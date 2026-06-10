from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from sqlalchemy import select, update, func, text, and_
from sqlalchemy.orm import Session

from models.base import get_db
from deps_orm import get_current_user, require_role, apply_op_filter, op_id
from models.tables import (
    Connection, Customer, Plan, StbInventory,
    CustomerPlan, Payment, PaypakkaPayment, PaypakkaEmployee, SmsLog,
)

router = APIRouter(prefix="/api", tags=["Connections"])


def _obj_to_dict(obj):
    """Convert a SQLAlchemy model instance to a dict."""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def _detect_network(stb_no: str) -> str:
    """Auto-detect network from STB number prefix."""
    stb = str(stb_no).strip()
    if stb.startswith("172") or stb.startswith("173"):
        return "TACTV"
    elif stb.startswith("5000"):
        return "SCV"
    else:
        return "GTPL"


class ConnectionCreate(BaseModel):
    stb_no: str
    can_id: Optional[str] = None
    mso: Optional[str] = "GTPL"
    service_type: Optional[str] = "Cable"
    billing_type: Optional[str] = "Prepaid"
    status: Optional[str] = "Active"


def _plan_to_dict(cp_obj, plan_name=None):
    return {
        "id": cp_obj.id,
        "customer_id": cp_obj.customer_id,
        "connection_id": cp_obj.connection_id,
        "plan_id": cp_obj.plan_id,
        "plan_name": plan_name,
        "amount": cp_obj.amount,
        "start_date": cp_obj.start_date,
        "expiry_date": cp_obj.expiry_date,
        "status": cp_obj.status,
    }


