     1|"""Paypakka sync endpoint — fetch new payments and send Telegram notifications."""
     2|from fastapi import APIRouter, Depends, HTTPException
     3|from pydantic import BaseModel
     4|from typing import Optional
     5|import httpx
     6|import time
     7|import os
     8|import logging
     9|
    10|from models.base import get_db
from conn import get_conn
    11|from deps_orm import get_current_user, apply_op_filter, op_id
    12|from config import DB_PATH, PAYPAKKA_DISTRIBUTOR_REF_ID
    13|from routes.notifications import notify_payment
    14|from routes.settings import should_notify_payment
    15|
    16|logger = logging.getLogger(__name__)
    17|
    18|router = APIRouter(prefix="/api/paypakka", tags=["Paypakka"])
    19|
    20|API_BASE = "https://api.paypakka.com"
    21|HEADERS = {
    22|    "Content-Type": "application/json",
    23|    "x-app-version": "1.0",
    24|    "x-user-agent": "Web",
    25|    "x-app-id": "Distributor",
    26|}
    27|
    28|
    29|class SyncRequest(BaseModel):
    30|    token: str  # Paypakka JWT token (captured from app.paypakka.com)
    31|
    32|
    33|def paypakka_api(token: str, endpoint: str, body: dict):
    34|    headers = {**HEADERS, "x-access-token": token}
    35|    try:
    36|        resp = httpx.post(f"{API_BASE}{endpoint}", json=body, headers=headers, timeout=30)
    37|        if resp.status_code != 200:
    38|            logger.error(f"Paypakka API error {resp.status_code}: {resp.text[:200]}")
    39|            return None
    40|        return resp.json()
    41|    except Exception as e:
    42|        logger.error(f"Paypakka API exception: {e}")
    43|        return None
    44|
    45|
    46|@router.post("/sync")
    47|def sync_payments(req: SyncRequest, current_user=Depends(get_current_user)):
    48|    """Sync latest Paypakka payments. Returns count of new payments found."""
    49|    flt = op_filter(current_user)
    50|    _oid = op_id(current_user)
    51|    # Master (admin) has no operator_id — infer from customer prefix
    52|    if not _oid:
    53|        with get_conn() as conn:
    54|            op_row = conn.execute("SELECT id FROM operators WHERE status='active' LIMIT 1").fetchone()
    55|            _oid = op_row["id"] if op_row else 1
    56|
    57|    with get_conn() as conn:
    58|        c = conn.cursor()
    59|
    60|        # Build paypakka_id -> customer_id mapping
    61|        c.execute(f"SELECT paypakka_id, customer_id FROM customers WHERE paypakka_id IS NOT NULL AND {flt}")
    62|        paypakka_to_cust = {row["paypakka_id"]: row["customer_id"] for row in c.fetchall()}
    63|
    64|        # Get the latest payment date we already have
    65|        latest = c.execute(
    66|            f"SELECT MAX(paypakka_created_at) as latest FROM paypakka_payments WHERE {flt}"
    67|        ).fetchone()
    68|        latest_date = latest["latest"] if latest and latest["latest"] else "2020-01-01"
    69|
    70|        new_payments = []
    71|        start = 0
    72|        limit = 500
    73|        total_checked = 0
    74|
    75|        while True:
    76|            data = paypakka_api(req.token, "/api/v2/payment/list", {
    77|                "distributor_ref_id": PAYPAKKA_DISTRIBUTOR_REF_ID,
    78|                "start": start,
    79|                "limit": limit,
    80|            })
    81|
    82|            if not data:
    83|                break
    84|
    85|            payments = data.get("data", [])
    86|            total_count = data.get("total_count", 0)
    87|
    88|            if not payments:
    89|                break
    90|
    91|            for pay in payments:
    92|                cust_ref_id = pay.get("cust_ref_id", "")
    93|                customer_id = paypakka_to_cust.get(cust_ref_id)
    94|                if not customer_id:
    95|                    continue
    96|
    97|                payment_ref_id = pay.get("_id", "")
    98|                if not payment_ref_id:
    99|                    continue
   100|
   101|                created_at = pay.get("created_at", "")
   102|
   103|                # Check if already exists (INSERT OR IGNORE logic)
   104|                existing = c.execute(
   105|                    f"SELECT 1 FROM paypakka_payments WHERE payment_ref_id = ? AND {flt}",
   106|                    (payment_ref_id,),
   107|                ).fetchone()
   108|                if existing:
   109|                    continue  # Already imported
   110|
   111|                collection_amount = pay.get("collection_amount", 0)
   112|                payment_type = pay.get("payment_type", "")
   113|
   114|                # Insert new payment
   115|                c.execute(
   116|                    f"""INSERT OR IGNORE INTO paypakka_payments
   117|                    (customer_id, payment_ref_id, transaction_id, service_ref_id,
   118|                     plan_amount, bill_amount, collection_amount, discount_amount, tax,
   119|                     payment_type, status, paypakka_created_at, emp_ref_id, operator_id)
   120|                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
   121|                    (
   122|                        customer_id,
   123|                        payment_ref_id,
   124|                        pay.get("transaction_id", ""),
   125|                        pay.get("service_ref_id", ""),
   126|                        pay.get("plan_amount", 0),
   127|                        pay.get("bill_amount", 0),
   128|                        collection_amount,
   129|                        pay.get("discount_amount", 0),
   130|                        pay.get("tax", 0),
   131|                        payment_type,
   132|                        pay.get("status", "Success"),
   133|                        created_at,
   134|                        pay.get("emp_ref_id", ""),
   135|                        _oid,
   136|                    ),
   137|                )
   138|
   139|                # Get customer details for notification
   140|                cust = c.execute(
   141|                    f"SELECT name, area, status FROM customers WHERE customer_id = ? AND {flt}",
   142|                    (customer_id,),
   143|                ).fetchone()
   144|
   145|                new_payments.append({
   146|                    "customer_id": customer_id,
   147|                    "customer_name": cust["name"] if cust else "",
   148|                    "area": cust["area"] if cust else "",
   149|                    "customer_status": cust["status"] if cust else "active",
   150|                    "amount": collection_amount,
   151|                    "mode": payment_type,
   152|                    "date": created_at,
   153|                })
   154|
   155|            total_checked += len(payments)
   156|            start += limit
   157|
   158|            if start >= total_count or len(payments) < limit:
   159|                break
   160|            time.sleep(0.3)
   161|
   162|        conn.commit()
   163|
   164|    # Send Telegram notifications for each new payment (based on settings)
   165|    notified = 0
   166|    for p in new_payments:
   167|        try:
   168|            if should_notify_payment(p.get("customer_status", "active"), operator_id=_oid):
   169|                notify_payment(
   170|                    customer_name=p["customer_name"],
   171|                    customer_id=p["customer_id"],
   172|                    amount=p["amount"],
   173|                    mode=p["mode"],
   174|                    source="Paypakka",
   175|                    area=p.get("area", ""),
   176|                    operator_id=_oid,
   177|                )
   178|            notified += 1
   179|        except Exception:
   180|            pass
   181|
   182|    return {
   183|        "new_payments": len(new_payments),
   184|        "notified": notified,
   185|        "total_checked": total_checked,
   186|        "payments": new_payments,
   187|    }
   188|
   189|
   190|@router.get("/token-status")
   191|def token_status(current_user=Depends(get_current_user)):
   192|    """Check if a Paypakka token is configured (not stored, just informational)."""
   193|    return {"message": "Provide token via POST /api/paypakka/sync"}
   194|