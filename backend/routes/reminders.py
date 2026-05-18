"""Payment reminder endpoints — WhatsApp reminders via CARE bridge only."""
import datetime
import json
import os
import random
import time as _time
from typing import Optional, List

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

from models.base import get_db
from deps_orm import get_current_user, apply_op_filter, op_id

router = APIRouter(prefix="/api/reminders", tags=["Reminders"])

# CARE bridge only (wife's number 7708551139) — never use personal number
CARE_BRIDGE = "http://localhost:3001/send"
MAX_PER_DAY = 15  # Safe limit per WhatsApp account per operator


# ── Helpers ──────────────────────────────────────────────────────────────

def _normalize_phone(phone: str) -> str:
    """Strip + and spaces, return digits only."""
    return phone.replace("+", "").replace(" ", "").replace("-", "").strip()


def _chat_id(phone: str) -> str:
    """Convert phone to WhatsApp chat ID."""
    digits = _normalize_phone(phone)
    if digits.startswith("91") and len(digits) == 12:
        return f"{digits}@s.whatsapp.net"
    return f"{digits}@s.whatsapp.net"


def _today_key() -> str:
    return datetime.date.today().isoformat()


def _sent_today_file(operator_id) -> str:
    """Per-operator sent tracking file."""
    oid_suffix = f"_{operator_id}" if operator_id else ""
    return f"/tmp/reminders_sent_{_today_key()}{oid_suffix}.json"


def _load_sent_today(operator_id) -> set:
    """Load set of customer IDs already sent today for this operator."""
    f = _sent_today_file(operator_id)
    if os.path.exists(f):
        with open(f) as fh:
            return set(json.load(fh))
    return set()


def _save_sent_today(sent: set, operator_id):
    with open(_sent_today_file(operator_id), "w") as fh:
        json.dump(list(sent), fh)


def _count_sent_today(operator_id) -> int:
    return len(_load_sent_today(operator_id))


# ── Message Templates ────────────────────────────────────────────────────

GREETINGS = [
    "Hi {name}", "Hello {name}", "Dear {name}", "Vanakkam {name}",
    "Hi {name}", "Hello {name}!", "Dear {name},",
]
BODY_PARTS = [
    "your cable TV subscription payment of Rs.{amount} is due",
    "kindly pay your cable TV bill of Rs.{amount}",
    "your monthly cable payment of Rs.{amount} is pending",
    "please clear your cable TV subscription of Rs.{amount}",
    "a friendly reminder — your cable TV bill Rs.{amount} is due",
]
CLOSINGS = [
    "Thank you!\n— Sree Selvanaayakki Amman Cables",
    "Thanks for your continued support.\n— Sree Selvanaayakki Amman Cables",
    "Please pay at the earliest.\n— Sree Selvanaayakki Amman Cables",
    "Namaste.\n— Sree Selvanaayakki Amman Cables",
    "Thank you for choosing us.\n— Sree Selvanaayakki Amman Cables",
]


def _generate_message(name: str, amount: float) -> str:
    """Generate a unique-looking reminder message."""
    greeting = random.choice(GREETINGS).format(name=name.split()[0])
    body = random.choice(BODY_PARTS).format(amount=int(amount))
    closing = random.choice(CLOSINGS)
    return f"{greeting}, {body}.\n\n{closing}"


# ── Operator filter helper for text() queries ────────────────────────────

def _op_flt(user, alias="") -> str:
    """Return SQL WHERE fragment for operator isolation in text() queries."""
    oid = user.get("operator_id")
    prefix = f"{alias}." if alias else ""
    if oid is None:
        if prefix:
            return f"({prefix}operator_id > 0 OR {prefix}operator_id IS NULL)"
        return "(operator_id > 0 OR operator_id IS NULL)"
    return f"{prefix}operator_id = {oid}"


# ── Endpoints ────────────────────────────────────────────────────────────

class SendReminderRequest(BaseModel):
    customer_ids: List[str]  # list of customer IDs to send to
    dry_run: bool = False  # if True, just return what would be sent


