"""Dashboard routes — migrated to SQLAlchemy 2.0 ORM.

Complex aggregation queries (UNION, GROUP BY with subqueries) use
text() as a bridge where ORM would be more verbose and harder to read.
Simple counts/sums use full ORM style.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, text, and_, or_, literal_column
from datetime import datetime, timedelta
from typing import Optional

from models.base import get_db
from models.tables import (
    Customer, Connection, Payment, PaypakkaPayment, PaypakkaEmployee,
    CustomerPlan, Plan, User, Operator, ServiceRequest,
)
from deps_orm import get_current_user, require_role, apply_op_filter, op_id, is_agent_role
from utils import get_month_range, get_current_month
from cache import get_cached, set_cached

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/stats")
def dashboard_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    # 30-second TTL cache — dashboard is expensive (12 queries)
    # But NOT for agents — they need fresh personal data
    is_agent = is_agent_role(current_user)
    _oid = op_id(current_user)
    _cache_key = f"dashboard_stats:{_oid}"  # per-operator to prevent cross-tenant bleed
    if not is_agent:
        cached = get_cached(_cache_key, ttl=30)
        if cached:
            return cached

    uid = current_user.get("id")  # logged-in user's ID

    now = datetime.now()
    current_month = get_current_month()
    month_start, month_end = get_month_range(now)
    month_start_str = month_start  # "YYYY-MM-01"
    now_end = now.strftime("%Y-%m-%d 23:59:59")

    # ── Helper: operator filter fragment for raw-text queries ──────────
    # In the old code `op_filter(current_user)` returned either
    # "operator_id = <N>"  or  "1=1" (master sees all).
    op_flt = "1=1"
    op_flt_p = "1=1"
    op_flt_pp = "1=1"
    op_flt_c = "1=1"
    op_flt_cp = "1=1"
    if _oid is not None:
        op_flt = f"operator_id = {_oid}"
        op_flt_p = f"p.operator_id = {_oid}"
        op_flt_pp = f"pp.operator_id = {_oid}"
        op_flt_c = f"c.operator_id = {_oid}"
        op_flt_cp = f"cp.operator_id = {_oid}"

    # Total active customers
    q_cust = apply_op_filter(select(func.count()), Customer, current_user)
    total_customers = db.execute(q_cust).scalar()

    # Total connections
    q_conn = apply_op_filter(
        select(func.count()).where(Connection.status == "Active"),
        Connection,
        current_user,
    )
    total_connections = db.execute(q_conn).scalar()

    # Paid this month: UNION of local payments + paypakka payments
    # Complex UNION subquery — use text() bridge
    # NOTE: paypakka data is historical (Dec 2023 → Apr 2026). For months where
    # local payments exist, we skip paypakka to avoid double-counting.
    # Check if local payments exist for this month first.
    # Single grouped scan of this month's local payments — existence (has_local),
    # distinct payers (paid_this_month), and total collected — replacing three
    # separate queries that shared the exact same predicate.
    _local = dict(db.execute(
        text(f"""SELECT COUNT(*) AS rows_cnt,
                        COUNT(DISTINCT customer_id) AS paid_distinct,
                        COALESCE(SUM(amount), 0) AS collected
                 FROM payments
                 WHERE (deleted IS NULL OR deleted = 0)
                   AND collected_at >= :ms AND collected_at <= :ne AND {op_flt}"""),
        {"ms": month_start_str, "ne": now_end},
    ).fetchone()._mapping)
    has_local = (_local["rows_cnt"] or 0) > 0
    local_collected = _local["collected"] or 0

    if has_local:
        # Local payments exist → use local data only (paypakka is historical)
        paid_this_month = _local["paid_distinct"]
    else:
        # No local data (historical month) → fall back to paypakka
        paid_this_month = db.execute(
            text(f"""SELECT COUNT(DISTINCT customer_id) FROM (
                   SELECT customer_id FROM payments WHERE (deleted IS NULL OR deleted = 0) AND collected_at >= :ms AND collected_at <= :ne AND {op_flt}
                   UNION
                   SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= :ms2 AND paypakka_created_at <= :ne2 AND {op_flt}
               )"""),
            {"ms": month_start_str, "ne": now_end, "ms2": month_start_str, "ne2": now_end},
        ).scalar()

    # Paypakka data is historical (Dec 2023 → Apr 2026). Only query paypakka
    # if no local payments exist for this month (purely historical period).
    paypakka_collected = 0
    if not has_local:
        q_pp = apply_op_filter(
            select(func.coalesce(func.sum(PaypakkaPayment.collection_amount), 0)).where(
                and_(
                    PaypakkaPayment.paypakka_created_at >= month_start_str,
                    PaypakkaPayment.paypakka_created_at <= now_end,
                )
            ),
            PaypakkaPayment,
            current_user,
        )
        paypakka_collected = db.execute(q_pp).scalar() or 0

    total_collected = local_collected + paypakka_collected

    # Unpaid = active customers who haven't paid this month
    if has_local:
        unpaid = db.execute(
            text(f"""SELECT COUNT(DISTINCT c.customer_id)
               FROM customers c
               JOIN connections con ON c.customer_id = con.customer_id
               WHERE c.status = 'Active' AND con.status = 'Active' AND {op_flt_c}
                 AND c.customer_id NOT IN (
                   SELECT customer_id FROM payments WHERE (deleted IS NULL OR deleted = 0) AND collected_at >= :ms AND collected_at <= :ne AND {op_flt}
                 )"""),
            {"ms": month_start_str, "ne": now_end},
        ).scalar()
    else:
        unpaid = db.execute(
            text(f"""SELECT COUNT(DISTINCT c.customer_id)
               FROM customers c
               JOIN connections con ON c.customer_id = con.customer_id
               WHERE c.status = 'Active' AND con.status = 'Active' AND {op_flt_c}
                 AND c.customer_id NOT IN (
                   SELECT customer_id FROM payments WHERE (deleted IS NULL OR deleted = 0) AND collected_at >= :ms AND collected_at <= :ne AND {op_flt}
                   UNION
                   SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= :ms2 AND paypakka_created_at <= :ne2 AND {op_flt}
                 )"""),
            {"ms": month_start_str, "ne": now_end, "ms2": month_start_str, "ne2": now_end},
        ).scalar()

    # Payments by area
    if has_local:
        by_area_rows = db.execute(
            text(f"""SELECT COALESCE(c.area, 'Unknown') as area, COUNT(DISTINCT sub.customer_id) as paid_count,
                      SUM(sub.amount) as total_amount
               FROM (
                   SELECT customer_id, amount FROM payments WHERE (deleted IS NULL OR deleted = 0) AND collected_at >= :ms AND collected_at <= :ne AND {op_flt}
               ) sub
               LEFT JOIN customers c ON sub.customer_id = c.customer_id
               GROUP BY COALESCE(c.area, 'Unknown')
               ORDER BY total_amount DESC"""),
            {"ms": month_start_str, "ne": now_end},
        ).fetchall()
    else:
        by_area_rows = db.execute(
            text(f"""SELECT COALESCE(c.area, 'Unknown') as area, COUNT(DISTINCT sub.customer_id) as paid_count,
                      SUM(sub.amount) as total_amount
               FROM (
                   SELECT customer_id, amount FROM payments WHERE (deleted IS NULL OR deleted = 0) AND collected_at >= :ms AND collected_at <= :ne AND {op_flt}
                   UNION ALL
                   SELECT customer_id, collection_amount FROM paypakka_payments
                   WHERE paypakka_created_at >= :ms2 AND paypakka_created_at <= :ne2 AND {op_flt}
               ) sub
               LEFT JOIN customers c ON sub.customer_id = c.customer_id
               GROUP BY COALESCE(c.area, 'Unknown')
               ORDER BY total_amount DESC"""),
            {"ms": month_start_str, "ne": now_end, "ms2": month_start_str, "ne2": now_end},
        ).fetchall()

    by_area = [dict(r._mapping) for r in by_area_rows]

    # Recent payments (last 15 from BOTH local + paypakka)
    recent_local_rows = db.execute(
        text(f"""SELECT p.customer_id, p.amount, p.payment_mode as mode, p.collected_at as date,
                  c.name as customer_name, c.area, u.name as collector_name, 'Local' as source,
                  cn.stb_no
           FROM payments p
           JOIN customers c ON p.customer_id = c.customer_id
           LEFT JOIN users u ON p.collected_by = u.id
           LEFT JOIN connections cn ON cn.id = p.connection_id
           WHERE {op_flt_p}
           ORDER BY p.collected_at DESC LIMIT 15"""),
    ).fetchall()

    recent_pp_rows = db.execute(
        text(f"""SELECT pp.customer_id, pp.collection_amount as amount, pp.payment_type as mode,
                  pp.paypakka_created_at as date, c.name as customer_name, c.area,
                  e.emp_name as collector_name, 'Paypakka' as source,
                  cn.stb_no
           FROM paypakka_payments pp
           JOIN customers c ON pp.customer_id = c.customer_id
           LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
           LEFT JOIN connections cn ON cn.customer_id = pp.customer_id AND cn.status = 'Active'
           WHERE {op_flt_pp}
           ORDER BY pp.paypakka_created_at DESC LIMIT 15"""),
    ).fetchall()

    # Merge and sort, take top 10
    all_recent = [dict(r._mapping) for r in recent_local_rows] + [dict(r._mapping) for r in recent_pp_rows]
    all_recent.sort(key=lambda x: x.get("date") or "", reverse=True)
    recent_payments = all_recent[:10]

    # Expiring soon (next 3 days) — SQLite vs Postgres date arithmetic
    from config import DB_ENGINE
    if DB_ENGINE == "sqlite":
        date_filter = "date(cp.expiry_date) <= date('now', '+3 days')"
    else:
        date_filter = "cp.expiry_date <= (CURRENT_DATE + INTERVAL '3 days')::text"
    expiring_rows = db.execute(
        text(f"""SELECT cp.*, c.name as customer_name, c.phone, c.area, p.name as plan_name
           FROM customer_plans cp
           JOIN customers c ON cp.customer_id = c.customer_id
           JOIN plans p ON cp.plan_id = p.id
           WHERE cp.status = 'Active' AND {date_filter} AND {op_flt_cp}
           ORDER BY cp.expiry_date"""),
    ).fetchall()

    expiring_soon = [dict(r._mapping) for r in expiring_rows]

    # Collection efficiency
    efficiency = round((paid_this_month / total_customers * 100) if total_customers > 0 else 0, 1)

    # ── Agent-specific branch ──────────────────────────────────────────
    if is_agent:
        # Agent-specific: only their own collections
        my_local_row = db.execute(
            text("""SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt
                    FROM payments
                    WHERE collected_by = :uid AND collected_at >= :ms AND collected_at <= :ne"""),
            {"uid": uid, "ms": month_start_str, "ne": now_end},
        ).fetchone()

        my_pp_row = db.execute(
            text("""SELECT COALESCE(SUM(pp.collection_amount), 0) as total, COUNT(*) as cnt
                    FROM paypakka_payments pp
                    JOIN paypakka_employees pe ON pp.emp_ref_id = pe.emp_ref_id
                    WHERE pe.emp_name = (SELECT name FROM users WHERE id = :uid)
                      AND pp.paypakka_created_at >= :ms AND pp.paypakka_created_at <= :ne"""),
            {"uid": uid, "ms": month_start_str, "ne": now_end},
        ).fetchone()

        my_local_map = dict(my_local_row._mapping) if my_local_row else {"total": 0, "cnt": 0}
        my_pp_map = dict(my_pp_row._mapping) if my_pp_row else {"total": 0, "cnt": 0}
        my_collected = (my_local_map.get("total") or 0) + (my_pp_map.get("total") or 0)
        my_count = (my_local_map.get("cnt") or 0) + (my_pp_map.get("cnt") or 0)

        # Agent's recent payments only
        my_recent_local_rows = db.execute(
            text("""SELECT p.customer_id, p.amount, p.payment_mode as mode, p.collected_at as date,
                      c.name as customer_name, c.area, u.name as collector_name, 'Local' as source,
                      cn.stb_no
               FROM payments p
               JOIN customers c ON p.customer_id = c.customer_id
               LEFT JOIN users u ON p.collected_by = u.id
               LEFT JOIN connections cn ON cn.id = p.connection_id
               WHERE p.collected_by = :uid
               ORDER BY p.collected_at DESC LIMIT 10"""),
            {"uid": uid},
        ).fetchall()

        my_recent_pp_rows = db.execute(
            text("""SELECT pp.customer_id, pp.collection_amount as amount, pp.payment_type as mode,
                      pp.paypakka_created_at as date, c.name as customer_name, c.area,
                      e.emp_name as collector_name, 'Paypakka' as source,
                      cn.stb_no
               FROM paypakka_payments pp
               JOIN customers c ON pp.customer_id = c.customer_id
               JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
               LEFT JOIN connections cn ON cn.customer_id = pp.customer_id AND cn.status = 'Active'
               WHERE e.emp_name = (SELECT name FROM users WHERE id = :uid)
               ORDER BY pp.paypakka_created_at DESC LIMIT 10"""),
            {"uid": uid},
        ).fetchall()

        all_my_recent = [dict(r._mapping) for r in my_recent_local_rows] + [dict(r._mapping) for r in my_recent_pp_rows]
        all_my_recent.sort(key=lambda x: x.get("date") or "", reverse=True)

        # SR count for agent
        my_open_sr = 0
        try:
            sr_row = db.execute(
                select(func.count(ServiceRequest.id)).where(
                    and_(
                        ServiceRequest.status.in_(["open", "pending", "assigned", "in_progress"]),
                        ServiceRequest.assigned_to == uid,
                    )
                )
            ).scalar()
            my_open_sr = sr_row or 0
        except Exception:
            pass

        return {
            "month": current_month,
            "is_agent": True,
            "agent_name": current_user.get("name", ""),
            "my_collected": my_collected,
            "my_payments": my_count,
            "recent_payments": all_my_recent[:10],
            "open_sr_count": my_open_sr,
            "my_open_sr_count": my_open_sr,
        }

    # ── Non-agent (admin/operator) result ──────────────────────────────
    result = {
        "month": current_month,
        "total_customers": total_customers,
        "total_connections": total_connections,
        "paid_this_month": paid_this_month,
        "unpaid_this_month": unpaid,
        "total_collected": total_collected,
        "collection_efficiency": efficiency,
        "by_area": by_area,
        "recent_payments": recent_payments,
        "expiring_soon": expiring_soon,
    }

    # Add open SR count
    try:
        q_sr = apply_op_filter(
            select(func.count(ServiceRequest.id)).where(
                ServiceRequest.status.in_(["open", "pending", "assigned", "in_progress"])
            ),
            ServiceRequest,
            current_user,
        )
        result["open_sr_count"] = db.execute(q_sr).scalar() or 0
    except Exception:
        result["open_sr_count"] = 0

    set_cached(_cache_key, result)
    return result


@router.get("/payment-modes")
def payment_mode_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Get payment mode breakdown for current month from both tables."""
    _oid = op_id(current_user)
    _cache_key = f"payment_modes:{_oid}"  # per-operator to prevent cross-tenant bleed
    cached = get_cached(_cache_key, ttl=60)
    if cached:
        return cached

    op_flt = "1=1"
    if _oid is not None:
        op_flt = f"operator_id = {_oid}"

    now = datetime.now()
    current_month = get_current_month()
    month_start, month_end = get_month_range(now)

    # Local payments by mode (date range for consistency)
    local_rows = db.execute(
        text(f"""SELECT COALESCE(payment_mode, 'Other') as mode, COUNT(*) as cnt, SUM(amount) as total
               FROM payments
               WHERE collected_at >= :ms AND collected_at <= :me AND {op_flt}
               GROUP BY payment_mode"""),
        {"ms": month_start, "me": month_end},
    ).fetchall()

    # Paypakka payments by type
    pp_rows = db.execute(
        text(f"""SELECT COALESCE(payment_type, 'Other') as mode, COUNT(*) as cnt, SUM(collection_amount) as total
               FROM paypakka_payments
               WHERE paypakka_created_at >= :ms AND paypakka_created_at <= :me AND {op_flt}
               GROUP BY payment_type"""),
        {"ms": month_start, "me": month_end},
    ).fetchall()

    # Merge both
    modes: dict = {}
    for r in local_rows:
        d = dict(r._mapping)
        m = d["mode"] or "Other"
        modes[m] = {"count": d["cnt"], "total": d["total"] or 0}
    for r in pp_rows:
        d = dict(r._mapping)
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
    set_cached(_cache_key, result)
    return result


