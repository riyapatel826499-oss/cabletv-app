from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime
from typing import Optional

from deps import get_db, get_current_user, op_filter, op_id
from utils import get_month_range, get_current_month
from cache import get_cached, set_cached

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/stats")
def dashboard_stats(current_user=Depends(get_current_user)):
    # 30-second TTL cache — dashboard is expensive (12 queries)
    cached = get_cached("dashboard_stats", ttl=30)
    if cached:
        return cached

    flt = op_filter(current_user)
    _oid = op_id(current_user)

    with get_db() as conn:
        now = datetime.now()
        current_month = get_current_month()
        month_start, month_end = get_month_range(now)
        month_start_str = month_start  # "YYYY-MM-01"
        now_end = now.strftime("%Y-%m-%d 23:59:59")

        # Total active customers
        total_customers = conn.execute(
            f"SELECT COUNT(*) FROM customers WHERE status = 'Active' AND {flt}"
        ).fetchone()[0]

        # Total connections
        total_connections = conn.execute(
            f"SELECT COUNT(*) FROM connections WHERE status = 'Active' AND {flt}"
        ).fetchone()[0]

        # Paid this month: UNION of local payments + paypakka payments
        # Both use date range (collected_at / paypakka_created_at) for consistency
        paid_this_month = conn.execute(
            f"""SELECT COUNT(DISTINCT customer_id) FROM (
                   SELECT customer_id FROM payments WHERE collected_at >= ? AND collected_at <= ? AND {flt}
                   UNION
                   SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= ? AND paypakka_created_at <= ? AND {flt}
               )""",
            (month_start_str, now_end, month_start_str, now_end),
        ).fetchone()[0]

        # Total collected: sum of local + paypakka for current month
        # Both use date range for consistency
        local_collected = conn.execute(
            f"SELECT COALESCE(SUM(amount), 0) FROM payments WHERE collected_at >= ? AND collected_at <= ? AND {flt}",
            (month_start_str, now_end),
        ).fetchone()[0]

        paypakka_collected = conn.execute(
            f"""SELECT COALESCE(SUM(collection_amount), 0) FROM paypakka_payments
               WHERE paypakka_created_at >= ? AND paypakka_created_at <= ? AND {flt}""",
            (month_start_str, now_end),
        ).fetchone()[0]

        total_collected = local_collected + paypakka_collected

        # Unpaid = active customers who haven't paid this month
        unpaid = conn.execute(
            f"""SELECT COUNT(DISTINCT c.customer_id) 
               FROM customers c
               JOIN connections con ON c.customer_id = con.customer_id
               WHERE c.status = 'Active' AND con.status = 'Active' AND {op_filter(current_user, 'c')}
                 AND c.customer_id NOT IN (
                   SELECT customer_id FROM payments WHERE collected_at >= ? AND collected_at <= ? AND {flt}
                   UNION
                   SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= ? AND paypakka_created_at <= ? AND {flt}
                 )""",
            (month_start_str, now_end, month_start_str, now_end),
        ).fetchone()[0]

        # Payments by area (from both tables, LEFT JOIN for missing customers)
        by_area = conn.execute(
            f"""SELECT COALESCE(c.area, 'Unknown') as area, COUNT(DISTINCT sub.customer_id) as paid_count,
                      SUM(sub.amount) as total_amount
               FROM (
                   SELECT customer_id, amount FROM payments WHERE collected_at >= ? AND collected_at <= ? AND {flt}
                   UNION ALL
                   SELECT customer_id, collection_amount FROM paypakka_payments
                   WHERE paypakka_created_at >= ? AND paypakka_created_at <= ? AND {flt}
               ) sub
               LEFT JOIN customers c ON sub.customer_id = c.customer_id
               GROUP BY COALESCE(c.area, 'Unknown')
               ORDER BY total_amount DESC""",
            (month_start_str, now_end, month_start_str, now_end),
        ).fetchall()

        # Recent payments (last 15 from BOTH local + paypakka)
        recent_local = conn.execute(
            f"""SELECT p.customer_id, p.amount, p.payment_mode as mode, p.collected_at as date,
                      c.name as customer_name, c.area, u.name as collector_name, 'Local' as source,
                      cn.stb_no
               FROM payments p
               JOIN customers c ON p.customer_id = c.customer_id
               LEFT JOIN users u ON p.collected_by = u.id
               LEFT JOIN connections cn ON cn.id = p.connection_id
               WHERE {op_filter(current_user, 'p')}
               ORDER BY p.collected_at DESC LIMIT 15""",
        ).fetchall()

        recent_pp = conn.execute(
            f"""SELECT pp.customer_id, pp.collection_amount as amount, pp.payment_type as mode,
                      pp.paypakka_created_at as date, c.name as customer_name, c.area,
                      e.emp_name as collector_name, 'Paypakka' as source,
                      cn.stb_no
               FROM paypakka_payments pp
               JOIN customers c ON pp.customer_id = c.customer_id
               LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
               LEFT JOIN connections cn ON cn.customer_id = pp.customer_id AND cn.status = 'Active'
               WHERE {op_filter(current_user, 'pp')}
               ORDER BY pp.paypakka_created_at DESC LIMIT 15""",
        ).fetchall()

        # Merge and sort, take top 10
        all_recent = [dict(r) for r in recent_local] + [dict(r) for r in recent_pp]
        all_recent.sort(key=lambda x: x.get("date") or "", reverse=True)
        recent_payments = all_recent[:10]

        # Expiring soon (next 3 days)
        expiring_soon = conn.execute(
            f"""SELECT cp.*, c.name as customer_name, c.phone, c.area, p.name as plan_name
               FROM customer_plans cp
               JOIN customers c ON cp.customer_id = c.customer_id
               JOIN plans p ON cp.plan_id = p.id
               WHERE cp.status = 'Active' AND cp.expiry_date <= date('now', '+3 days') AND {op_filter(current_user, 'cp')}
               ORDER BY cp.expiry_date""",
        ).fetchall()

        # Collection efficiency
        efficiency = round((paid_this_month / total_customers * 100) if total_customers > 0 else 0, 1)

    result = {
        "month": current_month,
        "total_customers": total_customers,
        "total_connections": total_connections,
        "paid_this_month": paid_this_month,
        "unpaid_this_month": unpaid,
        "total_collected": total_collected,
        "collection_efficiency": efficiency,
        "by_area": [dict(r) for r in by_area],
        "recent_payments": [dict(r) for r in recent_payments],
        "expiring_soon": [dict(r) for r in expiring_soon],
    }
    set_cached("dashboard_stats", result)
    return result


