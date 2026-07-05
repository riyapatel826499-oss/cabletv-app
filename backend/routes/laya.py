"""
Laya Internet Integration Routes

POST /api/laya/sync-subscribers  — Import/update subscribers from CRM
POST /api/laya/import-statement  — Upload & parse deposit statement (auto-reconcile)
GET  /api/laya/wallet            — Current wallet balance from CRM
GET  /api/laya/subscribers       — List Laya subscribers in Wasool
GET  /api/laya/collection-status — Monthly collection status (paid/unpaid)
"""
import logging
import re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import text
from datetime import datetime

from models.base import get_db
from deps_orm import get_current_user, require_role
from conn import get_conn
from config import DB_ENGINE

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/laya", tags=["Laya"])

CUSTOMER_PREFIX = "LAY"


# ── Helpers ────────────────────────────────────────────────────

def _normalize_name(name: str) -> str:
    """Normalize name for fuzzy matching."""
    return re.sub(r"[^a-z]", "", name.lower())


def _get_or_create_customer(conn, crm_sub: dict, operator_id: int = 1) -> str:
    """Find or create a customer record from CRM subscriber data."""
    name = crm_sub.get("subscriber_name", "").strip()
    if not name:
        return None

    phone = crm_sub.get("subscriber_mobile", "").strip()
    norm = _normalize_name(name)

    # Try to find existing customer by name match
    existing = conn.execute(
        text("SELECT customer_id, name FROM customers WHERE operator_id = :op"),
        {"op": operator_id},
    ).fetchall()

    for row in existing:
        if _normalize_name(row[1]) == norm:
            # Update phone if missing
            if phone:
                conn.execute(
                    text("UPDATE customers SET phone = :ph WHERE customer_id = :cid AND (phone IS NULL OR phone = '')"),
                    {"ph": phone, "cid": row[0]},
                )
            return row[0]

    # Create new customer
    # Find next LAY-xxxx ID
    max_id_row = conn.execute(
        text("SELECT customer_id FROM customers WHERE customer_id LIKE :pat ORDER BY customer_id DESC LIMIT 1"),
        {"pat": f"{CUSTOMER_PREFIX}-%"},
    ).fetchone()

    if max_id_row:
        try:
            next_num = int(max_id_row[0].split("-")[1]) + 1
        except (ValueError, IndexError):
            next_num = 1
    else:
        next_num = 1

    customer_id = f"{CUSTOMER_PREFIX}-{next_num:04d}"
    area = (crm_sub.get("subscibre_install_address") or "").split(",")[-1].strip()[:50]

    addr = (crm_sub.get("subscibre_install_address") or "").strip()

    conn.execute(
        text("""INSERT INTO customers (customer_id, name, phone, address, area, status, operator_id)
                VALUES (:cid, :name, :phone, :addr, :area, 'Active', :op)"""),
        {
            "cid": customer_id,
            "name": name,
            "phone": phone,
            "addr": addr,
            "area": area,
            "op": operator_id,
        },
    )
    return customer_id


def _get_plan_amount(packagename: str) -> float:
    """Map Laya package name to plan amount (total incl GST)."""
    # Common Laya plans — total monthly amount including 18% GST
    plan_map = {
        "Laya-Fiber_30": 589,       # 499 + GST
        "Laya-S-Fiber-50": 589,
        "Laya-S+-Fiber-100": 707,   # 599 + GST
        "LAYA-STAR-OP-UL30": 589,
        "LAYA-STAR-OP-UL50": 589,
        "LAYA-STAR-OP-UL100": 707,
        "Laya-G-Fiber-150": 943,    # 799 + GST
        "Laya-G+-Fiber-300": 1474,  # 1249 + GST
    }
    for key, amount in plan_map.items():
        if key.lower() in packagename.lower():
            return amount
    return 589  # default to most common


# ── Endpoints ──────────────────────────────────────────────────

class ImportStatementRequest(BaseModel):
    content: str  # HTML content of the .xls file