@router.get("/today")
def dashboard_today(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Today's collection snapshot + comparison data for actionable dashboard."""
    is_agent = is_agent_role(current_user)
    uid = current_user.get("id")
    _oid = op_id(current_user)
    _cache_key = f"dashboard_today:{'a'+str(uid) if is_agent else 'o'+str(_oid)}"
    cached = get_cached(_cache_key, ttl=20)
    if cached:
        return cached

    now = datetime.now()
    today_start = now.strftime("%Y-%m-%d 00:00:00")
    today_end = now.strftime("%Y-%m-%d 23:59:59")
    yesterday_start = (now - timedelta(days=1)).strftime("%Y-%m-%d 00:00:00")
    yesterday_end = (now - timedelta(days=1)).strftime("%Y-%m-%d 23:59:59")

    # Last month range
    if now.month == 1:
        lm_year = now.year - 1
        lm_month = 12
    else:
        lm_year = now.year
        lm_month = now.month - 1
    last_month_start = f"{lm_year}-{lm_month:02d}-01"
    last_month_end = f"{lm_year}-{lm_month:02d}-{(now.replace(month=lm_month, year=lm_year).date().replace(day=28)).day} 23:59:59"
    month_start = now.strftime("%Y-%m-01")

    if is_agent:
        # Agent: personal stats only (filter by collected_by)
        agent_flt = "collected_by = :uid"

        today_row = db.execute(
            text(f"""SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt
                     FROM payments
                     WHERE (deleted IS NULL OR deleted = 0)
                       AND collected_at >= :ts AND collected_at <= :te AND {agent_flt}"""),
            {"ts": today_start, "te": today_end, "uid": uid},
        ).fetchone()
        today_collected = today_row.total or 0 if today_row else 0
        today_count = today_row.cnt or 0 if today_row else 0

        yest_row = db.execute(
            text(f"""SELECT COALESCE(SUM(amount), 0) as total
                     FROM payments
                     WHERE (deleted IS NULL OR deleted = 0)
                       AND collected_at >= :ys AND collected_at <= :ye AND {agent_flt}"""),
            {"ys": yesterday_start, "ye": yesterday_end, "uid": uid},
        ).fetchone()
        yesterday_collected = yest_row.total or 0 if yest_row else 0

        lm_row = db.execute(
            text(f"""SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT customer_id) as paid
                     FROM payments
                     WHERE (deleted IS NULL OR deleted = 0)
                       AND collected_at >= :lms AND collected_at <= :lme AND {agent_flt}"""),
            {"lms": last_month_start, "lme": last_month_end, "uid": uid},
        ).fetchone()
        last_month_collected = lm_row.total or 0 if lm_row else 0
        last_month_paid = lm_row.paid or 0 if lm_row else 0

        result = {
            "is_agent": True,
            "today_collected": today_collected,
            "today_count": today_count,
            "yesterday_collected": yesterday_collected,
            "last_month_collected": last_month_collected,
            "last_month_paid": last_month_paid,
            "new_customers_this_month": 0,
            "temp_disconnected": 0,
            "surrendered_this_month": 0,
        }
        set_cached(_cache_key, result)
        return result

    # Non-agent path
    op_flt = "1=1"
    if _oid is not None:
        op_flt = f"operator_id = {_oid}"

    # Today's local collection
    today_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt
                 FROM payments
                 WHERE (deleted IS NULL OR deleted = 0)
                   AND collected_at >= :ts AND collected_at <= :te AND {op_flt}"""),
        {"ts": today_start, "te": today_end},
    ).fetchone()
    today_collected = today_row.total or 0 if today_row else 0
    today_count = today_row.cnt or 0 if today_row else 0

    # Yesterday's collection
    yest_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt
                 FROM payments
                 WHERE (deleted IS NULL OR deleted = 0)
                   AND collected_at >= :ys AND collected_at <= :ye AND {op_flt}"""),
        {"ys": yesterday_start, "ye": yesterday_end},
    ).fetchone()
    yesterday_collected = yest_row.total or 0 if yest_row else 0

    # Last month total
    lm_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT customer_id) as paid
                 FROM payments
                 WHERE (deleted IS NULL OR deleted = 0)
                   AND collected_at >= :lms AND collected_at <= :lme AND {op_flt}"""),
        {"lms": last_month_start, "lme": last_month_end},
    ).fetchone()
    last_month_collected = lm_row.total or 0 if lm_row else 0
    last_month_paid = lm_row.paid or 0 if lm_row else 0

    # New customers this month
    new_customers = db.execute(
        text(f"""SELECT COUNT(*) FROM customers WHERE created_at >= :ms AND {op_flt}"""),
        {"ms": month_start},
    ).scalar() or 0

    # Temp disconnected count
    temp_disc = db.execute(
        text(f"""SELECT COUNT(*) FROM connections WHERE status = 'TempDisconnected' AND {op_flt}"""),
    ).scalar() or 0

    # Surrendered this month
    surrendered = db.execute(
        text(f"""SELECT COUNT(*) FROM customers WHERE status = 'Surrendered' AND updated_at >= :ms AND {op_flt}"""),
        {"ms": month_start},
    ).scalar() or 0

    result = {
        "today_collected": today_collected,
        "today_count": today_count,
        "yesterday_collected": yesterday_collected,
        "last_month_collected": last_month_collected,
        "last_month_paid": last_month_paid,
        "new_customers_this_month": new_customers,
        "temp_disconnected": temp_disc,
        "surrendered_this_month": surrendered,
    }
    set_cached(_cache_key, result)
    return result


@router.get("/insights")
def dashboard_insights(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Actionable dashboard insights: MSO profitability, top unpaid, MRR trend,
    aging buckets, STB health, collection target."""
    _oid = op_id(current_user)
    _cache_key = f"dashboard_insights:{_oid}"
    cached = get_cached(_cache_key, ttl=30)
    if cached:
        return cached

    now = datetime.now()
    current_month = get_current_month()
    month_start, _ = get_month_range(now)
    now_end = now.strftime("%Y-%m-%d 23:59:59")
    today_start = now.strftime("%Y-%m-%d 00:00:00")
    today_end = now.strftime("%Y-%m-%d 23:59:59")

    op_flt = "1=1"
    if _oid is not None:
        op_flt = f"operator_id = {_oid}"

    # ── 1. MSO PROFITABILITY ────────────────────────────────────────────
    # Active connections per MSO with revenue (sum plan_amount) and cost
    mso_rows = db.execute(
        text(f"""SELECT COALESCE(conn.mso, 'Unknown') as mso,
                  COUNT(*) as active_boxes,
                  COALESCE(SUM(conn.plan_amount), 0) as monthly_revenue,
                  AVG(conn.plan_amount) as arpu
           FROM connections conn
           WHERE conn.status = 'Active' AND {op_flt.replace('operator_id', 'conn.operator_id')}
           GROUP BY COALESCE(conn.mso, 'Unknown')
           ORDER BY monthly_revenue DESC"""),
    ).fetchall()

    # Get avg mso_cost per MSO from plans table
    mso_cost_rows = db.execute(
        text(f"""SELECT network, AVG(mso_cost) as avg_cost
           FROM plans WHERE status = 'Active' AND {op_flt}
           GROUP BY network"""),
    ).fetchall()
    mso_cost_map = {r.network: (r.avg_cost or 0) for r in mso_cost_rows}

    mso_profitability = []
    for r in mso_rows:
        mso_name = r.mso
        boxes = r.active_boxes or 0
        revenue = float(r.monthly_revenue or 0)
        arpu = float(r.arpu or 0)
        # Match cost by MSO name variations
        cost_per_box = mso_cost_map.get(mso_name, 0)
        if cost_per_box == 0:
            # Try matching network field for GTPL/TACTV/SCV
            for k, v in mso_cost_map.items():
                if k and mso_name and k.lower() in mso_name.lower():
                    cost_per_box = v
                    break
        total_cost = cost_per_box * boxes
        profit = revenue - total_cost
        margin = round((profit / revenue * 100) if revenue > 0 else 0, 1)
        mso_profitability.append({
            "mso": mso_name,
            "active_boxes": boxes,
            "monthly_revenue": round(revenue, 0),
            "arpu": round(arpu, 0),
            "cost_per_box": round(cost_per_box, 0),
            "total_cost": round(total_cost, 0),
            "profit": round(profit, 0),
            "margin_pct": margin,
        })

    # ── 2. TOP UNPAID CUSTOMERS (same logic as /customers/unpaid) ──────
    # Active connections where: expiry < today OR not paid this month
    # Also checks paypakka_payments (not just payments)
    ref_str = now.strftime("%Y-%m-%d")
    top_unpaid_rows = db.execute(
        text(f"""SELECT c.customer_id, c.name, c.phone, c.area,
                  conn.stb_no, conn.mso, conn.plan_name, conn.plan_amount,
                  conn.expiry_date, conn.id as conn_id
           FROM customers c
           JOIN connections conn ON c.customer_id = conn.customer_id
           WHERE conn.status = 'Active'
             AND {op_flt.replace('operator_id', 'conn.operator_id')}
             AND (
               (conn.expiry_date IS NOT NULL AND conn.expiry_date != '' AND conn.expiry_date < :rs)
               OR conn.customer_id NOT IN (
                 SELECT customer_id FROM payments
                 WHERE (deleted IS NULL OR deleted = 0)
                   AND collected_at >= :ms AND collected_at <= :ne
                 UNION
                 SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= :ms AND paypakka_created_at <= :ne
               )
             )
           ORDER BY conn.expiry_date ASC NULLS LAST, conn.plan_amount DESC
           LIMIT 20"""),
        {"rs": ref_str, "ms": month_start, "ne": now_end},
    ).fetchall()

    # Calculate gap_months and pending for each
    top_unpaid = []
    for r in top_unpaid_rows:
        gap = 0
        if r.expiry_date:
            try:
                exp_parts = str(r.expiry_date)[:10].split("-")
                exp_dt = datetime(int(exp_parts[0]), int(exp_parts[1]), int(exp_parts[2]))
                gap = (now.year - exp_dt.year) * 12 + (now.month - exp_dt.month)
                if gap < 0:
                    gap = 0
            except Exception:
                gap = 0
        pa = float(r.plan_amount or 0)
        top_unpaid.append({
            "customer_id": r.customer_id,
            "name": r.name,
            "phone": r.phone or "",
            "area": r.area or "",
            "stb_no": r.stb_no,
            "mso": r.mso,
            "plan_amount": pa,
            "gap_months": gap,
            "pending_amount": round(pa * (gap + 1), 0) if pa else 0,
        })

    # Total unpaid count (same WHERE clause)
    total_unpaid_count = db.execute(
        text(f"""SELECT COUNT(DISTINCT conn.customer_id)
           FROM connections conn
           WHERE conn.status = 'Active'
             AND {op_flt.replace('operator_id', 'conn.operator_id')}
             AND (
               (conn.expiry_date IS NOT NULL AND conn.expiry_date != '' AND conn.expiry_date < :rs)
               OR conn.customer_id NOT IN (
                 SELECT customer_id FROM payments
                 WHERE (deleted IS NULL OR deleted = 0)
                   AND collected_at >= :ms AND collected_at <= :ne
                 UNION
                 SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= :ms AND paypakka_created_at <= :ne
               )
             )"""),
        {"rs": ref_str, "ms": month_start, "ne": now_end},
    ).scalar() or 0

    # Total pending = query all unpaid connections, compute in Python
    all_unpaid_rows = db.execute(
        text(f"""SELECT conn.plan_amount, conn.expiry_date
           FROM connections conn
           WHERE conn.status = 'Active'
             AND {op_flt.replace('operator_id', 'conn.operator_id')}
             AND (
               (conn.expiry_date IS NOT NULL AND conn.expiry_date != '' AND conn.expiry_date < :rs)
               OR conn.customer_id NOT IN (
                 SELECT customer_id FROM payments
                 WHERE (deleted IS NULL OR deleted = 0)
                   AND collected_at >= :ms AND collected_at <= :ne
                 UNION
                 SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= :ms AND paypakka_created_at <= :ne
               )
             )"""),
        {"rs": ref_str, "ms": month_start, "ne": now_end},
    ).fetchall()
    total_pending = 0.0
    for r in all_unpaid_rows:
        gap = 0
        if r.expiry_date:
            try:
                exp_parts = str(r.expiry_date)[:10].split("-")
                exp_dt = datetime(int(exp_parts[0]), int(exp_parts[1]), int(exp_parts[2]))
                gap = (now.year - exp_dt.year) * 12 + (now.month - exp_dt.month)
                if gap < 0:
                    gap = 0
            except Exception:
                gap = 0
        pa = float(r.plan_amount or 0)
        if pa:
            total_pending += pa * (gap + 1)
    total_pending = round(total_pending, 0)

    # ── 3. AGING BUCKETS (computed in Python from all_unpaid_rows) ──────
    aging = {"current": 0, "current_amt": 0, "bucket_1_2": 0, "bucket_1_2_amt": 0,
             "bucket_3_5": 0, "bucket_3_5_amt": 0, "bucket_6plus": 0, "bucket_6plus_amt": 0}
    for r in all_unpaid_rows:
        gap = 0
        if r.expiry_date:
            try:
                exp_parts = str(r.expiry_date)[:10].split("-")
                exp_dt = datetime(int(exp_parts[0]), int(exp_parts[1]), int(exp_parts[2]))
                gap = (now.year - exp_dt.year) * 12 + (now.month - exp_dt.month)
                if gap < 0:
                    gap = 0
            except Exception:
                gap = 0
        pa = float(r.plan_amount or 0)
        if gap == 0:
            aging["current"] += 1
            aging["current_amt"] += pa
        elif gap <= 2:
            aging["bucket_1_2"] += 1
            aging["bucket_1_2_amt"] += pa
        elif gap <= 5:
            aging["bucket_3_5"] += 1
            aging["bucket_3_5_amt"] += pa
        else:
            aging["bucket_6plus"] += 1
            aging["bucket_6plus_amt"] += pa

    # ── 3. MRR TREND (last 6 months) ────────────────────────────────────
    six_months_ago = (now - timedelta(days=180)).strftime("%Y-%m-01")
    trend_rows = db.execute(
        text(f"""SELECT month, SUM(total) as total FROM (
            SELECT TO_CHAR(collected_at::timestamp, 'YYYY-MM') as month, SUM(amount) as total
            FROM payments
            WHERE (deleted IS NULL OR deleted = 0) AND collected_at >= :sma AND {op_flt}
            GROUP BY TO_CHAR(collected_at::timestamp, 'YYYY-MM')
        ) GROUP BY month ORDER BY month DESC LIMIT 6"""),
        {"sma": six_months_ago},
    ).fetchall()
    mrr_trend = [dict(r._mapping) for r in reversed(trend_rows)]

    aging_data = aging  # Already computed above

    # ── 5. STB INVENTORY HEALTH ─────────────────────────────────────────
    try:
        stb_rows = db.execute(
            text(f"""SELECT COALESCE(status, 'unknown') as status, COUNT(*) as cnt
               FROM stb_inventory WHERE {op_flt}
               GROUP BY status ORDER BY cnt DESC"""),
        ).fetchall()
        stb_health = {r.status: r.cnt for r in stb_rows}
    except Exception:
        stb_health = {}

    # ── 6. COLLECTION TARGET ────────────────────────────────────────────
    # Target = total expected monthly revenue from active connections
    target_row = db.execute(
        text(f"""SELECT COALESCE(SUM(plan_amount), 0) as target
           FROM connections WHERE status = 'Active' AND {op_flt}"""),
    ).fetchone()
    month_target = float(target_row.target or 0) if target_row else 0

    # Today's collection
    today_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt
           FROM payments WHERE (deleted IS NULL OR deleted = 0)
             AND collected_at >= :ts AND collected_at <= :te AND {op_flt}"""),
        {"ts": today_start, "te": today_end},
    ).fetchone()
    today_collected = float(today_row.total or 0) if today_row else 0
    today_count = today_row.cnt or 0 if today_row else 0

    # Month collected so far
    month_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT customer_id) as paid
           FROM payments WHERE (deleted IS NULL OR deleted = 0)
             AND collected_at >= :ms AND collected_at <= :ne AND {op_flt}"""),
        {"ms": month_start, "ne": now_end},
    ).fetchone()
    month_collected = float(month_row.total or 0) if month_row else 0
    month_paid = month_row.paid or 0 if month_row else 0

    collection_pct = round((month_collected / month_target * 100) if month_target > 0 else 0, 1)

    result = {
        "month": current_month,
        # Collection
        "month_target": round(month_target, 0),
        "month_collected": round(month_collected, 0),
        "collection_pct": collection_pct,
        "today_collected": round(today_collected, 0),
        "today_count": today_count,
        "total_unpaid_count": total_unpaid_count,
        "total_pending": round(total_pending, 0),
        # MSO
        "mso_profitability": mso_profitability,
        # Unpaid
        "top_unpaid": top_unpaid,
        # Trend
        "mrr_trend": mrr_trend,
        # Aging
        "aging": {
            "current": aging.get("current", 0),
            "current_amt": float(aging.get("current_amt", 0)),
            "b1_2": aging.get("bucket_1_2", 0),
            "b1_2_amt": float(aging.get("bucket_1_2_amt", 0)),
            "b3_5": aging.get("bucket_3_5", 0),
            "b3_5_amt": float(aging.get("bucket_3_5_amt", 0)),
            "b6plus": aging.get("bucket_6plus", 0),
            "b6plus_amt": float(aging.get("bucket_6plus_amt", 0)),
        },
        # STB
        "stb_health": stb_health,
    }
    set_cached(_cache_key, result)
    return result


