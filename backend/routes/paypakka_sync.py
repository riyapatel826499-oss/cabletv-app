"""Paypakka sync endpoint — fetch new payments and send Telegram notifications."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import httpx
import time
import os
import logging
from models.base import get_db
from conn import get_conn
from deps_orm import _op_flt, get_current_user, apply_op_filter, op_id
from config import DB_PATH, PAYPAKKA_DISTRIBUTOR_REF_ID
from routes.notifications import notify_payment
from routes.settings import should_notify_payment
logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/paypakka", tags=["Paypakka"])
API_BASE = "https://api.paypakka.com"
HEADERS = {
   "Content-Type": "application/json",
   "x-app-version": "1.0",
   "x-user-agent": "Web",
   "x-app-id": "Distributor",
}
class SyncRequest(BaseModel):
   token: str  # Paypakka JWT token (captured from app.paypakka.com)
def paypakka_api(token: str, endpoint: str, body: dict):
   headers = {**HEADERS, "x-access-token": token}
   try:
       resp = httpx.post(f"{API_BASE}{endpoint}", json=body, headers=headers, timeout=30)
       if resp.status_code != 200:
           logger.error(f"Paypakka API error {resp.status_code}: {resp.text[:200]}")
           return None
       return resp.json()
   except Exception as e:
       logger.error(f"Paypakka API exception: {e}")
       return None
@router.post("/sync")
def sync_payments(req: SyncRequest, current_user=Depends(get_current_user)):
   """Sync latest Paypakka payments. Returns count of new payments found."""
   flt = _op_flt(current_user)
   _oid = op_id(current_user)
   # Master (admin) has no operator_id — infer from customer prefix
   if not _oid:
       with get_conn() as conn:
           op_row = conn.execute("SELECT id FROM operators WHERE status='active' LIMIT 1").fetchone()
           _oid = op_row["id"] if op_row else 1
   with get_conn() as conn:
       c = conn.cursor()
       # Build paypakka_id -> customer_id mapping
       c.execute(f"SELECT paypakka_id, customer_id FROM customers WHERE paypakka_id IS NOT NULL AND {flt}")
       paypakka_to_cust = {row["paypakka_id"]: row["customer_id"] for row in c.fetchall()}
       # Get the latest payment date we already have
       latest = c.execute(
           f"SELECT MAX(paypakka_created_at) as latest FROM paypakka_payments WHERE {flt}"
       ).fetchone()
       latest_date = latest["latest"] if latest and latest["latest"] else "2020-01-01"
       new_payments = []
       start = 0
       limit = 500
       total_checked = 0
       while True:
           data = paypakka_api(req.token, "/api/v2/payment/list", {
               "distributor_ref_id": PAYPAKKA_DISTRIBUTOR_REF_ID,
               "start": start,
               "limit": limit,
           })
           if not data:
               break
           payments = data.get("data", [])
           total_count = data.get("total_count", 0)
           if not payments:
               break
           for pay in payments:
               cust_ref_id = pay.get("cust_ref_id", "")
               customer_id = paypakka_to_cust.get(cust_ref_id)
               if not customer_id:
                   continue
               payment_ref_id = pay.get("_id", "")
               if not payment_ref_id:
                   continue
               created_at = pay.get("created_at", "")
               # Check if already exists (INSERT OR IGNORE logic)
               existing = c.execute(
                   f"SELECT 1 FROM paypakka_payments WHERE payment_ref_id = ? AND {flt}",
                   (payment_ref_id,),
               ).fetchone()
               if existing:
                   continue  # Already imported
               collection_amount = pay.get("collection_amount", 0)
               payment_type = pay.get("payment_type", "")
               # Insert new payment
               c.execute(
                   f"""INSERT OR IGNORE INTO paypakka_payments
                   (customer_id, payment_ref_id, transaction_id, service_ref_id,
                    plan_amount, bill_amount, collection_amount, discount_amount, tax,
                    payment_type, status, paypakka_created_at, emp_ref_id, operator_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                   (
                       customer_id,
                       payment_ref_id,
                       pay.get("transaction_id", ""),
                       pay.get("service_ref_id", ""),
                       pay.get("plan_amount", 0),
                       pay.get("bill_amount", 0),
                       collection_amount,
                       pay.get("discount_amount", 0),
                       pay.get("tax", 0),
                       payment_type,
                       pay.get("status", "Success"),
                       created_at,
                       pay.get("emp_ref_id", ""),
                       _oid,
                   ),
               )
               # Get customer details for notification
               cust = c.execute(
                   f"SELECT name, area, status FROM customers WHERE customer_id = ? AND {flt}",
                   (customer_id,),
               ).fetchone()
               new_payments.append({
                   "customer_id": customer_id,
                   "customer_name": cust["name"] if cust else "",
                   "area": cust["area"] if cust else "",
                   "customer_status": cust["status"] if cust else "active",
                   "amount": collection_amount,
                   "mode": payment_type,
                   "date": created_at,
               })
           total_checked += len(payments)
           start += limit
           if start >= total_count or len(payments) < limit:
               break
           time.sleep(0.3)
       conn.commit()
   # Send Telegram notifications for each new payment (based on settings)
   notified = 0
   for p in new_payments:
       try:
           if should_notify_payment(p.get("customer_status", "active"), operator_id=_oid):
               notify_payment(
                   customer_name=p["customer_name"],
                   customer_id=p["customer_id"],
                   amount=p["amount"],
                   mode=p["mode"],
                   source="Paypakka",
                   area=p.get("area", ""),
                   operator_id=_oid,
               )
           notified += 1
       except Exception:
           pass
   return {
       "new_payments": len(new_payments),
       "notified": notified,
       "total_checked": total_checked,
       "payments": new_payments,
   }
@router.get("/token-status")
def token_status(current_user=Depends(get_current_user)):
   """Check if a Paypakka token is configured (not stored, just informational)."""
   return {"message": "Provide token via POST /api/paypakka/sync"}
