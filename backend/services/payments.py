"""Shared payment query service — combines local + paypakka payment data."""
from datetime import datetime, timedelta


def get_date_range(paid_from=None, paid_to=None):
    """Return (month_start, month_end, current_month) for payment queries.
    
    current_month is None when custom date range is used (forces date-range queries).
    """
    now = datetime.now()
    if paid_from or paid_to:
        month_start = paid_from or "2000-01-01"
        month_end = (paid_to + " 23:59:59") if paid_to else now.strftime("%Y-%m-%d 23:59:59")
        return month_start, month_end, None  # current_month=None → use date range

    month_start = now.strftime("%Y-%m-01")
    if now.month == 12:
        month_end = f"{now.year}-12-31 23:59:59"
    else:
        next_mo = now.replace(month=now.month + 1, day=1)
        month_end = (next_mo - timedelta(days=1)).strftime("%Y-%m-%d") + " 23:59:59"
    return month_start, month_end, now.strftime("%m-%Y")


def paid_customer_subquery(current_month):
    """Return (SQL subquery, params) to find distinct customer_ids who paid.
    
    Uses month_year for local payments when current_month is set,
    otherwise falls back to date-range comparison for both tables.
    """
    if current_month:
        return (
            "SELECT DISTINCT customer_id FROM ("
            "SELECT customer_id FROM payments WHERE month_year = ? "
            "UNION "
            "SELECT customer_id FROM paypakka_payments "
            "WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?"
            ")"
        )
    else:
        return (
            "SELECT DISTINCT customer_id FROM ("
            "SELECT customer_id FROM payments WHERE collected_at >= ? AND collected_at <= ? "
            "UNION "
            "SELECT customer_id FROM paypakka_payments "
            "WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?"
            ")"
        )


def paid_subquery_params(month_start, month_end, current_month):
    """Return the parameter list for paid_customer_subquery()."""
    if current_month:
        return [current_month, month_start, month_end]
    return [month_start, month_end, month_start, month_end]


def paypakka_payment_details_sql(placeholders):
    """SQL to aggregate paypakka payment details for given customer placeholders.
    
    Returns amount, modes, collector name, last payment date per customer.
    """
    return f"""SELECT pp.customer_id,
            SUM(pp.collection_amount) as total_amount,
            GROUP_CONCAT(DISTINCT pp.payment_type) as payment_modes,
            MAX(pp.paypakka_created_at) as last_payment_date,
            GROUP_CONCAT(DISTINCT e.emp_name) as collected_by
        FROM paypakka_payments pp
        LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
        WHERE pp.customer_id IN ({placeholders})
        AND pp.paypakka_created_at >= ? AND pp.paypakka_created_at <= ?
        GROUP BY pp.customer_id"""


def local_payment_details_sql(placeholders, current_month):
    """SQL to aggregate local payment details for given customer placeholders."""
    if current_month:
        return f"""SELECT customer_id, SUM(amount) as total_amount,
                GROUP_CONCAT(DISTINCT payment_mode) as payment_modes,
                MAX(collected_at) as last_payment_date
            FROM payments WHERE customer_id IN ({placeholders})
            AND month_year = ?
            GROUP BY customer_id"""
    return f"""SELECT customer_id, SUM(amount) as total_amount,
            GROUP_CONCAT(DISTINCT payment_mode) as payment_modes,
            MAX(collected_at) as last_payment_date
        FROM payments WHERE customer_id IN ({placeholders})
        AND collected_at >= ? AND collected_at <= ?
        GROUP BY customer_id"""


def get_merged_payments(conn, customer_ids, month_start, month_end, current_month):
    """Fetch and merge paypakka + local payment details into a dict keyed by customer_id.
    
    Returns {customer_id: {amount, mode, date, collected_by}}.
    """
    if not customer_ids:
        return {}

    pay_map = {}
    placeholders = ",".join(["?"] * len(customer_ids))

    # Paypakka payments
    pay_q = paypakka_payment_details_sql(placeholders)
    pay_rows = conn.execute(pay_q, customer_ids + [month_start, month_end]).fetchall()
    for pr in pay_rows:
        modes = pr["payment_modes"] or ""
        mode_list = [m.strip().title() for m in modes.split(",")]
        pay_map[pr["customer_id"]] = {
            "amount": pr["total_amount"] or 0,
            "mode": ", ".join(sorted(set(mode_list))),
            "date": pr["last_payment_date"],
            "collected_by": pr["collected_by"] or "",
        }

    # Local payments
    local_q = local_payment_details_sql(placeholders, current_month)
    if current_month:
        local_params = customer_ids + [current_month]
    else:
        local_params = customer_ids + [month_start, month_end]
    local_rows = conn.execute(local_q, local_params).fetchall()

    for lr in local_rows:
        cid = lr["customer_id"]
        existing = pay_map.get(cid, {"amount": 0, "mode": "", "date": ""})
        existing["amount"] += lr["total_amount"] or 0
        if lr["payment_modes"]:
            existing["mode"] = (existing["mode"] + ", " + lr["payment_modes"]).strip(", ")
        if lr["last_payment_date"] and (not existing.get("date") or lr["last_payment_date"] > existing["date"]):
            existing["date"] = lr["last_payment_date"]
        pay_map[cid] = existing

    return pay_map


def get_total_paid_amount(conn, month_start, month_end, area=None):
    """Get total paid amount from paypakka payments, optionally filtered by area."""
    if area:
        q = """SELECT COALESCE(SUM(pp.collection_amount), 0) FROM paypakka_payments pp
    INNER JOIN customers c ON pp.customer_id = c.customer_id
    WHERE pp.paypakka_created_at >= ? AND pp.paypakka_created_at <= ?
    AND c.area = ?"""
        return conn.execute(q, [month_start, month_end, area]).fetchone()[0] or 0
    q = """SELECT COALESCE(SUM(pp.collection_amount), 0) FROM paypakka_payments pp
    WHERE pp.paypakka_created_at >= ? AND pp.paypakka_created_at <= ?"""
    return conn.execute(q, [month_start, month_end]).fetchone()[0] or 0