@router.get("/master")
def master_dashboard(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Master admin dashboard — operators overview."""
    if current_user.get("role") != "master":
        raise HTTPException(403, "Master admin only")

    now = datetime.now()
    current_month = get_current_month()
    month_start = now.strftime("%Y-%m-01")
    now_end = now.strftime("%Y-%m-%d 23:59:59")

    # All active operators with their stats
    # Complex correlated subqueries with UNION — use text() bridge
    operators = db.execute(
        text("""SELECT o.id, o.business_name, o.owner_name, o.phone, o.area, o.mso,
                  o.customer_prefix, o.status, o.created_at,
                  (SELECT COUNT(*) FROM customers WHERE operator_id = o.id) as customer_count,
                  (SELECT COUNT(*) FROM connections WHERE operator_id = o.id AND status = 'Active') as connection_count,
                  (SELECT COUNT(DISTINCT customer_id) FROM (
                      SELECT customer_id FROM payments WHERE (deleted IS NULL OR deleted = 0) AND operator_id = o.id AND collected_at >= :ms1 AND collected_at <= :ne1
                      UNION
                      SELECT customer_id FROM paypakka_payments WHERE operator_id = o.id AND paypakka_created_at >= :ms2 AND paypakka_created_at <= :ne2
                  )) as paid_local,
                  (SELECT COALESCE(SUM(total), 0) FROM (
                      SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE (deleted IS NULL OR deleted = 0) AND operator_id = o.id AND collected_at >= :ms3 AND collected_at <= :ne3
                      UNION ALL
                      SELECT COALESCE(SUM(collection_amount), 0) as total FROM paypakka_payments WHERE operator_id = o.id AND paypakka_created_at >= :ms4 AND paypakka_created_at <= :ne4
                  )) as collected_local
           FROM operators o
           ORDER BY o.status = 'active' DESC, o.business_name"""),
        {
            "ms1": month_start, "ne1": now_end,
            "ms2": month_start, "ne2": now_end,
            "ms3": month_start, "ne3": now_end,
            "ms4": month_start, "ne4": now_end,
        },
    ).fetchall()

    ops_list = [dict(r._mapping) for r in operators]

    # Total stats across all operators
    total_operators = len([o for o in ops_list if o.get("status") == "active"])
    total_customers = sum(o.get("customer_count", 0) or 0 for o in ops_list)
    total_connections = sum(o.get("connection_count", 0) or 0 for o in ops_list)
    total_collected = sum(o.get("collected_local", 0) or 0 for o in ops_list)
    total_paid = sum(o.get("paid_local", 0) or 0 for o in ops_list)

    # Monthly revenue trend (last 6 months, from both local + paypakka)
    six_months_ago = (now - timedelta(days=180)).strftime("%Y-%m-01")
    trend_rows = db.execute(
        text("""SELECT month, SUM(total) as total FROM (
            SELECT TO_CHAR(collected_at::timestamp, 'MM-YYYY') as month, SUM(amount) as total
            FROM payments
            WHERE collected_at >= :sma
            GROUP BY TO_CHAR(collected_at::timestamp, 'MM-YYYY')
            UNION ALL
            SELECT TO_CHAR(paypakka_created_at::timestamp, 'MM-YYYY') as month, SUM(collection_amount) as total
            FROM paypakka_payments
            WHERE paypakka_created_at >= :sma2
            GROUP BY TO_CHAR(paypakka_created_at::timestamp, 'MM-YYYY')
        )
        GROUP BY month ORDER BY month DESC LIMIT 6"""),
        {"sma": six_months_ago, "sma2": six_months_ago},
    ).fetchall()

    return {
        "total_operators": total_operators,
        "total_customers": total_customers,
        "total_connections": total_connections,
        "total_collected": total_collected,
        "total_paid": total_paid,
        "collection_efficiency": round((total_paid / total_customers * 100) if total_customers > 0 else 0, 1),
        "operators": ops_list,
        "revenue_trend": [dict(r._mapping) for r in trend_rows],
        "month": current_month,
    }


# ═══════════════════════════════════════════════════════════════════════════
# PRIORITY UNPAID — "Follow Up Today"
# Customers who paid LAST month but haven't paid THIS month.
# These are the highest-conversion targets for a reminder call/WhatsApp.
# ═══════════════════════════════════════════════════════════════════════════
@router.get("/priority-unpaid")
def priority_unpaid(
    page: int = 1,
    per_page: int = 50,
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Customers who paid last month but haven't paid this month.
    Works for admin/master/support (all customers) and agents (their own customers)."""
    _agent = is_agent_role(current_user)
    _uid = current_user.get("id")
    _oid = op_id(current_user)
    _cache_key = f"priority_unpaid:{'a'+str(_uid) if _agent else 'o'+str(_oid)}:{page}"
    cached = get_cached(_cache_key, ttl=30)
    if cached:
        return cached

    now = datetime.now()

    # Calendar month boundaries
    this_month_start = now.strftime("%Y-%m-01")
    this_month_end = now.strftime("%Y-%m-%d 23:59:59")

    if now.month == 1:
        lm_year, lm_month = now.year - 1, 12
    else:
        lm_year, lm_month = now.year, now.month - 1
    last_month_start = f"{lm_year}-{lm_month:02d}-01"
    # Last day of previous month
    if lm_month == 12:
        lm_last_day = 31
    else:
        lm_last_day = (now.replace(year=lm_year, month=lm_month + 1, day=1) - timedelta(days=1)).day
    last_month_end = f"{lm_year}-{lm_month:02d}-{lm_last_day} 23:59:59"

    # Build the "who paid last month" CTE — UNION payments + paypakka_payments
    # All roles (admin, agent, support) see the FULL priority list — no per-agent filtering.
    # Agents need the complete follow-up list to call/WhatsApp all priority customers.
    op_filter = ""
    if _oid is not None:
        op_filter = f"AND conn.operator_id = {_oid}"
    paid_last_month = f"""
        SELECT DISTINCT customer_id FROM payments
        WHERE (deleted IS NULL OR deleted = 0)
          AND collected_at >= '{last_month_start}' AND collected_at <= '{last_month_end}'
        UNION
        SELECT DISTINCT customer_id FROM paypakka_payments
        WHERE paypakka_created_at >= '{last_month_start}' AND paypakka_created_at <= '{last_month_end}'
    """
    paid_this_month_collector = ""

    offset = (page - 1) * per_page

    # Count total
    count_sql = f"""
        WITH paid_last AS ({paid_last_month}),
        paid_this AS (
            SELECT DISTINCT customer_id FROM payments
            WHERE (deleted IS NULL OR deleted = 0)
              AND collected_at >= '{this_month_start}' AND collected_at <= '{this_month_end}'
              {paid_this_month_collector}
            UNION
            SELECT DISTINCT customer_id FROM paypakka_payments
            WHERE paypakka_created_at >= '{this_month_start}' AND paypakka_created_at <= '{this_month_end}'
        )
        SELECT COUNT(DISTINCT conn.customer_id)
        FROM connections conn
        JOIN customers c ON c.customer_id = conn.customer_id
        WHERE conn.status = 'Active'
          {op_filter}
          AND conn.customer_id IN (SELECT customer_id FROM paid_last)
          AND conn.customer_id NOT IN (SELECT customer_id FROM paid_this)
    """
    total = db.execute(text(count_sql)).scalar() or 0

    # Fetch list
    list_sql = f"""
        WITH paid_last AS ({paid_last_month}),
        paid_this AS (
            SELECT DISTINCT customer_id FROM payments
            WHERE (deleted IS NULL OR deleted = 0)
              AND collected_at >= '{this_month_start}' AND collected_at <= '{this_month_end}'
              {paid_this_month_collector}
            UNION
            SELECT DISTINCT customer_id FROM paypakka_payments
            WHERE paypakka_created_at >= '{this_month_start}' AND paypakka_created_at <= '{this_month_end}'
        )
        SELECT c.customer_id, c.name, c.phone, c.area,
               conn.stb_no, conn.mso, conn.plan_name, conn.plan_amount,
               conn.expiry_date
        FROM connections conn
        JOIN customers c ON c.customer_id = conn.customer_id
        WHERE conn.status = 'Active'
          {op_filter}
          AND conn.customer_id IN (SELECT customer_id FROM paid_last)
          AND conn.customer_id NOT IN (SELECT customer_id FROM paid_this)
        ORDER BY conn.plan_amount DESC NULLS LAST, c.name
        LIMIT {per_page} OFFSET {offset}
    """
    rows = db.execute(text(list_sql)).fetchall()

    customers = []
    for r in rows:
        gap = 0
        if r.expiry_date:
            try:
                exp_parts = str(r.expiry_date)[:10].split("-")
                exp_dt = datetime(int(exp_parts[0]), int(exp_parts[1]), int(exp_parts[2]))
                gap = (now.year - exp_dt.year) * 12 + (now.month - exp_dt.month)
                if gap < 0:
                    gap = 0
            except Exception:
                gap = 0
        pa = float(r.plan_amount or 0)
        customers.append({
            "customer_id": r.customer_id,
            "name": r.name,
            "phone": r.phone or "",
            "area": r.area or "",
            "stb_no": r.stb_no or "",
            "mso": r.mso or "",
            "plan_name": r.plan_name or "",
            "plan_amount": pa,
            "gap_months": 0,
            # Priority customers paid last month — they owe only THIS month's plan.
            # Do NOT use expiry_date gap (stale/inaccurate); 1 month only.
            "pending_amount": round(pa, 0) if pa else 0,
        })

    total_pending = sum(c["pending_amount"] for c in customers)

    result = {
        "customers": customers,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pending": round(total_pending, 0),
        "last_month": f"{lm_month:02d}-{lm_year}",
        "this_month": f"{now.month:02d}-{now.year}",
    }
    set_cached(_cache_key, result)
    return result


# ════════════════════════════════════════════════════════════════════════════
# Agent Personal Dashboard — /api/dashboard/agent-insights
# ════════════════════════════════════════════════════════════════════════════
@router.get("/agent-insights")
def agent_insights(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Personal dashboard for collection agents — today/week/month stats,
    recent payments, priority follow-ups, area breakdown, collection streak."""
    if not is_agent_role(current_user):
        raise HTTPException(403, "Agent access only")

    uid = current_user.get("id")
    _cache_key = f"agent_insights:{uid}"
    cached = get_cached(_cache_key, ttl=20)
    if cached:
        return cached

    now = datetime.now()
    current_month = now.strftime("%Y-%m")

    # ── Date ranges ─────────────────────────────────────────────────────
    today_start = now.strftime("%Y-%m-%d 00:00:00")
    today_end = now.strftime("%Y-%m-%d 23:59:59")
    yesterday_start = (now - timedelta(days=1)).strftime("%Y-%m-%d 00:00:00")
    yesterday_end = (now - timedelta(days=1)).strftime("%Y-%m-%d 23:59:59")
    week_start = (now - timedelta(days=6)).strftime("%Y-%m-%d 00:00:00")
    month_start = now.strftime("%Y-%m-01")
    now_end = now.strftime("%Y-%m-%d 23:59:59")

    # Last month range
    if now.month == 1:
        lm_year, lm_month = now.year - 1, 12
    else:
        lm_year, lm_month = now.year, now.month - 1
    last_month_start = f"{lm_year}-{lm_month:02d}-01"
    if lm_month == 12:
        lm_last_day = 31
    else:
        lm_last_day = (now.replace(year=lm_year, month=lm_month + 1, day=1) - timedelta(days=1)).day
    last_month_end = f"{lm_year}-{lm_month:02d}-{lm_last_day} 23:59:59"

    agent_name = current_user.get("name", "")

    # ── Today / Week / Month collection ─────────────────────────────────
    _common = "collected_by = :uid AND (deleted IS NULL OR deleted = 0)"
    today_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
                 FROM payments
                 WHERE {_common} AND collected_at >= :ts AND collected_at <= :te"""),
        {"uid": uid, "ts": today_start, "te": today_end},
    ).fetchone()
    today_collected = today_row.total or 0 if today_row else 0
    today_count = today_row.cnt or 0 if today_row else 0

    week_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
                 FROM payments
                 WHERE {_common} AND collected_at >= :ws AND collected_at <= :te"""),
        {"uid": uid, "ws": week_start, "te": today_end},
    ).fetchone()
    week_collected = week_row.total or 0 if week_row else 0
    week_count = week_row.cnt or 0 if week_row else 0

    month_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
                 FROM payments
                 WHERE {_common} AND collected_at >= :ms AND collected_at <= :ne"""),
        {"uid": uid, "ms": month_start, "ne": now_end},
    ).fetchone()
    month_collected = month_row.total or 0 if month_row else 0
    month_count = month_row.cnt or 0 if month_row else 0

    # ── Yesterday & last month for comparison ───────────────────────────
    yesterday_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) AS total
                 FROM payments
                 WHERE {_common} AND collected_at >= :ys AND collected_at <= :ye"""),
        {"uid": uid, "ys": yesterday_start, "ye": yesterday_end},
    ).fetchone()
    yesterday_collected = yesterday_row.total or 0 if yesterday_row else 0

    last_month_row = db.execute(
        text(f"""SELECT COALESCE(SUM(amount), 0) AS total
                 FROM payments
                 WHERE {_common} AND collected_at >= :lms AND collected_at <= :lme"""),
        {"uid": uid, "lms": last_month_start, "lme": last_month_end},
    ).fetchone()
    last_month_collected = last_month_row.total or 0 if last_month_row else 0

    # ── Month target & percentage ───────────────────────────────────────
    # Default target derived from last month's collection (rounded up to nearest 5k);
    # fallback 50000 if no history.
    month_target = 50000
    if last_month_collected > 0:
        month_target = int(((last_month_collected + 4999) // 5000) * 5000)
    month_pct = round((month_collected / month_target * 100), 1) if month_target else 0.0

    # ── Recent payments (last 10) — same pattern as /stats agent section ──
    recent_rows = db.execute(
        text("""SELECT p.customer_id, p.amount, p.payment_mode AS mode, p.collected_at AS date,
                       c.name AS customer_name, c.area, u.name AS collector_name, 'Local' AS source,
                       cn.stb_no
                FROM payments p
                JOIN customers c ON p.customer_id = c.customer_id
                LEFT JOIN users u ON p.collected_by = u.id
                LEFT JOIN connections cn ON cn.id = p.connection_id
                WHERE p.collected_by = :uid AND (p.deleted IS NULL OR p.deleted = 0)
                ORDER BY p.collected_at DESC LIMIT 10"""),
        {"uid": uid},
    ).fetchall()
    recent_payments = [dict(r._mapping) for r in recent_rows]

    # ── Priority count: customers who paid last month but not this month ──
    # Same CTE pattern as /priority-unpaid endpoint.
    priority_count = db.execute(
        text(f"""
            WITH paid_last AS (
                SELECT DISTINCT customer_id FROM payments
                WHERE (deleted IS NULL OR deleted = 0)
                  AND collected_at >= :lms AND collected_at <= :lme
            ),
            paid_this AS (
                SELECT DISTINCT customer_id FROM payments
                WHERE (deleted IS NULL OR deleted = 0)
                  AND collected_at >= :ms AND collected_at <= :ne
            )
            SELECT COUNT(DISTINCT conn.customer_id)
            FROM connections conn
            JOIN customers c ON c.customer_id = conn.customer_id
            WHERE conn.status = 'Active'
              AND conn.customer_id IN (SELECT customer_id FROM paid_last)
              AND conn.customer_id NOT IN (SELECT customer_id FROM paid_this)
              AND c.area IN (
                  SELECT DISTINCT c2.area FROM payments p2
                  JOIN customers c2 ON p2.customer_id = c2.customer_id
                  WHERE p2.collected_by = :uid
              )
        """),
        {"uid": uid, "lms": last_month_start, "lme": last_month_end,
         "ms": month_start, "ne": now_end},
    ).scalar() or 0

    # ── Open service requests assigned to agent ─────────────────────────
    my_open_sr = 0
    try:
        my_open_sr = db.execute(
            select(func.count(ServiceRequest.id)).where(
                and_(
                    ServiceRequest.status.in_(["open", "pending", "assigned", "in_progress"]),
                    ServiceRequest.assigned_to == uid,
                )
            )
        ).scalar() or 0
    except Exception:
        pass

    # ── My areas: unpaid customers in areas the agent covers ─────────────
    area_rows = db.execute(
        text("""
            SELECT COALESCE(c.area, 'Unknown') AS area,
                   COUNT(DISTINCT conn.customer_id) AS unpaid,
                   COALESCE(SUM(conn.plan_amount), 0) AS pending
            FROM connections conn
            JOIN customers c ON conn.customer_id = c.customer_id
            WHERE conn.status = 'Active'
              AND c.area IN (
                  SELECT DISTINCT c2.area FROM payments p2
                  JOIN customers c2 ON p2.customer_id = c2.customer_id
                  WHERE p2.collected_by = :uid
              )
              AND conn.customer_id NOT IN (
                  SELECT customer_id FROM payments
                  WHERE (deleted IS NULL OR deleted = 0)
                    AND collected_at >= :ms AND collected_at <= :ne
              )
            GROUP BY COALESCE(c.area, 'Unknown')
            ORDER BY unpaid DESC
            LIMIT 10
        """),
        {"uid": uid, "ms": month_start, "ne": now_end},
    ).fetchall()
    my_areas = [
        {"area": r.area, "unpaid": r.unpaid, "pending": r.pending or 0}
        for r in area_rows
    ]

    # ── Collection streak: consecutive days with ≥1 payment ──────────────
    week_ago = (now - timedelta(days=7)).strftime("%Y-%m-%d 00:00:00")
    streak_rows = db.execute(
        text("""SELECT DATE(collected_at) AS d
                FROM payments
                WHERE collected_by = :uid
                  AND (deleted IS NULL OR deleted = 0)
                  AND collected_at >= :wa
                GROUP BY d
                ORDER BY d DESC"""),
        {"uid": uid, "wa": week_ago},
    ).fetchall()
    streak_dates = {r.d for r in streak_rows}
    collection_streak = 0
    cursor = now.date()
    for _ in range(8):
        if cursor in streak_dates:
            collection_streak += 1
            cursor -= timedelta(days=1)
        else:
            # Allow a gap if today has no payments yet (streak counts from yesterday)
            if collection_streak == 0 and cursor == now.date():
                cursor -= timedelta(days=1)
                continue
            break

    result = {
        "month": current_month,
        "agent_name": agent_name,
        "today_collected": today_collected,
        "today_count": today_count,
        "week_collected": week_collected,
        "week_count": week_count,
        "month_collected": month_collected,
        "month_count": month_count,
        "month_target": month_target,
        "month_pct": month_pct,
        "yesterday_collected": yesterday_collected,
        "last_month_collected": last_month_collected,
        "recent_payments": recent_payments,
        "priority_count": priority_count,
        "my_open_sr": my_open_sr,
        "my_areas": my_areas,
        "collection_streak": collection_streak,
    }
    set_cached(_cache_key, result)
    return result


# ════════════════════════════════════════════════════════════════════════════
# Collector Leaderboard — /api/dashboard/collector-leaderboard
# ════════════════════════════════════════════════════════════════════════════
@router.get("/collector-leaderboard")
def collector_leaderboard(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Collector performance for current month — admin/support/master only.
    Returns per-collector totals (amount, count, today) + areas covered."""
    if is_agent_role(current_user):
        raise HTTPException(403, "Admin access only")

    _oid = op_id(current_user)
    _cache_key = f"collector_leaderboard:{_oid}"
    cached = get_cached(_cache_key, ttl=30)
    if cached:
        return cached

    now = datetime.now()
    current_month = now.strftime("%Y-%m")
    month_start = now.strftime("%Y-%m-01")
    now_end = now.strftime("%Y-%m-%d 23:59:59")

    # Operator filter fragment
    op_clause = "AND p.operator_id = :oid"
    op_params = {"oid": _oid}
    if _oid is None:
        op_clause = ""  # master sees all
        op_params = {}

    # ── Main per-collector aggregation ──────────────────────────────────
    collector_rows = db.execute(
        text(f"""
            SELECT u.name, u.role,
                   COALESCE(SUM(p.amount), 0) AS collected,
                   COUNT(p.id) AS cnt,
                   COALESCE(SUM(CASE WHEN DATE(p.collected_at) = CURRENT_DATE THEN p.amount ELSE 0 END), 0) AS today,
                   SUM(CASE WHEN DATE(p.collected_at) = CURRENT_DATE THEN 1 ELSE 0 END) AS today_count
            FROM payments p
            JOIN users u ON p.collected_by = u.id
            WHERE (p.deleted IS NULL OR p.deleted = 0)
              AND p.collected_at >= :ms AND p.collected_at <= :ne
              {op_clause}
            GROUP BY u.name, u.role
            ORDER BY collected DESC
        """),
        {"ms": month_start, "ne": now_end, **op_params},
    ).fetchall()

    # ── Areas per collector (separate query, merged by name) ─────────────
    from services.payments import _gc
    area_rows = db.execute(
        text(f"""
            SELECT u.name,
                   {_gc("COALESCE(c.area, 'Unknown')")} AS areas
            FROM payments p
            JOIN users u ON p.collected_by = u.id
            JOIN customers c ON p.customer_id = c.customer_id
            WHERE (p.deleted IS NULL OR p.deleted = 0)
              AND p.collected_at >= :ms AND p.collected_at <= :ne
              {op_clause}
            GROUP BY u.name
        """),
        {"ms": month_start, "ne": now_end, **op_params},
    ).fetchall()
    areas_map = {r.name: (r.areas or "") for r in area_rows}

    collectors = []
    total_collected = 0
    total_count = 0
    for r in collector_rows:
        d = dict(r._mapping)
        collected = d.get("collected") or 0
        cnt = d.get("cnt") or 0
        name = d.get("name") or ""
        total_collected += collected
        total_count += cnt
        collectors.append({
            "name": name,
            "role": d.get("role") or "",
            "collected": collected,
            "count": cnt,
            "today": d.get("today") or 0,
            "today_count": d.get("today_count") or 0,
            "areas": areas_map.get(name, ""),
        })

    result = {
        "month": current_month,
        "collectors": collectors,
        "total_collected": total_collected,
        "total_count": total_count,
    }
    set_cached(_cache_key, result)
    return result


