from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import calendar
import threading

from sqlalchemy import select, update, func, text, or_, and_
from sqlalchemy.orm import Session

from models.base import get_db
from deps_orm import get_current_user, require_role, apply_op_filter, op_id
from models.tables import (
    Payment, Customer, Connection, PaypakkaPayment,
    CustomerPlan, Plan, User, PaypakkaEmployee,
)
from utils import get_current_month
from routes.notifications import notify_payment
from routes.settings import should_notify_payment
from routes.wa_notify import send_payment_receipt
from audit import log_action

router = APIRouter(prefix="/api", tags=["Payments"])

# Broadcast channel for WebSocket notifications
_payment_listeners_lock = threading.Lock()
payment_listeners = []


def _obj_to_dict(obj):
    """Convert a SQLAlchemy model instance to a dict."""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


class PaymentCreate(BaseModel):
    customer_id: str
    connection_id: Optional[int] = -1
    plan_id: Optional[int] = None
    amount: float
    payment_mode: Optional[str] = "Cash"
    payment_type: Optional[str] = "regular"  # regular, new_connection, reconnection
    month_year: Optional[str] = None
    months_paid: Optional[int] = 1
    notes: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    previous_balance: Optional[float] = 0
    bill_amount: Optional[float] = 0


@router.post("/payments", status_code=201)
def create_payment(
    data: PaymentCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Validate customer
    cust_query = select(Customer).where(Customer.customer_id == data.customer_id)
    cust_query = apply_op_filter(cust_query, Customer, current_user)
    customer = db.execute(cust_query).scalar_one_or_none()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")

    # Auto-detect connection_id if not provided (-1 = auto)
    if not data.connection_id or data.connection_id == -1:
        conn_query = select(Connection).where(
            Connection.customer_id == data.customer_id,
            Connection.status == "Active",
        )
        conn_query = apply_op_filter(conn_query, Connection, current_user)
        conn_query = conn_query.order_by(Connection.id).limit(1)
        auto_conn = db.execute(conn_query).scalar_one_or_none()
        if auto_conn:
            data.connection_id = auto_conn.id
        else:
            raise HTTPException(status_code=400, detail="No active connection found for this customer")

    # Validate connection
    conn_query = select(Connection).where(
        Connection.id == data.connection_id,
        Connection.customer_id == data.customer_id,
    )
    conn_query = apply_op_filter(conn_query, Connection, current_user)
    connection = db.execute(conn_query).scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")
    connection_dict = _obj_to_dict(connection)

    # Auto-fill month_year
    if not data.month_year:
        data.month_year = get_current_month()

    # Insert payment
    payment = Payment(
        customer_id=data.customer_id,
        connection_id=data.connection_id,
        plan_id=data.plan_id,
        amount=data.amount,
        payment_mode=data.payment_mode,
        payment_type=data.payment_type or "regular",
        collected_by=current_user["id"],
        month_year=data.month_year,
        months_paid=data.months_paid or 1,
        notes=data.notes,
        latitude=data.latitude,
        longitude=data.longitude,
        previous_balance=data.previous_balance,
        bill_amount=data.bill_amount,
        operator_id=op_id(current_user),
    )
    db.add(payment)
    db.flush()
    payment_id = payment.id

    # Update customer plan expiry if plan provided
    expiry_date = connection_dict.get("expiry_date")
    plan = None
    if data.plan_id:
        plan_query = select(Plan).where(Plan.id == data.plan_id)
        plan_query = apply_op_filter(plan_query, Plan, current_user)
        plan_obj = db.execute(plan_query).scalar_one_or_none()
        if plan_obj:
            plan = _obj_to_dict(plan_obj)
            # Deactivate old plans
            db.execute(
                update(CustomerPlan)
                .where(
                    CustomerPlan.connection_id == data.connection_id,
                    CustomerPlan.status == "Active",
                )
                .values(status="Expired")
            )
            months = data.months_paid or 1
            start_date = datetime.now().strftime("%Y-%m-%d")

            # Calculate expiry: last day of the Nth month from now
            now = datetime.now()
            expiry_month = now.month + months
            expiry_year = now.year
            while expiry_month > 12:
                expiry_month -= 12
                expiry_year += 1
            last_day = calendar.monthrange(expiry_year, expiry_month)[1]
            expiry_date = f"{expiry_year}-{expiry_month:02d}-{last_day}"

            new_cp = CustomerPlan(
                customer_id=data.customer_id,
                connection_id=data.connection_id,
                plan_id=plan["id"],
                amount=plan["amount"],
                start_date=start_date,
                expiry_date=expiry_date,
                operator_id=op_id(current_user),
            )
            db.add(new_cp)

            # Also update connection expiry
            db.execute(
                update(Connection)
                .where(Connection.id == data.connection_id)
                .values(expiry_date=expiry_date, plan_name=plan["name"], plan_amount=plan["amount"])
            )

    db.commit()

    # Audit log
    log_action("payment_create", "payments", str(payment_id),
               new_value={"customer_id": data.customer_id, "amount": data.amount,
                          "mode": data.payment_mode, "month": data.month_year},
               user=current_user)

    # Fetch the created payment with user info
    result = db.execute(
        select(Payment, Customer, User)
        .join(Customer, Payment.customer_id == Customer.customer_id)
        .join(User, Payment.collected_by == User.id, isouter=True)
        .where(Payment.id == payment_id)
    ).fetchone()

    # Build payment_data dict
    if result:
        p_obj, c_obj, u_obj = result
        payment_data = _obj_to_dict(p_obj)
        payment_data["customer_name"] = c_obj.name
        payment_data["customer_phone"] = c_obj.phone
        payment_data["area"] = c_obj.area
        payment_data["customer_status"] = c_obj.status
        payment_data["collector_name"] = u_obj.name if u_obj else None
    else:
        payment_data = {"id": payment_id}

    # Notify WebSocket listeners (thread-safe)
    with _payment_listeners_lock:
        for queue in payment_listeners:
            try:
                queue.put_nowait({
                    "type": "payment_received",
                    "data": payment_data,
                })
            except Exception:
                pass

    # Send Telegram notification (based on settings)
    if result:
        try:
            cust_status = payment_data.get("customer_status", "active")
            if should_notify_payment(cust_status):
                notify_payment(
                    customer_name=payment_data.get("customer_name", ""),
                    customer_id=data.customer_id,
                    amount=data.amount,
                    mode=data.payment_mode or "",
                    source="Local",
                    collector=payment_data.get("collector_name", ""),
                    area=payment_data.get("area", ""),
                )
        except Exception:
            pass  # notification failure should not break payment

    # Send WhatsApp payment receipt to customer
    if result:
        try:
            send_payment_receipt(
                customer_name=payment_data.get("customer_name", ""),
                phone=payment_data.get("customer_phone", ""),
                amount=data.amount,
                month_year=data.month_year or "",
                plan_name=plan.get("name") if plan else None,
                payment_mode=data.payment_mode,
                collector_name=payment_data.get("collector_name", ""),
                expiry_date=expiry_date,
            )
        except Exception:
            pass  # WA receipt failure should not break payment

    # Push notification: Reconnection alert for disconnected customers
    if result:
        try:
            from routes.push import send_push_to_roles
            conn_status = (connection_dict.get("status") or "").lower() if connection_dict else ""
            was_disconnected = conn_status in ("disconnected", "suspended", "inactive")
            is_reconnection = (data.payment_type or "regular") == "reconnection"
            if was_disconnected or is_reconnection:
                send_push_to_roles(
                    ["admin", "support"],
                    title="🔌 Reconnection Payment",
                    body=f"{payment_data.get('customer_name', '')} ({data.customer_id}) paid ₹{data.amount:,.0f} — reconnect now!",
                    tag="reconnection",
                    data={"url": "/", "customer_id": data.customer_id}
                )
        except Exception:
            pass

    return payment_data


@router.get("/payments/history")
def payment_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    customer_id: Optional[str] = None,
    month_year: Optional[str] = None,
    collected_by: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Base query with JOINs
    query = (
        select(Payment, Customer, User, Connection)
        .join(Customer, Payment.customer_id == Customer.customer_id)
        .join(User, Payment.collected_by == User.id, isouter=True)
        .join(Connection, Payment.connection_id == Connection.id, isouter=True)
        .where(or_(Payment.deleted.is_(None), Payment.deleted == 0))
    )

    # Agents can only see their own collected payments
    if current_user.get("role") in ("service_agent", "collection_agent", "agent"):
        query = query.where(Payment.collected_by == current_user["id"])

    if customer_id:
        query = query.where(Payment.customer_id == customer_id)
    if month_year:
        query = query.where(Payment.month_year == month_year)
    if collected_by:
        query = query.where(Payment.collected_by == collected_by)

    # Count query (separate for efficiency)
    count_query = (
        select(func.count())
        .select_from(Payment)
        .where(or_(Payment.deleted.is_(None), Payment.deleted == 0))
    )
    if current_user.get("role") in ("service_agent", "collection_agent", "agent"):
        count_query = count_query.where(Payment.collected_by == current_user["id"])
    if customer_id:
        count_query = count_query.where(Payment.customer_id == customer_id)
    if month_year:
        count_query = count_query.where(Payment.month_year == month_year)
    if collected_by:
        count_query = count_query.where(Payment.collected_by == collected_by)

    total = db.execute(count_query).scalar()

    query = query.order_by(Payment.collected_at.desc()).limit(per_page).offset((page - 1) * per_page)
    rows = db.execute(query).fetchall()

    payments = []
    for row in rows:
        p_obj, c_obj, u_obj, con_obj = row
        d = _obj_to_dict(p_obj)
        d["customer_name"] = c_obj.name
        d["customer_phone"] = c_obj.phone
        d["area"] = c_obj.area
        d["collector_name"] = u_obj.name if u_obj else None
        d["stb_no"] = con_obj.stb_no if con_obj else None
        payments.append(d)

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "payments": payments,
    }


