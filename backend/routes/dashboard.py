"""Dashboard routes — migrated to SQLAlchemy 2.0 ORM.

Complex aggregation queries (UNION, GROUP BY with subqueries) use
text() as a bridge where ORM would be more verbose and harder to read.
Simple counts/sums use full ORM style.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, text, and_, literal_column
from datetime import datetime, timedelta
from typing import Optional

from models.base import get_db
from models.tables import (
    Customer, Connection, Payment, PaypakkaPayment, PaypakkaEmployee,
    CustomerPlan, Plan, User, Operator, ServiceRequest,
)
from deps_orm import get_current_user, require_role, apply_op_filter, op_id
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
    is_agent = current_user.get("role") in ("service_agent", "collection_agent", "agent")
    if not is_agent:
        cached = get_cached("dashboard_stats", ttl=30)
        if cached:
            return cached

    _oid = op_id(current_user)
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
    has_local = db.execute(
        text(f"SELECT COUNT(*) FROM payments WHERE collected_at >= :ms AND collected_at <= :ne AND {op_flt}"),
        {"ms": month_start_str, "ne": now_end},
    ).scalar() > 0

    if has_local:
        # Local payments exist → use local data only (paypakka is historical)
        paid_this_month = db.execute(
            text(f"SELECT COUNT(DISTINCT customer_id) FROM payments WHERE collected_at >= :ms AND collected_at <= :ne AND {op_flt}"),
            {"ms": month_start_str, "ne": now_end},
        ).scalar()
    else:
        # No local data (historical month) → fall back to paypakka
        paid_this_month = db.execute(
            text(f"""SELECT COUNT(DISTINCT customer_id) FROM (
                   SELECT customer_id FROM payments WHERE collected_at >= :ms AND collected_at <= :ne AND {op_flt}
                   UNION
                   SELECT customer_id FROM paypakka_payments
                   WHERE paypakka_created_at >= :ms2 AND paypakka_created_at <= :ne2 AND {op_flt}
               )"""),
            {"ms": month_start_str, "ne": now_end, "ms2": month_start_str, "ne2": now_end},
        ).scalar()

    # Total collected: sum of local + paypakka for current month
    q_local = apply_op_filter(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            and_(
                Payment.collected_at >= month_start_str,
                Payment.collected_at <= now_end,
            )
        ),
        Payment,
        current_user,
    )
    local_collected = db.execute(q_local).scalar() or 0

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
                   SELECT customer_id FROM payments WHERE collected_at >= :ms AND collected_at <= :ne AND {op_flt}
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
                   SELECT customer_id FROM payments WHERE collected_at >= :ms AND collected_at <= :ne AND {op_flt}
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
                   SELECT customer_id, amount FROM payments WHERE collected_at >= :ms AND collected_at <= :ne AND {op_flt}
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
                   SELECT customer_id, amount FROM payments WHERE collected_at >= :ms AND collected_at <= :ne AND {op_flt}
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

    # Expiring soon (next 3 days)
    expiring_rows = db.execute(
        text(f"""SELECT cp.*, c.name as customer_name, c.phone, c.area, p.name as plan_name
           FROM customer_plans cp
           JOIN customers c ON cp.customer_id = c.customer_id
           JOIN plans p ON cp.plan_id = p.id
           WHERE cp.status = 'Active' AND cp.expiry_date <= (CURRENT_DATE + INTERVAL '3 days')::text AND {op_flt_cp}
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

    set_cached("dashboard_stats", result)
    return result


@router.get("/payment-modes")
def payment_mode_stats(
    current_user: dict = Depends(get_current_user),
    db=Depends(get_db),
):
    """Get payment mode breakdown for current month from both tables."""
    cached = get_cached("payment_modes", ttl=60)
    if cached:
        return cached

    _oid = op_id(current_user)
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
    set_cached("payment_modes", result)
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
                      SELECT customer_id FROM payments WHERE operator_id = o.id AND collected_at >= :ms1 AND collected_at <= :ne1
                      UNION
                      SELECT customer_id FROM paypakka_payments WHERE operator_id = o.id AND paypakka_created_at >= :ms2 AND paypakka_created_at <= :ne2
                  )) as paid_local,
                  (SELECT COALESCE(SUM(total), 0) FROM (
                      SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE operator_id = o.id AND collected_at >= :ms3 AND collected_at <= :ne3
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
