from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
import asyncio
import calendar

from deps import get_db, get_current_user, require_role, op_filter, op_id
from utils import get_current_month
from routes.notifications import notify_payment
from routes.settings import should_notify_payment

router = APIRouter(prefix="/api", tags=["Payments"])

# Broadcast channel for WebSocket notifications
import threading
_payment_listeners_lock = threading.Lock()
payment_listeners = []


class PaymentCreate(BaseModel):
    customer_id: str
    connection_id: Optional[int] = -1
    plan_id: Optional[int] = None
    amount: float
    payment_mode: Optional[str] = "Cash"
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
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _opf = op_filter(current_user)

        # Validate customer
        customer = conn.execute(
            f"SELECT * FROM customers WHERE customer_id = ? AND {_opf}", (data.customer_id,)
        ).fetchone()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")

        # Auto-detect connection_id if not provided (-1 = auto)
        if not data.connection_id or data.connection_id == -1:
            auto_conn = conn.execute(
                f"SELECT id FROM connections WHERE customer_id = ? AND status = 'Active' AND {_opf} ORDER BY id LIMIT 1",
                (data.customer_id,),
            ).fetchone()
            if auto_conn:
                data.connection_id = auto_conn["id"]
            else:
                raise HTTPException(status_code=400, detail="No active connection found for this customer")

        # Validate connection
        connection = conn.execute(
            f"SELECT * FROM connections WHERE id = ? AND customer_id = ? AND {_opf}",
            (data.connection_id, data.customer_id),
        ).fetchone()
        if not connection:
            raise HTTPException(status_code=404, detail="Connection not found")

        # Auto-fill month_year
        if not data.month_year:
            data.month_year = get_current_month()

        # Insert payment
        cursor = conn.execute(
            f"""INSERT INTO payments (customer_id, connection_id, plan_id, amount, payment_mode, collected_by, month_year, months_paid, notes, latitude, longitude, previous_balance, bill_amount, operator_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, {op_id(current_user) or 'NULL'})""",
            (
                data.customer_id,
                data.connection_id,
                data.plan_id,
                data.amount,
                data.payment_mode,
                current_user["id"],
                data.month_year,
                data.months_paid or 1,
                data.notes,
                data.latitude,
                data.longitude,
                data.previous_balance,
                data.bill_amount,
            ),
        )
        payment_id = cursor.lastrowid

        # Update customer plan expiry if plan provided
        if data.plan_id:
            plan = conn.execute(f"SELECT * FROM plans WHERE id = ? AND {_opf}", (data.plan_id,)).fetchone()
            if plan:
                # Deactivate old plans
                conn.execute(
                    "UPDATE customer_plans SET status = 'Expired' WHERE connection_id = ? AND status = 'Active'",
                    (data.connection_id,),
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

                conn.execute(
                    f"""INSERT INTO customer_plans (customer_id, connection_id, plan_id, amount, start_date, expiry_date, operator_id)
                       VALUES (?, ?, ?, ?, ?, ?, {op_id(current_user) or 'NULL'})""",
                    (data.customer_id, data.connection_id, plan["id"], plan["amount"], start_date, expiry_date),
                )

                # Also update connection expiry
                conn.execute(
                    "UPDATE connections SET expiry_date = ?, plan_name = ?, plan_amount = ? WHERE id = ?",
                    (expiry_date, plan["name"], plan["amount"], data.connection_id),
                )

        conn.commit()

        # Fetch the created payment with user info
        payment = conn.execute(
            f"""SELECT p.*, c.name as customer_name, c.phone as customer_phone, c.area as area, c.status as customer_status, u.name as collector_name
               FROM payments p
               JOIN customers c ON p.customer_id = c.customer_id
               LEFT JOIN users u ON p.collected_by = u.id
               WHERE p.id = ? AND {op_filter(current_user, 'p.')}""",
            (payment_id,),
        ).fetchone()

    # Notify WebSocket listeners (thread-safe)
    payment_data = dict(payment) if payment else {"id": payment_id}
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
    if payment:
        try:
            cust_status = payment.get("customer_status", "active")
            if should_notify_payment(cust_status):
                notify_payment(
                    customer_name=payment.get("customer_name", ""),
                    customer_id=data.customer_id,
                    amount=data.amount,
                    mode=data.payment_mode or "",
                    source="Local",
                    collector=payment.get("collector_name", ""),
                    area=payment.get("area", ""),
                )
        except Exception:
            pass  # notification failure should not break payment

    return payment_data


@router.get("/payments/history")
def payment_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    customer_id: Optional[str] = None,
    month_year: Optional[str] = None,
    collected_by: Optional[int] = None,
    current_user=Depends(get_current_user),
):
    with get_db() as conn:
        _opf = op_filter(current_user)
        query = f"""
            SELECT p.*, c.name as customer_name, c.phone as customer_phone, c.area as area,
                   u.name as collector_name, con.stb_no
            FROM payments p
            JOIN customers c ON p.customer_id = c.customer_id
            LEFT JOIN users u ON p.collected_by = u.id
            LEFT JOIN connections con ON p.connection_id = con.id
            WHERE {op_filter(current_user, 'p.')}
        """
        params = []

        if customer_id:
            query += " AND p.customer_id = ?"
        if month_year:
            query += " AND p.month_year = ?"
            params.append(month_year)
        if collected_by:
            query += " AND p.collected_by = ?"
            params.append(collected_by)

        # Count
        count_query = query.replace(
            "SELECT p.*, c.name as customer_name, c.phone as customer_phone, c.area as area,\n                   u.name as collector_name, con.stb_no",
            "SELECT COUNT(*)",
        )
        total = conn.execute(count_query, params).fetchone()[0]

        query += " ORDER BY p.collected_at DESC LIMIT ? OFFSET ?"
        params.extend([per_page, (page - 1) * per_page])

        rows = conn.execute(query, params).fetchall()

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "payments": [dict(r) for r in rows],
    }