# ═══════════════════════════════════════════════════════════════════════════
# PAYMENT MODE TRANSITION — Cash ↔ Digital migration between two months
#
# Classifies each customer's payment mode as "Cash" or "Digital":
#   Cash   = Cash
#   Digital = GPay, PhonePe, UPI, Bank Transfer, Online, Card, Cheque
#
# Then tracks 4 transition buckets:
#   cash_to_digital    — paid cash last month, digital this month (converted!)
#   digital_to_cash    — paid digital last month, cash this month (lost!)
#   digital_to_digital — stable digital
#   cash_to_cash       — stable cash
#
# Also returns side-by-side split: last_month {cash, digital} vs this_month,
# and a 6-month digital % trend.
# ═══════════════════════════════════════════════════════════════════════════

# Modes classified as "Digital"
_DIGITAL_KEYWORDS = ("gpay", "phonepe", "phone pe", "phonepé", "upi",
                     "online", "bank", "card", "cheque", "check", "netbanking")


def _classify_mode(mode: str) -> str:
    """Return 'Cash', 'Digital', or 'Other' for a payment mode string."""
    if not mode:
        return "Other"
    m = str(mode).strip().lower()
    if m == "cash":
        return "Cash"
    if m in _DIGITAL_KEYWORDS:
        return "Digital"
    if "cash" in m:
        return "Cash"
    if any(k in m for k in _DIGITAL_KEYWORDS):
        return "Digital"
    return "Other"


