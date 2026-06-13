"""Reports API — area-wise collection, charts, etc."""
from fastapi import APIRouter, Query, Depends
from typing import Optional
from models.base import get_db
from conn import get_conn
from deps_orm import _op_flt, get_current_user, apply_op_filter, op_id
router = APIRouter(prefix="/api/reports", tags=["Reports"])
@router.get("/area-collection")
def area_collection(
   from_date: Optional[str] = Query(None),
   to_date: Optional[str] = Query(None),
   current_user=Depends(get_current_user),
):
   """Area-wise collection report combining local + Paypakka payments."""
   flt_pp = _op_flt(current_user, "pp.")
   flt_p = _op_flt(current_user, "p.")
   with get_conn() as conn:
       # Build area→amount map from BOTH payment sources
       area_data = {}  # area -> {total_amount, customer_count}
       # 1. Paypakka payments (LEFT JOIN — customer may not exist)
       pp_query = f"""
           SELECT COALESCE(c.area, 'Unknown') as area, 
                  SUM(pp.collection_amount) as total, 
                  COUNT(DISTINCT pp.customer_id) as cust_count
           FROM paypakka_payments pp
           LEFT JOIN customers c ON pp.customer_id = c.customer_id
           WHERE {flt_pp}
       """
       pp_params = []
       if from_date:
           pp_query += " AND date(pp.paypakka_created_at) >= ?"
           pp_params.append(from_date)
       if to_date:
           pp_query += " AND date(pp.paypakka_created_at) <= ?"
           pp_params.append(to_date)
       pp_query += " GROUP BY COALESCE(c.area, 'Unknown')"
       rows = conn.execute(pp_query, pp_params).fetchall()
       for r in rows:
           area = r["area"]
           if area not in area_data:
               area_data[area] = {"total_amount": 0, "customer_count": 0}
           area_data[area]["total_amount"] += r["total"] or 0
           area_data[area]["customer_count"] += r["cust_count"] or 0
       # 2. Local payments (LEFT JOIN — customer may not exist)
       lp_query = f"""
           SELECT COALESCE(c.area, 'Unknown') as area,
                  SUM(p.amount) as total,
                  COUNT(DISTINCT p.customer_id) as cust_count
           FROM payments p
           LEFT JOIN customers c ON p.customer_id = c.customer_id
           WHERE {flt_p}
       """
       lp_params = []
       if from_date:
           lp_query += " AND date(p.collected_at) >= ?"
           lp_params.append(from_date)
       if to_date:
           lp_query += " AND date(p.collected_at) <= ?"
           lp_params.append(to_date)
       lp_query += " GROUP BY COALESCE(c.area, 'Unknown')"
       rows2 = conn.execute(lp_query, lp_params).fetchall()
       for r in rows2:
           area = r["area"]
           if area not in area_data:
               area_data[area] = {"total_amount": 0, "customer_count": 0}
           area_data[area]["total_amount"] += r["total"] or 0
           area_data[area]["customer_count"] += r["cust_count"] or 0
       # Sort by total_amount descending
       areas_list = [
           {
               "area": area,
               "total_amount": round(data["total_amount"], 2),
               "customer_count": data["customer_count"],
           }
           for area, data in area_data.items()
       ]
       areas_list.sort(key=lambda x: x["total_amount"], reverse=True)
       # Summary
       total_amount = sum(a["total_amount"] for a in areas_list)
       total_customers = sum(a["customer_count"] for a in areas_list)
       return {
           "areas": areas_list,
           "total_amount": round(total_amount, 2),
           "total_areas": len(areas_list),
           "total_customers": total_customers,
       }
