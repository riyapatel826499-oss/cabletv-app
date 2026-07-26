"""
Map routes — plot customers on an interactive map and show who's paid this month.

Adds:
  GET  /api/map/customers?month=YYYY-MM   -> all located customers + is_paid flag
  PUT  /api/map/customers/{customer_id}/location  -> save a house's lat/lng
  DELETE /api/map/customers/{customer_id}/location -> clear a wrongly-placed pin

Design notes
------------
* "Paid" reuses the SAME logic as the rest of the app: a customer counts as paid
  for a month if they have a local payment OR a paypakka payment inside that
  month's date range (see services.payments.paid_customer_subquery). So a pin
  turns green automatically once a payment is recorded — nothing extra to maintain.
* Multi-tenant safe: every query is scoped with _op_flt(current_user), exactly
  like customers.py, so an operator only ever sees their own customers.
* Area guard blocks saving locations outside the collection area (e.g. GPS from
  another city). Enforced both server-side and client-side.
"""

import calendar
import math
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from conn import get_conn as _get_conn
from deps_orm import get_current_user, _op_flt
from services.payments import get_date_range, paid_customer_subquery, paid_subquery_params
from audit import log_action
from config import DB_ENGINE
from db import table_has_column

router = APIRouter(prefix="/api/map", tags=["Map"])

# ── Collection-area guard ───────────────────────────────────────────────────
AREA_CENTER_LAT = float(os.environ.get("AREA_CENTER_LAT", "11.0974473"))
AREA_CENTER_LNG = float(os.environ.get("AREA_CENTER_LNG", "77.2013613"))
AREA_RADIUS_KM = float(os.environ.get("AREA_RADIUS_KM", "10"))


def _distance_km(lat1, lng1, lat2, lng2):
    """Great-circle distance in km (haversine)."""
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _in_area(lat, lng) -> bool:
    return _distance_km(lat, lng, AREA_CENTER_LAT, AREA_CENTER_LNG) <= AREA_RADIUS_KM


def _all_stbs(conn):
    """Return {customer_id: 'STB1,STB2'} for every customer. One plain query, no
    IN clause, no GROUP_CONCAT/STRING_AGG — safe on SQLite and Postgres. Never
    raises to the caller (returns {} on any problem) so it can't blank the list."""
    try:
        rows = conn.execute("SELECT customer_id, stb_no FROM connections").fetchall()
    except Exception:
        return {}
    out: dict = {}
    for r in rows:
        cid, stb = r["customer_id"], r["stb_no"]
        if cid and stb:
            out.setdefault(cid, []).append(stb)
    return {k: ",".join(v) for k, v in out.items()}


class LocationIn(BaseModel):
    latitude: float
    longitude: float


class NoteIn(BaseModel):
    note: Optional[str] = None  # e.g. "1st floor", "Ground floor - back"


class ReminderIn(BaseModel):
    customer_id: str
    template: str  # 'monthly' | 'reconnection'
    month: Optional[str] = None


def _ensure_reminders_table(conn):
    """Create the reminder log table if missing (so logging works even before the
    migration runs). Engine-aware."""
    if DB_ENGINE == "sqlite":
        conn.execute(
            "CREATE TABLE IF NOT EXISTS reminder_logs ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, template TEXT, "
            "sent_by INTEGER, sent_by_name TEXT, sent_at TEXT, month TEXT, operator_id INTEGER)"
        )
    else:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS reminder_logs ("
            "id SERIAL PRIMARY KEY, customer_id TEXT, template TEXT, "
            "sent_by INTEGER, sent_by_name TEXT, sent_at TEXT, month TEXT, operator_id INTEGER)"
        )


def _reminder_summary(conn, month, op_and):
    """{customer_id: {count, last_at, last_by}} for reminders logged in `month`.
    Never raises (returns {} if the table doesn't exist yet)."""
    try:
        rows = conn.execute(
            "SELECT customer_id, sent_at, sent_by_name FROM reminder_logs WHERE month = ? " + op_and,
            [month],
        ).fetchall()
    except Exception:
        return {}
    out: dict = {}
    for r in rows:
        cid = r["customer_id"]
        d = out.setdefault(cid, {"count": 0, "last_at": None, "last_by": None})
        d["count"] += 1
        if d["last_at"] is None or (r["sent_at"] or "") > d["last_at"]:
            d["last_at"] = r["sent_at"]
            d["last_by"] = r["sent_by_name"]
    return out


def _month_range(month: Optional[str]):
    """Turn 'YYYY-MM' into (paid_from, paid_to) for get_date_range()."""
    if not month:
        return None, None
    try:
        y, m = (int(x) for x in month.split("-"))
        last = calendar.monthrange(y, m)[1]
        return f"{month}-01", f"{month}-{last:02d}"
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="month must be 'YYYY-MM'")


def _prev_month_str(month: Optional[str]) -> str:
    """The calendar month before the given 'YYYY-MM' (or current month)."""
    if month:
        y, m = int(month[:4]), int(month[5:7])
    else:
        now = datetime.now()
        y, m = now.year, now.month
    m -= 1
    if m == 0:
        m, y = 12, y - 1
    return f"{y:04d}-{m:02d}"


