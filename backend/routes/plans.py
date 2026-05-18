from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from sqlalchemy import select, update, delete, func, and_, text
from sqlalchemy.orm import Session

from models.base import get_db
from deps_orm import get_current_user, require_role, apply_op_filter, op_id
from models.tables import Plan, CustomerPlan, Connection, Customer

router = APIRouter(prefix="/api", tags=["Plans"])


def _obj_to_dict(obj):
    """Convert a SQLAlchemy model instance to a dict."""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


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
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = select(Plan)
    query = apply_op_filter(query, Plan, current_user)
    if status:
        query = query.where(Plan.status == status)
    if network:
        query = query.where(Plan.network == network)
    query = query.order_by(Plan.network, Plan.amount)

    rows = db.execute(query).scalars().all()
    plans = [_obj_to_dict(p) for p in rows]

    # Add active customer count for each plan
    for p in plans:
        count_query = (
            select(func.count(func.distinct(CustomerPlan.customer_id)))
            .select_from(CustomerPlan)
            .join(Connection, CustomerPlan.connection_id == Connection.id)
        )
        count_query = count_query.where(
            CustomerPlan.plan_id == p['id'],
            CustomerPlan.status == 'Active',
            Connection.status == 'Active',
        )
        count_query = apply_op_filter(count_query, CustomerPlan, current_user)
        count = db.execute(count_query).scalar()
        p['active_customers'] = count or 0

    return {"plans": plans}


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    query = select(Plan).where(Plan.id == plan_id)
    query = apply_op_filter(query, Plan, current_user)
    plan = db.execute(query).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    return _obj_to_dict(plan)


@router.post("/plans", status_code=201)
def create_plan(
    data: PlanCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "master")),
):
    _oid = op_id(current_user)
    try:
        plan = Plan(
            name=data.name,
            amount=data.amount,
            validity_days=data.validity_days,
            description=data.description,
            status=data.status,
            network=data.network,
            mso_cost=data.mso_cost,
            mso_cost_late=data.mso_cost_late,
            operator_id=_oid,
        )
        db.add(plan)
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Plan created"}


@router.put("/plans/{plan_id}")
def update_plan(
    plan_id: int,
    data: PlanUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "master")),
):
    query = select(Plan).where(Plan.id == plan_id)
    query = apply_op_filter(query, Plan, current_user)
    plan = db.execute(query).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    updates = {k: v for k, v in data.dict().items() if v is not None}
    if updates:
        db.execute(
            update(Plan).where(Plan.id == plan_id).values(**updates)
        )
        db.commit()
    return {"message": "Plan updated"}


@router.delete("/plans/{plan_id}")
def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin", "master")),
):
    query = select(Plan).where(Plan.id == plan_id)
    query = apply_op_filter(query, Plan, current_user)
    plan = db.execute(query).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Check active customers using this plan
    count_query = (
        select(func.count(func.distinct(CustomerPlan.customer_id)))
        .select_from(CustomerPlan)
        .join(Connection, CustomerPlan.connection_id == Connection.id)
    )
    count_query = count_query.where(
        CustomerPlan.plan_id == plan_id,
        CustomerPlan.status == 'Active',
        Connection.status == 'Active',
    )
    count_query = apply_op_filter(count_query, CustomerPlan, current_user)
    active_count = db.execute(count_query).scalar() or 0

    if active_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {active_count} active customer(s) are using this plan",
        )

    # Soft delete
    db.execute(
        update(Plan).where(Plan.id == plan_id).values(status='Deleted')
    )
    db.commit()
    return {"message": "Plan deleted"}


@router.get("/plans/{plan_id}/customers")
def get_plan_customers(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = select(Plan).where(Plan.id == plan_id)
    query = apply_op_filter(query, Plan, current_user)
    plan = db.execute(query).scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    # Use text() bridge for this multi-join query
    oid = current_user.get("operator_id")
    if oid is not None:
        op_clause = "cp.operator_id = :op_id"
        params = {"plan_id": plan_id, "op_id": oid}
    else:
        op_clause = "(cp.operator_id > 0 OR cp.operator_id IS NULL)"
        params = {"plan_id": plan_id}

    rows = db.execute(
        text(f"""SELECT c.customer_id, c.name, c.phone, c.area, cp.status as plan_status,
               conn.stb_no, conn.status as conn_status
               FROM customer_plans cp
               JOIN customers c ON cp.customer_id = c.customer_id
               LEFT JOIN connections conn ON cp.connection_id = conn.id
               WHERE cp.plan_id = :plan_id AND {op_clause}
               ORDER BY cp.status, c.name"""),
        params,
    ).fetchall()

    return {
        "plan": _obj_to_dict(plan),
        "customers": [dict(r._mapping) for r in rows],
    }
