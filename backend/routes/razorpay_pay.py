"""
Razorpay Standard Checkout + webhook auto-confirmation.

Public endpoints (used by the public /app/pay page):
  POST /api/create-order     { amount(paise), receipt?, customer_id?, month? }
                             -> { order_id, amount, currency, key_id }
  POST /api/verify-payment   { razorpay_order_id, razorpay_payment_id, razorpay_signature }
  POST /api/razorpay/webhook  (called by Razorpay servers) -> auto-records the payment

Keys/secret come ONLY from environment variables:
  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET

Auto-confirmation: the order carries the customer_id + month in Razorpay "notes". When
Razorpay confirms the payment, the webhook records it via the app's OWN create_payment
logic (so plan expiry advances correctly). Every webhook is also logged to the
`online_payments` table, so if the billing write ever fails it's kept for one-tap review
instead of being lost.

Register in main.py by adding to the _routers dict:
  "razorpay_pay": ("routes.razorpay_pay", "router"),
"""

import os
import json
import hmac
import hashlib
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from conn import get_conn as _get_conn

router = APIRouter(prefix="/api", tags=["Razorpay"])

KEY_ID = os.environ.get("RAZORPAY_KEY_ID")
KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET")
WEBHOOK_SECRET = os.environ.get("RAZORPAY_WEBHOOK_SECRET")


class OrderIn(BaseModel):
    amount: int                       # paise (₹1 = 100)
    receipt: Optional[str] = None
    customer_id: Optional[str] = None
    month: Optional[str] = None       # 'YYYY-MM'