def _order_name():
    """Return ORDER BY clause compatible with the active DB engine."""
    return "name COLLATE NOCASE" if DB_ENGINE == "sqlite" else "LOWER(name)"


@router.get("/customers")
def customers_map(
    month: Optional[str] = Query(None, description="YYYY-MM (default: current month)"),
    unpaid_only: bool = Query(False),
    current_user=Depends(get_current_user),
):
    """Return every located customer with a colour status for the selected month:
      - 'paid'    (GREEN)  : paid this month
      - 'due'     (YELLOW) : not paid this month, but paid last month (not renewed)
      - 'overdue' (RED)    : not paid this month AND not last month (2+ months)"""
    paid_from, paid_to = _month_range(month)
    prev_from, prev_to = _month_range(_prev_month_str(month))

    with _get_conn() as conn:
        # This month params
        ms, me, cm = get_date_range(paid_from, paid_to)
        paid_params = paid_subquery_params(ms, me, cm)

        # Last month params
        ms2, me2, cm2 = get_date_range(prev_from, prev_to)
        prev_params = paid_subquery_params(ms2, me2, cm2)

        subq = paid_customer_subquery(cm)

        _of_c = _op_flt(current_user, "c.")

        # `map_note` (floor/unit label) may not exist yet if migration hasn't run
        note_col = "c.map_note" if table_has_column(conn, "customers", "map_note") else "NULL"

        query = (
            "SELECT c.customer_id, c.name, c.phone, c.phone2, c.area, c.address, "
            "c.latitude, c.longitude, " + note_col + " AS map_note, "
            "CASE WHEN p.customer_id IS NOT NULL THEN 1 ELSE 0 END AS is_paid, "
            "CASE WHEN p2.customer_id IS NOT NULL THEN 1 ELSE 0 END AS paid_prev, "
            "(SELECT cn.plan_amount FROM connections cn "
            " WHERE cn.customer_id = c.customer_id AND cn.status = 'Active' LIMIT 1) AS plan_amount "
            "FROM customers c "
            "LEFT JOIN (" + subq + ") p  ON c.customer_id = p.customer_id "
            "LEFT JOIN (" + subq + ") p2 ON c.customer_id = p2.customer_id "
            "WHERE " + _of_c + " "
            # Return ALL active customers (located AND not). The frontend splits them
            # by whether they have coordinates — one source of truth, no second query.
            "AND (c.status = 'Active' OR c.status IS NULL)"
        )
        params = list(paid_params) + list(prev_params)

        if unpaid_only:
            query += " AND p.customer_id IS NULL"

        query += " ORDER BY " + _order_name()

        rows = conn.execute(query, params).fetchall()
        customers = []
        for r in rows:
            is_paid = bool(r["is_paid"])
            paid_prev = bool(r["paid_prev"])
            status = "paid" if is_paid else ("due" if paid_prev else "overdue")
            customers.append({
                "customer_id": r["customer_id"],
                "name": r["name"],
                "phone": r["phone"],
                "phone2": r["phone2"],
                "area": r["area"],
                "address": r["address"],
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "map_note": r["map_note"],
                "is_paid": is_paid,
                "paid_prev": paid_prev,
                "status": status,
                "plan_amount": r["plan_amount"],
            })

        # Attach STB numbers per customer (engine-agnostic Python, not SQL aggregation).
        stbmap = _all_stbs(conn)
        for c in customers:
            c["stbs"] = stbmap.get(c["customer_id"])

        # Attach reminder counts for the selected month.
        sel_month = month or datetime.now().strftime("%Y-%m")
        _ofp = _op_flt(current_user)
        rem_op_and = "" if _ofp == "1=1" else f"AND {_ofp}"
        remmap = _reminder_summary(conn, sel_month, rem_op_and)
        for c in customers:
            info = remmap.get(c["customer_id"])
            c["reminder_count"] = info["count"] if info else 0
            c["last_reminder_at"] = info["last_at"] if info else None
            c["last_reminder_by"] = info["last_by"] if info else None

        _of_plain = _op_flt(current_user)
        of_and = "" if _of_plain == "1=1" else f"AND {_of_plain}"
        missing = conn.execute(
            "SELECT COUNT(*) AS n FROM customers c "
            "WHERE (c.latitude IS NULL OR c.longitude IS NULL) "
            "AND EXISTS (SELECT 1 FROM connections cn WHERE cn.customer_id = c.customer_id AND cn.status = 'Active') " + of_and
        ).fetchone()["n"]

        return {
            "month": month or ms[:7],
            "count": len(customers),
            "missing_location": missing,
            "customers": customers,
        }


