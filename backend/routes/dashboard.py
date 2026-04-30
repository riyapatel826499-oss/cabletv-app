from fastapi import APIRouter, Depends
from datetime import datetime
from typing import Optional

from deps import get_db, get_current_user
from utils import get_month_range, get_current_month
from cache import get_cached, set_cached

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/stats")
def dashboard_stats(current_user=Depends(get_current_user)):
    # 30-second TTL cache — dashboard is expensive (12 queries)
    cached = get_cached("dashboard_stats", ttl=30)
    if cached:
        return cached

    with get_db() as conn:
        now = datetime.now()
        current_month = get_current_month()
        month_start, month_end = get_month_range(now)
        month_start_str = month_start  # "YYYY-MM-01"
        now_end = now.strftime("%Y-%m-%d 23:59:59")

        # Total active customers
        total_customers = conn.execute(
            "SELECT COUNT(*) FROM customers WHERE status = 'Active'"
        ).fetchone()[0]

        # Total connections
        total_connections = conn.execute(
            "SELECT COUNT(*) FROM connections WHERE status = 'Active'"
        ).fetchone()[0]

        # Paid this month: UNION of local payments + paypakka payments
        paid_this_month = conn.execute(
            """SELECT COUNT(DISTINCT customer_id) FROM (
                   SELECT customer_id FROM payments WHERE month_year = ?
                   UNION
                   SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?
               )""",
            (current_month, month_start_str, now_end),
        ).fetchone()[0]

        # Total collected: sum of local + paypakka for current month
        local_collected = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE month_year = ?",
            (current_month,),
        ).fetchone()[0]

        paypakka_collected = conn.execute(
            """SELECT COALESCE(SUM(collection_amount), 0) FROM paypakka_payments
               WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?""",
            (month_start_str, now_end),
        ).fetchone()[0]

        total_collected = local_collected + paypakka_collected

        # Unpaid = active customers who haven't paid this month
        unpaid = conn.execute(
            """SELECT COUNT(DISTINCT c.customer_id) 
               FROM customers c
               JOIN connections con ON c.customer_id = con.customer_id
               WHERE c.status = 'Active' AND con.status = 'Active'
                 AND c.customer_id NOT IN (
                   SELECT customer_id FROM payments WHERE month_year = ?
                   UNION
                   SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?
                 )""",
            (current_month, month_start_str, now_end),
        ).fetchone()[0]

        # Payments by area (from both tables)
        by_area = conn.execute(
            """SELECT c.area, COUNT(DISTINCT sub.customer_id) as paid_count,
                      SUM(sub.amount) as total_amount
               FROM (
                   SELECT customer_id, amount FROM payments WHERE month_year = ?
                   UNION ALL
                   SELECT customer_id, collection_amount FROM paypakka_payments
                   WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?
               ) sub
               JOIN customers c ON sub.customer_id = c.customer_id
               GROUP BY c.area
               ORDER BY total_amount DESC""",
            (current_month, month_start_str, now_end),
        ).fetchall()

        # Recent payments (last 15 from BOTH local + paypakka)
        recent_local = conn.execute(
            """SELECT p.customer_id, p.amount, p.payment_mode as mode, p.collected_at as date,
                      c.name as customer_name, c.area, u.name as collector_name, 'Local' as source,
                      cn.stb_no
               FROM payments p
               JOIN customers c ON p.customer_id = c.customer_id
               LEFT JOIN users u ON p.collected_by = u.id
               LEFT JOIN connections cn ON cn.id = p.connection_id
               ORDER BY p.collected_at DESC LIMIT 15""",
        ).fetchall()

        recent_pp = conn.execute(
            """SELECT pp.customer_id, pp.collection_amount as amount, pp.payment_type as mode,
                      pp.paypakka_created_at as date, c.name as customer_name, c.area,
                      e.emp_name as collector_name, 'Paypakka' as source,
                      cn.stb_no
               FROM paypakka_payments pp
               JOIN customers c ON pp.customer_id = c.customer_id
               LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
               LEFT JOIN connections cn ON cn.customer_id = pp.customer_id AND cn.status = 'Active'
               ORDER BY pp.paypakka_created_at DESC LIMIT 15""",
        ).fetchall()

        # Merge and sort, take top 10
        all_recent = [dict(r) for r in recent_local] + [dict(r) for r in recent_pp]
        all_recent.sort(key=lambda x: x.get("date") or "", reverse=True)
        recent_payments = all_recent[:10]

        # Expiring soon (next 3 days)
        expiring_soon = conn.execute(
            """SELECT cp.*, c.name as customer_name, c.phone, c.area, p.name as plan_name
               FROM customer_plans cp
               JOIN customers c ON cp.customer_id = c.customer_id
               JOIN plans p ON cp.plan_id = p.id
               WHERE cp.status = 'Active' AND cp.expiry_date <= date('now', '+3 days')
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

    with get_db() as conn:
        now = datetime.now()
        current_month = get_current_month()
        month_start, month_end = get_month_range(now)

        # Local payments by mode
        local = conn.execute(
            """SELECT COALESCE(payment_mode, 'Other') as mode, COUNT(*) as cnt, SUM(amount) as total
               FROM payments WHERE month_year = ? GROUP BY payment_mode""",
            (current_month,),
        ).fetchall()

        # Paypakka payments by type
        pp = conn.execute(
            """SELECT COALESCE(payment_type, 'Other') as mode, COUNT(*) as cnt, SUM(collection_amount) as total
               FROM paypakka_payments WHERE paypakka_created_at >= ? AND paypakka_created_at <= ?
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