@router.get("/collector-performance")
def collector_performance(
   from_date: Optional[str] = Query(None),
   to_date: Optional[str] = Query(None),
   current_user=Depends(get_current_user),
):
   """Collector-wise collection performance combining local + Paypakka payments."""
   flt_pp = _op_flt(current_user, "pp.")
   flt_p = _op_flt(current_user, "p.")
   with get_conn() as conn:
       collector_data = {}  # name -> {total_collected, payment_count}
       # 1. Paypakka payments (JOIN with paypakka_employees for name)
       pp_query = f"""
           SELECT COALESCE(e.emp_name, 'Unknown') as name,
                  SUM(pp.collection_amount) as total,
                  COUNT(*) as cnt
           FROM paypakka_payments pp
           LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
           WHERE {flt_pp}
       """
       pp_params = []
       if from_date:
           pp_query += " AND date(pp.paypakka_created_at) >= ?"
           pp_params.append(from_date)
       if to_date:
           pp_query += " AND date(pp.paypakka_created_at) <= ?"
           pp_params.append(to_date)
       pp_query += " GROUP BY COALESCE(e.emp_name, 'Unknown')"
       rows = conn.execute(pp_query, pp_params).fetchall()
       for r in rows:
           name = r["name"]
           if name not in collector_data:
               collector_data[name] = {"total_collected": 0, "payment_count": 0}
           collector_data[name]["total_collected"] += r["total"] or 0
           collector_data[name]["payment_count"] += r["cnt"] or 0
       # 2. Local payments (join with users for collector name)
       lp_query = f"""
           SELECT COALESCE(u.name, 'Unknown') as name,
                  SUM(p.amount) as total,
                  COUNT(*) as cnt
           FROM payments p
           LEFT JOIN users u ON p.collected_by = u.id
           WHERE {flt_p}
       """
       lp_params = []
       if from_date:
           lp_query += " AND date(p.collected_at) >= ?"
           lp_params.append(from_date)
       if to_date:
           lp_query += " AND date(p.collected_at) <= ?"
           lp_params.append(to_date)
       lp_query += " GROUP BY COALESCE(u.name, 'Unknown')"
       rows2 = conn.execute(lp_query, lp_params).fetchall()
       for r in rows2:
           name = r["name"]
           if name not in collector_data:
               collector_data[name] = {"total_collected": 0, "payment_count": 0}
           collector_data[name]["total_collected"] += r["total"] or 0
           collector_data[name]["payment_count"] += r["cnt"] or 0
       # Sort by total_collected descending
       collectors_list = [
           {
               "name": name,
               "total_collected": round(data["total_collected"], 2),
               "payment_count": data["payment_count"],
           }
           for name, data in collector_data.items()
       ]
       collectors_list.sort(key=lambda x: x["total_collected"], reverse=True)
       total_amount = sum(c["total_collected"] for c in collectors_list)
       total_payments = sum(c["payment_count"] for c in collectors_list)
       return {
           "collectors": collectors_list,
           "total_amount": round(total_amount, 2),
           "total_payments": total_payments,
       }
@router.get("/mso-summary")
def mso_summary(
   from_date: Optional[str] = Query(None),
   to_date: Optional[str] = Query(None),
   current_user=Depends(get_current_user),
):
   """MSO-wise summary: customer counts + collection amounts."""
   flt = _op_flt(current_user)
   flt_pp = _op_flt(current_user, "pp.")
   flt_p = _op_flt(current_user, "p.")
   with get_conn() as conn:
       # 1. Customer/connection counts by MSO
       mso_data = {}
       conn_rows = conn.execute(f"""
           SELECT COALESCE(mso, 'Unknown') as mso,
                  COUNT(*) as total,
                  SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active
           FROM connections
           WHERE {flt}
           GROUP BY COALESCE(mso, 'Unknown')
       """).fetchall()
       for r in conn_rows:
           mso_data[r["mso"]] = {
               "name": r["mso"],
               "total_customers": r["total"],
               "active_customers": r["active"],
               "total_collected": 0,
           }
       # 2. Collection from Paypakka payments (JOIN connections → paypakka_payments)
       pp_query = f"""
           SELECT COALESCE(cn.mso, 'Unknown') as mso,
                  SUM(pp.collection_amount) as total
           FROM paypakka_payments pp
           JOIN customers c ON pp.customer_id = c.customer_id
           LEFT JOIN connections cn ON cn.customer_id = pp.customer_id
           WHERE {flt_pp}
       """
       pp_params = []
       if from_date:
           pp_query += " AND date(pp.paypakka_created_at) >= ?"
           pp_params.append(from_date)
       if to_date:
           pp_query += " AND date(pp.paypakka_created_at) <= ?"
           pp_params.append(to_date)
       pp_query += " GROUP BY COALESCE(cn.mso, 'Unknown')"
       rows = conn.execute(pp_query, pp_params).fetchall()
       for r in rows:
           mso = r["mso"]
           if mso not in mso_data:
               mso_data[mso] = {"name": mso, "total_customers": 0, "active_customers": 0, "total_collected": 0}
           mso_data[mso]["total_collected"] += r["total"] or 0
       # 3. Collection from Local payments
       lp_query = f"""
           SELECT COALESCE(cn.mso, 'Unknown') as mso,
                  SUM(p.amount) as total
           FROM payments p
           JOIN connections cn ON cn.id = p.connection_id
           WHERE {flt_p}
       """
       lp_params = []
       if from_date:
           lp_query += " AND date(p.collected_at) >= ?"
           lp_params.append(from_date)
       if to_date:
           lp_query += " AND date(p.collected_at) <= ?"
           lp_params.append(to_date)
       lp_query += " GROUP BY COALESCE(cn.mso, 'Unknown')"
       rows2 = conn.execute(lp_query, lp_params).fetchall()
       for r in rows2:
           mso = r["mso"]
           if mso not in mso_data:
               mso_data[mso] = {"name": mso, "total_customers": 0, "active_customers": 0, "total_collected": 0}
           mso_data[mso]["total_collected"] += r["total"] or 0
       msos_list = list(mso_data.values())
       msos_list.sort(key=lambda x: x["total_customers"], reverse=True)
       return {"msos": msos_list}
