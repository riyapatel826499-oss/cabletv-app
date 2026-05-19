     1|"""Customer portal — mobile+PIN auth, dashboard, payments, complaints."""
     2|from fastapi import APIRouter, Depends, HTTPException, Query, Request
     3|from pydantic import BaseModel
     4|from datetime import datetime
     5|from typing import Optional
     6|import hashlib
     7|import hmac
     8|
     9|from models.base import get_db
from conn import get_conn
    10|from deps_orm import get_current_customer, create_token, create_token
    11|from utils import (
    12|    hash_password, verify_password, needs_rehash,
    13|    normalize_phone, find_customer_by_phone,
    14|    get_current_month,
    15|)
    16|from config import RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, PIN_LENGTH
    17|from limiter import limiter
    18|
    19|router = APIRouter(prefix="/api/portal", tags=["Customer Portal"])
    20|
    21|
    22|# ── Pydantic Models ──────────────────────────────────────────────────────────
    23|
    24|class PortalLoginRequest(BaseModel):
    25|    customer_id: str
    26|    password: str
    27|
    28|
    29|class ChangePasswordRequest(BaseModel):
    30|    current_password: Optional[str] = ""
    31|    new_password: str
    32|
    33|
    34|class ComplaintCreate(BaseModel):
    35|    subject: str
    36|    description: str
    37|    priority: Optional[str] = "normal"
    38|
    39|
    40|class ComplaintUpdate(BaseModel):
    41|    subject: Optional[str] = None
    42|    description: Optional[str] = None
    43|
    44|
    45|class InitiatePaymentRequest(BaseModel):
    46|    amount: float
    47|
    48|
    49|class VerifyPaymentRequest(BaseModel):
    50|    razorpay_payment_id: str
    51|    razorpay_order_id: str
    52|    razorpay_signature: str
    53|    amount: float
    54|
    55|
    56|class MobileVerifyRequest(BaseModel):
    57|    mobile: str
    58|
    59|
    60|class SetPinRequest(BaseModel):
    61|    customer_id: str
    62|    mobile: str
    63|    pin: str
    64|
    65|
    66|class LoginPinRequest(BaseModel):
    67|    mobile: str
    68|    pin: str
    69|
    70|
    71|class RegisterRequest(BaseModel):
    72|    customer_id: str
    73|    phone: str
    74|    new_password: str
    75|
    76|
    77|# ── Password-Based Login ────────────────────────────────────────────────────
    78|
    79|@router.post("/login")
    80|@limiter.limit("5/minute")
    81|def portal_login(request: Request, body: PortalLoginRequest):
    82|    """Customer login via customer_id + password (bcrypt, auto-migrates legacy SHA256)."""
    83|    with get_conn() as conn:
    84|        customer = conn.execute(
    85|            "SELECT customer_id, name, phone, area FROM customers WHERE customer_id = ?",
    86|            (body.customer_id,),
    87|        ).fetchone()
    88|        if not customer:
    89|            raise HTTPException(status_code=401, detail="Invalid Customer ID")
    90|
    91|        auth = conn.execute(
    92|            "SELECT id, password FROM customer_auth WHERE customer_id = ?",
    93|            (customer["customer_id"],),
    94|        ).fetchone()
    95|        if not auth or not auth["password"]:
    96|            raise HTTPException(
    97|                status_code=401,
    98|                detail="Account not set up. Please contact support to register.",
    99|            )
   100|
   101|        if not verify_password(body.password, auth["password"]):
   102|            raise HTTPException(status_code=401, detail="Incorrect password")
   103|
   104|        # Auto-upgrade legacy SHA256 → bcrypt
   105|        if needs_rehash(auth["password"]):
   106|            conn.execute(
   107|                "UPDATE customer_auth SET password = ? WHERE customer_id = ?",
   108|                (hash_password(body.password), customer["customer_id"]),
   109|            )
   110|            conn.commit()
   111|
   112|    access_token = create_token(
   113|        subject=customer["customer_id"],
   114|        token_type="customer",
   115|    )
   116|    return {
   117|        "access_token": access_token,
   118|        "customer": {
   119|            "customer_id": customer["customer_id"],
   120|            "name": customer["name"],
   121|            "phone": customer["phone"],
   122|            "area": customer["area"] if "area" in customer.keys() else None,
   123|        },
   124|    }
   125|
   126|
   127|# ── PIN-Based Customer Auth (Mobile + 4-digit PIN, no OTP/SMS) ─────────────
   128|
   129|@router.post("/customer/mobile-verify")
   130|@limiter.limit("3/minute")
   131|def customer_mobile_verify(request: Request, body: MobileVerifyRequest):
   132|    """Step 1: Verify mobile exists. Returns customer_id, name, has_pin."""
   133|    mobile = body.mobile.strip()
   134|    if len(mobile) != 10 or not mobile.isdigit():
   135|        raise HTTPException(status_code=400, detail="Enter valid 10-digit mobile number")
   136|
   137|    with get_conn() as conn:
   138|        customer = find_customer_by_phone(conn, mobile)
   139|        if not customer:
   140|            raise HTTPException(
   141|                status_code=404,
   142|                detail="Mobile number not found. Please contact us to register.",
   143|            )
   144|        if customer["status"] not in ("Active",):
   145|            raise HTTPException(
   146|                status_code=400,
   147|                detail=f"Account is {customer['status']}. Please contact support.",
   148|            )
   149|
   150|        auth = conn.execute(
   151|            "SELECT pin FROM customer_auth WHERE customer_id = ?",
   152|            (customer["customer_id"],),
   153|        ).fetchone()
   154|
   155|    has_pin = bool(auth and auth["pin"])
   156|    return {
   157|        "customer_id": customer["customer_id"],
   158|        "name": customer["name"],
   159|        "mobile": mobile,
   160|        "has_pin": has_pin,
   161|    }
   162|
   163|
   164|@router.post("/customer/set-pin")
   165|@limiter.limit("3/minute")
   166|def customer_set_pin(request: Request, body: SetPinRequest):
   167|    """Step 2 (first time): Set a 4-digit PIN. bcrypt hashed."""
   168|    if len(body.pin) != PIN_LENGTH or not body.pin.isdigit():
   169|        raise HTTPException(
   170|            status_code=400,
   171|            detail=f"PIN must be exactly {PIN_LENGTH} digits",
   172|        )
   173|
   174|    with get_conn() as conn:
   175|        # Verify customer + mobile match
   176|        clean_mobile = normalize_phone(body.mobile)
   177|        customer = conn.execute(
   178|            """SELECT customer_id, name, phone, status FROM customers
   179|               WHERE customer_id = ?
   180|                 AND (REPLACE(REPLACE(phone, '+91', ''), ' ', '') = ?
   181|                      OR REPLACE(REPLACE(phone2, '+91', ''), ' ', '') = ?)""",
   182|            (body.customer_id, clean_mobile, clean_mobile),
   183|        ).fetchone()
   184|
   185|        if not customer:
   186|            raise HTTPException(status_code=400, detail="Customer verification failed")
   187|        if customer["status"] != "Active":
   188|            raise HTTPException(status_code=400, detail=f"Account is {customer['status']}")
   189|
   190|        existing = conn.execute(
   191|            "SELECT id, pin FROM customer_auth WHERE customer_id = ?",
   192|            (body.customer_id,),
   193|        ).fetchone()
   194|
   195|        if existing and existing["pin"]:
   196|            raise HTTPException(status_code=400, detail="PIN already set. Use login instead.")
   197|
   198|        pin_hash = hash_password(body.pin)  # bcrypt
   199|        now = datetime.utcnow().isoformat()
   200|
   201|        if existing:
   202|            conn.execute(
   203|                "UPDATE customer_auth SET pin = ? WHERE customer_id = ?",
   204|                (pin_hash, body.customer_id),
   205|            )
   206|        else:
   207|            conn.execute(
   208|                "INSERT INTO customer_auth (customer_id, phone, pin, created_at) VALUES (?, ?, ?, ?)",
   209|                (body.customer_id, body.mobile, pin_hash, now),
   210|            )
   211|        conn.commit()
   212|
   213|    access_token = create_token(
   214|        subject=customer["customer_id"],
   215|        token_type="customer",
   216|    )
   217|    return {
   218|        "token": access_token,
   219|        "customer": {
   220|            "customer_id": customer["customer_id"],
   221|            "name": customer["name"],
   222|            "mobile": body.mobile,
   223|        },
   224|        "message": "PIN set successfully",
   225|    }
   226|
   227|
   228|@router.post("/customer/login-pin")
   229|@limiter.limit("5/minute")
   230|def customer_login_pin(request: Request, body: LoginPinRequest):
   231|    """Step 2 (returning): Login with mobile + PIN. bcrypt verified."""
   232|    mobile = body.mobile.strip()
   233|    pin = body.pin.strip()
   234|
   235|    if len(mobile) != 10 or not mobile.isdigit():
   236|        raise HTTPException(status_code=400, detail="Enter valid 10-digit mobile number")
   237|    if len(pin) != PIN_LENGTH or not pin.isdigit():
   238|        raise HTTPException(
   239|            status_code=400,
   240|            detail=f"Enter valid {PIN_LENGTH}-digit PIN",
   241|        )
   242|
   243|    with get_conn() as conn:
   244|        customer = find_customer_by_phone(conn, mobile)
   245|        if not customer:
   246|            raise HTTPException(status_code=404, detail="Mobile number not found")
   247|        if customer["status"] != "Active":
   248|            raise HTTPException(status_code=400, detail=f"Account is {customer['status']}")
   249|
   250|        auth = conn.execute(
   251|            "SELECT pin FROM customer_auth WHERE customer_id = ?",
   252|            (customer["customer_id"],),
   253|        ).fetchone()
   254|
   255|    if not auth or not auth["pin"]:
   256|        raise HTTPException(status_code=400, detail="PIN not set. Please register first.")
   257|
   258|    if not verify_password(pin, auth["pin"]):  # bcrypt + legacy SHA256 fallback
   259|        raise HTTPException(status_code=401, detail="Incorrect PIN")
   260|
   261|    access_token = create_token(
   262|        subject=customer["customer_id"],
   263|        token_type="customer",
   264|    )
   265|    return {
   266|        "access_token": access_token,
   267|        "customer": {
   268|            "customer_id": customer["customer_id"],
   269|            "name": customer["name"],
   270|            "mobile": mobile,
   271|            "phone": customer["phone"],
   272|        },
   273|    }
   274|
   275|
   276|# ── Registration ─────────────────────────────────────────────────────────────
   277|
   278|@router.post("/register")
   279|@limiter.limit("3/minute")
   280|def portal_register(request: Request, body: RegisterRequest):
   281|    """First-time registration: customer sets password. bcrypt hashed."""
   282|    with get_conn() as conn:
   283|        customer = conn.execute(
   284|            "SELECT customer_id, name, phone, area FROM customers WHERE customer_id = ? AND phone = ?",
   285|            (body.customer_id, body.phone),
   286|        ).fetchone()
   287|        if not customer:
   288|            raise HTTPException(
   289|                status_code=400,
   290|                detail="Customer ID and Phone number do not match.",
   291|            )
   292|
   293|        existing = conn.execute(
   294|            "SELECT id FROM customer_auth WHERE customer_id = ? AND password IS NOT NULL",
   295|            (body.customer_id,),
   296|        ).fetchone()
   297|        if existing:
   298|            raise HTTPException(
   299|                status_code=400,
   300|                detail="Account already registered. Please use Login instead.",
   301|            )
   302|
   303|        pw_hash = hash_password(body.new_password)  # bcrypt
   304|        conn.execute(
   305|            "INSERT OR REPLACE INTO customer_auth (customer_id, phone, password, created_at) VALUES (?, ?, ?, ?)",
   306|            (customer["customer_id"], customer["phone"], pw_hash, datetime.utcnow().isoformat()),
   307|        )
   308|        conn.commit()
   309|
   310|    access_token = create_token(
   311|        subject=customer["customer_id"],
   312|        token_type="customer",
   313|    )
   314|    return {
   315|        "access_token": access_token,
   316|        "customer": {
   317|            "customer_id": customer["customer_id"],
   318|            "name": customer["name"],
   319|            "phone": customer["phone"],
   320|            "area": customer["area"] if "area" in customer.keys() else None,
   321|        },
   322|        "message": "Registration successful",
   323|    }
   324|
   325|
   326|# ── Profile ──────────────────────────────────────────────────────────────────
   327|
   328|@router.get("/me")
   329|def portal_me(customer=Depends(get_current_customer)):
   330|    customer_id = customer["customer_id"]
   331|    with get_conn() as conn:
   332|        cust = conn.execute(
   333|            "SELECT customer_id, name, phone, phone2, address, area, city, pincode, status FROM customers WHERE customer_id = ?",
   334|            (customer_id,),
   335|        ).fetchone()
   336|        connections = conn.execute(
   337|            "SELECT stb_no, can_id, mso, status FROM connections WHERE customer_id = ?",
   338|            (customer_id,),
   339|        ).fetchall()
   340|
   341|    result = dict(cust)
   342|    result["connections"] = [dict(c) for c in connections]
   343|    return result
   344|
   345|
   346|# ── Dashboard ────────────────────────────────────────────────────────────────
   347|
   348|@router.get("/dashboard")
   349|def portal_dashboard(customer=Depends(get_current_customer)):
   350|    customer_id = customer["customer_id"]
   351|    now = datetime.now()
   352|    current_month_year = now.strftime("%m-%Y")
   353|
   354|    with get_conn() as conn:
   355|        cust = conn.execute(
   356|            "SELECT customer_id, name, phone, status FROM customers WHERE customer_id = ?",
   357|            (customer_id,),
   358|        ).fetchone()
   359|
   360|        connection = conn.execute(
   361|            "SELECT stb_no, can_id, mso, status, id FROM connections WHERE customer_id = ? LIMIT 1",
   362|            (customer_id,),
   363|        ).fetchone()
   364|
   365|        connection_info = None
   366|        current_plan = None
   367|        due_amount = 0.0
   368|
   369|        if connection:
   370|            connection_info = {
   371|                "stb_no": connection["stb_no"],
   372|                "can_id": connection["can_id"] if "can_id" in connection.keys() else None,
   373|                "mso": connection["mso"] if "mso" in connection.keys() else None,
   374|                "connection_status": connection["status"],
   375|            }
   376|
   377|            plan_row = conn.execute(
   378|                """SELECT cp.*, p.name as plan_name
   379|                   FROM customer_plans cp
   380|                   JOIN plans p ON cp.plan_id = p.id
   381|                   WHERE cp.customer_id = ? AND cp.connection_id = ? AND cp.status = 'Active'
   382|                   ORDER BY cp.id DESC LIMIT 1""",
   383|                (customer_id, connection["id"]),
   384|            ).fetchone()
   385|
   386|            if plan_row:
   387|                expiry_str = plan_row["expiry_date"] if "expiry_date" in plan_row.keys() else None
   388|                is_expired = False
   389|                if expiry_str:
   390|                    try:
   391|                        expiry_date = datetime.strptime(expiry_str, "%Y-%m-%d")
   392|                        is_expired = expiry_date < now
   393|                    except ValueError:
   394|                        pass
   395|
   396|                current_plan = {
   397|                    "plan_name": plan_row["plan_name"] if "plan_name" in plan_row.keys() else None,
   398|                    "amount": plan_row["amount"] if "amount" in plan_row.keys() else 0,
   399|                    "start_date": plan_row["start_date"] if "start_date" in plan_row.keys() else None,
   400|                    "expiry_date": expiry_str,
   401|                    "is_expired": is_expired,
   402|                }
   403|
   404|                paid_this_month = conn.execute(
   405|                    "SELECT COUNT(*) FROM payments WHERE customer_id = ? AND month_year = ?",
   406|                    (customer_id, current_month_year),
   407|                ).fetchone()[0]
   408|                if paid_this_month == 0:
   409|                    due_amount = plan_row["amount"] if "amount" in plan_row.keys() else 0
   410|
   411|        last_payment_row = conn.execute(
   412|            "SELECT amount, collected_at, payment_mode FROM payments WHERE customer_id = ? ORDER BY collected_at DESC LIMIT 1",
   413|            (customer_id,),
   414|        ).fetchone()
   415|        last_payment = None
   416|        if last_payment_row:
   417|            last_payment = {
   418|                "amount": last_payment_row["amount"],
   419|                "date": last_payment_row["collected_at"] if "collected_at" in last_payment_row.keys() else None,
   420|                "mode": last_payment_row["payment_mode"] if "payment_mode" in last_payment_row.keys() else None,
   421|            }
   422|
   423|        paid_sum = conn.execute(
   424|            "SELECT COALESCE(SUM(amount), 0) FROM payments WHERE customer_id = ? AND month_year = ?",
   425|            (customer_id, current_month_year),
   426|        ).fetchone()[0]
   427|        pp_paid_sum = conn.execute(
   428|            "SELECT COALESCE(SUM(collection_amount), 0) FROM paypakka_payments WHERE customer_id = ? AND strftime('%m-%Y', paypakka_created_at) = ?",
   429|            (customer_id, current_month_year),
   430|        ).fetchone()[0]
   431|        total_paid_this_month = paid_sum + pp_paid_sum
   432|
   433|    return {
   434|        "customer": {
   435|            "name": cust["name"],
   436|            "status": cust["status"],
   437|            "customer_id": cust["customer_id"],
   438|        },
   439|        "connection": connection_info,
   440|        "current_plan": current_plan,
   441|        "due_amount": due_amount,
   442|        "last_payment": last_payment,
   443|        "total_paid_this_month": total_paid_this_month,
   444|    }
   445|
   446|
   447|# ── Payments ─────────────────────────────────────────────────────────────────
   448|
   449|@router.get("/payments")
   450|def portal_payments(
   451|    page: int = Query(1, ge=1),
   452|    per_page: int = Query(20, ge=1, le=100),
   453|    customer=Depends(get_current_customer),
   454|):
   455|    customer_id = customer["customer_id"]
   456|
   457|    with get_conn() as conn:
   458|        cash_rows = conn.execute(
   459|            "SELECT amount, collected_at as date, payment_mode as mode, 'cash' as source FROM payments WHERE customer_id = ?",
   460|            (customer_id,),
   461|        ).fetchall()
   462|        pp_rows = conn.execute(
   463|            "SELECT collection_amount as amount, paypakka_created_at as date, payment_type as mode, status, 'online' as source FROM paypakka_payments WHERE customer_id = ?",
   464|            (customer_id,),
   465|        ).fetchall()
   466|
   467|    all_payments = [dict(r) for r in cash_rows] + [dict(r) for r in pp_rows]
   468|    all_payments.sort(key=lambda x: x["date"] if x["date"] else "", reverse=True)
   469|
   470|    total = len(all_payments)
   471|    start = (page - 1) * per_page
   472|    paginated = all_payments[start : start + per_page]
   473|
   474|    return {
   475|        "total": total,
   476|        "page": page,
   477|        "per_page": per_page,
   478|        "payments": paginated,
   479|    }
   480|
   481|
   482|@router.post("/payments/initiate")
   483|def initiate_payment(
   484|    data: InitiatePaymentRequest,
   485|    customer=Depends(get_current_customer),
   486|):
   487|    customer_id = customer["customer_id"]
   488|
   489|    with get_conn() as conn:
   490|        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   491|        cursor = conn.execute(
   492|            "INSERT INTO online_payments (customer_id, amount, status, created_at) VALUES (?, ?, 'created', ?)",
   493|            (customer_id, data.amount, now_str),
   494|        )
   495|        order_id = cursor.lastrowid
   496|        conn.commit()
   497|
   498|    return {
   499|        "order_id": order_id,
   500|        "amount": data.amount,
   501|        "razorpay_key": RAZORPAY_KEY_ID,
   502|    }
   503|
   504|
   505|@router.post("/payments/verify")
   506|def verify_payment(
   507|    data: VerifyPaymentRequest,
   508|    customer=Depends(get_current_customer),
   509|):
   510|    """Verify Razorpay payment with HMAC signature validation."""
   511|    customer_id = customer["customer_id"]
   512|
   513|    # ── CRITICAL: Verify Razorpay signature ──────────────────────────────
   514|    if RAZORPAY_KEY_SECRET:
   515|        msg = f"{data.razorpay_order_id}|{data.razorpay_payment_id}"
   516|        expected_sig = hmac.new(
   517|            RAZORPAY_KEY_SECRET.encode(), msg.encode(), hashlib.sha256
   518|        ).hexdigest()
   519|        if not hmac.compare_digest(expected_sig, data.razorpay_signature):
   520|            raise HTTPException(
   521|                status_code=400,
   522|                detail="Payment verification failed: invalid signature",
   523|            )
   524|
   525|    with get_conn() as conn:
   526|        order = conn.execute(
   527|            "SELECT id, customer_id, amount FROM online_payments WHERE id = ? AND status = 'created'",
   528|            (int(data.razorpay_order_id),),
   529|        ).fetchone()
   530|        if not order:
   531|            raise HTTPException(status_code=400, detail="Order not found or already processed")
   532|        if order["customer_id"] != customer_id:
   533|            raise HTTPException(status_code=403, detail="Order does not belong to this customer")
   534|
   535|        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   536|        current_month_year = datetime.now().strftime("%m-%Y")
   537|
   538|        conn.execute(
   539|            "UPDATE online_payments SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'captured', captured_at = ? WHERE id = ?",
   540|            (data.razorpay_payment_id, data.razorpay_signature, now_str, order["id"]),
   541|        )
   542|
   543|        connection = conn.execute(
   544|            "SELECT id FROM connections WHERE customer_id = ? LIMIT 1",
   545|            (customer_id,),
   546|        ).fetchone()
   547|        if connection:
   548|            conn.execute(
   549|                """INSERT INTO payments (customer_id, connection_id, amount, payment_mode, collected_by, collected_at, month_year, notes)
   550|                   VALUES (?, ?, ?, 'Online', NULL, ?, ?, 'Razorpay online payment')""",
   551|                (customer_id, connection["id"], data.amount, now_str, current_month_year),
   552|            )
   553|        conn.commit()
   554|
   555|    return {"status": "success", "message": "Payment recorded"}
   556|
   557|
   558|# ── Complaints ───────────────────────────────────────────────────────────────
   559|
   560|@router.get("/complaints")
   561|def list_complaints(customer=Depends(get_current_customer)):
   562|    customer_id = customer["customer_id"]
   563|    with get_conn() as conn:
   564|        rows = conn.execute(
   565|            "SELECT id, subject, description, priority, status, created_at, updated_at, resolved_at, admin_notes FROM complaints WHERE customer_id = ? ORDER BY created_at DESC",
   566|            (customer_id,),
   567|        ).fetchall()
   568|    return [dict(r) for r in rows]
   569|
   570|
   571|@router.post("/complaints", status_code=201)
   572|def create_complaint(
   573|    data: ComplaintCreate,
   574|    customer=Depends(get_current_customer),
   575|):
   576|    customer_id = customer["customer_id"]
   577|    with get_conn() as conn:
   578|        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   579|        cursor = conn.execute(
   580|            "INSERT INTO complaints (customer_id, subject, description, priority, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
   581|            (customer_id, data.subject, data.description, data.priority, now_str),
   582|        )
   583|        complaint_id = cursor.lastrowid
   584|        conn.commit()
   585|        complaint = conn.execute(
   586|            "SELECT id, subject, description, priority, status, created_at FROM complaints WHERE id = ?",
   587|            (complaint_id,),
   588|        ).fetchone()
   589|    return dict(complaint)
   590|
   591|
   592|@router.put("/complaints/{complaint_id}")
   593|def update_complaint(
   594|    complaint_id: int,
   595|    data: ComplaintUpdate,
   596|    customer=Depends(get_current_customer),
   597|):
   598|    customer_id = customer["customer_id"]
   599|    with get_conn() as conn:
   600|        existing = conn.execute(
   601|            "SELECT id, status FROM complaints WHERE id = ? AND customer_id = ?",
   602|            (complaint_id, customer_id),
   603|        ).fetchone()
   604|        if not existing:
   605|            raise HTTPException(status_code=404, detail="Complaint not found")
   606|        if existing["status"] != "open":
   607|            raise HTTPException(status_code=400, detail="Only open complaints can be updated")
   608|
   609|        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
   610|        updates, params = [], []
   611|        if data.subject is not None:
   612|            updates.append("subject = ?")
   613|            params.append(data.subject)
   614|        if data.description is not None:
   615|            updates.append("description = ?")
   616|            params.append(data.description)
   617|        if not updates:
   618|            raise HTTPException(status_code=400, detail="No fields to update")
   619|
   620|        updates.append("updated_at = ?")
   621|        params.append(now_str)
   622|        params.append(complaint_id)
   623|        conn.execute(
   624|            f"UPDATE complaints SET {', '.join(updates)} WHERE id = ?", params
   625|        )
   626|        conn.commit()
   627|        complaint = conn.execute(
   628|            "SELECT id, subject, description, priority, status, created_at, updated_at FROM complaints WHERE id = ?",
   629|            (complaint_id,),
   630|        ).fetchone()
   631|    return dict(complaint)
   632|
   633|
   634|# ── Change Password ─────────────────────────────────────────────────────────
   635|
   636|@router.post("/change-password")
   637|@limiter.limit("3/minute")
   638|def change_password(
   639|    request: Request,
   640|    data: ChangePasswordRequest,
   641|    customer=Depends(get_current_customer),
   642|):
   643|    customer_id = customer["customer_id"]
   644|    with get_conn() as conn:
   645|        auth_row = conn.execute(
   646|            "SELECT id, password FROM customer_auth WHERE customer_id = ?",
   647|            (customer_id,),
   648|        ).fetchone()
   649|        if not auth_row:
   650|            raise HTTPException(status_code=404, detail="Customer auth record not found")
   651|
   652|        stored_password = auth_row["password"] if "password" in auth_row.keys() else None
   653|
   654|        if stored_password:
   655|            if not data.current_password:
   656|                raise HTTPException(status_code=400, detail="Current password is required")
   657|            if not verify_password(data.current_password, stored_password):
   658|                raise HTTPException(status_code=401, detail="Current password is incorrect")
   659|
   660|        conn.execute(
   661|            "UPDATE customer_auth SET password = ? WHERE customer_id = ?",
   662|            (hash_password(data.new_password), customer_id),
   663|        )
   664|        conn.commit()
   665|
   666|    return {"message": "Password changed successfully"}
   667|