@router.get("/payments/all")
def all_payment_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=10000),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    customer_id: Optional[str] = None,
    q: Optional[str] = None,
    mso: Optional[str] = None,
    export: bool = Query(False),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Unified payment history merging Local + Paypakka payments with date filtering."""
    import traceback

    try:
        # Default: current month
        now = datetime.now()
        if not date_from:
            date_from = f"{now.year}-{now.month:02d}-01"
        if not date_to:
            last_day = calendar.monthrange(now.year, now.month)[1]
            date_to = f"{now.year}-{now.month:02d}-{last_day}"

        # ── Local payments (text() bridge for complex multi-table join) ──────
        local_sql = """
            SELECT p.id, p.customer_id, p.amount, p.payment_mode, p.payment_type, p.collected_at,
                   p.month_year, p.notes, p.latitude, p.longitude,
                   p.previous_balance, p.bill_amount, p.connection_id,
                   c.name as customer_name, c.area, c.phone as customer_phone,
                   u.name as collector_name, con.stb_no, con.mso
            FROM payments p
            JOIN customers c ON p.customer_id = c.customer_id
            LEFT JOIN users u ON p.collected_by = u.id
            LEFT JOIN connections con ON p.connection_id = con.id
            WHERE (p.deleted IS NULL OR p.deleted = 0)
              AND DATE(p.collected_at) >= :date_from AND DATE(p.collected_at) <= :date_to
        """
        local_params: dict = {"date_from": date_from, "date_to": date_to}
        # Agents can only see their own collected payments
        if current_user.get("role") in ("service_agent", "collection_agent", "agent"):
            local_sql += " AND p.collected_by = :agent_id"
            local_params["agent_id"] = current_user["id"]
        if customer_id:
            local_sql += " AND p.customer_id = :cust_id"
            local_params["cust_id"] = customer_id
        if mso:
            local_sql += " AND con.mso = :mso"
            local_params["mso"] = mso
        local_rows = db.execute(text(local_sql), local_params).fetchall()

        # ── Paypakka payments (text() bridge) ───────────────────────────────
        pp_sql = """
            SELECT pp.id, pp.customer_id, pp.collection_amount, pp.payment_type,
                   pp.paypakka_created_at, pp.bill_amount, pp.plan_amount,
                   pp.discount_amount, pp.status, pp.transaction_id,
                   c.name as customer_name, c.area, c.phone as customer_phone,
                   e.emp_name as collector_name,
                   (SELECT con.stb_no FROM connections con WHERE con.customer_id = pp.customer_id AND con.status = 'Active' LIMIT 1) as stb_no,
                   (SELECT con.mso FROM connections con WHERE con.customer_id = pp.customer_id AND con.status = 'Active' LIMIT 1) as mso
            FROM paypakka_payments pp
            JOIN customers c ON pp.customer_id = c.customer_id
            LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
            WHERE DATE(pp.paypakka_created_at) >= :date_from AND DATE(pp.paypakka_created_at) <= :date_to
        """
        pp_params: dict = {"date_from": date_from, "date_to": date_to}
        if current_user.get("role") in ("service_agent", "collection_agent", "agent"):
            pp_sql += " AND pp.emp_ref_id IN (SELECT emp_ref_id FROM paypakka_employees WHERE emp_name = (SELECT name FROM users WHERE id = :agent_user_id))"
            pp_params["agent_user_id"] = current_user["id"]
        if customer_id:
            pp_sql += " AND pp.customer_id = :cust_id"
            pp_params["cust_id"] = customer_id
        if mso:
            pp_sql += " AND pp.customer_id IN (SELECT customer_id FROM connections WHERE mso = :mso)"
            pp_params["mso"] = mso
        pp_rows = db.execute(text(pp_sql), pp_params).fetchall()

        # ── Merge into unified list ─────────────────────────────────────────
        all_payments = []

        for r in local_rows:
            m = r._mapping
            all_payments.append({
                "id": m["id"],
                "source": "Local",
                "customer_id": m["customer_id"],
                "customer_name": m["customer_name"],
                "customer_phone": m["customer_phone"] or "",
                "area": m["area"] or "",
                "amount": m["amount"],
                "payment_mode": m["payment_mode"] or "Cash",
                "date": m["collected_at"],
                "collector": m["collector_name"] or "",
                "month_year": m["month_year"] or "",
                "stb_no": m["stb_no"] or "",
                "latitude": m["latitude"],
                "longitude": m["longitude"],
                "previous_balance": m["previous_balance"] or 0,
                "bill_amount": m["bill_amount"] or 0,
                "deletable": current_user.get("role") in ("admin",),
                "payment_type": m["payment_type"] or "regular",
                "mso": m["mso"] or "",
            })

        for r in pp_rows:
            m = r._mapping
            all_payments.append({
                "id": m["id"],
                "source": "Paypakka",
                "customer_id": m["customer_id"],
                "customer_name": m["customer_name"],
                "customer_phone": m["customer_phone"] or "",
                "area": m["area"] or "",
                "amount": m["collection_amount"],
                "payment_mode": (m["payment_type"] or "cash").title(),
                "date": m["paypakka_created_at"],
                "collector": m["collector_name"] or "",
                "month_year": "",
                "stb_no": m["stb_no"] or "",
                "latitude": None,
                "longitude": None,
                "previous_balance": 0,
                "bill_amount": m["bill_amount"] or 0,
                "deletable": False,
                "transaction_id": m["transaction_id"] or "",
                "plan_amount": m["plan_amount"] or 0,
                "discount_amount": m["discount_amount"] or 0,
                "payment_type": "regular",
                "mso": m["mso"] or "",
            })

        # Sort by date descending
        all_payments.sort(key=lambda x: x.get("date") or "", reverse=True)

        # Search filter (name, customer_id, stb_no, phone)
        if q:
            ql = q.lower()
            all_payments = [p for p in all_payments if
                ql in (p.get("customer_name") or "").lower() or
                ql in (p.get("customer_id") or "").lower() or
                ql in (p.get("stb_no") or "") or
                ql in (p.get("customer_phone") or "")]

        total = len(all_payments)
        total_amount = sum(p.get("amount", 0) or 0 for p in all_payments)

        # Export mode: return all payments, no pagination
        if export:
            return {"total": total, "total_amount": total_amount, "payments": all_payments, "date_from": date_from, "date_to": date_to}

        total_pages = max(1, (total + per_page - 1) // per_page)
        start = (page - 1) * per_page
        page_items = all_payments[start:start + per_page]

        return {
            "total": total,
            "total_amount": total_amount,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
            "date_from": date_from,
            "date_to": date_to,
            "payments": page_items,
        }
    except Exception as e:
        import sys
        print(f"PAYMENTS/ALL ERROR: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")


@router.delete("/payments/{payment_id}")
def delete_payment(
    payment_id: int,
    reason: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_role("admin")),
):
    # Fetch payment to delete (exclude already-deleted)
    payment_query = select(Payment).where(
        Payment.id == payment_id,
        or_(Payment.deleted.is_(None), Payment.deleted == 0),
    )
    payment_query = apply_op_filter(payment_query, Payment, current_user)
    payment = db.execute(payment_query).scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    customer_id = payment.customer_id
    connection_id = payment.connection_id

    # Snapshot before deletion for audit
    payment_snapshot = _obj_to_dict(payment)

    # Get current expiry before deletion
    cp_query = select(CustomerPlan).where(
        CustomerPlan.customer_id == customer_id,
        CustomerPlan.connection_id == connection_id,
        CustomerPlan.status == "Active",
    )
    cp_query = apply_op_filter(cp_query, CustomerPlan, current_user)
    cust_plan = db.execute(cp_query.limit(1)).scalar_one_or_none()

    old_expiry = None
    if cust_plan:
        old_expiry = cust_plan.expiry_date

    # Soft-delete the payment
    db.execute(
        update(Payment)
        .where(Payment.id == payment_id)
        .values(
            deleted=1,
            deleted_by=current_user["id"],
            deleted_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            delete_reason=reason or "",
        )
    )

    # Audit log
    log_action("payment_delete", "payments", str(payment_id),
               old_value=payment_snapshot,
               new_value={"reason": reason, "deleted_by": current_user.get("name")},
               user=current_user)

    # Count remaining LOCAL payments for this customer's connection (exclude soft-deleted)
    remaining_query = select(Payment).where(
        Payment.customer_id == customer_id,
        Payment.connection_id == connection_id,
        or_(Payment.deleted.is_(None), Payment.deleted == 0),
    )
    remaining_query = apply_op_filter(remaining_query, Payment, current_user)
    remaining_query = remaining_query.order_by(Payment.collected_at.asc())
    remaining = db.execute(remaining_query).scalars().all()

    new_expiry = old_expiry  # default: no change

    if remaining:
        # Recalculate expiry: count unique months paid
        months_paid = set()
        for p in remaining:
            my = p.month_year  # format: "04-2026"
            if my:
                months_paid.add(my)

        num_months = len(months_paid) if months_paid else 1

        # Find the earliest payment date to base expiry from
        earliest = remaining[0]
        earliest_date = datetime.strptime(earliest.collected_at[:10], "%Y-%m-%d")

        # Expiry = last day of (earliest_month + num_months - 1)
        exp_month = earliest_date.month + num_months - 1
        exp_year = earliest_date.year
        while exp_month > 12:
            exp_month -= 12
            exp_year += 1

        last_day = calendar.monthrange(exp_year, exp_month)[1]
        new_expiry = f"{exp_year}-{exp_month:02d}-{last_day:02d}"

        # Update customer_plans expiry
        if cust_plan:
            db.execute(
                update(CustomerPlan)
                .where(CustomerPlan.id == cust_plan.id)
                .values(expiry_date=new_expiry)
            )

        # Update connections expiry_date
        db.execute(
            update(Connection)
            .where(Connection.id == connection_id)
            .values(expiry_date=new_expiry)
        )
    else:
        # No payments left — clear expiry
        new_expiry = None

        if cust_plan:
            # Set expiry to start_date (effectively expired) since NOT NULL
            db.execute(
                update(CustomerPlan)
                .where(CustomerPlan.id == cust_plan.id)
                .values(status="Expired", expiry_date=cust_plan.start_date)
            )

        db.execute(
            update(Connection)
            .where(Connection.id == connection_id)
            .values(expiry_date=None)
        )

    db.commit()

    return {
        "message": "Payment deleted successfully",
        "old_expiry": old_expiry,
        "new_expiry": new_expiry,
        "remaining_payments": len(remaining),
    }
