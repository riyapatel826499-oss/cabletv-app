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
