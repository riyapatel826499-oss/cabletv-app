"""
Customer self-service web portal — login with Customer ID + mobile, no OTP/password.

Endpoints (prefix /api/portal):
  POST /customer/quick-login  { customer_id, phone }  → { token, name }
  GET  /dashboard                                      → customer + plan + status
  GET  /payments                                       → payment history
  GET  /complaints                                     → past problem reports
  POST /complaints          { type, description }      → insert into service_requests

Engine-safe (SQLite + Postgres). No new tables needed — reads from customers,
connections, payments, paypakka_payments, service_requests.

Register in main.py:
    "customer_portal_web": ("routes.customer_portal_web", "router"),
"""

import os
import json
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from conn import get_conn as _get_conn
from services.payments import get_date_range, paid_customer_subquery, paid_subquery_params

router = APIRouter(prefix="/api/portal", tags=["Customer Portal"])

PORTAL_SECRET = os.environ.get("PORTAL_JWT_SECRET", "portal-temp-secret-change-me")

try:
    from jose import jwt as jose_jwt
except Exception:
    jose_jwt = None


def _gen_token(customer_id: str) -> str:
    if jose_jwt is None:
        raise HTTPException(status_code=500, detail="JWT library not available")
    payload = {
        "sub": customer_id,
        "role": "portal_customer",
        "exp": datetime.utcnow() + timedelta(days=30),
    }
    return jose_jwt.encode(payload, PORTAL_SECRET, algorithm="HS256")


def _verify_token(token: str) -> str:
    if jose_jwt is None:
        raise HTTPException(status_code=500, detail="JWT library not available")
    try:
        payload = jose_jwt.decode(token, PORTAL_SECRET, algorithms=["HS256"])
        return payload.get("sub", "")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


def _is_sqlite() -> bool:
    try:
        from config import DB_ENGINE
        return DB_ENGINE == "sqlite"
    except Exception:
        return True


def _month_start_end(ym: str):
    """Given 'YYYY-MM', return (start_date, end_date)."""
    parts = ym.split("-")
    y, m = int(parts[0]), int(parts[1])
    if m == 12:
        return f"{y}-12-01", f"{y}-12-31"
    return f"{y}-{m:02d}-01", f"{y}-{m+1:02d}-01"


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


class LoginIn(BaseModel):
    stb_no: Optional[str] = None
    customer_id: Optional[str] = None
    phone: str


class ComplaintIn(BaseModel):
    type: str = "complaint"
    description: str


# ── Quick login ──────────────────────────────────────────────────────────────
@router.post("/customer/quick-login")
def quick_login(body: LoginIn):
    """Log in with STB number (primary) or Customer ID (fallback) + registered mobile."""
    raw = (body.stb_no or body.customer_id or "").strip().upper()
    phone = body.phone.strip()
    if not raw:
        raise HTTPException(status_code=422, detail="Provide stb_no or customer_id")
    customer_id = None

    with _get_conn() as conn:
        # 1. Try STB number (primary — printed on the box)
        row = conn.execute(
            "SELECT customer_id FROM connections WHERE UPPER(stb_no) = ? AND status = 'Active' LIMIT 1",
            [raw],
        ).fetchone()
        if row:
            customer_id = row["customer_id"]

        # 2. Try as Customer ID directly
        if not customer_id:
            row = conn.execute(
                "SELECT customer_id FROM customers WHERE customer_id = ?", [raw]
            ).fetchone()
            if row:
                customer_id = row["customer_id"]

        if not customer_id:
            raise HTTPException(status_code=401, detail="STB / Customer ID not found")

        # Verify phone matches
        row = conn.execute(
            "SELECT customer_id, name, phone, area FROM customers WHERE customer_id = ? AND phone = ?",
            [customer_id, phone],
        ).fetchone()
        if not row:
            row = conn.execute(
                "SELECT customer_id, name, phone, area FROM customers WHERE customer_id = ? AND phone2 = ?",
                [customer_id, phone],
            ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="STB / Customer ID and phone do not match")

    token = _gen_token(customer_id)
    return {
        "access_token": token,
        "token": token,
        "customer": {
            "customer_id": row["customer_id"],
            "name": row["name"],
            "phone": row["phone"],
            "area": row["area"],
        },
    }