@router.post("/sync-subscribers")
async def sync_subscribers(
    current_user=Depends(require_role("admin", "support", "master")),
    db=Depends(get_db),
):
    """Import/update all Laya subscribers from CRM into Wasool."""
    from services.laya_crm import get_subscribers, ensure_session

    if not ensure_session():
        raise HTTPException(503, "Could not login to Laya CRM")

    subs = get_subscribers()
    if not subs:
        raise HTTPException(502, "No subscribers returned from CRM")

    operator_id = current_user.get("operator_id", 1)
    created = 0
    updated = 0
    errors = []

    with get_conn() as conn:
        for sub in subs:
            try:
                name = (sub.get("subscriber_name") or "").strip()
                if not name:
                    continue

                acc_no = str(sub.get("subscriber_acc_no", ""))
                phone = (sub.get("subscriber_mobile") or "").strip()
                addr = (sub.get("subscibre_install_address") or "").strip()
                pkg = (sub.get("subscriber_packrunning") or "").strip()
                expiry = (sub.get("expirydate") or "").strip()

                # Find or create customer
                customer_id = _get_or_create_customer(conn, sub, operator_id)
                if not customer_id:
                    continue

                # Check if connection already exists
                existing_conn = conn.execute(
                    text("SELECT id FROM connections WHERE stb_no = :stb AND customer_id = :cid"),
                    {"stb": acc_no, "cid": customer_id},
                ).fetchone()

                plan_amount = _get_plan_amount(pkg)

                if existing_conn:
                    # Update
                    conn.execute(
                        text("""UPDATE connections SET
                                    plan_name = :pkg, plan_amount = :amt, expiry_date = :exp,
                                    updated_at = :now
                                WHERE id = :id"""),
                        {
                            "pkg": pkg[:100], "amt": plan_amount, "exp": expiry[:20],
                            "now": datetime.now().isoformat(), "id": existing_conn[0],
                        },
                    )
                    updated += 1
                else:
                    # Create connection
                    conn.execute(
                        text("""INSERT INTO connections
                                (customer_id, stb_no, mso, network, service_type, billing_type,
                                 status, plan_name, plan_amount, expiry_date, operator_id, created_at)
                                VALUES (:cid, :stb, 'LAYA', 'INTERNET', 'Internet', 'Prepaid',
                                        'Active', :pkg, :amt, :exp, :op, :now)"""),
                        {
                            "cid": customer_id, "stb": acc_no, "pkg": pkg[:100],
                            "amt": plan_amount, "exp": expiry[:20],
                            "op": operator_id, "now": datetime.now().isoformat(),
                        },
                    )
                    created += 1
            except Exception as e:
                errors.append(f"{name}: {e}")
                log.warning(f"Laya sync error for {name}: {e}")

        conn.commit()

    return {
        "success": True,
        "total_in_crm": len(subs),
        "created": created,
        "updated": updated,
        "errors": errors[:5],
    }


@router.post("/import-statement")
async def import_statement(
    req: ImportStatementRequest,
    current_user=Depends(require_role("admin", "support", "master")),
    db=Depends(get_db),
):
    """Parse deposit statement HTML and auto-create payment records.

    Categories:
    - online_payment: customer paid online → create payment (auto-collected)
    - recharge (cash): manually recharged → create payment if not already present
    - wallet_topup: your UPI deposit → record, no customer payment
    """
    from services.laya_crm import parse_statement_html

    txns = parse_statement_html(req.content)
    if not txns:
        raise HTTPException(400, "No transactions found in statement")

    operator_id = current_user.get("operator_id", 1)
    username = current_user.get("username", "system")

    results = {
        "online_payments": 0,
        "cash_recharges": 0,
        "wallet_topups": 0,
        "payments_created": 0,
        "skipped_duplicates": 0,
        "collection_pending": [],
    }

    # Extract month_year from first transaction date
    first_date = txns[0].get("date", "")
    m = re.match(r"(\d{2})-(\d{2})-(\d{4})", first_date)
    month_year = f"{m.group(2)}-{m.group(3)}" if m else datetime.now().strftime("%m-%Y")

    with get_conn() as conn:
        # Build customer name → customer_id index
        customers = conn.execute(
            text("SELECT customer_id, name FROM customers WHERE operator_id = :op"),
            {"op": operator_id},
        ).fetchall()
        name_index = {}
        for row in customers:
            name_index[_normalize_name(row[1])] = row[0]

        for txn in txns:
            cust_name = txn.get("customer_name", "")
            cust_id = name_index.get(_normalize_name(cust_name)) if cust_name else None

            if txn["type"] == "wallet_topup":
                results["wallet_topups"] += 1
                continue

            if txn["type"] == "online_payment":
                results["online_payments"] += 1

            elif txn["type"] == "recharge":
                results["cash_recharges"] += 1

                # Check if payment already exists for this customer/month
                if cust_id:
                    existing = conn.execute(
                        text("""SELECT id FROM payments
                                WHERE customer_id = :cid AND month_year = :my
                                AND amount = :amt LIMIT 1"""),
                        {"cid": cust_id, "my": month_year, "amt": txn["total_amount"]},
                    ).fetchone()

                    if existing:
                        results["skipped_duplicates"] += 1
                        continue

                results["collection_pending"].append({
                    "name": cust_name,
                    "phone": "",
                    "amount": txn["total_amount"],
                    "date": txn["date"],
                    "customer_id": cust_id,
                })

            # Create payment record
            if cust_id and txn["total_amount"] > 0:
                payment_mode = "online" if txn["type"] == "online_payment" else "cash"

                # Find connection for this customer
                conn_row = conn.execute(
                    text("SELECT id FROM connections WHERE customer_id = :cid LIMIT 1"),
                    {"cid": cust_id},
                ).fetchone()
                connection_id = conn_row[0] if conn_row else None

                conn.execute(
                    text("""INSERT INTO payments
                            (customer_id, connection_id, amount, payment_mode, month_year,
                             collected_at, collected_by, operator_id, payment_type, notes)
                            VALUES (:cid, :conn, :amt, :mode, :my, :dt, :by, :op, :ptype, :notes)"""),
                    {
                        "cid": cust_id,
                        "conn": connection_id,
                        "amt": txn["total_amount"],
                        "mode": payment_mode,
                        "my": month_year,
                        "dt": datetime.now().isoformat(),
                        "by": username,
                        "op": operator_id,
                        "ptype": payment_mode,
                        "notes": f"Laya {txn['type']}",
                    },
                )
                results["payments_created"] += 1

        conn.commit()

    return {
        "success": True,
        "month_year": month_year,
        "total_transactions": len(txns),
        **results,
    }


