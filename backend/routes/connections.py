import json
import ssl
import asyncio
import urllib.request

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, update, func, text, and_
from sqlalchemy.orm import Session

from models.base import get_db
from deps_orm import get_current_user, require_role, apply_op_filter, op_id
from models.tables import (
    Connection, Customer, Plan, StbInventory,
    CustomerPlan, Payment, PaypakkaPayment, PaypakkaEmployee, SmsLog,
)
from audit import log_action

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

    # Remove STB from inventory if it exists there (mark as assigned)
    inv_stb = db.execute(
        select(StbInventory).where(StbInventory.stb_no == data.stb_no)
    ).scalar_one_or_none()
    if inv_stb:
        db.execute(
            update(StbInventory)
            .where(StbInventory.id == inv_stb.id)
            .values(status="assigned")
        )

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


# ── STB Swap with MSO Portal Sync ──────────────────────────────────────────

class SwapStbRequest(BaseModel):
    connection_id: int
    customer_id: str
    new_stb_no: str
    old_stb_notes: Optional[str] = None
    sync_portal: Optional[bool] = True


# GTPL portal daemon (available on local/LCO machine, NOT on Railway)
GTPL_DAEMON_URL = "http://localhost:8199"
GTPL_DAEMON_TOKEN = "gtpl_secret_2026"


def _gtpl_portal_call(endpoint: str, stb_no: str):
    """Call a GTPL daemon endpoint (suspend/activate) for a single STB.

    Returns parsed JSON dict on success. Raises on network/timeout failure so
    the caller can catch and degrade gracefully.
    """
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    url = f"{GTPL_DAEMON_URL}/{endpoint}"
    payload = json.dumps({"stb_no": str(stb_no)}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {GTPL_DAEMON_TOKEN}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))


