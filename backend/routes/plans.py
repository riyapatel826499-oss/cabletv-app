from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from deps import get_db, get_current_user

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
        query = "SELECT * FROM plans WHERE 1=1"
        params = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if network:
            query += " AND network = ?"
            params.append(network)
        query += " ORDER BY network, amount"
        rows = conn.execute(query, params).fetchall()
    return {"plans": [dict(r) for r in rows]}


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        plan = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return dict(plan)


@router.post("/plans", status_code=201)
def create_plan(data: PlanCreate, current_user=Depends(get_current_user)):
    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO plans (name, amount, validity_days, description, status, network, mso_cost, mso_cost_late) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (data.name, data.amount, data.validity_days, data.description, data.status, data.network, data.mso_cost, data.mso_cost_late),
            )
            conn.commit()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Plan created"}


@router.put("/plans/{plan_id}")
def update_plan(plan_id: int, data: PlanUpdate, current_user=Depends(get_current_user)):
    with get_db() as conn:
        plan = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
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
def delete_plan(plan_id: int, current_user=Depends(get_current_user)):
    with get_db() as conn:
        plan = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
        if not plan:
            raise HTTPException(status_code=404, detail="Plan not found")

        # Soft delete
        conn.execute("UPDATE plans SET status = 'Deleted' WHERE id = ?", (plan_id,))
        conn.commit()
    return {"message": "Plan deleted"}