class VerifyIn(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


# ── Create order ────────────────────────────────────────────────────────────
@router.post("/create-order")
def create_order(body: OrderIn):
    if not KEY_ID or not KEY_SECRET:
        raise HTTPException(status_code=500, detail="Razorpay keys not configured on server")
    if body.amount is None or body.amount < 100:
        raise HTTPException(status_code=400, detail="Amount must be at least 100 paise (\u20b91)")

    try:
        import razorpay
    except Exception:
        raise HTTPException(status_code=500, detail="razorpay package not installed on server")

    client = razorpay.Client(auth=(KEY_ID, KEY_SECRET))
    notes = {}
    if body.customer_id:
        notes["customer_id"] = body.customer_id
    if body.month:
        notes["month"] = body.month
    try:
        order = client.order.create({
            "amount": int(body.amount),
            "currency": "INR",
            "receipt": body.receipt or "wasool",
            "payment_capture": 1,
            "notes": notes,
        })
    except razorpay.errors.BadRequestError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if "authentication" in msg or "unauthorized" in msg or "401" in msg:
            raise HTTPException(status_code=401, detail="Razorpay authentication failed")
        raise HTTPException(status_code=500, detail=f"Could not create order: {e}")

    return {"order_id": order["id"], "amount": order["amount"],
            "currency": order["currency"], "key_id": KEY_ID}


# ── Verify signature (called by the browser after checkout) ──────────────────
@router.post("/verify-payment")
def verify_payment(body: VerifyIn):
    if not (body.razorpay_order_id and body.razorpay_payment_id and body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Missing payment fields")
    if not KEY_SECRET:
        raise HTTPException(status_code=500, detail="Razorpay keys not configured on server")
    message = f"{body.razorpay_order_id}|{body.razorpay_payment_id}".encode()
    expected = hmac.new(KEY_SECRET.encode(), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, body.razorpay_signature):
        raise HTTPException(status_code=400, detail="Payment signature verification failed")
    return {"status": "ok", "payment_id": body.razorpay_payment_id}


# ── Webhook (called by Razorpay servers) — auto-confirmation ─────────────────
def _is_sqlite() -> bool:
    try:
        from config import DB_ENGINE
        return DB_ENGINE == "sqlite"
    except Exception:
        return True


def _ensure_online_table(conn):
    if _is_sqlite():
        conn.execute(
            "CREATE TABLE IF NOT EXISTS online_payments ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, razorpay_payment_id TEXT UNIQUE, "
            "razorpay_order_id TEXT, customer_id TEXT, month TEXT, amount REAL, "
            "status TEXT, error TEXT, created_at TEXT)"
        )
    else:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS online_payments ("
            "id SERIAL PRIMARY KEY, razorpay_payment_id TEXT UNIQUE, "
            "razorpay_order_id TEXT, customer_id TEXT, month TEXT, amount REAL, "
            "status TEXT, error TEXT, created_at TEXT)"
        )


def _post_to_billing(customer_id: str, month: Optional[str], amount_paise: int):
    """Record the payment through the app's own create_payment (advances expiry)."""
    from routes.payments import create_payment, PaymentCreate
    from models.base import get_db
    from sqlalchemy import select
    from models.tables import CustomerPlan

    my = None
    if month and "-" in month:            # 'YYYY-MM' -> app's 'MM-YYYY'
        y, m = month.split("-")[0], month.split("-")[1]
        my = f"{m}-{y}"

    gen = get_db()
    db = next(gen)
    try:
        plan_id = db.execute(
            select(CustomerPlan.plan_id).where(
                CustomerPlan.customer_id == customer_id,
                CustomerPlan.status == "Active",
            )
        ).scalars().first()
        data = PaymentCreate(
            customer_id=customer_id,
            connection_id=-1,             # auto-detect active connection
            plan_id=plan_id,
            amount=round((amount_paise or 0) / 100.0, 2),
            payment_mode="Online (Razorpay)",
            payment_type="regular",
            month_year=my,
            months_paid=1,
            notes="Razorpay online payment",
        )
        system_user = {"id": None, "operator_id": None, "role": "master", "name": "Razorpay Online"}
        create_payment(data, db=db, current_user=system_user)  # commits internally
    finally:
        try:
            gen.close()
        except Exception:
            pass


def _record_online_payment(payment_id, order_id, customer_id, month, amount_paise):
    with _get_conn() as conn:
        _ensure_online_table(conn)
        if not payment_id:
            return
        seen = conn.execute(
            "SELECT 1 FROM online_payments WHERE razorpay_payment_id = ?", [payment_id]
        ).fetchone()
        if seen:
            return  # idempotent — already processed

        status, err = "captured", None
        if customer_id:
            try:
                _post_to_billing(customer_id, month, amount_paise)
                status = "recorded"
            except Exception as e:  # noqa: BLE001 — never lose the payment
                status, err = "needs_review", str(e)[:400]
        else:
            status = "no_customer_id"

        conn.execute(
            "INSERT INTO online_payments (razorpay_payment_id, razorpay_order_id, customer_id, "
            "month, amount, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [payment_id, order_id, customer_id, month, (amount_paise or 0) / 100.0,
             status, err, datetime.now().isoformat()],
        )
        conn.commit()


@router.post("/razorpay/webhook")
async def razorpay_webhook(request: Request):
    raw = await request.body()
    if not WEBHOOK_SECRET:
        raise HTTPException(status_code=500, detail="Webhook secret not configured")
    signature = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        payload = json.loads(raw or b"{}")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event = payload.get("event", "")
    entity = {}
    if event in ("payment.captured", "payment.authorized"):
        entity = payload.get("payload", {}).get("payment", {}).get("entity", {})
    elif event == "order.paid":
        entity = (payload.get("payload", {}).get("payment", {}).get("entity", {})
                  or payload.get("payload", {}).get("order", {}).get("entity", {}))
    if not entity:
        return {"status": "ignored", "event": event}

    notes = entity.get("notes") or {}
    _record_online_payment(
        payment_id=entity.get("id"),
        order_id=entity.get("order_id"),
        customer_id=notes.get("customer_id"),
        month=notes.get("month"),
        amount_paise=entity.get("amount") or 0,
    )
    return {"status": "ok"}
