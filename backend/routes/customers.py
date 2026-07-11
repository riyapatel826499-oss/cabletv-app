from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta
import calendar

from sqlalchemy.orm import Session
from models.base import get_db
from deps_orm import get_current_user, require_role, apply_op_filter, _op_flt, op_id, block_master
from conn import get_conn as _get_conn
from audit import log_action
from services.payments import get_date_range, paid_customer_subquery, paid_subquery_params, get_merged_payments, get_total_paid_amount
from utils import get_current_month
from db import table_has_column
import re

router = APIRouter(prefix="/api", tags=["Customers"])



class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    phone2: Optional[str] = None
    address: Optional[str] = None
    area: Optional[str] = None
    city: Optional[str] = None
    pincode: Optional[str] = None
    status: Optional[str] = None


class ConnectionCreate(BaseModel):
    stb_no: str
    can_id: Optional[str] = None
    mso: Optional[str] = "GTPL"
    service_type: Optional[str] = "Cable"
    billing_type: Optional[str] = "Prepaid"
    status: Optional[str] = "Active"


class CustomerPlanAssign(BaseModel):
    connection_id: int
    plan_id: int
    start_date: Optional[str] = None  # ISO date string
    notes: Optional[str] = None


def _customer_to_dict(row):
    """Convert a customer row to dict."""
    d = {
        "id": row["id"],
        "customer_id": row["customer_id"],
        "name": row["name"],
        "phone": row["phone"],
        "phone2": row["phone2"],
        "address": row["address"],
        "area": row["area"],
        "city": row["city"],
        "pincode": row["pincode"],
        "status": row["status"],
    }
    # Add optional fields if available
    for field in ["surrendered_date", "surrender_reason", "stb_no", "conn_status",
                  "plan_name", "plan_amount", "expiry_date", "activation_date", "mso"]:
        try:
            d[field] = row[field] if row[field] is not None else None
        except (IndexError, KeyError):
            d[field] = None
    # Add is_paid if available (from JOIN query)
    try:
        d["is_paid"] = bool(row["is_paid"])
    except (IndexError, KeyError):
        d["is_paid"] = False
    return d


def _connection_to_dict(row):
    d = {
        "id": row["id"],
        "customer_id": row["customer_id"],
        "stb_no": row["stb_no"],
        "can_id": row["can_id"],
        "mso": row["mso"],
        "service_type": row["service_type"],
        "billing_type": row["billing_type"],
        "status": row["status"],
    }
    # network field
    try:
        d["network"] = row["network"]
    except (IndexError, KeyError):
        d["network"] = "GTPL"
    # Add plan/expiry fields if available (from Paypakka import)
    for field in ["plan_name", "plan_amount", "activation_date", "expiry_date"]:
        try:
            d[field] = row[field] if row[field] is not None else None
        except (IndexError, KeyError):
            d[field] = None
    return d



# ============================================================
# IMPORTANT: Fixed routes (search, unpaid, paid) MUST come
# before the parameterized /customers/{customer_id} route
# to avoid FastAPI matching "search"/"unpaid"/"paid" as customer_id
# ============================================================

@router.get("/customers/area-suggestions")
def area_suggestions(
    q: str = Query("", max_length=50),
    current_user=Depends(get_current_user),
):
    """Return matching area names for autocomplete."""
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        rows = conn.execute(f"""
            SELECT DISTINCT area FROM customers
            WHERE area IS NOT NULL AND area != ''
            AND area LIKE ?
            AND {_of}
            ORDER BY area
            LIMIT 20
        """, [f"%{q}%"]).fetchall()
        return {"areas": [r["area"] for r in rows]}


@router.get("/customers/paid-filters")
def get_paid_filters(
    paid_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    paid_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    current_user=Depends(get_current_user),
):
    """Return unique areas, amounts, modes, collectors from paid customers."""
    with _get_conn() as conn:
        month_start, month_end, current_month = get_date_range(paid_from, paid_to)
        _of = _op_flt(current_user)

        # Get unique areas from paid customers (always use date-range mode for filter queries)
        paid_subq = paid_customer_subquery(None)
        paid_params = paid_subquery_params(month_start, month_end, None)
        areas = conn.execute(f"""
            SELECT DISTINCT c.area FROM customers c
            INNER JOIN (
                {paid_subq}
            ) p ON c.customer_id = p.customer_id
            WHERE c.area IS NOT NULL AND c.area != ''
            AND c.{_of}
            ORDER BY c.area
        """, paid_params).fetchall()
        area_list = [r["area"] for r in areas]

        # Get unique amounts
        amounts = conn.execute("""
            SELECT DISTINCT collection_amount FROM paypakka_payments
            WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?
            AND collection_amount IS NOT NULL AND collection_amount > 0
            UNION
            SELECT DISTINCT amount FROM payments
            WHERE collected_at >= ? AND collected_at <= ?
            AND amount IS NOT NULL AND amount > 0
            ORDER BY collection_amount
        """, [month_start, month_end, month_start, month_end]).fetchall()
        amount_list = sorted(set([float(r[0]) for r in amounts]))

        # Get unique payment modes
        modes = conn.execute("""
            SELECT DISTINCT payment_type FROM paypakka_payments
            WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?
            AND payment_type IS NOT NULL AND payment_type != ''
            UNION
            SELECT DISTINCT payment_mode FROM payments
            WHERE collected_at >= ? AND collected_at <= ?
            AND payment_mode IS NOT NULL AND payment_mode != ''
        """, [month_start, month_end, month_start, month_end]).fetchall()
        mode_list = sorted(set([r[0].strip().title() for r in modes if r[0]]))

        # Get unique collectors
        collectors = conn.execute("""
            SELECT DISTINCT e.emp_name FROM paypakka_employees e
            INNER JOIN paypakka_payments pp ON pp.emp_ref_id = e.emp_ref_id
            WHERE pp.paypakka_created_at >= ? AND pp.paypakka_created_at <= ?
            AND e.emp_name IS NOT NULL AND e.emp_name != ''
            ORDER BY e.emp_name
        """, [month_start, month_end]).fetchall()
        collector_list = [r["emp_name"] for r in collectors]

        return {
            "areas": area_list,
            "amounts": amount_list,
            "modes": mode_list,
            "collectors": collector_list,
        }