@router.get("/customers/without-location")
def customers_without_location(current_user=Depends(get_current_user)):
    """Active customers that don't have a map location yet — so you can pin them."""
    with _get_conn() as conn:
        _of_plain = _op_flt(current_user)
        of_and = "" if _of_plain == "1=1" else f"AND {_of_plain}"
        rows = conn.execute(
            "SELECT customer_id, name, phone, phone2, area, address FROM customers "
            "WHERE (latitude IS NULL OR longitude IS NULL) "
            "AND (status = 'Active' OR status IS NULL) " + of_and +
            " ORDER BY " + ("name COLLATE NOCASE" if _is_sqlite() else "LOWER(name)"),
        ).fetchall()
        result = [dict(customer_id=r["customer_id"], name=r["name"], phone=r["phone"],
                       phone2=r["phone2"], area=r["area"], address=r["address"]) for r in rows]
        stbmap = _all_stbs(conn)
        for c in result:
            c["stbs"] = stbmap.get(c["customer_id"])
        return result


@router.put("/customers/{customer_id}/location")
def set_customer_location(customer_id: str, loc: LocationIn, current_user=Depends(get_current_user)):
    """Save a customer's house location (from tap-to-place OR phone GPS)."""
    if not (-90 <= loc.latitude <= 90 and -180 <= loc.longitude <= 180):
        raise HTTPException(status_code=400, detail="Invalid coordinates")

    if not _in_area(loc.latitude, loc.longitude):
        dist = _distance_km(loc.latitude, loc.longitude, AREA_CENTER_LAT, AREA_CENTER_LNG)
        raise HTTPException(
            status_code=422,
            detail=(f"That point is about {dist:.0f} km from your collection area, "
                    f"so it was not saved. Please place the pin inside your area."),
        )

    with _get_conn() as conn:
        _of = _op_flt(current_user)
        of_and = "" if _of == "1=1" else f"AND {_of}"
        existing = conn.execute(
            f"SELECT latitude, longitude FROM customers WHERE customer_id = ? {of_and}",
            [customer_id],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found")

        conn.execute(
            f"UPDATE customers SET latitude = ?, longitude = ? WHERE customer_id = ? {of_and}",
            [loc.latitude, loc.longitude, customer_id],
        )
        conn.commit()
        log_action(
            "customer_location_update", "customers", customer_id,
            old_value={"latitude": existing["latitude"], "longitude": existing["longitude"]},
            new_value={"latitude": loc.latitude, "longitude": loc.longitude},
            user=current_user,
        )
    return {"message": "Location saved", "latitude": loc.latitude, "longitude": loc.longitude}


@router.delete("/customers/{customer_id}/location")
def clear_customer_location(customer_id: str, current_user=Depends(get_current_user)):
    """Remove a customer's saved location (sets it back to 'no location')."""
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        of_and = "" if _of == "1=1" else f"AND {_of}"
        existing = conn.execute(
            f"SELECT latitude, longitude FROM customers WHERE customer_id = ? {of_and}",
            [customer_id],
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found")

        conn.execute(
            f"UPDATE customers SET latitude = NULL, longitude = NULL WHERE customer_id = ? {of_and}",
            [customer_id],
        )
        conn.commit()
        log_action(
            "customer_location_clear", "customers", customer_id,
            old_value={"latitude": existing["latitude"], "longitude": existing["longitude"]},
            new_value={"latitude": None, "longitude": None},
            user=current_user,
        )
    return {"message": "Location cleared"}


@router.put("/customers/{customer_id}/note")
def set_customer_note(customer_id: str, body: NoteIn, current_user=Depends(get_current_user)):
    """Save a short floor/unit label for a customer (e.g. '1st floor'), shown in the
    building popup. Helps tell apart connections stacked in a multi-floor building."""
    with _get_conn() as conn:
        if not table_has_column(conn, "customers", "map_note"):
            raise HTTPException(
                status_code=400,
                detail="map_note column missing — run migrate_customer_map_note.py first",
            )
        _of = _op_flt(current_user)
        of_and = "" if _of == "1=1" else f"AND {_of}"
        exists = conn.execute(
            f"SELECT 1 FROM customers WHERE customer_id = ? {of_and}", [customer_id]
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Customer not found")

        note = (body.note or "").strip() or None
        conn.execute(
            f"UPDATE customers SET map_note = ? WHERE customer_id = ? {of_and}",
            [note, customer_id],
        )
        conn.commit()
    return {"message": "Note saved", "map_note": note}


@router.post("/reminders")
def log_reminder(body: ReminderIn, current_user=Depends(get_current_user)):
    """Record that an agent sent a WhatsApp reminder to a customer (which template,
    who, when). Counts as 'reminder triggered' — WhatsApp delivery can't be confirmed."""
    month = body.month or datetime.now().strftime("%Y-%m")
    name = current_user.get("name") or current_user.get("username") or "Agent"
    with _get_conn() as conn:
        _ensure_reminders_table(conn)
        conn.execute(
            "INSERT INTO reminder_logs (customer_id, template, sent_by, sent_by_name, sent_at, month, operator_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [body.customer_id, body.template, current_user.get("id"), name,
             datetime.now().isoformat(), month, current_user.get("operator_id")],
        )
        conn.commit()
    return {"ok": True}