@router.get("/payments/all")
def all_payment_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=10000),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    customer_id: Optional[str] = None,
    export: bool = Query(False),
    current_user=Depends(get_current_user),
):
    """Unified payment history merging Local + Paypakka payments with date filtering."""
    import calendar as cal

    with get_db() as conn:
        _opf = op_filter(current_user)

        # Default: current month (skip if customer_id filter is set with wide date range)
        now = datetime.now()
        if not date_from:
            date_from = f"{now.year}-{now.month:02d}-01"
        if not date_to:
            last_day = cal.monthrange(now.year, now.month)[1]
            date_to = f"{now.year}-{now.month:02d}-{last_day}"

        # Build local payments query
        local_query = f"""
            SELECT p.id, p.customer_id, p.amount, p.payment_mode, p.collected_at,
                   p.month_year, p.notes, p.latitude, p.longitude,
                   p.previous_balance, p.bill_amount, p.connection_id,
                   c.name as customer_name, c.area, c.phone as customer_phone,
                   u.name as collector_name, con.stb_no
            FROM payments p
            JOIN customers c ON p.customer_id = c.customer_id
            LEFT JOIN users u ON p.collected_by = u.id
            LEFT JOIN connections con ON p.connection_id = con.id
            WHERE DATE(p.collected_at) >= ? AND DATE(p.collected_at) <= ? AND {op_filter(current_user, 'p.')}
        """
        local_params = [date_from, date_to]
        if customer_id:
            local_query += " AND p.customer_id = ?"
            local_params.append(customer_id)
        local_rows = conn.execute(local_query, local_params).fetchall()

        # Build paypakka payments query
        pp_query = f"""
            SELECT pp.id, pp.customer_id, pp.collection_amount, pp.payment_type,
                   pp.paypakka_created_at, pp.bill_amount, pp.plan_amount,
                   pp.discount_amount, pp.status, pp.transaction_id,
                   c.name as customer_name, c.area, c.phone as customer_phone,
                   e.emp_name as collector_name,
                   (SELECT con.stb_no FROM connections con WHERE con.customer_id = pp.customer_id AND con.status = 'Active' AND {op_filter(current_user, 'con.')} LIMIT 1) as stb_no
            FROM paypakka_payments pp
            JOIN customers c ON pp.customer_id = c.customer_id
            LEFT JOIN paypakka_employees e ON pp.emp_ref_id = e.emp_ref_id
            WHERE DATE(pp.paypakka_created_at) >= ? AND DATE(pp.paypakka_created_at) <= ? AND {op_filter(current_user, 'pp.')}
        """
        pp_params = [date_from, date_to]
        if customer_id:
            pp_query += " AND pp.customer_id = ?"
            pp_params.append(customer_id)
        pp_rows = conn.execute(pp_query, pp_params).fetchall()

        # Merge into unified list
        all_payments = []

        for r in local_rows:
            all_payments.append({
                "id": r["id"],
                "source": "Local",
                "customer_id": r["customer_id"],
                "customer_name": r["customer_name"],
                "area": r["area"] or "",
                "amount": r["amount"],
                "payment_mode": r["payment_mode"] or "Cash",
                "date": r["collected_at"],
                "collector": r["collector_name"] or "",
                "month_year": r["month_year"] or "",
                "stb_no": r["stb_no"] or "",
                "latitude": r["latitude"],
                "longitude": r["longitude"],
                "previous_balance": r["previous_balance"] or 0,
                "bill_amount": r["bill_amount"] or 0,
                "deletable": True,
            })

        for r in pp_rows:
            all_payments.append({
                "id": r["id"],
                "source": "Paypakka",
                "customer_id": r["customer_id"],
                "customer_name": r["customer_name"],
                "area": r["area"] or "",
                "amount": r["collection_amount"],
                "payment_mode": (r["payment_type"] or "cash").title(),
                "date": r["paypakka_created_at"],
                "collector": r["collector_name"] or "",
                "month_year": "",
                "stb_no": r["stb_no"] or "",
                "latitude": None,
                "longitude": None,
                "previous_balance": 0,
                "bill_amount": r["bill_amount"] or 0,
                "deletable": False,
                "transaction_id": r["transaction_id"] or "",
                "plan_amount": r["plan_amount"] or 0,
                "discount_amount": r["discount_amount"] or 0,
            })

        # Sort by date descending
        all_payments.sort(key=lambda x: x.get("date") or "", reverse=True)

        total = len(all_payments)

        # Export mode: return all payments, no pagination
        if export:
            return {"total": total, "payments": all_payments, "date_from": date_from, "date_to": date_to}

        total_pages = max(1, (total + per_page - 1) // per_page)
        start = (page - 1) * per_page
        page_items = all_payments[start:start + per_page]

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages,
        "date_from": date_from,
        "date_to": date_to,
        "payments": page_items,
    }