@router.get("/my-collections")
def my_collections(
   from_date: Optional[str] = Query(None),
   to_date: Optional[str] = Query(None),
   page: int = Query(1, ge=1),
   per_page: int = Query(20, ge=1, le=200),
   current_user=Depends(get_current_user),
):
   """Agent's own collection report — payments collected by THIS logged-in user."""
   user_id = current_user["id"]
   username = current_user.get("username", "")
   flt = _op_flt(current_user)
   flt_pp = _op_flt(current_user, "pp.")
   flt_p = _op_flt(current_user, "p.")
   with get_conn() as conn:
       # Try to find paypakka employee mapping by username matching employee name
       emp_row = conn.execute(
           f"SELECT emp_ref_id, emp_name FROM paypakka_employees WHERE LOWER(emp_name) LIKE ? AND {flt}",
           (f"%{username.lower()}%",)
       ).fetchone()
       emp_ref_id = emp_row["emp_ref_id"] if emp_row else None
       emp_name = emp_row["emp_name"] if emp_row else username
       payments = []
       total_collected = 0
       payment_count = 0
       # 1. Paypakka payments by this agent
       if emp_ref_id:
           pp_query = f"""
               SELECT pp.id, pp.customer_id, c.name as customer_name, c.area,
                      pp.collection_amount, pp.payment_type, pp.paypakka_created_at,
                      pp.emp_ref_id, 'paypakka' as source
               FROM paypakka_payments pp
               LEFT JOIN customers c ON pp.customer_id = c.customer_id
               WHERE pp.emp_ref_id = ? AND {flt_pp}
           """
           pp_params = [emp_ref_id]
           if from_date:
               pp_query += " AND date(pp.paypakka_created_at) >= ?"
               pp_params.append(from_date)
           if to_date:
               pp_query += " AND date(pp.paypakka_created_at) <= ?"
               pp_params.append(to_date)
           # Get total
           total_row = conn.execute(
               f"SELECT COALESCE(SUM(collection_amount),0) as total, COUNT(*) as cnt FROM paypakka_payments WHERE emp_ref_id = ? AND {flt}" +
               (" AND date(paypakka_created_at) >= ?" if from_date else "") +
               (" AND date(paypakka_created_at) <= ?" if to_date else ""),
               [emp_ref_id] + ([from_date] if from_date else []) + ([to_date] if to_date else [])
           ).fetchone()
           total_collected += total_row["total"] or 0
           payment_count += total_row["cnt"] or 0
           # Get paginated payments
           pp_query += " ORDER BY pp.paypakka_created_at DESC LIMIT ? OFFSET ?"
           pp_params.extend([per_page, (page - 1) * per_page])
           rows = conn.execute(pp_query, pp_params).fetchall()
           for r in rows:
               payments.append({
                   "id": r["id"],
                   "customer_name": r["customer_name"] or f"Customer #{r['customer_id']}",
                   "area": r["area"] or "",
                   "amount": r["collection_amount"],
                   "mode": r["payment_type"],
                   "date": r["paypakka_created_at"],
                   "source": "paypakka"
               })
# 2. Local payments by this user
       lp_query = f"""
           SELECT p.id, p.customer_id, c.name as customer_name, c.area,
                  p.amount, p.payment_mode, p.collected_at, 'local' as source
           FROM payments p
           LEFT JOIN customers c ON p.customer_id = c.customer_id
           WHERE p.collected_by = ? AND {flt_p}
       """
       lp_params = [user_id]
       if from_date:
           lp_query += " AND date(p.collected_at) >= ?"
           lp_params.append(from_date)
       if to_date:
           lp_query += " AND date(p.collected_at) <= ?"
           lp_params.append(to_date)
       lp_total = conn.execute(
           f"SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM payments WHERE collected_by = ? AND {flt}" +
           (" AND date(collected_at) >= ?" if from_date else "") +
           (" AND date(collected_at) <= ?" if to_date else ""),
           [user_id] + ([from_date] if from_date else []) + ([to_date] if to_date else [])
       ).fetchone()
       total_collected += lp_total["total"] or 0
       payment_count += lp_total["cnt"] or 0
       lp_query += " ORDER BY p.collected_at DESC LIMIT ? OFFSET ?"
       lp_params.extend([per_page, (page - 1) * per_page])
       lp_rows = conn.execute(lp_query, lp_params).fetchall()
       for r in lp_rows:
           payments.append({
               "id": r["id"],
               "customer_name": r["customer_name"] or f"Customer #{r['customer_id']}",
               "area": r["area"] or "",
               "amount": r["amount"],
               "mode": r["payment_mode"],
               "date": r["collected_at"],
               "source": "local"
           })
       # Sort all by date desc
       payments.sort(key=lambda x: x["date"] or "", reverse=True)
       payments = payments[:per_page]
       return {
           "agent_name": emp_name,
           "total_collected": total_collected,
           "payment_count": payment_count,
           "from_date": from_date,
           "to_date": to_date,
           "page": page,
           "per_page": per_page,
           "payments": payments
       }