@router.get("/payment-modes")
def payment_mode_stats(current_user=Depends(get_current_user)):
    """Get payment mode breakdown for current month from both tables."""
    cached = get_cached("payment_modes", ttl=60)
    if cached:
        return cached

    flt = op_filter(current_user)

    with get_db() as conn:
        now = datetime.now()
        current_month = get_current_month()
        month_start, month_end = get_month_range(now)

        # Local payments by mode (date range for consistency)
        local = conn.execute(
            f"""SELECT COALESCE(payment_mode, 'Other') as mode, COUNT(*) as cnt, SUM(amount) as total
               FROM payments WHERE collected_at >= ? AND collected_at <= ? AND {flt} GROUP BY payment_mode""",
            (month_start, month_end),
        ).fetchall()

        # Paypakka payments by type
        pp = conn.execute(
            f"""SELECT COALESCE(payment_type, 'Other') as mode, COUNT(*) as cnt, SUM(collection_amount) as total
               FROM paypakka_payments WHERE paypakka_created_at >= ? AND paypakka_created_at <= ? AND {flt}
               GROUP BY payment_type""",
            (month_start, month_end),
        ).fetchall()

    # Merge both
    modes = {}
    for r in local:
        d = dict(r)
        m = d["mode"] or "Other"
        modes[m] = {"count": d["cnt"], "total": d["total"] or 0}
    for r in pp:
        d = dict(r)
        m = d["mode"] or "Other"
        if m in modes:
            modes[m]["count"] += d["cnt"]
            modes[m]["total"] += d["total"] or 0
        else:
            modes[m] = {"count": d["cnt"], "total": d["total"] or 0}

    total_count = sum(v["count"] for v in modes.values())
    total_amount = sum(v["total"] for v in modes.values())

    result = {
        "modes": modes,
        "total_count": total_count,
        "total_amount": total_amount,
    }
    set_cached("payment_modes", result)
    return result


