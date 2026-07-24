"""
Map routes — plot customers on an interactive map and show who's paid this month.

Adds:
  GET  /api/map/customers?month=YYYY-MM   -> all located customers + is_paid flag
  GET  /api/map/customers/without-location -> customers still needing a pin
  PUT  /api/map/customers/{customer_id}/location  -> save a house's lat/lng

Design notes
------------
* "Paid" reuses the SAME logic as the rest of the app: a customer counts as paid
  for a month if they have a local payment OR a paypakka payment inside that
  month's date range (see services.payments.paid_customer_subquery). So a pin
  turns green automatically once a payment is recorded through the normal
  Record-Payment flow — nothing extra to maintain.
* Multi-tenant safe: every query is scoped with _op_flt(current_user), exactly
  like customers.py, so an operator only ever sees their own customers.
* We deliberately DON'T record payments here — recording stays in the existing
  payment flow (with bill/discount/expiry logic). This module is only about
  *finding* customers on the map and saving their location.
"""

import calendar
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from conn import get_conn as _get_conn
from deps_orm import get_current_user, _op_flt
from services.payments import get_date_range, paid_customer_subquery, paid_subquery_params
from audit import log_action
from config import DB_ENGINE

router = APIRouter(prefix="/api/map", tags=["Map"])


class LocationIn(BaseModel):
    latitude: float
    longitude: float


def _month_range(month: Optional[str]):
    """Turn 'YYYY-MM' into (paid_from, paid_to) for get_date_range().
    None -> current month (handled by get_date_range)."""
    if not month:
        return None, None
    try:
        y, m = (int(x) for x in month.split("-"))
        last = calendar.monthrange(y, m)[1]
        return f"{month}-01", f"{month}-{last:02d}"
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="month must be 'YYYY-MM'")


def _order_name():
    """Return ORDER BY clause compatible with the active DB engine."""
    return "name COLLATE NOCASE" if DB_ENGINE == "sqlite" else "LOWER(name)"


@router.get("/customers")
def customers_map(
    month: Optional[str] = Query(None, description="YYYY-MM (default: current month)"),
    unpaid_only: bool = Query(False),
    current_user=Depends(get_current_user),
):
    """Return every customer that has a saved location, plus whether they've
    paid for the selected month. Frontend colours green (paid) / red (unpaid)."""
    paid_from, paid_to = _month_range(month)
    with _get_conn() as conn:
        month_start, month_end, current_month = get_date_range(paid_from, paid_to)
        paid_subq = paid_customer_subquery(current_month)
        paid_params = paid_subquery_params(month_start, month_end, current_month)

        _of_c = _op_flt(current_user, "c.")

        query = (
            "SELECT c.customer_id, c.name, c.phone, c.phone2, c.area, c.address, "
            "c.latitude, c.longitude, "
            "CASE WHEN p.customer_id IS NOT NULL THEN 1 ELSE 0 END AS is_paid, "
            "(SELECT cn.plan_amount FROM connections cn "
            " WHERE cn.customer_id = c.customer_id AND cn.status = 'Active' LIMIT 1) AS plan_amount "
            "FROM customers c "
            "LEFT JOIN (" + paid_subq + ") p ON c.customer_id = p.customer_id "
            "WHERE " + _of_c + " "
            "AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL "
            "AND EXISTS (SELECT 1 FROM connections cn WHERE cn.customer_id = c.customer_id AND cn.status = 'Active')"
        )
        params = list(paid_params)

        if unpaid_only:
            query += " AND p.customer_id IS NULL"

        query += " ORDER BY " + _order_name()

        rows = conn.execute(query, params).fetchall()
        customers = []
        for r in rows:
            customers.append({
                "customer_id": r["customer_id"],
                "name": r["name"],
                "phone": r["phone"],
                "phone2": r["phone2"],
                "area": r["area"],
                "address": r["address"],
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "is_paid": bool(r["is_paid"]),
                "plan_amount": r["plan_amount"],
            })

        # A small count of customers still missing a location, so the UI can
        # nudge the user to place them.
        _of_plain = _op_flt(current_user)
        of_and = "" if _of_plain == "1=1" else f"AND {_of_plain}"
        missing = conn.execute(
            "SELECT COUNT(*) AS n FROM customers c "
            "WHERE (c.latitude IS NULL OR c.longitude IS NULL) "
            "AND EXISTS (SELECT 1 FROM connections cn WHERE cn.customer_id = c.customer_id AND cn.status = 'Active') " + of_and
        ).fetchone()["n"]

        return {
            "month": month or month_start[:7],
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
            "SELECT c.customer_id, c.name, c.phone, c.area, c.address FROM customers c "
            "WHERE (c.latitude IS NULL OR c.longitude IS NULL) "
            "AND EXISTS (SELECT 1 FROM connections cn WHERE cn.customer_id = c.customer_id AND cn.status = 'Active') " + of_and +
            " ORDER BY " + _order_name(),
        ).fetchall()
        return [dict(customer_id=r["customer_id"], name=r["name"], phone=r["phone"],
                     area=r["area"], address=r["address"]) for r in rows]


@router.put("/customers/{customer_id}/location")
def set_customer_location(customer_id: str, loc: LocationIn, current_user=Depends(get_current_user)):
    """Save a customer's house location (from tap-to-place OR phone GPS)."""
    if not (-90 <= loc.latitude <= 90 and -180 <= loc.longitude <= 180):
        raise HTTPException(status_code=400, detail="Invalid coordinates")

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