@router.delete("/payments/{payment_id}")
def delete_payment(payment_id: int, current_user: dict = Depends(require_role("admin"))):
    with get_db() as conn:
        _opf = op_filter(current_user)

        # Fetch payment to delete
        payment = conn.execute(
            f"SELECT * FROM payments WHERE id = ? AND {_opf}", (payment_id,)
        ).fetchone()
        if not payment:
            raise HTTPException(status_code=404, detail="Payment not found")

        customer_id = payment["customer_id"]
        connection_id = payment["connection_id"]

        # Get current expiry before deletion
        old_expiry = None
        cust_plan = conn.execute(
            f"SELECT * FROM customer_plans WHERE customer_id = ? AND connection_id = ? AND status = 'Active' AND {_opf} LIMIT 1",
            (customer_id, connection_id),
        ).fetchone()
        if cust_plan:
            old_expiry = cust_plan["expiry_date"]

        # Delete the payment
        conn.execute(f"DELETE FROM payments WHERE id = ? AND {_opf}", (payment_id,))

        # Count remaining LOCAL payments for this customer's connection
        remaining = conn.execute(
            f"SELECT id, month_year, collected_at FROM payments WHERE customer_id = ? AND connection_id = ? AND {_opf} ORDER BY collected_at ASC",
            (customer_id, connection_id),
        ).fetchall()

        new_expiry = old_expiry  # default: no change

        if remaining:
            # Recalculate expiry: count unique months paid
            months_paid = set()
            for p in remaining:
                my = p["month_year"]  # format: "04-2026"
                if my:
                    months_paid.add(my)

            num_months = len(months_paid) if months_paid else 1

            # Find the earliest payment date to base expiry from
            earliest = remaining[0]
            earliest_date = datetime.strptime(earliest["collected_at"][:10], "%Y-%m-%d")

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
                conn.execute(
                    "UPDATE customer_plans SET expiry_date = ? WHERE id = ?",
                    (new_expiry, cust_plan["id"]),
                )

            # Update connections expiry_date
            conn.execute(
                "UPDATE connections SET expiry_date = ? WHERE id = ?",
                (new_expiry, connection_id),
            )
        else:
            # No payments left — clear expiry (can't determine old value for prepaid)
            new_expiry = None

            if cust_plan:
                # Set expiry to start_date (effectively expired) since NOT NULL
                conn.execute(
                    "UPDATE customer_plans SET status = 'Expired', expiry_date = start_date WHERE id = ?",
                    (cust_plan["id"],),
                )

            conn.execute(
                "UPDATE connections SET expiry_date = NULL WHERE id = ?",
                (connection_id,),
            )

        conn.commit()

        return {
            "message": "Payment deleted successfully",
            "old_expiry": old_expiry,
            "new_expiry": new_expiry,
            "remaining_payments": len(remaining),
        }

