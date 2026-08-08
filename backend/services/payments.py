"""Shared payment query service — combines local + paypakka payment data."""
from datetime import datetime, timedelta
from config import DB_ENGINE


def _gc(col):
    """Return GROUP_CONCAT or STRING_AGG depending on DB engine."""
    if DB_ENGINE == "postgresql":
        return f"STRING_AGG(DISTINCT {col}, ', ')"
    return f"GROUP_CONCAT(DISTINCT {col})"


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
    """Return SQL subquery to find distinct customer_ids PAID for the target month.

    CORRECT SEMANTIC (since 2026-08-08, commit after aef0f04):
    a customer is paid for the target month iff some payment COVERS it —
    the window [month(month_year), month(month_year) + months_paid) contains
    the target month index. Payment COLLECTION DATE is irrelevant: a payment
    collected on Aug 1 for month_year 07-2026 covers July only, so that
    customer is DUE for August (yellow), not green.

    This replaces the old MIN(month_year)+SUM(months_paid) heuristic, which
    assumed payments were contiguous from the first payment and over-counted
    customers with gaps (prod 2026-08-08: heuristic said ~345 paid for Aug
    2026 vs 25 with per-payment coverage) — the root cause of the collection
    map showing July-only payers as green.

    `current_month` = target month as 'MM-YYYY' (e.g. '08-2026').
    When None → DATE-RANGE mode: any payment collected within
    [month_start, month_end] counts (used by paid-filter dropdowns, where a
    date window is the intended semantic).
    """
    if current_month:
        # 'MM-YYYY' → month index = yyyy*12 + mm (e.g. 08-2026 → 24320)
        _mm, _yyyy = int(current_month[:2]), int(current_month[3:7])
        _target = _yyyy * 12 + _mm

        if DB_ENGINE == "postgresql":
            start_expr = (
                "EXTRACT(YEAR FROM TO_DATE(p.month_year, 'MM-YYYY')) * 12 + "
                "EXTRACT(MONTH FROM TO_DATE(p.month_year, 'MM-YYYY'))")
            local_sql = (
                "SELECT DISTINCT p.customer_id FROM payments p "
                f"WHERE p.month_year ~ '^[0-9]{{2}}-[0-9]{{4}}$' "
                f"  AND ({start_expr}) <= {_target} "
                f"  AND {_target} < ({start_expr}) + COALESCE(p.months_paid, 1)"
            )
        else:
            start_expr = (
                "CAST(SUBSTR(p.month_year, 4, 4) AS INTEGER) * 12 + "
                "CAST(SUBSTR(p.month_year, 1, 2) AS INTEGER)")
            local_sql = (
                "SELECT DISTINCT p.customer_id FROM payments p "
                "WHERE p.month_year GLOB '[0-9][0-9]-[0-9][0-9][0-9][0-9]' "
                f"  AND ({start_expr}) <= {_target} "
                f"  AND {_target} < ({start_expr}) + COALESCE(p.months_paid, 1)"
            )

        return (
            "SELECT DISTINCT customer_id FROM ("
            + local_sql +
            " UNION "
            "SELECT customer_id FROM paypakka_payments "
            "WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?"
            ")"
        )

    # --- DATE-RANGE mode (current_month is None): payments collected in window.
    return (
        "SELECT DISTINCT customer_id FROM ("
        "SELECT customer_id FROM payments WHERE collected_at >= ? AND collected_at <= ? "
        "UNION "
        "SELECT customer_id FROM paypakka_payments "
        "WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?"
        ")"
    )


def paid_subquery_params(month_start, month_end, current_month):
    """Return the parameter list for paid_customer_subquery().

    Month-coverage mode (current_month given): only the paypakka bridge uses
    the date window → 2 params. Date-range mode (current_month None): both
    local and paypakka windows → 4 params. Must match paid_customer_subquery().
    """
    if current_month:
        return [month_start, month_end]
    return [month_start, month_end, month_start, month_end]


def paypakka_payment_details_sql(placeholders):
    """SQL to aggregate paypakka payment details for given customer placeholders.
    
    Returns amount, modes, collector name, last payment date per customer.
    """
    return f"""SELECT pp.customer_id,
            SUM(pp.collection_amount) as total_amount,
            {_gc('pp.payment_type')} as payment_modes,
            MAX(pp.paypakka_created_at) as last_payment_date,
            {_gc('e.emp_name')} as collected_by
        FROM paypakka_payments pp
        LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
        WHERE pp.customer_id IN ({placeholders})
        AND pp.paypakka_created_at >= ? AND pp.paypakka_created_at <= ?
        GROUP BY pp.customer_id"""


def local_payment_details_sql(placeholders, current_month):
    """SQL to aggregate local payment details for given customer placeholders.
    
    Always uses collected_at date range for consistency with paypakka queries.
    """
    return f"""SELECT p.customer_id, SUM(p.amount) as total_amount,
            {_gc('p.payment_mode')} as payment_modes,
            MAX(p.collected_at) as last_payment_date,
            {_gc('u.name')} as collected_by
        FROM payments p
        LEFT JOIN users u ON p.collected_by = u.id
        WHERE p.customer_id IN ({placeholders})
        AND p.collected_at >= ? AND p.collected_at <= ?
        AND p.deleted = 0
        GROUP BY p.customer_id"""


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

    # Local payments (always date range)
    local_q = local_payment_details_sql(placeholders, current_month)
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
        # Merge collected_by from local payments
        local_collector = lr["collected_by"] if "collected_by" in lr.keys() else None
        if local_collector:
            if existing.get("collected_by"):
                existing["collected_by"] = existing["collected_by"] + ", " + local_collector
            else:
                existing["collected_by"] = local_collector
        pay_map[cid] = existing

    return pay_map


def get_total_paid_amount(conn, month_start, month_end, area=None):
    """Get total paid amount from BOTH paypakka AND local payments, optionally filtered by area."""
    if area:
        q = """SELECT COALESCE(SUM(amount), 0) FROM (
            SELECT pp.collection_amount AS amount FROM paypakka_payments pp
                INNER JOIN customers c ON pp.customer_id = c.customer_id
                WHERE pp.paypakka_created_at >= ? AND pp.paypakka_created_at <= ?
                AND c.area = ?
            UNION ALL
            SELECT p.amount FROM payments p
                INNER JOIN customers c ON p.customer_id = c.customer_id
                WHERE p.collected_at >= ? AND p.collected_at <= ?
                AND c.area = ?
        )"""
        return conn.execute(q, [month_start, month_end, area, month_start, month_end, area]).fetchone()[0] or 0
    q = """SELECT COALESCE(SUM(amount), 0) FROM (
        SELECT pp.collection_amount AS amount FROM paypakka_payments pp
            WHERE pp.paypakka_created_at >= ? AND pp.paypakka_created_at <= ?
        UNION ALL
        SELECT p.amount FROM payments p
            WHERE p.collected_at >= ? AND p.collected_at <= ?
    )"""
    return conn.execute(q, [month_start, month_end, month_start, month_end]).fetchone()[0] or 0