@router.get("/master")
def master_dashboard(current_user=Depends(get_current_user)):
    """Master admin dashboard — operators overview."""
    if current_user.get("role") != "master":
        raise HTTPException(403, "Master admin only")

    with get_db() as conn:
        now = datetime.now()
        current_month = get_current_month()
        month_start = now.strftime("%Y-%m-01")
        now_end = now.strftime("%Y-%m-%d 23:59:59")

        # All active operators with their stats
        # Both local + paypakka payments, filtered by date range in current calendar month
        operators = conn.execute(
            """SELECT o.id, o.business_name, o.owner_name, o.phone, o.area, o.mso,
                      o.customer_prefix, o.status, o.created_at,
                      (SELECT COUNT(*) FROM customers WHERE operator_id = o.id AND status = 'Active') as customer_count,
                      (SELECT COUNT(*) FROM connections WHERE operator_id = o.id AND status = 'Active') as connection_count,
                      (SELECT COUNT(DISTINCT customer_id) FROM (
                          SELECT customer_id FROM payments WHERE operator_id = o.id AND collected_at >= ? AND collected_at <= ?
                          UNION
                          SELECT customer_id FROM paypakka_payments WHERE operator_id = o.id AND paypakka_created_at >= ? AND paypakka_created_at <= ?
                      )) as paid_local,
                      (SELECT COALESCE(SUM(total), 0) FROM (
                          SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE operator_id = o.id AND collected_at >= ? AND collected_at <= ?
                          UNION ALL
                          SELECT COALESCE(SUM(collection_amount), 0) as total FROM paypakka_payments WHERE operator_id = o.id AND paypakka_created_at >= ? AND paypakka_created_at <= ?
                      )) as collected_local
               FROM operators o
               ORDER BY o.status = 'active' DESC, o.business_name""",
            (month_start, now_end, month_start, now_end, month_start, now_end, month_start, now_end),
        ).fetchall()

        # Total stats across all operators
        total_operators = len([o for o in operators if o["status"] == "active"])
        total_customers = sum(o["customer_count"] for o in operators)
        total_connections = sum(o["connection_count"] for o in operators)
        total_collected = sum(o["collected_local"] for o in operators)
        total_paid = sum(o["paid_local"] for o in operators)

        # Monthly revenue trend (last 6 months, from both local + paypakka)
        trend = conn.execute("""
            SELECT month, SUM(total) as total FROM (
                SELECT strftime('%m-%Y', collected_at) as month, SUM(amount) as total
                FROM payments
                WHERE collected_at >= date('now', '-6 months', 'start of month')
                GROUP BY strftime('%Y-%m', collected_at)
                UNION ALL
                SELECT strftime('%m-%Y', paypakka_created_at) as month, SUM(collection_amount) as total
                FROM paypakka_payments
                WHERE paypakka_created_at >= date('now', '-6 months', 'start of month')
                GROUP BY strftime('%Y-%m', paypakka_created_at)
            )
            GROUP BY month ORDER BY month DESC LIMIT 6
        """).fetchall()

    return {
        "total_operators": total_operators,
        "total_customers": total_customers,
        "total_connections": total_connections,
        "total_collected": total_collected,
        "total_paid": total_paid,
        "collection_efficiency": round((total_paid / total_customers * 100) if total_customers > 0 else 0, 1),
        "operators": [dict(o) for o in operators],
        "revenue_trend": [dict(t) for t in trend],
        "month": current_month,
    }