@router.get("/due")
def get_due_customers(
    days_overdue: int = Query(0, description="0=due today, 1+=overdue by N days"),
    include_due_soon: bool = Query(False, description="Include customers due within 5 days"),
    network: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """List customers with unpaid/expiring connections."""
    _oid = op_id(current_user)
    flt = _op_flt(current_user, "cn")

    query = f"""
        SELECT DISTINCT cn.customer_id, c.name, c.phone,
        cn.stb_no, cn.mso, cn.plan_name, cn.plan_amount,
        cn.expiry_date, cn.id as connection_id
        FROM connections cn
        JOIN customers c ON cn.customer_id = c.customer_id
        WHERE cn.status = 'Active' AND {flt}
    """
    params: dict = {}

    if include_due_soon:
        query += " AND cn.expiry_date <= (CURRENT_DATE + INTERVAL '5 days')::text"
    else:
        if days_overdue > 0:
            query += " AND cn.expiry_date <= (CURRENT_DATE - make_interval(days => :days_overdue))::text"
            params["days_overdue"] = days_overdue
        else:
            query += " AND cn.expiry_date <= CURRENT_DATE::text"

    if network:
        query += " AND cn.mso = :network"
        params["network"] = network

    query += " ORDER BY cn.expiry_date ASC, c.name"

    rows = db.execute(text(query), params).fetchall()

    # Mark already-sent-today
    sent_today = _load_sent_today(_oid)

    results = []
    seen_customers = set()
    for r in rows:
        m = r._mapping
        cid = str(m["customer_id"])
        if cid in seen_customers:
            continue
        seen_customers.add(cid)
        results.append({
            "customer_id": cid,
            "name": m["name"],
            "phone": m["phone"],
            "stb_no": m["stb_no"],
            "mso": m["mso"],
            "plan_name": m["plan_name"],
            "plan_amount": m["plan_amount"],
            "expiry_date": m["expiry_date"],
            "sent_today": cid in sent_today,
        })

    return {
        "customers": results,
        "total": len(results),
        "sent_today_count": _count_sent_today(_oid),
        "max_per_day": MAX_PER_DAY,
        "remaining_today": max(0, MAX_PER_DAY - _count_sent_today(_oid)),
    }


@router.post("/send")
def send_reminders(
    data: SendReminderRequest,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Send WhatsApp reminders to selected customers via CARE bridge."""
    _oid = op_id(current_user)
    flt = _op_flt(current_user)
    sent_today = _load_sent_today(_oid)
    remaining = MAX_PER_DAY - len(sent_today)

    if remaining <= 0:
        raise HTTPException(400, detail=f"Daily limit of {MAX_PER_DAY} messages reached. Try tomorrow.")

    # Filter out already-sent and count
    to_send = [cid for cid in data.customer_ids if cid not in sent_today]
    if not to_send:
        raise HTTPException(400, detail="All selected customers already received reminders today.")

    if len(to_send) > remaining:
        to_send = to_send[:remaining]

    results = []
    for cid in to_send:
        customer = db.execute(
            text(f"SELECT name, phone FROM customers WHERE customer_id = :cid AND {flt}"),
            {"cid": cid},
        ).fetchone()

        if not customer or not customer._mapping["phone"]:
            results.append({"customer_id": cid, "status": "skipped", "reason": "No phone number"})
            continue

        # Get plan amount
        plan = db.execute(
            text(f"SELECT plan_name, plan_amount FROM connections WHERE customer_id = :cid AND status = 'Active' AND {flt} ORDER BY expiry_date LIMIT 1"),
            {"cid": cid},
        ).fetchone()

        m = plan._mapping if plan else {}
        amount = m.get("plan_amount", 0) or 0
        name = customer._mapping["name"]
        phone = customer._mapping["phone"]

        if data.dry_run:
            msg = _generate_message(name, amount)
            results.append({
                "customer_id": cid, "name": name, "phone": phone,
                "status": "dry_run", "message": msg,
            })
            continue

        # Generate unique message
        msg = _generate_message(name, amount)

        try:
            r = httpx.post(CARE_BRIDGE, json={
                "chatId": _chat_id(phone),
                "message": msg,
            }, timeout=30)

            if r.status_code == 200:
                status = "sent"
                # Log to sms_log
                db.execute(
                    text("INSERT INTO sms_log (customer_id, phone, message, status, provider, operator_id) VALUES (:cid, :phone, :msg, 'sent', 'whatsapp_care', :oid)"),
                    {"cid": cid, "phone": phone, "msg": msg, "oid": _oid},
                )
                db.commit()
                # Mark as sent today
                sent_today.add(cid)
                _save_sent_today(sent_today, _oid)
            else:
                status = "failed"
                error_detail = r.text[:200]
                results.append({
                    "customer_id": cid, "name": name, "phone": phone,
                    "status": status, "error": error_detail,
                })
                continue
        except Exception as e:
            status = "error"
            results.append({
                "customer_id": cid, "name": name, "phone": phone,
                "status": status, "error": str(e),
            })
            continue

        results.append({
            "customer_id": cid, "name": name, "phone": phone,
            "status": status, "message": msg,
        })

    return {
        "results": results,
        "sent_count": sum(1 for r in results if r["status"] == "sent"),
        "failed_count": sum(1 for r in results if r["status"] in ("failed", "error")),
        "sent_today_total": len(sent_today),
        "remaining_today": max(0, MAX_PER_DAY - len(sent_today)),
    }


@router.get("/history")
def reminder_history(
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Show recent WhatsApp reminders sent."""
    flt = _op_flt(current_user, "s")
    rows = db.execute(
        text(f"""SELECT s.*, c.name as customer_name
        FROM sms_log s
        LEFT JOIN customers c ON s.customer_id = c.customer_id
        WHERE s.provider = 'whatsapp_care' AND {flt}
        ORDER BY s.sent_at DESC LIMIT :limit"""),
        {"limit": limit},
    ).fetchall()
    return {"history": [dict(r._mapping) for r in rows]}


@router.get("/status")
def reminder_status(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Today's reminder sending status."""
    _oid = op_id(current_user)
    flt = _op_flt(current_user)
    sent_today = _load_sent_today(_oid)

    today_count = db.execute(
        text(f"SELECT COUNT(*) as c FROM sms_log WHERE provider = 'whatsapp_care' AND date(sent_at) = CURRENT_DATE AND {flt}"),
    ).fetchone()._mapping["c"]

    # Total unpaid
    total_unpaid = db.execute(
        text(f"SELECT COUNT(DISTINCT customer_id) as c FROM connections WHERE status = 'Active' AND expiry_date < CURRENT_DATE::text AND {flt}"),
    ).fetchone()._mapping["c"]

    return {
        "sent_today": today_count,
        "max_per_day": MAX_PER_DAY,
        "remaining_today": max(0, MAX_PER_DAY - today_count),
        "total_unpaid": total_unpaid,
    }
