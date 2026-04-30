"""Reports API — area-wise collection, charts, etc."""
from fastapi import APIRouter, Query, Depends
from typing import Optional
from models.database import get_db
from deps import get_current_user

router = APIRouter(prefix="/api/reports", tags=["Reports"])


@router.get("/area-collection")
def area_collection(
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
):
    """Area-wise collection report combining local + Paypakka payments."""
    with get_db() as conn:
        # Build area→amount map from BOTH payment sources
        area_data = {}  # area -> {total_amount, customer_count}

        # 1. Paypakka payments (JOIN with customers for area)
        pp_query = """
            SELECT COALESCE(c.area, 'Unknown') as area, 
                   SUM(pp.collection_amount) as total, 
                   COUNT(DISTINCT pp.customer_id) as cust_count
            FROM paypakka_payments pp
            JOIN customers c ON pp.customer_id = c.customer_id
            WHERE 1=1
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

        # 2. Local payments (join with customers for area)
        lp_query = """
            SELECT COALESCE(c.area, 'Unknown') as area,
                   SUM(p.amount) as total,
                   COUNT(DISTINCT p.customer_id) as cust_count
            FROM payments p
            JOIN customers c ON p.customer_id = c.customer_id
            WHERE 1=1
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
    with get_db() as conn:
        collector_data = {}  # name -> {total_collected, payment_count}

        # 1. Paypakka payments (JOIN with paypakka_employees for name)
        pp_query = """
            SELECT COALESCE(e.emp_name, 'Unknown') as name,
                   SUM(pp.collection_amount) as total,
                   COUNT(*) as cnt
            FROM paypakka_payments pp
            LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
            WHERE 1=1
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
        lp_query = """
            SELECT COALESCE(u.name, 'Unknown') as name,
                   SUM(p.amount) as total,
                   COUNT(*) as cnt
            FROM payments p
            LEFT JOIN users u ON p.collected_by = u.id
            WHERE 1=1
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
    with get_db() as conn:
        # 1. Customer/connection counts by MSO
        mso_data = {}
        conn_rows = conn.execute("""
            SELECT COALESCE(mso, 'Unknown') as mso,
                   COUNT(*) as total,
                   SUM(CASE WHEN status = 'Active' THEN 1 ELSE 0 END) as active
            FROM connections
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
        pp_query = """
            SELECT COALESCE(cn.mso, 'Unknown') as mso,
                   SUM(pp.collection_amount) as total
            FROM paypakka_payments pp
            JOIN customers c ON pp.customer_id = c.customer_id
            LEFT JOIN connections cn ON cn.customer_id = pp.customer_id
            WHERE 1=1
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
        lp_query = """
            SELECT COALESCE(cn.mso, 'Unknown') as mso,
                   SUM(p.amount) as total
            FROM payments p
            JOIN connections cn ON cn.id = p.connection_id
            WHERE 1=1
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