# ── Dashboard ────────────────────────────────────────────────────────────────
@router.get("/dashboard")
def portal_dashboard(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    customer_id = _verify_token(authorization.replace("Bearer ", ""))

    with _get_conn() as conn:
        # Customer info
        cust = conn.execute(
            "SELECT customer_id, name, phone, phone2, area, address FROM customers WHERE customer_id = ?",
            [customer_id],
        ).fetchone()
        if not cust:
            raise HTTPException(status_code=404, detail="Customer not found")

        customer = dict(cust)

        # Active connection(s)
        conns = conn.execute(
            "SELECT plan_name, plan_amount, expiry_date, status FROM connections "
            "WHERE customer_id = ? AND status = 'Active' ORDER BY id DESC LIMIT 1",
            [customer_id],
        ).fetchall()

        plan_name = None
        plan_amount = None
        expiry_date = None
        is_active = False

        for c in conns:
            if c["status"] == "Active":
                plan_name = c["plan_name"]
                plan_amount = c["plan_amount"]
                expiry_date = c["expiry_date"]  # Already YYYY-MM-DD or NULL
                is_active = True
                break

        # Paid status for current month — reuse shared payment logic
        ms, me, cm = get_date_range(None, None)
        paid_params = paid_subquery_params(ms, me, cm)
        subq = paid_customer_subquery(cm)
        paid_row = conn.execute(
            f"SELECT customer_id FROM ({subq}) p WHERE p.customer_id = ?",
            [customer_id],
        ).fetchone()
        is_paid = paid_row is not None

        customer.update({
            "plan_name": plan_name,
            "plan_amount": plan_amount,
            "expiry_date": expiry_date,
            "is_active": is_active,
            "is_paid": is_paid,
            "month": cm,  # MM-YYYY
        })

    return customer


# ── Payment history ──────────────────────────────────────────────────────────
@router.get("/payments")
def portal_payments(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    customer_id = _verify_token(authorization.replace("Bearer ", ""))

    with _get_conn() as conn:
        local = conn.execute(
            "SELECT id, amount, payment_mode, payment_type, month_year, created_at, notes "
            "FROM payments WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50",
            [customer_id],
        ).fetchall()

        # Paypakka payments
        pp = conn.execute(
            "SELECT id, amount, payment_type, month_year, created_at, remarks "
            "FROM paypakka_payments WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50",
            [customer_id],
        ).fetchall()

    combined = []
    for r in local:
        combined.append({
            "id": r["id"],
            "amount": r["amount"],
            "mode": r["payment_mode"],
            "type": r["payment_type"],
            "month_year": r["month_year"],
            "date": r["created_at"],
            "notes": r["notes"],
            "source": "local",
        })
    for r in pp:
        combined.append({
            "id": r["id"],
            "amount": r["amount"],
            "mode": "Paypakka",
            "type": r["payment_type"],
            "month_year": r["month_year"],
            "date": r["created_at"],
            "notes": r["remarks"],
            "source": "paypakka",
        })

    combined.sort(key=lambda x: x["date"] or "", reverse=True)
    return {"count": len(combined), "payments": combined[:50]}


# ── Complaints / Problem reports ─────────────────────────────────────────────
def _gen_ticket_no(conn):
    """Generate a ticket number like SRP-202607-001"""
    prefix = "SRP"
    if _is_sqlite():
        nxt = conn.execute(
            f"SELECT COALESCE(MAX(CAST(SUBSTR(ticket_no, -3) AS INTEGER)), 0) + 1 "
            f"FROM service_requests WHERE ticket_no LIKE '{prefix}-%'"
        ).fetchone()[0]
    else:
        nxt = conn.execute(
            f"SELECT COALESCE(MAX(CAST(RIGHT(ticket_no, 3) AS INTEGER)), 0) + 1 "
            f"FROM service_requests WHERE ticket_no LIKE '{prefix}-%'"
        ).fetchone()[0]
    y = datetime.now().strftime("%Y%m")
    return f"{prefix}-{y}-{nxt:03d}"


@router.get("/complaints")
def portal_complaints(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    customer_id = _verify_token(authorization.replace("Bearer ", ""))

    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT ticket_no, type, category, description, status, created_at, resolved_at, remarks "
            "FROM service_requests WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20",
            [customer_id],
        ).fetchall()
    return {"count": len(rows), "complaints": [dict(r) for r in rows]}


@router.post("/complaints")
def create_portal_complaint(body: ComplaintIn, authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing token")
    customer_id = _verify_token(authorization.replace("Bearer ", ""))

    if not body.description or not body.description.strip():
        raise HTTPException(status_code=400, detail="Description is required")

    with _get_conn() as conn:
        tno = _gen_ticket_no(conn)
        now = datetime.now().isoformat()
        conn.execute(
            "INSERT INTO service_requests (ticket_no, customer_id, type, category, description, "
            "status, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [tno, customer_id, body.type, "portal", body.description.strip(),
             "Open", "portal", "Customer (Portal)", now],
        )
        conn.commit()

    return {"ticket_no": tno, "status": "Open", "message": "Problem reported. We'll contact you soon."}