@router.get("/payment-mode-transition")
def payment_mode_transition(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Cash ↔ Digital payment mode transition between last month and this month."""
    if is_agent_role(current_user):
        raise HTTPException(403, "Admin access only")

    _oid = op_id(current_user)
    _cache_key = f"payment_mode_transition:{_oid}"
    cached = get_cached(_cache_key, ttl=60)
    if cached:
        return cached

    now = datetime.now()

    this_ms = now.strftime("%Y-%m-01")
    this_me = now.strftime("%Y-%m-%d 23:59:59")

    if now.month == 1:
        lm_year, lm_month = now.year - 1, 12
    else:
        lm_year, lm_month = now.year, now.month - 1
    last_ms = f"{lm_year}-{lm_month:02d}-01"
    if lm_month == 12:
        lm_last_day = 31
    else:
        lm_last_day = (now.replace(year=lm_year, month=lm_month + 1, day=1) - timedelta(days=1)).day
    last_me = f"{lm_year}-{lm_month:02d}-{lm_last_day} 23:59:59"

    op_flt = "1=1"
    if _oid is not None:
        op_flt = f"operator_id = {_oid}"

    # Engine-specific month extraction
    from config import DB_ENGINE
    if DB_ENGINE == "sqlite":
        month_expr = "strftime('%Y-%m', collected_at)"
    else:
        month_expr = "TO_CHAR(collected_at::timestamp, 'YYYY-MM')"

    # ── Each customer's latest payment mode per month ───────────────────
    # Simplified: for each customer, get their most recent payment in the
    # date window. Use a correlated subquery instead of ROW_NUMBER for
    # cross-engine compatibility (SQLite 3.25+ supports ROW_NUMBER but
    # some older deployments may not).
    last_mode_rows = db.execute(
        text(f"""
            SELECT p1.customer_id, p1.payment_mode
            FROM payments p1
            INNER JOIN (
                SELECT customer_id, MAX(collected_at) as max_dt
                FROM payments
                WHERE (deleted IS NULL OR deleted = 0)
                  AND collected_at >= :ms AND collected_at <= :me AND {op_flt}
                GROUP BY customer_id
            ) p2 ON p1.customer_id = p2.customer_id AND p1.collected_at = p2.max_dt
            WHERE (p1.deleted IS NULL OR p1.deleted = 0) AND {op_flt.replace('operator_id', 'p1.operator_id')}
        """),
        {"ms": last_ms, "me": last_me},
    ).fetchall()
    last_mode_map = {r.customer_id: _classify_mode(r.payment_mode) for r in last_mode_rows}

    this_mode_rows = db.execute(
        text(f"""
            SELECT p1.customer_id, p1.payment_mode
            FROM payments p1
            INNER JOIN (
                SELECT customer_id, MAX(collected_at) as max_dt
                FROM payments
                WHERE (deleted IS NULL OR deleted = 0)
                  AND collected_at >= :ms AND collected_at <= :me AND {op_flt}
                GROUP BY customer_id
            ) p2 ON p1.customer_id = p2.customer_id AND p1.collected_at = p2.max_dt
            WHERE (p1.deleted IS NULL OR p1.deleted = 0) AND {op_flt.replace('operator_id', 'p1.operator_id')}
        """),
        {"ms": this_ms, "me": this_me},
    ).fetchall()
    this_mode_map = {r.customer_id: _classify_mode(r.payment_mode) for r in this_mode_rows}

    # ── Compute transition buckets ───────────────────────────────────────
    transition_buckets = {
        "cash_to_cash": {"count": 0, "customers": []},
        "cash_to_digital": {"count": 0, "customers": []},
        "digital_to_cash": {"count": 0, "customers": []},
        "digital_to_digital": {"count": 0, "customers": []},
    }

    both_months = set(last_mode_map.keys()) & set(this_mode_map.keys())

    # Batch fetch customer names
    cust_names = {}
    if both_months:
        cust_ids = list(both_months)
        # fetch in chunks to avoid param limit
        for i in range(0, len(cust_ids), 100):
            chunk = cust_ids[i:i + 100]
            placeholders = ",".join([f":id{j}" for j in range(len(chunk))])
            params = {f"id{j}": cid for j, cid in enumerate(chunk)}
            name_rows = db.execute(
                text(f"SELECT customer_id, name FROM customers WHERE customer_id IN ({placeholders})"),
                params,
            ).fetchall()
            for r in name_rows:
                cust_names[r.customer_id] = r.name

    for cid in both_months:
        lm_mode = last_mode_map[cid]
        tm_mode = this_mode_map[cid]
        if lm_mode == "Other" or tm_mode == "Other":
            continue
        key = f"{lm_mode.lower()}_to_{tm_mode.lower()}"
        if key in transition_buckets:
            transition_buckets[key]["count"] += 1
            transition_buckets[key]["customers"].append({
                "customer_id": cid,
                "name": cust_names.get(cid, cid),
            })

    # ── Side-by-side split per month ─────────────────────────────────────
    last_total = sum(1 for v in last_mode_map.values() if v != "Other")
    last_cash = sum(1 for v in last_mode_map.values() if v == "Cash")
    last_digital = sum(1 for v in last_mode_map.values() if v == "Digital")

    this_total = sum(1 for v in this_mode_map.values() if v != "Other")
    this_cash = sum(1 for v in this_mode_map.values() if v == "Cash")
    this_digital = sum(1 for v in this_mode_map.values() if v == "Digital")

    # ── 6-month digital % trend ──────────────────────────────────────────
    six_months_ago = (now - timedelta(days=180)).strftime("%Y-%m-01")
    trend_rows = db.execute(
        text(f"""
            SELECT {month_expr} as month,
                   COUNT(*) as total,
                   SUM(CASE WHEN LOWER(COALESCE(payment_mode,'')) = 'cash' THEN 1 ELSE 0 END) as cash_cnt,
                   SUM(CASE WHEN LOWER(COALESCE(payment_mode,'')) IN ('gp','gpay','phonepe','phone pe','upi','online','bank','bank transfer','netbanking','card','debit card','credit card','cheque') THEN 1 ELSE 0 END) as digital_cnt
            FROM payments
            WHERE (deleted IS NULL OR deleted = 0)
              AND collected_at >= :sma AND {op_flt}
            GROUP BY {month_expr}
            ORDER BY month
        """),
        {"sma": six_months_ago},
    ).fetchall()

    trend = []
    for r in trend_rows:
        total = r.total or 0
        cash_cnt = r.cash_cnt or 0
        digital_cnt = r.digital_cnt or 0
        known = cash_cnt + digital_cnt
        if known > 0 and known < total:
            unknown = total - known
            ratio = digital_cnt / known
            digital_cnt += int(unknown * ratio)
            cash_cnt = total - digital_cnt

        pct = round((digital_cnt / total * 100) if total > 0 else 0, 1)
        trend.append({
            "month": r.month,
            "total": total,
            "cash": cash_cnt,
            "digital": digital_cnt,
            "digital_pct": pct,
        })

    result = {
        "last_month": f"{lm_month:02d}-{lm_year}",
        "this_month": f"{now.month:02d}-{now.year}",
        "last_month_split": {"cash": last_cash, "digital": last_digital, "total": last_total},
        "this_month_split": {"cash": this_cash, "digital": this_digital, "total": this_total},
        "transitions": transition_buckets,
        "trend": trend,
        "summary": {
            "digital_pct_last": round((last_digital / last_total * 100) if last_total > 0 else 0, 1),
            "digital_pct_this": round((this_digital / this_total * 100) if this_total > 0 else 0, 1),
            "converted": transition_buckets["cash_to_digital"]["count"],
            "lost": transition_buckets["digital_to_cash"]["count"],
        },
    }
    set_cached(_cache_key, result)
    return result
