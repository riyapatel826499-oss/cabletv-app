"""Customer portal — mobile+PIN auth, dashboard, payments, complaints."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from datetime import datetime
from typing import Optional
import hashlib
import hmac

from models.base import get_db
from deps_orm import get_current_customer, create_token, create_token
from utils import (
    hash_password, verify_password, needs_rehash,
    normalize_phone, find_customer_by_phone,
    get_current_month,
)
from config import RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, PIN_LENGTH
from limiter import limiter

router = APIRouter(prefix="/api/portal", tags=["Customer Portal"])


# ── Pydantic Models ──────────────────────────────────────────────────────────

class PortalLoginRequest(BaseModel):
    customer_id: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: Optional[str] = ""
    new_password: str


class ComplaintCreate(BaseModel):
    subject: str
    description: str
    priority: Optional[str] = "normal"


class ComplaintUpdate(BaseModel):
    subject: Optional[str] = None
    description: Optional[str] = None


class InitiatePaymentRequest(BaseModel):
    amount: float


class VerifyPaymentRequest(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str
    amount: float


class MobileVerifyRequest(BaseModel):
    mobile: str


class SetPinRequest(BaseModel):
    customer_id: str
    mobile: str
    pin: str


class LoginPinRequest(BaseModel):
    mobile: str
    pin: str


class RegisterRequest(BaseModel):
    customer_id: str
    phone: str
    new_password: str


# ── Password-Based Login ────────────────────────────────────────────────────

@router.post("/login")
@limiter.limit("5/minute")
def portal_login(request: Request, body: PortalLoginRequest):
    """Customer login via customer_id + password (bcrypt, auto-migrates legacy SHA256)."""
    with get_db() as conn:
        customer = conn.execute(
            "SELECT customer_id, name, phone, area FROM customers WHERE customer_id = ?",
            (body.customer_id,),
        ).fetchone()
        if not customer:
            raise HTTPException(status_code=401, detail="Invalid Customer ID")

        auth = conn.execute(
            "SELECT id, password FROM customer_auth WHERE customer_id = ?",
            (customer["customer_id"],),
        ).fetchone()
        if not auth or not auth["password"]:
            raise HTTPException(
                status_code=401,
                detail="Account not set up. Please contact support to register.",
            )

        if not verify_password(body.password, auth["password"]):
            raise HTTPException(status_code=401, detail="Incorrect password")

        # Auto-upgrade legacy SHA256 → bcrypt
        if needs_rehash(auth["password"]):
            conn.execute(
                "UPDATE customer_auth SET password = ? WHERE customer_id = ?",
                (hash_password(body.password), customer["customer_id"]),
            )
            conn.commit()

    access_token = create_token(
        subject=customer["customer_id"],
        token_type="customer",
    )
    return {
        "access_token": access_token,
        "customer": {
            "customer_id": customer["customer_id"],
            "name": customer["name"],
            "phone": customer["phone"],
            "area": customer["area"] if "area" in customer.keys() else None,
        },
    }


# ── PIN-Based Customer Auth (Mobile + 4-digit PIN, no OTP/SMS) ─────────────

@router.post("/customer/mobile-verify")
@limiter.limit("3/minute")
def customer_mobile_verify(request: Request, body: MobileVerifyRequest):
    """Step 1: Verify mobile exists. Returns customer_id, name, has_pin."""
    mobile = body.mobile.strip()
    if len(mobile) != 10 or not mobile.isdigit():
        raise HTTPException(status_code=400, detail="Enter valid 10-digit mobile number")

    with get_db() as conn:
        customer = find_customer_by_phone(conn, mobile)
        if not customer:
            raise HTTPException(
                status_code=404,
                detail="Mobile number not found. Please contact us to register.",
            )
        if customer["status"] not in ("Active",):
            raise HTTPException(
                status_code=400,
                detail=f"Account is {customer['status']}. Please contact support.",
            )

        auth = conn.execute(
            "SELECT pin FROM customer_auth WHERE customer_id = ?",
            (customer["customer_id"],),
        ).fetchone()

    has_pin = bool(auth and auth["pin"])
    return {
        "customer_id": customer["customer_id"],
        "name": customer["name"],
        "mobile": mobile,
        "has_pin": has_pin,
    }


@router.post("/customer/set-pin")
@limiter.limit("3/minute")
def customer_set_pin(request: Request, body: SetPinRequest):
    """Step 2 (first time): Set a 4-digit PIN. bcrypt hashed."""
    if len(body.pin) != PIN_LENGTH or not body.pin.isdigit():
        raise HTTPException(
            status_code=400,
            detail=f"PIN must be exactly {PIN_LENGTH} digits",
        )

    with get_db() as conn:
        # Verify customer + mobile match
        clean_mobile = normalize_phone(body.mobile)
        customer = conn.execute(
            """SELECT customer_id, name, phone, status FROM customers
               WHERE customer_id = ?
                 AND (REPLACE(REPLACE(phone, '+91', ''), ' ', '') = ?
                      OR REPLACE(REPLACE(phone2, '+91', ''), ' ', '') = ?)""",
            (body.customer_id, clean_mobile, clean_mobile),
        ).fetchone()

        if not customer:
            raise HTTPException(status_code=400, detail="Customer verification failed")
        if customer["status"] != "Active":
            raise HTTPException(status_code=400, detail=f"Account is {customer['status']}")

        existing = conn.execute(
            "SELECT id, pin FROM customer_auth WHERE customer_id = ?",
            (body.customer_id,),
        ).fetchone()

        if existing and existing["pin"]:
            raise HTTPException(status_code=400, detail="PIN already set. Use login instead.")

        pin_hash = hash_password(body.pin)  # bcrypt
        now = datetime.utcnow().isoformat()

        if existing:
            conn.execute(
                "UPDATE customer_auth SET pin = ? WHERE customer_id = ?",
                (pin_hash, body.customer_id),
            )
        else:
            conn.execute(
                "INSERT INTO customer_auth (customer_id, phone, pin, created_at) VALUES (?, ?, ?, ?)",
                (body.customer_id, body.mobile, pin_hash, now),
            )
        conn.commit()

    access_token = create_token(
        subject=customer["customer_id"],
        token_type="customer",
    )
    return {
        "token": access_token,
        "customer": {
            "customer_id": customer["customer_id"],
            "name": customer["name"],
            "mobile": body.mobile,
        },
        "message": "PIN set successfully",
    }


@router.post("/customer/login-pin")
@limiter.limit("5/minute")
def customer_login_pin(request: Request, body: LoginPinRequest):
    """Step 2 (returning): Login with mobile + PIN. bcrypt verified."""
    mobile = body.mobile.strip()
    pin = body.pin.strip()

    if len(mobile) != 10 or not mobile.isdigit():
        raise HTTPException(status_code=400, detail="Enter valid 10-digit mobile number")
    if len(pin) != PIN_LENGTH or not pin.isdigit():
        raise HTTPException(
            status_code=400,
            detail=f"Enter valid {PIN_LENGTH}-digit PIN",
        )

    with get_db() as conn:
        customer = find_customer_by_phone(conn, mobile)
        if not customer:
            raise HTTPException(status_code=404, detail="Mobile number not found")
        if customer["status"] != "Active":
            raise HTTPException(status_code=400, detail=f"Account is {customer['status']}")

        auth = conn.execute(
            "SELECT pin FROM customer_auth WHERE customer_id = ?",
            (customer["customer_id"],),
        ).fetchone()

    if not auth or not auth["pin"]:
        raise HTTPException(status_code=400, detail="PIN not set. Please register first.")

    if not verify_password(pin, auth["pin"]):  # bcrypt + legacy SHA256 fallback
        raise HTTPException(status_code=401, detail="Incorrect PIN")

    access_token = create_token(
        subject=customer["customer_id"],
        token_type="customer",
    )
    return {
        "access_token": access_token,
        "customer": {
            "customer_id": customer["customer_id"],
            "name": customer["name"],
            "mobile": mobile,
            "phone": customer["phone"],
        },
    }


# ── Registration ─────────────────────────────────────────────────────────────

@router.post("/register")
@limiter.limit("3/minute")
def portal_register(request: Request, body: RegisterRequest):
    """First-time registration: customer sets password. bcrypt hashed."""
    with get_db() as conn:
        customer = conn.execute(
            "SELECT customer_id, name, phone, area FROM customers WHERE customer_id = ? AND phone = ?",
            (body.customer_id, body.phone),
        ).fetchone()
        if not customer:
            raise HTTPException(
                status_code=400,
                detail="Customer ID and Phone number do not match.",
            )

        existing = conn.execute(
            "SELECT id FROM customer_auth WHERE customer_id = ? AND password IS NOT NULL",
            (body.customer_id,),
        ).fetchone()
        if existing:
            raise HTTPException(
                status_code=400,
                detail="Account already registered. Please use Login instead.",
            )

        pw_hash = hash_password(body.new_password)  # bcrypt
        conn.execute(
            "INSERT OR REPLACE INTO customer_auth (customer_id, phone, password, created_at) VALUES (?, ?, ?, ?)",
            (customer["customer_id"], customer["phone"], pw_hash, datetime.utcnow().isoformat()),
        )
        conn.commit()

    access_token = create_token(
        subject=customer["customer_id"],
        token_type="customer",
    )
    return {
        "access_token": access_token,
        "customer": {
            "customer_id": customer["customer_id"],
            "name": customer["name"],
            "phone": customer["phone"],
            "area": customer["area"] if "area" in customer.keys() else None,
        },
        "message": "Registration successful",
    }


# ── Profile ──────────────────────────────────────────────────────────────────

@router.get("/me")
def portal_me(customer=Depends(get_current_customer)):
    customer_id = customer["customer_id"]
    with get_db() as conn:
        cust = conn.execute(
            "SELECT customer_id, name, phone, phone2, address, area, city, pincode, status FROM customers WHERE customer_id = ?",
            (customer_id,),
        ).fetchone()
        connections = conn.execute(
            "SELECT stb_no, can_id, mso, status FROM connections WHERE customer_id = ?",
            (customer_id,),
        ).fetchall()

    result = dict(cust)
    result["connections"] = [dict(c) for c in connections]
    return result


# ── Dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard")
def portal_dashboard(customer=Depends(get_current_customer)):
    customer_id = customer["customer_id"]
    now = datetime.now()
    current_month_year = now.strftime("%m-%Y")

    with get_db() as conn:
        cust = conn.execute(
            "SELECT customer_id, name, phone, status FROM customers WHERE customer_id = ?",
            (customer_id,),
        ).fetchone()

        connection = conn.execute(
            "SELECT stb_no, can_id, mso, status, id FROM connections WHERE customer_id = ? LIMIT 1",
            (customer_id,),
        ).fetchone()

        connection_info = None
        current_plan = None
        due_amount = 0.0

        if connection:
            connection_info = {
                "stb_no": connection["stb_no"],
                "can_id": connection["can_id"] if "can_id" in connection.keys() else None,
                "mso": connection["mso"] if "mso" in connection.keys() else None,
                "connection_status": connection["status"],
            }

            plan_row = conn.execute(
                """SELECT cp.*, p.name as plan_name
                   FROM customer_plans cp
                   JOIN plans p ON cp.plan_id = p.id
                   WHERE cp.customer_id = ? AND cp.connection_id = ? AND cp.status = 'Active'
                   ORDER BY cp.id DESC LIMIT 1""",
                (customer_id, connection["id"]),
            ).fetchone()

            if plan_row:
                expiry_str = plan_row["expiry_date"] if "expiry_date" in plan_row.keys() else None
                is_expired = False
                if expiry_str:
                    try:
                        expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d")
                        is_expired = expiry_date < now
                    except ValueError:
                        pass

                current_plan = {
                    "plan_name": plan_row["plan_name"] if "plan_name" in plan_row.keys() else None,
                    "amount": plan_row["amount"] if "amount" in plan_row.keys() else 0,
                    "start_date": plan_row["start_date"] if "start_date" in plan_row.keys() else None,
                    "expiry_date": expiry_str,
                    "is_expired": is_expired,
                }

                paid_this_month = conn.execute(
                    "SELECT COUNT(*) FROM payments WHERE customer_id = ? AND month_year = ?",
                    (customer_id, current_month_year),
                ).fetchone()[0]
                if paid_this_month == 0:
                    due_amount = plan_row["amount"] if "amount" in plan_row.keys() else 0

        last_payment_row = conn.execute(
            "SELECT amount, collected_at, payment_mode FROM payments WHERE customer_id = ? ORDER BY collected_at DESC LIMIT 1",
            (customer_id,),
        ).fetchone()
        last_payment = None
        if last_payment_row:
            last_payment = {
                "amount": last_payment_row["amount"],
                "date": last_payment_row["collected_at"] if "collected_at" in last_payment_row.keys() else None,
                "mode": last_payment_row["payment_mode"] if "payment_mode" in last_payment_row.keys() else None,
            }

        paid_sum = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE customer_id = ? AND month_year = ?",
            (customer_id, current_month_year),
        ).fetchone()[0]
        pp_paid_sum = conn.execute(
            "SELECT COALESCE(SUM(collection_amount), 0) FROM paypakka_payments WHERE customer_id = ? AND strftime('%m-%Y', paypakka_created_at) = ?",
            (customer_id, current_month_year),
        ).fetchone()[0]
        total_paid_this_month = paid_sum + pp_paid_sum

    return {
        "customer": {
            "name": cust["name"],
            "status": cust["status"],
            "customer_id": cust["customer_id"],
        },
        "connection": connection_info,
        "current_plan": current_plan,
        "due_amount": due_amount,
        "last_payment": last_payment,
        "total_paid_this_month": total_paid_this_month,
    }


# ── Payments ─────────────────────────────────────────────────────────────────

@router.get("/payments")
def portal_payments(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    customer=Depends(get_current_customer),
):
    customer_id = customer["customer_id"]

    with get_db() as conn:
        cash_rows = conn.execute(
            "SELECT amount, collected_at as date, payment_mode as mode, 'cash' as source FROM payments WHERE customer_id = ?",
            (customer_id,),
        ).fetchall()
        pp_rows = conn.execute(
            "SELECT collection_amount as amount, paypakka_created_at as date, payment_type as mode, status, 'online' as source FROM paypakka_payments WHERE customer_id = ?",
            (customer_id,),
        ).fetchall()

    all_payments = [dict(r) for r in cash_rows] + [dict(r) for r in pp_rows]
    all_payments.sort(key=lambda x: x["date"] if x["date"] else "", reverse=True)

    total = len(all_payments)
    start = (page - 1) * per_page
    paginated = all_payments[start : start + per_page]

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "payments": paginated,
    }


@router.post("/payments/initiate")
def initiate_payment(
    data: InitiatePaymentRequest,
    customer=Depends(get_current_customer),
):
    customer_id = customer["customer_id"]

    with get_db() as conn:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor = conn.execute(
            "INSERT INTO online_payments (customer_id, amount, status, created_at) VALUES (?, ?, 'created', ?)",
            (customer_id, data.amount, now_str),
        )
        order_id = cursor.lastrowid
        conn.commit()

    return {
        "order_id": order_id,
        "amount": data.amount,
        "razorpay_key": RAZORPAY_KEY_ID,
    }


@router.post("/payments/verify")
def verify_payment(
    data: VerifyPaymentRequest,
    customer=Depends(get_current_customer),
):
    """Verify Razorpay payment with HMAC signature validation."""
    customer_id = customer["customer_id"]

    # ── CRITICAL: Verify Razorpay signature ──────────────────────────────
    if RAZORPAY_KEY_SECRET:
        msg = f"{data.razorpay_order_id}|{data.razorpay_payment_id}"
        expected_sig = hmac.new(
            RAZORPAY_KEY_SECRET.encode(), msg.encode(), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected_sig, data.razorpay_signature):
            raise HTTPException(
                status_code=400,
                detail="Payment verification failed: invalid signature",
            )

    with get_db() as conn:
        order = conn.execute(
            "SELECT id, customer_id, amount FROM online_payments WHERE id = ? AND status = 'created'",
            (int(data.razorpay_order_id),),
        ).fetchone()
        if not order:
            raise HTTPException(status_code=400, detail="Order not found or already processed")
        if order["customer_id"] != customer_id:
            raise HTTPException(status_code=403, detail="Order does not belong to this customer")

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        current_month_year = datetime.now().strftime("%m-%Y")

        conn.execute(
            "UPDATE online_payments SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'captured', captured_at = ? WHERE id = ?",
            (data.razorpay_payment_id, data.razorpay_signature, now_str, order["id"]),
        )

        connection = conn.execute(
            "SELECT id FROM connections WHERE customer_id = ? LIMIT 1",
            (customer_id,),
        ).fetchone()
        if connection:
            conn.execute(
                """INSERT INTO payments (customer_id, connection_id, amount, payment_mode, collected_by, collected_at, month_year, notes)
                   VALUES (?, ?, ?, 'Online', NULL, ?, ?, 'Razorpay online payment')""",
                (customer_id, connection["id"], data.amount, now_str, current_month_year),
            )
        conn.commit()

    return {"status": "success", "message": "Payment recorded"}


# ── Complaints ───────────────────────────────────────────────────────────────

@router.get("/complaints")
def list_complaints(customer=Depends(get_current_customer)):
    customer_id = customer["customer_id"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, subject, description, priority, status, created_at, updated_at, resolved_at, admin_notes FROM complaints WHERE customer_id = ? ORDER BY created_at DESC",
            (customer_id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/complaints", status_code=201)
def create_complaint(
    data: ComplaintCreate,
    customer=Depends(get_current_customer),
):
    customer_id = customer["customer_id"]
    with get_db() as conn:
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor = conn.execute(
            "INSERT INTO complaints (customer_id, subject, description, priority, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
            (customer_id, data.subject, data.description, data.priority, now_str),
        )
        complaint_id = cursor.lastrowid
        conn.commit()
        complaint = conn.execute(
            "SELECT id, subject, description, priority, status, created_at FROM complaints WHERE id = ?",
            (complaint_id,),
        ).fetchone()
    return dict(complaint)


@router.put("/complaints/{complaint_id}")
def update_complaint(
    complaint_id: int,
    data: ComplaintUpdate,
    customer=Depends(get_current_customer),
):
    customer_id = customer["customer_id"]
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id, status FROM complaints WHERE id = ? AND customer_id = ?",
            (complaint_id, customer_id),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Complaint not found")
        if existing["status"] != "open":
            raise HTTPException(status_code=400, detail="Only open complaints can be updated")

        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        updates, params = [], []
        if data.subject is not None:
            updates.append("subject = ?")
            params.append(data.subject)
        if data.description is not None:
            updates.append("description = ?")
            params.append(data.description)
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates.append("updated_at = ?")
        params.append(now_str)
        params.append(complaint_id)
        conn.execute(
            f"UPDATE complaints SET {', '.join(updates)} WHERE id = ?", params
        )
        conn.commit()
        complaint = conn.execute(
            "SELECT id, subject, description, priority, status, created_at, updated_at FROM complaints WHERE id = ?",
            (complaint_id,),
        ).fetchone()
    return dict(complaint)


# ── Change Password ─────────────────────────────────────────────────────────

@router.post("/change-password")
@limiter.limit("3/minute")
def change_password(
    request: Request,
    data: ChangePasswordRequest,
    customer=Depends(get_current_customer),
):
    customer_id = customer["customer_id"]
    with get_db() as conn:
        auth_row = conn.execute(
            "SELECT id, password FROM customer_auth WHERE customer_id = ?",
            (customer_id,),
        ).fetchone()
        if not auth_row:
            raise HTTPException(status_code=404, detail="Customer auth record not found")

        stored_password = auth_row["password"] if "password" in auth_row.keys() else None

        if stored_password:
            if not data.current_password:
                raise HTTPException(status_code=400, detail="Current password is required")
            if not verify_password(data.current_password, stored_password):
                raise HTTPException(status_code=401, detail="Current password is incorrect")

        conn.execute(
            "UPDATE customer_auth SET password = ? WHERE customer_id = ?",
            (hash_password(data.new_password), customer_id),
        )
        conn.commit()

    return {"message": "Password changed successfully"}