@router.get("/wallet")
async def laya_wallet(
    current_user=Depends(require_role("admin", "support", "master")),
):
    """Get current Laya wallet balance from CRM."""
    from services.laya_crm import get_wallet_balance
    return get_wallet_balance()


@router.get("/subscribers")
async def laya_subscribers(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """List all Laya subscribers from Wasool DB."""
    with get_conn() as conn:
        rows = conn.execute(
            text("""SELECT c.customer_id, c.name, c.phone, c.area,
                       cn.stb_no as account_no, cn.plan_name, cn.plan_amount,
                       cn.status, cn.expiry_date
                   FROM customers c
                   JOIN connections cn ON c.customer_id = cn.customer_id
                   WHERE cn.mso = 'LAYA'
                   ORDER BY c.name"""),
        ).fetchall()

    subscribers = []
    for r in rows:
        subscribers.append({
            "customer_id": r[0],
            "name": r[1],
            "phone": r[2],
            "area": r[3],
            "account_no": r[4],
            "plan_name": r[5],
            "plan_amount": r[6],
            "status": r[7],
            "expiry_date": r[8],
        })

    return {"subscribers": subscribers, "total": len(subscribers)}


@router.get("/collection-status")
async def collection_status(
    current_user=Depends(require_role("admin", "support", "master")),
    db=Depends(get_db),
):
    """Monthly collection status for Laya subscribers."""
    month_year = datetime.now().strftime("%m-%Y")

    with get_conn() as conn:
        # All active Laya customers
        active = conn.execute(
            text("""SELECT c.customer_id, c.name, c.phone, cn.plan_amount,
                       cn.stb_no
                   FROM customers c
                   JOIN connections cn ON c.customer_id = cn.customer_id
                   WHERE cn.mso = 'LAYA' AND cn.status = 'Active'"""),
        ).fetchall()

        # Who has paid this month
        paid_ids = set()
        paid_rows = conn.execute(
            text("""SELECT DISTINCT customer_id FROM payments
                    WHERE month_year = :my AND customer_id IN (
                        SELECT customer_id FROM connections WHERE mso = 'LAYA')"""),
            {"my": month_year},
        ).fetchall()
        paid_ids = {r[0] for r in paid_rows}

    paid_list = []
    unpaid_list = []
    for r in active:
        entry = {
            "customer_id": r[0],
            "name": r[1],
            "phone": r[2],
            "amount": r[3],
            "account_no": r[4],
            "paid": r[0] in paid_ids,
        }
        if r[0] in paid_ids:
            paid_list.append(entry)
        else:
            unpaid_list.append(entry)

    total_revenue = sum(r[3] or 0 for r in active)
    collected = sum(r[3] or 0 for r in active if r[0] in paid_ids)

    return {
        "month_year": month_year,
        "total_active": len(active),
        "paid": len(paid_list),
        "unpaid": len(unpaid_list),
        "total_revenue": total_revenue,
        "collected": collected,
        "pending": total_revenue - collected,
        "collection_rate": round(collected / total_revenue * 100, 1) if total_revenue else 0,
        "unpaid_customers": unpaid_list,
    }