@router.get("/mom-trend")
def mom_trend(
   months: int = Query(6, ge=2, le=24),
   current_user=Depends(get_current_user),
):
   """Month-over-month revenue trend for the last N months (local + Paypakka combined)."""
   from datetime import datetime, date
   import calendar
   flt_c = _op_flt(current_user, "c.")
   flt_pp = _op_flt(current_user, "pp.")
   now = datetime.now()
   # Build list of months to query
   month_list = []
   for i in range(months - 1, -1, -1):
       m = now.month - i
       y = now.year
       while m <= 0:
           m += 12
           y -= 1
       label = date(y, m, 1).strftime("%b %Y")
       first = f"{y}-{m:02d}-01"
       last_day = calendar.monthrange(y, m)[1]
       # Use first day of NEXT month as upper bound (exclusive)
       # so string comparison captures all timestamps within the month
       nm, nyy = m + 1, y
       if nm > 12:
           nm, nyy = 1, y + 1
       next_first = f"{nyy}-{nm:02d}-01"
       month_list.append({"label": label, "first": first, "next_first": next_first})
   results = []
   with get_conn() as conn:
       for mo in month_list:
           # Local payments — string comparison works on TEXT collected_at
           # because ISO format (YYYY-MM-DD ...) sorts lexicographically
           local = conn.execute(
               f"""SELECT COALESCE(SUM(p.amount), 0) as total, COUNT(*) as cnt
                   FROM payments p
                   JOIN customers c ON p.customer_id = c.customer_id
                   WHERE (p.deleted IS NULL OR p.deleted = 0)
                     AND p.collected_at >= ? AND p.collected_at < ?
                     AND {flt_c}""",
               (mo["first"], mo["next_first"])
           ).fetchone()
           # Paypakka payments
           pp = conn.execute(
               f"""SELECT COALESCE(SUM(pp.collection_amount), 0) as total, COUNT(*) as cnt
                   FROM paypakka_payments pp
                   LEFT JOIN customers c ON pp.customer_id = c.customer_id
                   WHERE pp.paypakka_created_at >= ? AND pp.paypakka_created_at < ?
                     AND {flt_pp}""",
               (mo["first"], mo["next_first"])
           ).fetchone()
           local_total = local["total"] if local else 0
           pp_total = pp["total"] if pp else 0
           results.append({
               "month": mo["label"],
               "local": round(local_total, 2),
               "paypakka": round(pp_total, 2),
               "total": round(local_total + pp_total, 2),
               "count": (local["cnt"] if local else 0) + (pp["cnt"] if pp else 0),
           })
   return {"months": months, "data": results}
@router.get("/audit-log")
def audit_log(
   entity: Optional[str] = Query(None),
   entity_id: Optional[str] = Query(None),
   action: Optional[str] = Query(None),
   page: int = Query(1, ge=1),
   per_page: int = Query(50, ge=1, le=200),
   current_user=Depends(get_current_user),
):
   """Fetch audit log entries. Admin/master only."""
   from deps import require_role
   if current_user.get("role") not in ("admin", "master"):
       from fastapi import HTTPException
       raise HTTPException(status_code=403, detail="Admin access required")
   with get_conn() as conn:
       # Scope to the caller's operator (master/_op_flt returns "1=1" → sees all)
       where = ["1=1", _op_flt(current_user)]
       params = []
       if entity:
           where.append("entity = ?")
           params.append(entity)
       if entity_id:
           where.append("entity_id = ?")
           params.append(entity_id)
       if action:
           where.append("action = ?")
           params.append(action)
       where_sql = " AND ".join(where)
       total = conn.execute(f"SELECT COUNT(*) FROM audit_log WHERE {where_sql}", params).fetchone()[0]
       rows = conn.execute(
           f"""SELECT * FROM audit_log WHERE {where_sql}
               ORDER BY created_at DESC LIMIT ? OFFSET ?""",
           params + [per_page, (page - 1) * per_page]
       ).fetchall()
   return {
       "total": total,
       "page": page,
       "per_page": per_page,
       "entries": [dict(r) for r in rows],
   }