@router.post("/customers/bulk-import")
def bulk_import_customers(
    customers: list[dict],
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Bulk import customers directly (bypasses master restriction). Used for migrations."""
    from models.tables import Customer
    from sqlalchemy import select
    created = []
    for c in customers[:100]:  # limit 100 per call
        cid = c.get("customer_id")
        if not cid:
            continue
        # Check if exists
        existing = db.execute(select(Customer).where(Customer.customer_id == cid)).scalar_one_or_none()
        if existing:
            continue
        # Create customer
        cust = Customer(
            customer_id=cid,
            name=c.get("name", ""),
            phone=c.get("phone", ""),
            phone2=c.get("phone2", ""),
            area=c.get("area", ""),
            address=c.get("address", ""),
            city=c.get("city", ""),
            pincode=c.get("pincode", ""),
            status=c.get("status", "Active"),
            operator_id=1  # default to first LCO
        )
        db.add(cust)
        created.append(cid)
    db.commit()
    return {"created": len(created), "customer_ids": created}


@router.get("/customers")
def list_customers(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=200),
    area: Optional[str] = None,
    status: Optional[str] = None,
    sort_by: Optional[str] = Query("name", regex="^(name|customer_id|area)$"),
    sort_order: Optional[str] = Query("asc", regex="^(asc|desc)$"),
    payment_filter: Optional[str] = Query(None, regex="^(paid|unpaid)$"),
    paid_from: Optional[str] = Query(None, description="YYYY-MM-DD"),
    paid_to: Optional[str] = Query(None, description="YYYY-MM-DD"),
    paid_area: Optional[str] = Query(None, description="Filter paid by area"),
    paid_mode: Optional[str] = Query(None, description="Filter paid by payment mode"),
    paid_collected_by: Optional[str] = Query(None, description="Filter paid by collector"),
    paid_amount: Optional[float] = Query(None, description="Filter paid by exact amount"),
    plan_id: Optional[int] = Query(None, description="Filter by plan ID"),
    current_user=Depends(get_current_user),
):
    with _get_conn() as conn:
        month_start, month_end, current_month = get_date_range(paid_from, paid_to)
        paid_subq = paid_customer_subquery(current_month)
        paid_params = paid_subquery_params(month_start, month_end, current_month)
        _of = _op_flt(current_user)
        _of_c = _op_flt(current_user, "c.")

        query = """SELECT c.*, CASE WHEN p.customer_id IS NOT NULL THEN 1 ELSE 0 END as is_paid,
            (SELECT conn2.stb_no FROM connections conn2 WHERE conn2.customer_id = c.customer_id AND conn2.status = 'Active' LIMIT 1) as stb_no
            FROM customers c
            LEFT JOIN (
                """ + paid_subq + """
            ) p ON c.customer_id = p.customer_id
            WHERE """ + _of_c
        params = list(paid_params)

        if area:
            query += " AND c.area LIKE ?"
            params.append(f"%{area}%")
        if status is not None and status != "":
            # Specific status filter (e.g. "Surrendered")
            query += " AND c.status = ?"
            params.append(status)
        elif status == "":
            # Empty string means show ALL statuses (no filter)
            pass
        else:
            # No status param at all: only show Active (default)
            query += " AND (c.status = 'Active' OR c.status IS NULL)"

        # Payment filter
        if payment_filter == "paid":
            query += " AND p.customer_id IS NOT NULL"
        elif payment_filter == "unpaid":
            query += " AND p.customer_id IS NULL"

        # Plan filter
        if plan_id:
            _of_cp = _op_flt(current_user, "cp.")
            query += f" AND c.customer_id IN (SELECT DISTINCT cp.customer_id FROM customer_plans cp WHERE cp.plan_id = ? AND cp.status = 'Active' AND {_of_cp})"
            params.append(plan_id)

        # Paid-specific area filter (exact match on customer area)
        if payment_filter == "paid" and paid_area:
            query += " AND c.area = ?"
            params.append(paid_area)

        # Count total — use a clean COUNT query without extra columns
        count_base = """SELECT COUNT(*) FROM customers c
            LEFT JOIN (
                """ + paid_subq + """
            ) p ON c.customer_id = p.customer_id
            WHERE """ + _of_c
        # Rebuild WHERE clauses for count query
        count_params = list(paid_params)
        count_query = count_base
        if area:
            count_query += " AND c.area LIKE ?"
            count_params.append(f"%{area}%")
        if status is not None and status != "":
            count_query += " AND c.status = ?"
            count_params.append(status)
        elif status != "":
            count_query += " AND (c.status = 'Active' OR c.status IS NULL)"
        if payment_filter == "paid":
            count_query += " AND p.customer_id IS NOT NULL"
        elif payment_filter == "unpaid":
            count_query += " AND p.customer_id IS NULL"
        if plan_id:
            _of_cp = _op_flt(current_user, "cp.")
            count_query += f" AND c.customer_id IN (SELECT DISTINCT cp.customer_id FROM customer_plans cp WHERE cp.plan_id = ? AND cp.status = 'Active' AND {_of_cp})"
            count_params.append(plan_id)
        total = conn.execute(count_query, count_params).fetchone()[0]

        # Sorting - customer_id sort uses numeric part for proper ordering
        if sort_by == "customer_id":
            from config import DB_ENGINE
            if DB_ENGINE == "postgresql":
                query += f" ORDER BY CAST(SUBSTRING(c.customer_id FROM STRPOS(c.customer_id, '-') + 1) AS INTEGER) {sort_order.upper()}"
            else:
                query += f" ORDER BY CAST(SUBSTR(c.customer_id, INSTR(c.customer_id, '-') + 1) AS INTEGER) {sort_order.upper()}"
        else:
            query += f" ORDER BY LOWER(c.{sort_by}) {sort_order.upper()}"
        query += " LIMIT ? OFFSET ?"
        params.extend([per_page, (page - 1) * per_page])

        rows = conn.execute(query, params).fetchall()

        # If paid filter, fetch payment details for each customer
        customers_list = [_customer_to_dict(r) for r in rows]
        if payment_filter == "paid" and customers_list:
            cids = [c["customer_id"] for c in customers_list]
            pay_map = get_merged_payments(conn, cids, month_start, month_end, current_month)
            for c in customers_list:
                pinfo = pay_map.get(c["customer_id"], {})
                c["paid_amount"] = pinfo.get("amount", 0)
                c["payment_mode"] = pinfo.get("mode", "")
                c["payment_date"] = pinfo.get("date", "")
                c["collected_by"] = pinfo.get("collected_by", "")

            # Apply paid_mode and paid_collected_by filters (post-SQL, since they come from aggregated payment data)
            if payment_filter == "paid" and (paid_mode or paid_collected_by or paid_amount):
                # Need to compute total across ALL pages, not just current page
                # Run the full query without LIMIT/OFFSET
                all_q = query.replace(" LIMIT ? OFFSET ?", "")
                all_params_no_page = params[:-2]
                all_rows = conn.execute(all_q, all_params_no_page).fetchall()
                all_cids = [dict(r).get("customer_id") for r in all_rows]
            
                # Get payment details for ALL matching customers
                all_pay_map = get_merged_payments(conn, all_cids, month_start, month_end, current_month) if all_cids else {}
                # Lowercase mode for filter matching
                for info in all_pay_map.values():
                    info["mode"] = info.get("mode", "").lower()

                # Apply filters to get total count and amount
                filtered_count = 0
                filtered_total_amount = 0
                filtered_ids = set()
                for cid in all_cids:
                    info = all_pay_map.get(cid, {})
                    if paid_mode and paid_mode.lower() not in info.get("mode", ""):
                        continue
                    if paid_collected_by and paid_collected_by.lower() not in info.get("collected_by", "").lower():
                        continue
                    if paid_amount and abs(info.get("amount", 0) - paid_amount) > 0.5:
                        continue
                    filtered_count += 1
                    filtered_total_amount += info.get("amount", 0)
                    filtered_ids.add(cid)


                # Override total and total_paid_amount
                total = filtered_count
                total_paid_amount = filtered_total_amount

                # Re-fetch customers for this page from filtered_ids
                def sort_key(cid):
                    m = re.search(r'-(\d+)', cid)
                    return int(m.group(1)) if m else 0
                sorted_ids = sorted(filtered_ids, key=sort_key)
                start_idx = (page - 1) * per_page
                end_idx = start_idx + per_page
                page_ids = sorted_ids[start_idx:end_idx]

                # Re-query DB for only the filtered page of customers
                if page_ids:
                    placeholders = ",".join(["?"] * len(page_ids))
                    detail_q = f"""SELECT c.*, CASE WHEN p.customer_id IS NOT NULL THEN 1 ELSE 0 END as is_paid,
                        conn.stb_no
                        FROM customers c
                        LEFT JOIN (
                            """ + paid_subq + """
                        ) p ON c.customer_id = p.customer_id
                        LEFT JOIN connections conn ON c.customer_id = conn.customer_id
                        WHERE c.customer_id IN (""" + placeholders + """)
                        AND """ + _of_c + """
                        ORDER BY CAST(SUBSTR(c.customer_id, INSTR(c.customer_id, '-') + 1) AS INTEGER) ASC"""
                    detail_params = paid_params + page_ids
                    detail_rows = conn.execute(detail_q, detail_params).fetchall()
                    customers_list = [_customer_to_dict(r) for r in detail_rows]
                    for c in customers_list:
                        pinfo = all_pay_map.get(c["customer_id"], {})
                        c["paid_amount"] = pinfo.get("amount", 0)
                        c["payment_mode"] = pinfo.get("mode", "").title()
                        c["payment_date"] = pinfo.get("date", "")
                        c["collected_by"] = pinfo.get("collected_by", "")
                else:
                    customers_list = []

        # Calculate total paid amount for paid tab (across ALL matching, not just current page)
        total_paid_amount = 0  # default
        if payment_filter == "paid" and not (paid_mode or paid_collected_by or paid_amount):
            total_paid_amount = get_total_paid_amount(conn, month_start, month_end, paid_area)
        elif payment_filter != "paid":
            # "all" or "unpaid" — set to 0
            total_paid_amount = 0
        # else: total_paid_amount was already set by the filter block above


        # Get distinct areas for filter (scoped to operator)
        _of_area = "" if _of == "1=1" else f"AND {_of}"
        areas = [a["area"] for a in conn.execute(
            f"SELECT DISTINCT area FROM customers WHERE area IS NOT NULL AND area != '' {_of_area} ORDER BY area"
        ).fetchall() if a["area"]]

        return {
            "total": total,
            "page": page,
            "per_page": per_page,
            "customers": customers_list,
            "total_paid_amount": total_paid_amount,
            "areas": areas,
        }


@router.get("/customers/unpaid")
def get_unpaid_customers(
    q: Optional[str] = None,
    area: Optional[str] = None,
    mso: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
    as_of: Optional[str] = None,  # YYYY-MM-DD — show unpaid AS OF this date
    current_user: dict = Depends(get_current_user),
):
    """Get customers with expired connections (unpaid).
    as_of: optional date to check who was unpaid BY that date (default: today)."""
    with _get_conn() as db:
        _of = _op_flt(current_user)
        # Use as_of date or today
        if as_of:
            try:
                ref_date = datetime.strptime(as_of, "%Y-%m-%d")
            except ValueError:
                ref_date = datetime.now()
        else:
            ref_date = datetime.now()
        ref_str = ref_date.strftime("%Y-%m-%d")

        offset = (page - 1) * per_page

        # Base query: active connections with expired expiry OR
        # active connections with future expiry but no payment this month
        # (imported customers may have future expiry_date from Paypakka but haven't actually paid)
        _of_conn = _op_flt(current_user, "conn.")
        _of_c = _op_flt(current_user, "c.")
        month_start = ref_date.strftime("%Y-%m-01")
        # month_end for payment check = end of ref_date's month
        if ref_date.month == 12:
            month_end_dt = ref_date.replace(year=ref_date.year, month=12, day=31)
        else:
            month_end_dt = ref_date.replace(month=ref_date.month + 1, day=1)
            month_end_dt = month_end_dt.replace(day=1)  # first of next month minus 1 day
            from datetime import timedelta as _td
            month_end_dt = (month_end_dt - _td(days=1)).replace(hour=23, minute=59, second=59)
        month_end_str = month_end_dt.strftime("%Y-%m-%d 23:59:59")

        where = f"""WHERE conn.status = 'Active' AND {_of_conn} AND {_of_c}
            AND (
                (conn.expiry_date != '' AND conn.expiry_date IS NOT NULL AND conn.expiry_date < ?)
                OR (
                    conn.customer_id NOT IN (
                        SELECT DISTINCT customer_id FROM (
                            SELECT customer_id FROM payments WHERE collected_at >= ? AND collected_at <= ?
                            UNION
                            SELECT customer_id FROM paypakka_payments WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?
                        )
                    )
                )
            )"""
        params: list = [ref_str, month_start, month_end_str, month_start, month_end_str]

        if q:
            where += " AND (c.name ILIKE ? OR c.customer_id ILIKE ? OR c.phone ILIKE ? OR conn.stb_no ILIKE ?)"
            params += [f"%{q}%"] * 4
        if area:
            where += " AND c.area = ?"
            params.append(area)
        if mso:
            where += " AND conn.mso = ?"
            params.append(mso)

        # Count
        count_row = db.execute(
            f"SELECT COUNT(DISTINCT conn.id) FROM connections conn JOIN customers c ON c.customer_id = conn.customer_id {where}",
            params
        ).fetchone()
        total = count_row[0] if count_row else 0

        # Fetch data
        rows = db.execute(f"""
            SELECT c.customer_id, c.name, c.phone, c.phone2, c.area, c.address,
                   conn.id as conn_id, conn.stb_no, conn.mso, conn.plan_name, conn.plan_amount,
                   conn.expiry_date, conn.network
            FROM connections conn 
            JOIN customers c ON c.customer_id = conn.customer_id
            {where}
            ORDER BY conn.expiry_date ASC, c.area, c.name
            LIMIT ? OFFSET ?
        """, params + [per_page, offset]).fetchall()

        # Calculate gap months and pending amount (relative to ref_date)
        results = []
        for r in rows:
            exp = r["expiry_date"]
            gap_months = 0
            if exp:
                try:
                    exp_dt = datetime.strptime(exp, "%Y-%m-%d")
                    gap_months = (ref_date.year - exp_dt.year) * 12 + (ref_date.month - exp_dt.month)
                    if gap_months < 0:
                        gap_months = 0
                except (ValueError, TypeError):
                    pass  # unparseable date → treat as no gap, skip amount calc

            results.append({
                "customer_id": r["customer_id"],
                "name": r["name"],
                "phone": r["phone"],
                "phone2": r["phone2"],
                "area": r["area"],
                "address": r["address"],
                "conn_id": r["conn_id"],
                "stb_no": r["stb_no"],
                "mso": r["mso"],
                "plan_name": r["plan_name"],
                "plan_amount": r["plan_amount"],
                "expiry_date": exp,
                "network": r["network"],
                "gap_months": gap_months,
                "pending_amount": round(r["plan_amount"] * (gap_months + 1), 2) if r["plan_amount"] else 0
            })

        # Get distinct areas for filter
        _of_area = "" if _of == "1=1" else f"AND {_of}"
        areas = [a["area"] for a in db.execute(
            f"SELECT DISTINCT area FROM customers WHERE area IS NOT NULL AND area != '' {_of_area} ORDER BY area"
        ).fetchall() if a["area"]]

        # Get distinct MSOs for filter
        msos = [m["mso"] for m in db.execute(
            f"SELECT DISTINCT mso FROM connections WHERE mso IS NOT NULL AND mso != '' ORDER BY mso"
        ).fetchall() if m["mso"]]

        return {
            "customers": results,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
            "areas": areas,
            "msos": msos,
            "as_of": ref_str
        }


@router.get("/customers/not-renewed")
def get_not_renewed_customers(
    month: str = None, # YYYY-MM format, e.g. "2026-05" = not renewed for May
    q: Optional[str] = None,
    area: Optional[str] = None,
    mso: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
    current_user: dict = Depends(get_current_user),
):
    """Active customers who paid LAST month but have NOT paid for the SELECTED month.
    Default: current month = who paid last month but hasn't renewed this month."""
    import traceback
    try:
     with _get_conn() as db:
        _of = _op_flt(current_user)
        _of_c = _op_flt(current_user, "c.")
        _of_conn = _op_flt(current_user, "conn.")

        # Determine target month (the month they haven't paid for)
        if not month:
            now = datetime.now()
            target_year, target_month = now.year, now.month
        else:
            try:
                target_year, target_month = month.split("-")
                target_year, target_month = int(target_year), int(target_month)
            except (ValueError, AttributeError):
                now = datetime.now()
                target_year, target_month = now.year, now.month

        # Previous month (the month they DID pay)
        if target_month == 1:
            prev_year, prev_month = target_year - 1, 12
        else:
            prev_year, prev_month = target_year, target_month - 1

        # month_year format in DB is MM-YYYY
        target_my = f"{target_month:02d}-{target_year}"
        prev_my = f"{prev_month:02d}-{prev_year}"

        offset = (page - 1) * per_page

        # Build dynamic WHERE clauses for filters
        extra_where = ""
        params: list = []

        if q:
            extra_where += " AND (c.name ILIKE ? OR c.customer_id ILIKE ? OR c.phone ILIKE ? OR conn.stb_no ILIKE ?)"
            params += [f"%{q}%"] * 4
        if area:
            extra_where += " AND c.area = ?"
            params.append(area)
        if mso:
            extra_where += " AND conn.mso = ?"
            params.append(mso)

        # Count + Lost Revenue: paid prev month, NOT paid target month
        agg_row = db.execute(f"""
            SELECT COUNT(*) as cnt, COALESCE(SUM(conn.plan_amount), 0) as lost_rev
            FROM customers c
            JOIN connections conn ON conn.customer_id = c.customer_id AND conn.status = 'Active'
            WHERE c.status = 'Active' AND {_of_c} AND {_of_conn}
            AND EXISTS (
                SELECT 1 FROM payments p
                WHERE p.customer_id = c.customer_id AND p.month_year = ?
            )
            AND NOT EXISTS (
                SELECT 1 FROM payments p
                WHERE p.customer_id = c.customer_id AND p.month_year = ?
            )
            {extra_where}
        """, [prev_my, target_my] + params).fetchone()
        total = agg_row["cnt"] if agg_row else 0
        lost_revenue = agg_row["lost_rev"] if agg_row else 0

        # Fetch with details
        rows = db.execute(f"""
            SELECT c.customer_id, c.name, c.phone, c.phone2, c.area, c.address,
                   conn.id as conn_id, conn.stb_no, conn.mso, conn.plan_name, conn.plan_amount,
                   conn.expiry_date, conn.network,
                   (SELECT MAX(p3.collected_at) FROM payments p3
                    WHERE p3.customer_id = c.customer_id) as last_paid_date
            FROM customers c
            JOIN connections conn ON conn.customer_id = c.customer_id AND conn.status = 'Active'
            WHERE c.status = 'Active' AND {_of_c} AND {_of_conn}
            AND EXISTS (
                SELECT 1 FROM payments p
                WHERE p.customer_id = c.customer_id AND p.month_year = ?
            )
            AND NOT EXISTS (
                SELECT 1 FROM payments p
                WHERE p.customer_id = c.customer_id AND p.month_year = ?
            )
            {extra_where}
            ORDER BY c.area, c.name
            LIMIT ? OFFSET ?
        """, [prev_my, target_my] + params + [per_page, offset]).fetchall()

        results = []
        for r in rows:
            results.append({
                "customer_id": r["customer_id"],
                "name": r["name"],
                "phone": r["phone"],
                "phone2": r["phone2"],
                "area": r["area"],
                "address": r["address"],
                "conn_id": r["conn_id"],
                "stb_no": r["stb_no"],
                "mso": r["mso"],
                "plan_name": r["plan_name"],
                "plan_amount": r["plan_amount"],
                "expiry_date": r["expiry_date"],
                "network": r["network"],
                "last_paid_date": r["last_paid_date"],
            })

        _of_area = "" if _of == "1=1" else f"AND {_of}"
        areas = [a["area"] for a in db.execute(
            f"SELECT DISTINCT area FROM customers WHERE area IS NOT NULL AND area != '' {_of_area} ORDER BY area"
        ).fetchall() if a["area"]]

        msos = [m["mso"] for m in db.execute(
            f"SELECT DISTINCT mso FROM connections WHERE mso IS NOT NULL AND mso != '' AND {_op_flt(current_user)} ORDER BY mso"
        ).fetchall() if m["mso"]]

        month_label = datetime(target_year, target_month, 1).strftime("%B %Y")

        return {
            "customers": results,
            "total": total,
            "lost_revenue": lost_revenue,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
            "areas": areas,
            "msos": msos,
            "month": f"{target_year}-{target_month:02d}",
            "month_label": month_label,
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/customers/collection-list")
def get_collection_list(
    filter: str = Query("all", regex="^(due_today|due_tomorrow|unpaid|paid|all)$"),
    q: Optional[str] = None,
    area: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    """Get customers grouped by payment status for collection screen.
    Filters: due_today, due_tomorrow, unpaid, paid, all."""
    with _get_conn() as db:
        _of = _op_flt(current_user)
        today = datetime.now().strftime("%Y-%m-%d")
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        current_month_start = datetime.now().replace(day=1).strftime("%Y-%m-%d")
        current_month_end_fmt = datetime.now().strftime("%Y-%m-%d")
        # For "paid" filter: check if payment exists this month
        _of_c = _op_flt(current_user, "c.")
        _of_conn = _op_flt(current_user, "conn.")

        offset = (page - 1) * per_page

        # Build WHERE clause based on filter
        if filter == "due_today":
            where = f"WHERE conn.status = 'Active' AND conn.expiry_date = ? AND {_of_conn} AND {_of_c}"
            params: list = [today]
        elif filter == "due_tomorrow":
            where = f"WHERE conn.status = 'Active' AND conn.expiry_date = ? AND {_of_conn} AND {_of_c}"
            params: list = [tomorrow]
        elif filter == "unpaid":
            where = f"WHERE conn.status = 'Active' AND conn.expiry_date != '' AND conn.expiry_date IS NOT NULL AND conn.expiry_date < ? AND {_of_conn} AND {_of_c}"
            params: list = [today]
        elif filter == "paid":
            # Customers who have a payment this month
            where = f"""WHERE conn.status = 'Active' AND {_of_conn} AND {_of_c}
                AND EXISTS (
                    SELECT 1 FROM payments p
                    WHERE p.customer_id = c.customer_id
                    AND p.collected_at >= ?
                )"""
            params: list = [current_month_start]
        else:  # "all"
            where = f"WHERE conn.status = 'Active' AND {_of_conn} AND {_of_c}"
            params: list = []

        # Search filter
        if q:
            where += " AND (c.name ILIKE ? OR c.phone ILIKE ? OR c.customer_id ILIKE ? OR conn.stb_no ILIKE ? OR c.area ILIKE ?)"
            params += [f"%{q}%"] * 5

        # Area filter
        if area:
            where += " AND c.area = ?"
            params.append(area)

        # Count total
        count_row = db.execute(
            f"SELECT COUNT(DISTINCT conn.id) FROM connections conn JOIN customers c ON c.customer_id = conn.customer_id {where}",
            params
        ).fetchone()
        total = count_row[0] if count_row else 0

        # Fetch data with last payment info
        rows = db.execute(f"""
            SELECT c.customer_id, c.name, c.phone, c.phone2, c.area, c.address,
                   conn.id as conn_id, conn.stb_no, conn.can_id, conn.mso,
                   conn.plan_name, conn.plan_amount, conn.expiry_date, conn.network,
                   COALESCE(
                     (SELECT MAX(p.collected_at) FROM payments p
                      WHERE p.customer_id = conn.customer_id AND p.connection_id = conn.id),
                     (SELECT MAX(pp.paypakka_created_at) FROM paypakka_payments pp
                      WHERE pp.customer_id = conn.customer_id),
                     NULL
                   ) as last_payment_date,
                   COALESCE(
                     (SELECT p.amount FROM payments p
                      WHERE p.customer_id = conn.customer_id AND p.connection_id = conn.id
                      ORDER BY p.collected_at DESC LIMIT 1),
                     (SELECT pp.collection_amount FROM paypakka_payments pp
                      WHERE pp.customer_id = conn.customer_id
                      ORDER BY pp.paypakka_created_at DESC LIMIT 1),
                     NULL
                   ) as last_payment_amount,
                   CASE WHEN EXISTS (
                       SELECT 1 FROM payments p
                       WHERE p.customer_id = c.customer_id AND p.collected_at >= ?
                   ) THEN 1 ELSE 0 END as is_paid
            FROM connections conn
            JOIN customers c ON c.customer_id = conn.customer_id
            {where}
            ORDER BY conn.expiry_date ASC, c.area, c.name
            LIMIT ? OFFSET ?
        """, [current_month_start] + params + [per_page, offset]).fetchall()

        # Calculate pending amount for each customer
        ref_date = datetime.now()
        results = []
        for r in rows:
            exp = r["expiry_date"]
            gap_months = 0
            if exp:
                try:
                    exp_dt = datetime.strptime(exp, "%Y-%m-%d")
                    gap_months = (ref_date.year - exp_dt.year) * 12 + (ref_date.month - exp_dt.month)
                    if gap_months < 0:
                        gap_months = 0
                except ValueError:
                    pass

            plan_amt = r["plan_amount"] or 0
            is_paid = bool(r["is_paid"])
            pending = round(plan_amt * (gap_months + 1), 2) if (not is_paid and plan_amt and gap_months >= 0) else 0

            results.append({
                "customer_id": r["customer_id"],
                "name": r["name"],
                "phone": r["phone"],
                "phone2": r["phone2"],
                "area": r["area"],
                "address": r["address"],
                "conn_id": r["conn_id"],
                "stb_no": r["stb_no"],
                "can_id": r["can_id"],
                "mso": r["mso"],
                "plan_name": r["plan_name"],
                "plan_amount": plan_amt,
                "expiry_date": exp,
                "is_paid": is_paid,
                "pending_amount": pending,
                "last_payment_amount": r["last_payment_amount"],
                "last_payment_date": r["last_payment_date"],
                "network": r["network"],
                "gap_months": gap_months,
            })

        # Get counts for each filter tab
        _of_count_c = _op_flt(current_user, "c.")
        _of_count_conn = _op_flt(current_user, "conn.")
        base_join = f"connections conn JOIN customers c ON c.customer_id = conn.customer_id"

        count_due_today = db.execute(
            f"SELECT COUNT(DISTINCT conn.id) FROM {base_join} WHERE conn.status = 'Active' AND conn.expiry_date = ? AND {_of_count_conn} AND {_of_count_c}",
            [today]
        ).fetchone()[0]

        count_due_tomorrow = db.execute(
            f"SELECT COUNT(DISTINCT conn.id) FROM {base_join} WHERE conn.status = 'Active' AND conn.expiry_date = ? AND {_of_count_conn} AND {_of_count_c}",
            [tomorrow]
        ).fetchone()[0]

        count_unpaid = db.execute(
            f"SELECT COUNT(DISTINCT conn.id) FROM {base_join} WHERE conn.status = 'Active' AND conn.expiry_date < ? AND {_of_count_conn} AND {_of_count_c}",
            [today]
        ).fetchone()[0]

        count_paid = db.execute(
            f"SELECT COUNT(DISTINCT conn.id) FROM {base_join} WHERE conn.status = 'Active' AND {_of_count_conn} AND {_of_count_c} AND EXISTS (SELECT 1 FROM payments p WHERE p.customer_id = c.customer_id AND p.collected_at >= ?)",
            [current_month_start]
        ).fetchone()[0]

        # Get distinct areas
        _of_area = "" if _of == "1=1" else f"AND {_of}"
        areas = [a["area"] for a in db.execute(
            f"SELECT DISTINCT area FROM customers WHERE area IS NOT NULL AND area != '' {_of_area} ORDER BY area"
        ).fetchall() if a["area"]]

        return {
            "customers": results,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
            "areas": areas,
            "counts": {
                "due_today": count_due_today,
                "due_tomorrow": count_due_tomorrow,
                "unpaid": count_unpaid,
                "paid": count_paid,
            },
        }


@router.get("/customers/search")
def search_customers(
    q: str = Query(..., min_length=1),
    current_user=Depends(get_current_user),
):
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        _of_c = _op_flt(current_user, "c.")
        month_start, month_end, current_month = get_date_range()
        paid_subq = paid_customer_subquery(current_month)
        paid_params = paid_subquery_params(month_start, month_end, current_month)
        rows = conn.execute(f"""
            SELECT c.*, conn.stb_no, conn.status as conn_status,
            CASE WHEN p.customer_id IS NOT NULL THEN 1 ELSE 0 END as is_paid
            FROM customers c
            LEFT JOIN connections conn ON c.customer_id = conn.customer_id
            LEFT JOIN (
                {paid_subq}
            ) p ON c.customer_id = p.customer_id
            WHERE (c.name ILIKE ? OR c.phone ILIKE ? OR c.customer_id ILIKE ? OR conn.stb_no ILIKE ? OR c.area ILIKE ?)
            AND {_of_c}
            ORDER BY c.area, c.name
            LIMIT 50
        """, paid_params + [f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%", f"%{q}%"]).fetchall()
        return [_customer_to_dict(r) for r in rows]


# ── Temp Disconnected customers (must be before {customer_id} route) ──

@router.get("/customers/temp-disconnected")
def list_temp_disconnected(current_user=Depends(get_current_user)):
    """List all Temp Disconnected customers with their reclaimed STBs."""
    with _get_conn() as conn:
        _of = _op_flt(current_user, "c.")
        rows = conn.execute(f"""
            SELECT c.customer_id, c.name, c.phone, c.area, c.address
            FROM customers c
            WHERE c.status = 'Temp Disconnected' AND {_of}
            ORDER BY c.name
        """).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            # Find any available STB in inventory that was reclaimed from this customer
            inv = conn.execute("SELECT stb_no FROM stb_inventory WHERE notes LIKE ? AND status = 'available' LIMIT 1",
                              [f"%{r['customer_id']}%"]).fetchone()
            d['reclaimed_stb'] = inv['stb_no'] if inv else None
            # Find the temp disconnected connection(s)
            td_conn = conn.execute("SELECT id, mso, disconnect_date FROM connections WHERE customer_id = ? AND status = 'Temp Disconnected'",
                                  [r['customer_id']]).fetchone()
            d['connection_id'] = td_conn['id'] if td_conn else None
            d['mso'] = td_conn['mso'] if td_conn else None
            d['disconnect_date'] = td_conn['disconnect_date'] if td_conn else None
            result.append(d)
        return {"customers": result}


@router.get("/customers/{customer_id}")
def get_customer(customer_id: str, current_user=Depends(get_current_user)):
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        _of_c = _op_flt(current_user, "c.")
        row = conn.execute(f"""
            SELECT c.*, conn.stb_no, conn.id as conn_id, conn.can_id, conn.mso, conn.status as conn_status,
                   conn.expiry_date, conn.plan_name, conn.plan_amount, conn.activation_date
            FROM customers c
            LEFT JOIN connections conn ON c.customer_id = conn.customer_id AND conn.status = 'Active'
            WHERE c.customer_id = ?
            AND {_of_c}
        """, [customer_id]).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Customer not found")
        result = _customer_to_dict(row)
        _of_conn = "" if _of == "1=1" else f"AND {_of}"
        result["connections"] = [_connection_to_dict(r) for r in
            conn.execute(f"SELECT * FROM connections WHERE customer_id = ? {_of_conn}", [customer_id]).fetchall()]
        # Include last 25 payments for the payment history section
        result["payments"] = [
            dict(p) for p in conn.execute("""
                SELECT p.*, u.name as collector_name
                FROM payments p
                LEFT JOIN users u ON p.collected_by = u.id
                WHERE p.customer_id = ?
                  AND (p.deleted IS NULL OR p.deleted = 0)
                ORDER BY p.collected_at DESC
                LIMIT 25
            """, [customer_id]).fetchall()
        ]
        return result


    # ========== SURRENDER ==========
# Surrender endpoints moved to routes/surrenders.py

class CustomerCreateRequest(BaseModel):
    name: str
    phone: str
    area: Optional[str] = None
    address: Optional[str] = None
    stb_number: Optional[str] = None
    plan_id: Optional[int] = None
    activation_date: Optional[str] = None
    connection_fee: Optional[float] = None  # New connection fee (agent fills manually)


@router.post("/customers", status_code=201)
def create_customer(data: CustomerCreateRequest, current_user=Depends(get_current_user)):
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        _oid = op_id(current_user)
        # Generate customer_id using operator's prefix
        if _oid is not None:
            prefix_row = conn.execute(
                "SELECT customer_prefix FROM operators WHERE id = ?", [_oid]
            ).fetchone()
        else:
            prefix_row = None
        prefix = prefix_row["customer_prefix"] if prefix_row and prefix_row["customer_prefix"] else "SSA"
        last = conn.execute(
            "SELECT customer_id FROM customers WHERE customer_id LIKE ? ORDER BY customer_id DESC LIMIT 1",
            [f"{prefix}-%"],
        ).fetchone()
        if last:
            m = re.search(r'-(\d+)', last["customer_id"])
            next_num = int(m.group(1)) + 1 if m else 1
        else:
            next_num = 1
        customer_id = f"{prefix}-{next_num:06d}"

        # Validate STB uniqueness
        stb_no = (data.stb_number or "").strip()
        _of_c = _op_flt(current_user, "c.")
        _of_bare = "" if _of == "1=1" else f"AND {_of}"
        if stb_no:
            existing = conn.execute(
                f"SELECT c.customer_id, c.name FROM connections con JOIN customers c ON con.customer_id = c.customer_id WHERE con.stb_no = ? AND con.status = 'Active' AND {_of_c}",
                [stb_no]
            ).fetchone()
            if existing:
                raise HTTPException(status_code=400, detail=f"STB {stb_no} is already assigned to {existing['name']} ({existing['customer_id']})")

        try:
            conn.execute("""
                INSERT INTO customers (customer_id, name, phone, area, address, status, operator_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, [customer_id, data.name, data.phone,
                  data.area or "", data.address or "", "Active", _oid])

            # Add connection if STB provided
            if stb_no:
                network = "TACTV" if (stb_no.startswith("172") or stb_no.startswith("173")) else ("SCV" if stb_no.startswith("5000") else "GTPL")
                conn.execute("""
                    INSERT INTO connections (customer_id, stb_no, mso, service_type, billing_type, status, network, created_at, operator_id)
                    VALUES (?, ?, ?, 'Cable', 'Prepaid', 'Active', ?, NOW(), ?)
                """, [customer_id, stb_no, network, network, _oid])

                # Remove STB from inventory (if it was there as spare)
                if _oid is not None:
                    conn.execute("DELETE FROM stb_inventory WHERE stb_no = ? AND operator_id = ?", [stb_no, _oid])
                else:
                    conn.execute("DELETE FROM stb_inventory WHERE stb_no = ? AND operator_id IS NULL", [stb_no])

                # Assign plan if provided
                plan_id = data.plan_id
                if plan_id:
                    plan = conn.execute("SELECT * FROM plans WHERE id = ?", [plan_id]).fetchone()
                    if plan:
                        act_date = data.activation_date or datetime.now().strftime("%Y-%m-%d")
                        act_dt = datetime.strptime(act_date, "%Y-%m-%d")
                        exp_dt = act_dt + timedelta(days=plan["validity_days"] or 30)
                        conn_obj = conn.execute(f"SELECT id FROM connections WHERE customer_id = ? {_of_bare}", [customer_id]).fetchone()
                        conn.execute("""
                            INSERT INTO customer_plans (customer_id, connection_id, plan_id, amount, start_date, expiry_date, status, operator_id)
                            VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)
                        """, [customer_id, conn_obj["id"], plan_id, plan["amount"], act_date, exp_dt.strftime("%Y-%m-%d"), _oid])

            # Auto-create connection fee payment if provided
            if data.connection_fee and data.connection_fee > 0:
                fee_conn_id = None
                if stb_no:
                    fee_row = conn.execute("SELECT id FROM connections WHERE customer_id = ? ORDER BY id LIMIT 1", [customer_id]).fetchone()
                    if fee_row:
                        fee_conn_id = fee_row["id"]
                # Use Python datetime (consistent format with regular payments)
                from datetime import timezone as _tz
                _ist = _tz(timedelta(hours=5, minutes=30))
                _fee_ts = datetime.now(_ist).strftime("%Y-%m-%d %H:%M:%S")
                # Check if payment_type column exists
                has_ptype = table_has_column(conn, 'payments', 'payment_type')
                if has_ptype:
                    conn.execute(
                        """INSERT INTO payments (customer_id, connection_id, plan_id, amount, payment_mode, payment_type, collected_by, month_year, months_paid, notes, operator_id, collected_at)
                           VALUES (?, ?, ?, ?, 'Cash', 'new_connection', ?, ?, 1, 'New connection fee', ?, ?)""",
                        [customer_id, fee_conn_id, data.plan_id, data.connection_fee, current_user["id"], get_current_month(), _oid, _fee_ts]
                    )
                else:
                    conn.execute(
                        """INSERT INTO payments (customer_id, connection_id, plan_id, amount, payment_mode, collected_by, month_year, months_paid, notes, operator_id, collected_at)
                           VALUES (?, ?, ?, ?, 'Cash', ?, ?, 1, 'New connection fee', ?, ?)""",
                        [customer_id, fee_conn_id, data.plan_id, data.connection_fee, current_user["id"], get_current_month(), _oid, _fee_ts]
                    )

            conn.commit()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
    log_action("customer_create", "customers", customer_id,
               new_value={"name": data.name, "phone": data.phone, "area": data.area or ""},
               user=current_user)
    return {"customer_id": customer_id, "message": "Customer created successfully"}


@router.put("/customers/{customer_id}")
def update_customer(customer_id: str, data: CustomerUpdate, current_user=Depends(get_current_user)):
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        _of_c = "" if _of == "1=1" else f"AND {_of}"
        existing = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? {_of_c}", [customer_id]).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found")

        updates = {}
        for field in ["name", "phone", "phone2", "area", "address", "city", "pincode", "status"]:
            val = getattr(data, field, None)
            if val is not None:
                updates[field] = val

        if updates:
            # If status changing to 'Surrendered', trigger full surrender logic
            # (add STBs to inventory, rename connections, etc.)
            new_status = updates.get("status")
            if new_status == "Surrendered" and existing["status"] not in ["Surrendered", "Pending Surrender"]:
                from datetime import datetime
                now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                stbs = conn.execute(f"SELECT stb_no, id FROM connections WHERE customer_id = ? {_of_c.replace('AND','AND')}", [customer_id]).fetchall()
                stb_list = [row["stb_no"] for row in stbs if row["stb_no"]]

                # Update connections to Surrendered + release STB numbers
                conn.execute(f"UPDATE connections SET status = 'Surrendered' WHERE customer_id = ? {_of_c.replace('AND','AND')}", [customer_id])
                for row in stbs:
                    if row["stb_no"]:
                        conn.execute("UPDATE connections SET stb_no = 'SURRENDERED-' || ? WHERE id = ?",
                                     [row["id"], row["id"]])

                # Set surrendered_date (status='Surrendered' already in updates)
                updates["surrendered_date"] = now

                # Add freed STBs to inventory
                cust_oid = existing["operator_id"] if existing["operator_id"] else 1
                for stb_no in stb_list:
                    inv = conn.execute("SELECT id FROM stb_inventory WHERE stb_no = ?", [stb_no]).fetchone()
                    if inv:
                        conn.execute("UPDATE stb_inventory SET status = 'available', notes = ?, operator_id = ? WHERE stb_no = ?",
                                    [f"Returned from surrendered customer {customer_id}", cust_oid, stb_no])
                    else:
                        conn.execute("""INSERT INTO stb_inventory (stb_no, status, added_at, notes, operator_id)
                                        VALUES (?, 'available', ?, ?, ?)""",
                                    [stb_no, now, f"Returned from surrendered customer {customer_id}", cust_oid])

            set_clause = ", ".join([f"{k} = ?" for k in updates])
            conn.execute(f"UPDATE customers SET {set_clause} WHERE customer_id = ? {_of_c}",
                         list(updates.values()) + [customer_id])
            conn.commit()
            log_action("customer_update", "customers", customer_id,
                       old_value={k: dict(existing).get(k) for k in updates},
                       new_value=updates, user=current_user)
        return {"message": "Customer updated successfully"}


@router.delete("/customers/{customer_id}")
def delete_customer(customer_id: str, current_user=Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admin can delete customers")
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        _of_c = "" if _of == "1=1" else f"AND {_of}"
        existing = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? {_of_c}", [customer_id]).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Customer not found")

        # Delete in order: plans -> payments -> connections -> customer
        snap = dict(existing)
        conn.execute(f"DELETE FROM customer_plans WHERE customer_id = ? {_of_c}", [customer_id])
        conn.execute(f"DELETE FROM payments WHERE customer_id = ? {_of_c}", [customer_id])
        conn.execute(f"DELETE FROM connections WHERE customer_id = ? {_of_c}", [customer_id])
        conn.execute(f"DELETE FROM customers WHERE customer_id = ? {_of_c}", [customer_id])
        conn.commit()
        log_action("customer_delete", "customers", customer_id,
                   old_value=snap, user=current_user)
        return {"message": "Customer deleted successfully"}


class UpdateExpiryRequest(BaseModel):
    expiry_date: str

@router.put("/customers/{customer_id}/connections/{conn_id}/expiry")
def update_connection_expiry(customer_id: str, conn_id: int, data: UpdateExpiryRequest, current_user=Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admin can update expiry date")
    # Validate date format
    try:
        from datetime import datetime
        datetime.strptime(data.expiry_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        _of_conn = "" if _of == "1=1" else f"AND {_of}"
        # Verify connection belongs to this customer
        connection = conn.execute(
            f"SELECT * FROM connections WHERE id = ? AND customer_id = ? {_of_conn}",
            [conn_id, customer_id]
        ).fetchone()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")
        conn.execute(
            f"UPDATE connections SET expiry_date = ? WHERE id = ? {_of_conn}",
            [data.expiry_date, conn_id]
        )
        conn.commit()
        return {"message": f"Expiry date updated to {data.expiry_date}", "expiry_date": data.expiry_date}


class ChangePlanRequest(BaseModel):
    plan_id: int

@router.put("/customers/{customer_id}/change-plan")
def change_customer_plan(customer_id: str, data: ChangePlanRequest, current_user=Depends(get_current_user)):
    with _get_conn() as conn:
        _of = _op_flt(current_user)
        _oid = op_id(current_user)
        _of_c = "" if _of == "1=1" else f"AND {_of}"
        _of_conn = "" if _of == "1=1" else f"AND {_of}"
        _of_cp = "" if _of == "1=1" else f"AND {_of}"

        # Verify customer exists
        customer = conn.execute(f"SELECT * FROM customers WHERE customer_id = ? {_of_c}", [customer_id]).fetchone()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")

        # Verify plan exists
        plan = conn.execute("SELECT * FROM plans WHERE id = ? AND status = 'Active'", [data.plan_id]).fetchone()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        # Get the active connection
        connection = conn.execute(
            f"SELECT * FROM connections WHERE customer_id = ? AND status = 'Active' {_of_conn} LIMIT 1",
            [customer_id]
        ).fetchone()
        if not connection:
            raise HTTPException(status_code=400, detail="No active connection found")

        # Update connection with new plan
        conn.execute(f"""
            UPDATE connections 
            SET plan_name = ?, plan_amount = ?
            WHERE id = ? {_of_conn}
        """, [plan["name"], plan["amount"], connection["id"]])

        # Update/create customer_plans record
        existing_plan = conn.execute(
            f"SELECT * FROM customer_plans WHERE customer_id = ? AND status = 'Active' {_of_cp} LIMIT 1",
            [customer_id]
        ).fetchone()
        
        from datetime import datetime, timedelta
        import calendar
        today = datetime.now()
        # Expiry = last day of current paying month
        last_day = calendar.monthrange(today.year, today.month)[1]
        exp_date = today.replace(day=last_day).strftime("%Y-%m-%d")

        if existing_plan:
            conn.execute(f"""
                UPDATE customer_plans 
                SET plan_id = ?, amount = ?, start_date = ?, expiry_date = ?
                WHERE id = ? {_of_cp}
            """, [plan["id"], plan["amount"], today.strftime("%Y-%m-%d"), exp_date, existing_plan["id"]])
        else:
            conn.execute("""
                INSERT INTO customer_plans (customer_id, connection_id, plan_id, amount, start_date, expiry_date, status, operator_id)
                VALUES (?, ?, ?, ?, ?, ?, 'Active', ?)
            """, [customer_id, connection["id"], plan["id"], plan["amount"], today.strftime("%Y-%m-%d"), exp_date, _oid])

        conn.commit()
    return {"message": f"Plan changed to {plan['name']} (₹{plan['amount']}) successfully"}


# Connection endpoints moved to routes/connections.py
