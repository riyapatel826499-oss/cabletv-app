from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from deps import get_db, get_current_user, require_role, op_filter, op_id

router = APIRouter(prefix="/api", tags=["Plans"])


class PlanCreate(BaseModel):
    name: str
    amount: float
    validity_days: int = 30
    description: Optional[str] = None
    status: Optional[str] = "Active"
    network: Optional[str] = "GTPL"
    mso_cost: Optional[float] = 0
    mso_cost_late: Optional[float] = 0


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    amount: Optional[float] = None
    validity_days: Optional[int] = None
    description: Optional[str] = None
    status: Optional[str] = None
    network: Optional[str] = None
    mso_cost: Optional[float] = None
    mso_cost_late: Optional[float] = None


@router.get("/plans")
def list_plans(
    status: Optional[str] = Query(None),
    network: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _opf = op_filter(current_user)
        query = f"SELECT * FROM plans WHERE {_opf}"
        params = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if network:
            query += " AND network = ?"
            params.append(network)
        query += " ORDER BY network, amount"
        rows = conn.execute(query, params).fetchall()
        plans = [dict(r) for r in rows]
        # Add active customer count for each plan
        for p in plans:
            count = conn.execute(
                f"SELECT COUNT(DISTINCT cp.customer_id) FROM customer_plans cp JOIN connections conn ON cp.connection_id = conn.id WHERE cp.plan_id = ? AND cp.status = 'Active' AND conn.status = 'Active' AND {op_filter(current_user, 'cp.')}",
                (p['id'],)
            ).fetchone()[0]
            p['active_customers'] = count
    return {"plans": plans}


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        _opf = op_filter(current_user)
        plan = conn.execute(f"SELECT * FROM plans WHERE id = ? AND {_opf}", (plan_id,)).fetchone()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return dict(plan)


@router.post("/plans", status_code=201)
def create_plan(data: PlanCreate, current_user=Depends(require_role("admin", "master"))):
    _opf = op_filter(current_user)
    _opid = op_id(current_user)
    with get_db() as conn:
        try:
            conn.execute(
                f"INSERT INTO plans (name, amount, validity_days, description, status, network, mso_cost, mso_cost_late, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, {_opid or 'NULL'})",
                (data.name, data.amount, data.validity_days, data.description, data.status, data.network, data.mso_cost, data.mso_cost_late),
            )
            conn.commit()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Plan created"}


@router.put("/plans/{plan_id}")
def update_plan(plan_id: int, data: PlanUpdate, current_user=Depends(require_role("admin", "master"))):
    with get_db() as conn:
        _opf = op_filter(current_user)
        plan = conn.execute(f"SELECT * FROM plans WHERE id = ? AND {_opf}", (plan_id,)).fetchone()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        updates = {k: v for k, v in data.dict().items() if v is not None}
        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [plan_id]
            conn.execute(f"UPDATE plans SET {set_clause} WHERE id = ?", values)
            conn.commit()
    return {"message": "Plan updated"}


@router.delete("/plans/{plan_id}")
def delete_plan(plan_id: int, current_user=Depends(require_role("admin", "master"))):
    with get_db() as conn:
        _opf = op_filter(current_user)
        plan = conn.execute(f"SELECT * FROM plans WHERE id = ? AND {_opf}", (plan_id,)).fetchone()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        # Check active customers using this plan
        active_count = conn.execute(
            f"SELECT COUNT(DISTINCT cp.customer_id) FROM customer_plans cp JOIN connections conn ON cp.connection_id = conn.id WHERE cp.plan_id = ? AND cp.status = 'Active' AND conn.status = 'Active' AND {op_filter(current_user, 'cp.')}",
            (plan_id,)
        ).fetchone()[0]

        if active_count > 0:
            raise HTTPException(status_code=400, detail=f"Cannot delete: {active_count} active customer(s) are using this plan")

        # Soft delete
        conn.execute(f"UPDATE plans SET status = 'Deleted' WHERE id = ? AND {_opf}", (plan_id,))
        conn.commit()
    return {"message": "Plan deleted"}


@router.get("/plans/{plan_id}/customers")
def get_plan_customers(plan_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        _opf = op_filter(current_user)
        plan = conn.execute(f"SELECT * FROM plans WHERE id = ? AND {_opf}", (plan_id,)).fetchone()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        rows = conn.execute(
            f"""SELECT c.customer_id, c.name, c.phone, c.area, cp.status as plan_status,
               conn.stb_no, conn.status as conn_status
               FROM customer_plans cp
               JOIN customers c ON cp.customer_id = c.customer_id
               LEFT JOIN connections conn ON cp.connection_id = conn.id
               WHERE cp.plan_id = ? AND {op_filter(current_user, 'cp.')}
               ORDER BY cp.status, c.name""",
            (plan_id,)
        ).fetchall()
    return {"plan": dict(plan), "customers": [dict(r) for r in rows]}