@router.post("/connections/swap-stb")
def swap_stb(
    data: SwapStbRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Swap a customer's STB with a spare one AND sync the MSO portal.

    - Suspends the old STB and activates the new STB on the GTPL/TACTV portal.
    - Updates the DB connection + STB inventory regardless of portal outcome.
    - Portal failures are logged as warnings and never block the DB swap.
    - If suspend succeeded but activate failed, attempts to re-activate the
      old STB on the portal (rollback) so the customer isn't left disconnected.
    """
    # Role check: master blocked, admin/support allowed
    if current_user.get("role") == "master":
        raise HTTPException(
            status_code=403,
            detail="Master admin cannot swap STBs. Use an operator admin account.",
        )
    if current_user["role"] not in ("admin", "support"):
        raise HTTPException(status_code=403, detail="Not authorized")

    _opid = op_id(current_user)
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime.now(ist).strftime("%Y-%m-%d %H:%M:%S")

    # 1. Validate connection exists, is Active, belongs to customer
    conn_query = (
        select(Connection, Customer.name.label("customer_name"))
        .join(Customer, Connection.customer_id == Customer.customer_id)
        .where(
            Connection.id == data.connection_id,
            Connection.customer_id == data.customer_id,
        )
    )
    conn_query = apply_op_filter(conn_query, Customer, current_user)
    conn_result = db.execute(conn_query).first()

    if not conn_result:
        raise HTTPException(
            status_code=404,
            detail="Connection not found for this customer",
        )

    conn_obj, customer_name = conn_result
    if conn_obj.status != "Active":
        raise HTTPException(
            status_code=400,
            detail=f"Connection status is '{conn_obj.status}', only Active connections can be swapped",
        )

    # 2. Get old STB from connection
    old_stb = conn_obj.stb_no
    new_stb = data.new_stb_no.strip()

    if not new_stb:
        raise HTTPException(status_code=400, detail="new_stb_no is required")
    if old_stb == new_stb:
        raise HTTPException(
            status_code=400,
            detail="New STB is the same as the current STB — nothing to swap",
        )

    # 3. Detect MSO from new STB prefix
    detected = _detect_network(new_stb)

    # 4. Validate new STB is available in inventory (spare/available)
    inv_stb = db.execute(
        select(StbInventory).where(StbInventory.stb_no == new_stb)
    ).scalar_one_or_none()

    if inv_stb and inv_stb.status not in ("spare", "available"):
        raise HTTPException(
            status_code=400,
            detail=f"STB {new_stb} is in inventory as '{inv_stb.status}', not available for assignment",
        )

    # 5. Validate new STB is not assigned to another active customer
    in_use_query = (
        select(Customer.name, Customer.customer_id)
        .join(Connection, Connection.customer_id == Customer.customer_id)
        .where(
            Connection.stb_no == new_stb,
            Connection.status == "Active",
            Connection.id != data.connection_id,
        )
    )
    in_use_query = apply_op_filter(in_use_query, Customer, current_user)
    in_use = db.execute(in_use_query).first()
    if in_use:
        in_use_name, in_use_cust = in_use
        raise HTTPException(
            status_code=400,
            detail=f"STB {new_stb} is already assigned to {in_use_name} ({in_use_cust})",
        )

    # 6. Portal sync
    portal_sync = {
        "old_stb_suspended": False,
        "new_stb_activated": False,
        "warning": None,
    }

    if data.sync_portal:
        if detected == "GTPL":
            # Suspend old STB
            try:
                resp = _gtpl_portal_call("suspend", old_stb)
                if resp and resp.get("success"):
                    portal_sync["old_stb_suspended"] = True
                else:
                    portal_sync["warning"] = (
                        f"GTPL suspend non-success: "
                        f"{(resp or {}).get('message', 'unknown')}"
                    )
            except Exception:
                portal_sync["warning"] = (
                    "GTPL daemon not available - manual portal sync needed"
                )

            # Activate new STB
            try:
                resp = _gtpl_portal_call("activate", new_stb)
                if resp and resp.get("success"):
                    portal_sync["new_stb_activated"] = True
                else:
                    w = portal_sync["warning"]
                    extra = (
                        f"GTPL activate non-success: "
                        f"{(resp or {}).get('message', 'unknown')}"
                    )
                    portal_sync["warning"] = (w + " | " if w else "") + extra
            except Exception:
                if not portal_sync["warning"]:
                    portal_sync["warning"] = (
                        "GTPL daemon not available - manual portal sync needed"
                    )

        elif detected == "TACTV":
            try:
                from services.tactv_playwright import TACTVClient

                async def _tactv_swap():
                    client = TACTVClient()
                    try:
                        await client.login()
                        disc = await client.disconnect_stb(old_stb)
                        act = await client.activate_stb(new_stb)
                        return disc, act
                    finally:
                        await client.close()

                disc, act = asyncio.run(_tactv_swap())
                if disc.get("status") in ("deactivated", "already_deactive"):
                    portal_sync["old_stb_suspended"] = True
                else:
                    portal_sync["warning"] = (
                        f"TACTV disconnect {old_stb}: {disc.get('status')} - "
                        f"{disc.get('error') or disc.get('message', '')}"
                    )
                if act.get("status") in ("activated", "already_active"):
                    portal_sync["new_stb_activated"] = True
                else:
                    w = portal_sync["warning"]
                    extra = (
                        f"TACTV activate {new_stb}: {act.get('status')} - "
                        f"{act.get('error') or act.get('message', '')}"
                    )
                    portal_sync["warning"] = (w + " | " if w else "") + extra
            except Exception as e:
                portal_sync["warning"] = (
                    f"TACTV portal sync failed: {e} - manual portal sync needed"
                )

        elif detected == "SCV":
            portal_sync["warning"] = "SCV does not have portal automation"

        # 8. Rollback: if suspend succeeded but activate failed, re-activate old STB
        if portal_sync["old_stb_suspended"] and not portal_sync["new_stb_activated"]:
            if detected == "GTPL":
                try:
                    resp = _gtpl_portal_call("activate", old_stb)
                    if resp and resp.get("success"):
                        portal_sync["warning"] = (
                            (portal_sync["warning"] or "")
                            + " | Rolled back: re-activated old STB on GTPL"
                        )
                    else:
                        portal_sync["warning"] = (
                            (portal_sync["warning"] or "")
                            + " | Rollback FAILED: could not re-activate old STB on GTPL"
                        )
                except Exception:
                    portal_sync["warning"] = (
                        (portal_sync["warning"] or "")
                        + " | Rollback FAILED: GTPL daemon unreachable during re-activate"
                    )
            elif detected == "TACTV":
                try:
                    from services.tactv_playwright import TACTVClient

                    async def _tactv_reactivate():
                        client = TACTVClient()
                        try:
                            await client.login()
                            return await client.activate_stb(old_stb)
                        finally:
                            await client.close()

                    rb = asyncio.run(_tactv_reactivate())
                    if rb.get("status") in ("activated", "already_active"):
                        portal_sync["warning"] = (
                            (portal_sync["warning"] or "")
                            + " | Rolled back: re-activated old STB on TACTV"
                        )
                    else:
                        portal_sync["warning"] = (
                            (portal_sync["warning"] or "")
                            + f" | Rollback FAILED on TACTV: {rb.get('status')}"
                        )
                except Exception as e:
                    portal_sync["warning"] = (
                        (portal_sync["warning"] or "")
                        + f" | Rollback FAILED on TACTV: {e}"
                    )

    # 7. Database updates (always happen, even if portal sync failed)
    note_text = data.old_stb_notes or f"Exchanged from {data.customer_id}"

    # a. Update connection: stb_no, mso, network + audit note
    db.execute(
        update(Connection)
        .where(Connection.id == data.connection_id)
        .values(stb_no=new_stb, mso=detected, network=detected)
    )
    try:
        db.execute(
            update(Connection)
            .where(Connection.id == data.connection_id)
            .values(
                notes=(conn_obj.notes or "")
                + f"\n[STB Swap {now}: {old_stb} → {new_stb} ({detected})]",
                updated_at=now,
            )
        )
    except Exception:
        pass  # notes/updated_at columns optional

    # b. Remove new STB from inventory (mark as "assigned")
    if inv_stb:
        db.execute(
            update(StbInventory)
            .where(StbInventory.id == inv_stb.id)
            .values(status="assigned")
        )
    new_stb_removed = True

    # c. Add old STB to inventory as "faulty"
    old_inv = db.execute(
        select(StbInventory).where(StbInventory.stb_no == old_stb)
    ).scalar_one_or_none()
    cust_oid = _opid or 1
    if old_inv:
        db.execute(
            update(StbInventory)
            .where(StbInventory.id == old_inv.id)
            .values(
                status="faulty",
                notes=note_text,
                added_at=now,
                added_by=current_user.get("name"),
                operator_id=cust_oid,
            )
        )
    else:
        db.add(StbInventory(
            stb_no=old_stb,
            status="faulty",
            notes=note_text,
            added_at=now,
            added_by=current_user.get("name"),
            operator_id=cust_oid,
        ))

    db.commit()

    # Audit log
    log_action(
        action="SWAP_STB",
        entity="connection",
        entity_id=str(data.connection_id),
        old_value={"stb_no": old_stb},
        new_value={
            "stb_no": new_stb,
            "mso": detected,
            "portal_sync": portal_sync,
        },
        user=current_user,
    )

    # Create notification
    from routes.notifications import _create_notification
    status = "success" if (portal_sync["old_stb_suspended"] and portal_sync["new_stb_activated"]) else "warning"
    if portal_sync["warning"]:
        status = "error" if ("FAILED" in portal_sync["warning"]) else "warning"
    
    _create_notification(
        db,
        type="swap",
        title=f"STB Swapped: {old_stb} → {new_stb}",
        message=f"Customer {customer_name} ({data.customer_id}) - MSO: {detected}. "
                f"Old box suspended: {'✅' if portal_sync['old_stb_suspended'] else '❌'}. "
                f"New box activated: {'✅' if portal_sync['new_stb_activated'] else '❌'}",
        status=status,
        mso=detected,
        stb_no=new_stb,
        customer_id=data.customer_id,
        operator_id=_opid,
    )

    return {
        "ok": True,
        "message": "STB swapped successfully",
        "customer_id": data.customer_id,
        "old_stb": old_stb,
        "new_stb": new_stb,
        "mso": detected,
        "portal_sync": portal_sync,
        "inventory": {
            "old_stb_status": "faulty",
            "new_stb_removed": new_stb_removed,
        },
    }
