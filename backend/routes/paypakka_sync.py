     1|     1|"""Paypakka sync endpoint — fetch new payments and send Telegram notifications."""
     2|     2|from fastapi import APIRouter, Depends, HTTPException
     3|     3|from pydantic import BaseModel
     4|     4|from typing import Optional
     5|     5|import httpx
     6|     6|import time
     7|     7|import os
     8|     8|import logging
     9|     9|
    10|    10|from models.base import get_db
    11|from conn import get_conn
    12|    11|from deps_orm import _op_flt, get_current_user, apply_op_filter, op_id
    13|    12|from config import DB_PATH, PAYPAKKA_DISTRIBUTOR_REF_ID
    14|    13|from routes.notifications import notify_payment
    15|    14|from routes.settings import should_notify_payment
    16|    15|
    17|    16|logger = logging.getLogger(__name__)
    18|    17|
    19|    18|router = APIRouter(prefix="/api/paypakka", tags=["Paypakka"])
    20|    19|
    21|    20|API_BASE = "https://api.paypakka.com"
    22|    21|HEADERS = {
    23|    22|    "Content-Type": "application/json",
    24|    23|    "x-app-version": "1.0",
    25|    24|    "x-user-agent": "Web",
    26|    25|    "x-app-id": "Distributor",
    27|    26|}
    28|    27|
    29|    28|
    30|    29|class SyncRequest(BaseModel):
    31|    30|    token: str  # Paypakka JWT token (captured from app.paypakka.com)
    32|    31|
    33|    32|
    34|    33|def paypakka_api(token: str, endpoint: str, body: dict):
    35|    34|    headers = {**HEADERS, "x-access-token": token}
    36|    35|    try:
    37|    36|        resp = httpx.post(f"{API_BASE}{endpoint}", json=body, headers=headers, timeout=30)
    38|    37|        if resp.status_code != 200:
    39|    38|            logger.error(f"Paypakka API error {resp.status_code}: {resp.text[:200]}")
    40|    39|            return None
    41|    40|        return resp.json()
    42|    41|    except Exception as e:
    43|    42|        logger.error(f"Paypakka API exception: {e}")
    44|    43|        return None
    45|    44|
    46|    45|
    47|    46|@router.post("/sync")
    48|    47|def sync_payments(req: SyncRequest, current_user=Depends(get_current_user)):
    49|    48|    """Sync latest Paypakka payments. Returns count of new payments found."""
    50|    49|    flt = _op_flt(current_user)
    51|    50|    _oid = op_id(current_user)
    52|    51|    # Master (admin) has no operator_id — infer from customer prefix
    53|    52|    if not _oid:
    54|    53|        with get_conn() as conn:
    55|    54|            op_row = conn.execute("SELECT id FROM operators WHERE status='active' LIMIT 1").fetchone()
    56|    55|            _oid = op_row["id"] if op_row else 1
    57|    56|
    58|    57|    with get_conn() as conn:
    59|    58|        c = conn.cursor()
    60|    59|
    61|    60|        # Build paypakka_id -> customer_id mapping
    62|    61|        c.execute(f"SELECT paypakka_id, customer_id FROM customers WHERE paypakka_id IS NOT NULL AND {flt}")
    63|    62|        paypakka_to_cust = {row["paypakka_id"]: row["customer_id"] for row in c.fetchall()}
    64|    63|
    65|    64|        # Get the latest payment date we already have
    66|    65|        latest = c.execute(
    67|    66|            f"SELECT MAX(paypakka_created_at) as latest FROM paypakka_payments WHERE {flt}"
    68|    67|        ).fetchone()
    69|    68|        latest_date = latest["latest"] if latest and latest["latest"] else "2020-01-01"
    70|    69|
    71|    70|        new_payments = []
    72|    71|        start = 0
    73|    72|        limit = 500
    74|    73|        total_checked = 0
    75|    74|
    76|    75|        while True:
    77|    76|            data = paypakka_api(req.token, "/api/v2/payment/list", {
    78|    77|                "distributor_ref_id": PAYPAKKA_DISTRIBUTOR_REF_ID,
    79|    78|                "start": start,
    80|    79|                "limit": limit,
    81|    80|            })
    82|    81|
    83|    82|            if not data:
    84|    83|                break
    85|    84|
    86|    85|            payments = data.get("data", [])
    87|    86|            total_count = data.get("total_count", 0)
    88|    87|
    89|    88|            if not payments:
    90|    89|                break
    91|    90|
    92|    91|            for pay in payments:
    93|    92|                cust_ref_id = pay.get("cust_ref_id", "")
    94|    93|                customer_id = paypakka_to_cust.get(cust_ref_id)
    95|    94|                if not customer_id:
    96|    95|                    continue
    97|    96|
    98|    97|                payment_ref_id = pay.get("_id", "")
    99|    98|                if not payment_ref_id:
   100|    99|                    continue
   101|   100|
   102|   101|                created_at = pay.get("created_at", "")
   103|   102|
   104|   103|                # Check if already exists (INSERT OR IGNORE logic)
   105|   104|                existing = c.execute(
   106|   105|                    f"SELECT 1 FROM paypakka_payments WHERE payment_ref_id = ? AND {flt}",
   107|   106|                    (payment_ref_id,),
   108|   107|                ).fetchone()
   109|   108|                if existing:
   110|   109|                    continue  # Already imported
   111|   110|
   112|   111|                collection_amount = pay.get("collection_amount", 0)
   113|   112|                payment_type = pay.get("payment_type", "")
   114|   113|
   115|   114|                # Insert new payment
   116|   115|                c.execute(
   117|   116|                    f"""INSERT OR IGNORE INTO paypakka_payments
   118|   117|                    (customer_id, payment_ref_id, transaction_id, service_ref_id,
   119|   118|                     plan_amount, bill_amount, collection_amount, discount_amount, tax,
   120|   119|                     payment_type, status, paypakka_created_at, emp_ref_id, operator_id)
   121|   120|                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
   122|   121|                    (
   123|   122|                        customer_id,
   124|   123|                        payment_ref_id,
   125|   124|                        pay.get("transaction_id", ""),
   126|   125|                        pay.get("service_ref_id", ""),
   127|   126|                        pay.get("plan_amount", 0),
   128|   127|                        pay.get("bill_amount", 0),
   129|   128|                        collection_amount,
   130|   129|                        pay.get("discount_amount", 0),
   131|   130|                        pay.get("tax", 0),
   132|   131|                        payment_type,
   133|   132|                        pay.get("status", "Success"),
   134|   133|                        created_at,
   135|   134|                        pay.get("emp_ref_id", ""),
   136|   135|                        _oid,
   137|   136|                    ),
   138|   137|                )
   139|   138|
   140|   139|                # Get customer details for notification
   141|   140|                cust = c.execute(
   142|   141|                    f"SELECT name, area, status FROM customers WHERE customer_id = ? AND {flt}",
   143|   142|                    (customer_id,),
   144|   143|                ).fetchone()
   145|   144|
   146|   145|                new_payments.append({
   147|   146|                    "customer_id": customer_id,
   148|   147|                    "customer_name": cust["name"] if cust else "",
   149|   148|                    "area": cust["area"] if cust else "",
   150|   149|                    "customer_status": cust["status"] if cust else "active",
   151|   150|                    "amount": collection_amount,
   152|   151|                    "mode": payment_type,
   153|   152|                    "date": created_at,
   154|   153|                })
   155|   154|
   156|   155|            total_checked += len(payments)
   157|   156|            start += limit
   158|   157|
   159|   158|            if start >= total_count or len(payments) < limit:
   160|   159|                break
   161|   160|            time.sleep(0.3)
   162|   161|
   163|   162|        conn.commit()
   164|   163|
   165|   164|    # Send Telegram notifications for each new payment (based on settings)
   166|   165|    notified = 0
   167|   166|    for p in new_payments:
   168|   167|        try:
   169|   168|            if should_notify_payment(p.get("customer_status", "active"), operator_id=_oid):
   170|   169|                notify_payment(
   171|   170|                    customer_name=p["customer_name"],
   172|   171|                    customer_id=p["customer_id"],
   173|   172|                    amount=p["amount"],
   174|   173|                    mode=p["mode"],
   175|   174|                    source="Paypakka",
   176|   175|                    area=p.get("area", ""),
   177|   176|                    operator_id=_oid,
   178|   177|                )
   179|   178|            notified += 1
   180|   179|        except Exception:
   181|   180|            pass
   182|   181|
   183|   182|    return {
   184|   183|        "new_payments": len(new_payments),
   185|   184|        "notified": notified,
   186|   185|        "total_checked": total_checked,
   187|   186|        "payments": new_payments,
   188|   187|    }
   189|   188|
   190|   189|
   191|   190|@router.get("/token-status")
   192|   191|def token_status(current_user=Depends(get_current_user)):
   193|   192|    """Check if a Paypakka token is configured (not stored, just informational)."""
   194|   193|    return {"message": "Provide token via POST /api/paypakka/sync"}
   195|   194|