@router.get("/customers/{customer_id}/plans")
def get_customer_plans(
    customer_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = (
        select(CustomerPlan, Plan.name.label("plan_name"))
        .outerjoin(Plan, CustomerPlan.plan_id == Plan.id)
        .where(CustomerPlan.customer_id == customer_id)
    )
    query = apply_op_filter(query, CustomerPlan, current_user)
    query = query.order_by(CustomerPlan.created_at.desc())

    rows = db.execute(query).all()
    plans = []
    for cp_obj, plan_name in rows:
        plans.append(_plan_to_dict(cp_obj, plan_name))
    return {"plans": plans}


@router.get("/customers/{customer_id}/payment-history")
def get_customer_payment_history(
    customer_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Local payments
    local_query = (
        select(Payment, Customer.name.label("customer_name"))
        .outerjoin(Customer, Payment.customer_id == Customer.customer_id)
        .where(Payment.customer_id == customer_id)
    )
    local_query = apply_op_filter(local_query, Payment, current_user)
    local_query = local_query.order_by(Payment.collected_at.desc()).limit(50)

    local_rows = db.execute(local_query).all()

    # Paypakka payments
    ppay_query = (
        select(PaypakkaPayment, PaypakkaEmployee.emp_name.label("collector_name"))
        .outerjoin(PaypakkaEmployee, PaypakkaPayment.emp_ref_id == PaypakkaEmployee.emp_ref_id)
        .where(PaypakkaPayment.customer_id == customer_id)
    )
    ppay_query = apply_op_filter(ppay_query, PaypakkaPayment, current_user)
    ppay_query = ppay_query.order_by(PaypakkaPayment.paypakka_created_at.desc()).limit(50)

    ppay_rows = db.execute(ppay_query).all()

    payments = []
    for p_obj, customer_name in local_rows:
        payments.append({
            "id": f"LOCAL-{p_obj.id}",
            "amount": p_obj.amount,
            "mode": p_obj.payment_mode,
            "date": p_obj.collected_at,
            "type": "Local",
            "notes": p_obj.notes,
        })
    for pp_obj, collector_name in ppay_rows:
        payments.append({
            "id": f"PP-{pp_obj.id}",
            "amount": pp_obj.collection_amount,
            "mode": pp_obj.payment_type,
            "date": pp_obj.paypakka_created_at,
            "type": "Paypakka",
            "collector": collector_name or "",
        })
    payments.sort(key=lambda x: x.get("date") or "", reverse=True)
    return {"payments": payments, "total": len(payments)}


@router.get("/customers/{customer_id}/sms-history")
def get_customer_sms_history(
    customer_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    query = select(SmsLog).where(SmsLog.customer_id == customer_id)
    query = apply_op_filter(query, SmsLog, current_user)
    query = query.order_by(SmsLog.sent_at.desc()).limit(50)

    msgs = db.execute(query).scalars().all()
    return {"sms_history": [_obj_to_dict(m) for m in msgs]}


@router.post("/customers/{customer_id}/connections")
def add_connection(
    customer_id: str,
    data: ConnectionCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    _opid = op_id(current_user)

    # Validate customer exists
    cust_query = select(Customer).where(Customer.customer_id == customer_id)
    cust_query = apply_op_filter(cust_query, Customer, current_user)
    existing = db.execute(cust_query).scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Validate STB uniqueness — check if STB is in active use
    dup_query = (
        select(Connection, Customer.name)
        .join(Customer, Connection.customer_id == Customer.customer_id)
        .where(Connection.stb_no == data.stb_no, Connection.status == "Active")
    )
    dup_query = apply_op_filter(dup_query, Connection, current_user)
    dup_row = db.execute(dup_query).first()
    if dup_row:
        dup_conn, dup_name = dup_row
        raise HTTPException(
            status_code=400,
            detail=f"STB {data.stb_no} is already assigned to {dup_name} ({dup_conn.customer_id})",
        )

    # Free up STB from any surrendered connections so UNIQUE constraint passes
    surrendered_query = select(Connection).where(
        Connection.stb_no == data.stb_no,
        Connection.status == "Surrendered",
    )
    surrendered_query = apply_op_filter(surrendered_query, Connection, current_user)
    surrendered_rows = db.execute(surrendered_query).scalars().all()
    for row in surrendered_rows:
        db.execute(
            update(Connection)
            .where(Connection.id == row.id)
            .values(stb_no=f"SURRENDERED-{row.id}")
        )

    network = _detect_network(data.stb_no)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    new_conn = Connection(
        customer_id=customer_id,
        stb_no=data.stb_no,
        can_id=data.can_id,
        mso=data.mso,
        service_type=data.service_type,
        billing_type=data.billing_type,
        status=data.status,
        network=network,
        created_at=now,
        operator_id=_opid,
    )
    db.add(new_conn)
    db.commit()
    return {"ok": True, "message": "Connection added"}


# ── Temp Disconnect: Reclaim STB from customer (no refund, reconnectable free) ──

class TempDisconnectRequest(BaseModel):
    connection_id: int
    reason: Optional[str] = None


@router.post("/connections/temp-disconnect")
def temp_disconnect(
    data: TempDisconnectRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Mark a connection as 'Temp Disconnected' — STB reclaimed, customer stays Active.
    STB becomes available in inventory for reassignment. No refund given.
    Customer can reconnect anytime without extra charges."""
    if current_user.get("role") == "master":
        raise HTTPException(status_code=403, detail="Master admin cannot disconnect connections. Use an operator admin account.")
    if current_user["role"] not in ("admin", "support", "collection_agent"):
        raise HTTPException(status_code=403, detail="Not authorized")

    _opid = op_id(current_user)

    # Get the connection with customer info (filter via customer's operator_id)
    row_query = (
        select(Connection, Customer.name.label("customer_name"), Customer.customer_id)
        .join(Customer, Connection.customer_id == Customer.customer_id)
        .where(Connection.id == data.connection_id)
    )
    row_query = apply_op_filter(row_query, Customer, current_user)
    row_result = db.execute(row_query).first()

    if not row_result:
        raise HTTPException(status_code=404, detail="Connection not found")

    conn_obj, customer_name, cust_id = row_result
    if conn_obj.status != "Active":
        raise HTTPException(
            status_code=400,
            detail=f"Connection is already '{conn_obj.status}', only Active connections can be temp disconnected",
        )

    stb_no = conn_obj.stb_no
    customer_id = conn_obj.customer_id
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1. Update connection status to Temp Disconnected
    db.execute(
        update(Connection)
        .where(Connection.id == data.connection_id)
        .values(status="Temp Disconnected")
    )

    # Try to add notes/disconnect_date if columns exist
    try:
        note_text = (
            f"\n[Temp Disconnected: {now}"
            + (f" — {data.reason}" if data.reason else "")
            + "]"
        )
        db.execute(
            update(Connection)
            .where(Connection.id == data.connection_id)
            .values(
                notes=(conn_obj.notes or "") + note_text,
                disconnect_date=now,
                updated_at=now,
            )
        )
    except Exception:
        pass  # Columns don't exist yet, that's OK

    # 2. Release STB number — rename to TEMPDISC-{id} so UNIQUE constraint passes
    db.execute(
        update(Connection)
        .where(Connection.id == data.connection_id)
        .values(stb_no=f"TEMPDISC-{data.connection_id}")
    )

    # 3. Add STB to inventory as 'available'
    cust_oid = _opid or 1
    inv = db.execute(
        select(StbInventory).where(StbInventory.stb_no == stb_no)
    ).scalar_one_or_none()
    note = f"Reclaimed from {customer_name} ({customer_id}) — temp disconnect"
    if inv:
        db.execute(
            update(StbInventory)
            .where(StbInventory.stb_no == stb_no)
            .values(status="available", notes=note, operator_id=cust_oid)
        )
    else:
        db.add(StbInventory(
            stb_no=stb_no,
            status="available",
            added_at=now,
            notes=note,
            operator_id=cust_oid,
        ))

    # 4. Check if customer has any remaining Active connections
    remaining = db.execute(
        select(func.count()).select_from(Connection).where(
            Connection.customer_id == customer_id,
            Connection.status == "Active",
        )
    ).scalar()

    # If no active connections left, mark customer as 'Temp Disconnected' too
    customer_status = "Active"
    if remaining == 0:
        cust_update = (
            update(Customer)
            .where(Customer.customer_id == customer_id)
            .values(status="Temp Disconnected")
        )
        cust_update = apply_op_filter(cust_update, Customer, current_user)
        db.execute(cust_update)
        customer_status = "Temp Disconnected"

    db.commit()
    return {
        "ok": True,
        "message": f"STB {stb_no} reclaimed from {customer_name}. Customer can reconnect anytime without charges.",
        "stb_no": stb_no,
        "customer_name": customer_name,
        "customer_status": customer_status,
    }


class ReconnectRequest(BaseModel):
    customer_id: str
    stb_no: str
    connection_id: Optional[int] = None  # If reconnecting specific connection
    plan_id: Optional[int] = None
    month_year: Optional[str] = None


class RestoreRequest(BaseModel):
    connection_id: int
    customer_id: str
    stb_no: str


@router.post("/connections/restore")
def restore_connection(
    data: RestoreRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Restore a Surrendered connection by assigning an STB from inventory.
    Sets connection back to Active, removes STB from inventory, reactivates customer."""
    if current_user.get("role") == "master":
        raise HTTPException(status_code=403, detail="Master admin cannot restore connections. Use an operator admin account.")
    if current_user["role"] not in ("admin", "support", "collection_agent"):
        raise HTTPException(status_code=403, detail="Not authorized")

    _opid = op_id(current_user)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1. Validate the connection exists and is Surrendered
    conn_query = (
        select(Connection, Customer.name.label("customer_name"))
        .join(Customer, Connection.customer_id == Customer.customer_id)
        .where(Connection.id == data.connection_id)
    )
    conn_query = apply_op_filter(conn_query, Customer, current_user)
    conn_result = db.execute(conn_query).first()

    if not conn_result:
        raise HTTPException(status_code=404, detail="Connection not found")

    conn_obj, customer_name = conn_result
    if conn_obj.status != "Surrendered":
        raise HTTPException(
            status_code=400,
            detail=f"Connection status is '{conn_obj.status}', not 'Surrendered'. Only surrendered connections can be restored.",
        )

    # 2. Validate the STB exists in inventory as 'available'
    inv_stb = db.execute(
        select(StbInventory).where(StbInventory.stb_no == data.stb_no)
    ).scalar_one_or_none()

    if not inv_stb:
        raise HTTPException(status_code=404, detail=f"STB {data.stb_no} not found in inventory")
    if inv_stb.status not in ("available", "spare"):
        raise HTTPException(status_code=400, detail=f"STB {data.stb_no} is '{inv_stb.status}' in inventory, not available for assignment")

    # 3. Validate STB is not already in active use
    stb_in_use = db.execute(
        select(Customer.name)
        .join(Connection, Connection.customer_id == Customer.customer_id)
        .where(Connection.stb_no == data.stb_no, Connection.status == "Active")
    ).scalar_one_or_none()
    if stb_in_use:
        raise HTTPException(status_code=400, detail=f"STB {data.stb_no} is already assigned to {stb_in_use}")

    # 4. Update connection: set status Active, assign new STB
    network = _detect_network(data.stb_no)
    db.execute(
        update(Connection)
        .where(Connection.id == data.connection_id)
        .values(status="Active", stb_no=data.stb_no, network=network)
    )
    try:
        db.execute(
            update(Connection)
            .where(Connection.id == data.connection_id)
            .values(
                notes=(conn_obj.notes or "") + f"\n[Restored: {now} with STB {data.stb_no}]",
                updated_at=now,
            )
        )
    except Exception:
        pass

    # 5. Remove STB from inventory (mark as assigned)
    db.execute(
        update(StbInventory)
        .where(StbInventory.id == inv_stb.id)
        .values(status="assigned")
    )

    # 6. Reactivate customer if currently Surrendered
    cust = db.execute(
        select(Customer).where(Customer.customer_id == data.customer_id)
    ).scalar_one_or_none()
    if cust and cust.status == "Surrendered":
        cust_update = (
            update(Customer)
            .where(Customer.customer_id == data.customer_id)
            .values(status="Active", surrendered_date=None, surrender_reason=None)
        )
        cust_update = apply_op_filter(cust_update, Customer, current_user)
        db.execute(cust_update)

    db.commit()
    return {
        "ok": True,
        "message": f"STB {data.stb_no} restored to {customer_name}. Connection activated successfully!",
        "customer_id": data.customer_id,
        "stb_no": data.stb_no,
    }


@router.post("/connections/reconnect")
def reconnect_customer(
    data: ReconnectRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Reconnect a Temp Disconnected customer — assigns STB (can be same or different),
    sets connection back to Active. No installation/extra charges."""
    if current_user.get("role") == "master":
        raise HTTPException(status_code=403, detail="Master admin cannot reconnect connections. Use an operator admin account.")
    if current_user["role"] not in ("admin", "support", "collection_agent"):
        raise HTTPException(status_code=403, detail="Not authorized")

    _opid = op_id(current_user)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Get customer
    cust_query = select(Customer).where(Customer.customer_id == data.customer_id)
    cust_query = apply_op_filter(cust_query, Customer, current_user)
    cust = db.execute(cust_query).scalar_one_or_none()
    if not cust:
        raise HTTPException(status_code=404, detail="Customer not found")
    if cust.status != "Temp Disconnected":
        raise HTTPException(
            status_code=400,
            detail=f"Customer status is '{cust.status}', not 'Temp Disconnected'. Use normal connection add instead.",
        )

    # Validate STB is not in active use (filter via customer JOIN)
    stb_query = (
        select(Customer.name)
        .join(Connection, Connection.customer_id == Customer.customer_id)
        .where(Connection.stb_no == data.stb_no, Connection.status == "Active")
    )
    stb_query = apply_op_filter(stb_query, Customer, current_user)
    stb_in_use = db.execute(stb_query).scalar_one_or_none()
    if stb_in_use:
        raise HTTPException(
            status_code=400,
            detail=f"STB {data.stb_no} is already assigned to {stb_in_use}",
        )

    # Find the temp disconnected connection for this customer
    td_conn = db.execute(
        select(Connection)
        .where(
            Connection.customer_id == data.customer_id,
            Connection.status == "Temp Disconnected",
        )
        .order_by(Connection.id.desc())
        .limit(1)
    ).scalar_one_or_none()

    if td_conn:
        # Reactivate existing connection with new STB
        network = _detect_network(data.stb_no)
        db.execute(
            update(Connection)
            .where(Connection.id == td_conn.id)
            .values(status="Active", stb_no=data.stb_no, network=network)
        )
        try:
            db.execute(
                update(Connection)
                .where(Connection.id == td_conn.id)
                .values(
                    notes=(td_conn.notes or "") + f"\n[Reconnected: {now} with STB {data.stb_no}]",
                    updated_at=now,
                )
            )
        except Exception:
            pass
    else:
        # Create new connection
        network = _detect_network(data.stb_no)
        new_conn = Connection(
            customer_id=data.customer_id,
            stb_no=data.stb_no,
            mso="GTPL",
            service_type="Cable",
            billing_type="Prepaid",
            status="Active",
            network=network,
            created_at=now,
        )
        db.add(new_conn)

    # Set customer back to Active
    cust_update = (
        update(Customer)
        .where(Customer.customer_id == data.customer_id)
        .values(status="Active")
    )
    cust_update = apply_op_filter(cust_update, Customer, current_user)
    db.execute(cust_update)

    # Remove STB from inventory (or mark as assigned)
    db.execute(
        update(StbInventory)
        .where(StbInventory.stb_no == data.stb_no)
        .values(status="assigned")
    )

    db.commit()
    return {
        "ok": True,
        "message": f"{cust.name} reconnected with STB {data.stb_no}. No installation charges applied.",
        "customer_id": data.customer_id,
        "stb_no": data.stb_no,
    }
