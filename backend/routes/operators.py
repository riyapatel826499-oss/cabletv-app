from conn import get_conn
     1|"""Operator management — Master admin only. CRUD for cable TV operators + data import."""
     2|from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
     3|from pydantic import BaseModel
     4|from typing import Optional, List
     5|import sqlite3
     6|import csv
     7|import io
     8|import json
     9|import re
    10|import uuid
    11|import httpx
    12|from datetime import datetime
    13|
    14|from deps import get_db, get_current_user, op_id
    15|from config import DB_PATH
    16|from utils import hash_password
    17|
    18|router = APIRouter(prefix="/api/operators", tags=["Operators"])
    19|
    20|
    21|def require_master(user=Depends(get_current_user)):
    22|    if user.get("role") != "master":
    23|        raise HTTPException(403, "Master admin only")
    24|    return user
    25|
    26|
    27|@router.get("/")
    28|def list_operators(user=Depends(require_master)):
    29|    """List all operators with stats."""
    30|    # Compute month start in IST (UTC+5:30) — replaces SQLite date('now','+5 hours','+30 minutes','start of month')
    31|    from datetime import timedelta
    32|    now_ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
    33|    month_start = now_ist.strftime("%Y-%m-01")
    34|
    35|    with get_conn() as conn:
    36|        ops = conn.execute("""
    37|            SELECT o.*,
    38|                (SELECT COUNT(*) FROM customers WHERE operator_id = o.id) as customer_count,
    39|                (SELECT COUNT(*) FROM customers WHERE operator_id = o.id AND status = 'Active') as active_count,
    40|                (SELECT COUNT(*) FROM connections WHERE operator_id = o.id AND status = 'Active') as connection_count,
    41|                (SELECT COUNT(*) FROM users WHERE operator_id = o.id) as staff_count,
    42|                (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE operator_id = o.id
    43|                    AND collected_at >= ?)
    44|                + (SELECT COALESCE(SUM(collection_amount), 0) FROM paypakka_payments WHERE operator_id = o.id
    45|                    AND paypakka_created_at >= ?)
    46|                as month_collection,
    47|                (SELECT username FROM users WHERE operator_id = o.id AND role = 'admin' LIMIT 1) as admin_username,
    48|                (SELECT name FROM users WHERE operator_id = o.id AND role = 'admin' LIMIT 1) as admin_name,
    49|                (SELECT phone FROM users WHERE operator_id = o.id AND role = 'admin' LIMIT 1) as admin_phone
    50|            FROM operators o
    51|            ORDER BY o.created_at DESC
    52|        """, (month_start, month_start)).fetchall()
    53|        return [dict(o) for o in ops]
    54|
    55|
    56|@router.get("/{operator_id}")
    57|def get_operator(operator_id: int, user=Depends(require_master)):
    58|    with get_conn() as conn:
    59|        op = conn.execute("SELECT * FROM operators WHERE id = ?", (operator_id,)).fetchone()
    60|        if not op:
    61|            raise HTTPException(404, "Operator not found")
    62|        return dict(op)
    63|
    64|
    65|class OperatorCreate(BaseModel):
    66|    business_name: str
    67|    owner_name: str
    68|    phone: str
    69|    email: Optional[str] = ""
    70|    area: Optional[str] = ""
    71|    mso: Optional[str] = "GTPL"
    72|    notes: Optional[str] = ""
    73|    customer_prefix: str  # 2-5 char prefix for customer IDs (e.g., "SSA", "TVC")
    74|    # Admin login for this operator
    75|    admin_username: str
    76|    admin_password: str
    77|    admin_name: Optional[str] = ""
    78|
    79|
    80|@router.post("/")
    81|def create_operator(data: OperatorCreate, user=Depends(require_master)):
    82|    """Create a new operator + their admin login."""
    83|    # Validate prefix: 2-5 uppercase alphanumeric
    84|    prefix = data.customer_prefix.strip().upper()
    85|    if not re.match(r'^[A-Z0-9]{2,5}$', prefix):
    86|        raise HTTPException(400, "Customer prefix must be 2-5 uppercase letters/numbers (e.g., SSA, TVC)")
    87|
    88|    with get_conn() as conn:
    89|        # Check username uniqueness
    90|        existing = conn.execute("SELECT id FROM users WHERE username = ?", (data.admin_username,)).fetchone()
    91|        if existing:
    92|            raise HTTPException(400, f"Username '{data.admin_username}' already taken")
    93|
    94|        # Check prefix uniqueness
    95|        existing_prefix = conn.execute("SELECT id, business_name FROM operators WHERE customer_prefix = ?", (prefix,)).fetchone()
    96|        if existing_prefix:
    97|            raise HTTPException(400, f"Prefix '{prefix}' already used by {existing_prefix['business_name']}")
    98|
    99|        # Create operator
   100|        conn.execute(
   101|            """INSERT INTO operators (business_name, owner_name, phone, email, area, mso, notes, customer_prefix)
   102|               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
   103|            (data.business_name, data.owner_name, data.phone, data.email, data.area, data.mso, data.notes, prefix),
   104|        )
   105|        new_op_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
   106|
   107|        # Create admin user for this operator
   108|        conn.execute(
   109|            """INSERT INTO users (username, password, name, role, phone, operator_id)
   110|               VALUES (?, ?, ?, 'admin', ?, ?)""",
   111|            (data.admin_username, hash_password(data.admin_password),
   112|             data.admin_name or data.owner_name, data.phone, new_op_id),
   113|        )
   114|        conn.commit()
   115|
   116|        return {"ok": True, "operator_id": new_op_id, "message": f"Operator '{data.business_name}' created with admin login '{data.admin_username}'"}
   117|
   118|
   119|class OperatorUpdate(BaseModel):
   120|    business_name: Optional[str] = None
   121|    owner_name: Optional[str] = None
   122|    phone: Optional[str] = None
   123|    email: Optional[str] = None
   124|    area: Optional[str] = None
   125|    mso: Optional[str] = None
   126|    status: Optional[str] = None  # active, suspended
   127|    license_type: Optional[str] = None  # active, trial, expired
   128|    notes: Optional[str] = None
   129|    customer_prefix: Optional[str] = None
   130|
   131|
   132|@router.put("/{operator_id}")
   133|def update_operator(operator_id: int, data: OperatorUpdate, user=Depends(require_master)):
   134|    with get_conn() as conn:
   135|        op = conn.execute("SELECT id FROM operators WHERE id = ?", (operator_id,)).fetchone()
   136|        if not op:
   137|            raise HTTPException(404, "Operator not found")
   138|
   139|        updates = data.model_dump(exclude_unset=True)
   140|        if not updates:
   141|            raise HTTPException(400, "No fields to update")
   142|
   143|        set_clause = ", ".join([f"{k} = ?" for k in updates])
   144|        conn.execute(
   145|            f"UPDATE operators SET {set_clause} WHERE id = ?",
   146|            list(updates.values()) + [operator_id],
   147|        )
   148|        conn.commit()
   149|        return {"ok": True, "updated": list(updates.keys())}
   150|
   151|
   152|@router.delete("/{operator_id}")
   153|def delete_operator(operator_id: int, user=Depends(require_master)):
   154|    """Suspend operator (soft delete — data preserved)."""
   155|    with get_conn() as conn:
   156|        op = conn.execute("SELECT id, business_name FROM operators WHERE id = ?", (operator_id,)).fetchone()
   157|        if not op:
   158|            raise HTTPException(404, "Operator not found")
   159|
   160|        conn.execute("UPDATE operators SET status = 'suspended' WHERE id = ?", (operator_id,))
   161|        # Deactivate all users for this operator
   162|        conn.execute("UPDATE users SET status = 'Inactive' WHERE operator_id = ?", (operator_id,))
   163|        conn.commit()
   164|        return {"ok": True, "message": f"Operator '{op['business_name']}' suspended. All staff deactivated."}
   165|
   166|
   167|@router.post("/{operator_id}/reset-admin-password")
   168|def reset_admin_password(operator_id: int, new_password: str, user=Depends(require_master)):
   169|    """Reset the admin password for an operator."""
   170|    with get_conn() as conn:
   171|        admin = conn.execute(
   172|            "SELECT id, name FROM users WHERE operator_id = ? AND role = 'admin' LIMIT 1",
   173|            (operator_id,),
   174|        ).fetchone()
   175|        if not admin:
   176|            raise HTTPException(404, "No admin user found for this operator")
   177|
   178|        conn.execute("UPDATE users SET password = ? WHERE id = ?", (hash_password(new_password), admin["id"]))
   179|        conn.commit()
   180|        return {"ok": True, "message": f"Password reset for {admin['name']}"}
   181|
   182|
   183|@router.post("/migrate")
   184|def run_migration(user=Depends(require_master)):
   185|    """Run multi-tenant migration on DB — idempotent, safe to re-run."""
   186|    import sqlite3
   187|    conn = sqlite3.connect(DB_PATH)
   188|    conn.row_factory = sqlite3.Row
   189|    results = []
   190|
   191|    # Tables that need operator_id
   192|    tables = [
   193|        "customers", "connections", "plans", "customer_plans",
   194|        "payments", "paypakka_payments", "paypakka_plans",
   195|        "paypakka_customer_plans", "paypakka_employees",
   196|        "stb_inventory", "surrender_requests", "complaints",
   197|        "sms_log", "online_payments", "users",
   198|    ]
   199|
   200|    for table in tables:
   201|        try:
   202|            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
   203|            if "operator_id" not in cols:
   204|                conn.execute(f"ALTER TABLE {table} ADD COLUMN operator_id INTEGER DEFAULT NULL")
   205|                results.append(f"Added operator_id to {table}")
   206|            else:
   207|                results.append(f"{table} already has operator_id")
   208|        except Exception as e:
   209|            results.append(f"{table}: {e}")
   210|
   211|    # Create operators table if not exists
   212|    conn.execute("""CREATE TABLE IF NOT EXISTS operators (
   213|        id INTEGER PRIMARY KEY AUTOINCREMENT,
   214|        business_name TEXT NOT NULL,
   215|        owner_name TEXT NOT NULL,
   216|        phone TEXT NOT NULL,
   217|        email TEXT DEFAULT '',
   218|        area TEXT DEFAULT '',
   219|        mso TEXT DEFAULT 'GTPL',
   220|        status TEXT DEFAULT 'active',
   221|        license_type TEXT DEFAULT 'active',
   222|        notes TEXT DEFAULT '',
   223|        customer_prefix TEXT DEFAULT '',
   224|        created_at TEXT DEFAULT CURRENT_TIMESTAMP
   225|    )""")
   226|    results.append("operators table ensured")
   227|
   228|    # Ensure customer_prefix column exists
   229|    op_cols = [r[1] for r in conn.execute("PRAGMA table_info(operators)").fetchall()]
   230|    if "customer_prefix" not in op_cols:
   231|        conn.execute("ALTER TABLE operators ADD COLUMN customer_prefix TEXT DEFAULT ''")
   232|        results.append("Added customer_prefix to operators")
   233|
   234|    # Create notification_settings with composite PK
   235|    conn.execute("""CREATE TABLE IF NOT EXISTS notification_settings (
   236|        key TEXT NOT NULL,
   237|        operator_id INTEGER NOT NULL DEFAULT 1,
   238|        value TEXT NOT NULL,
   239|        PRIMARY KEY (key, operator_id)
   240|    )""")
   241|    results.append("notification_settings table ensured")
   242|
   243|    # Seed default operator if not exists
   244|    op_count = conn.execute("SELECT COUNT(*) FROM operators").fetchone()[0]
   245|    if op_count == 0:
   246|        conn.execute("""INSERT INTO operators (business_name, owner_name, phone, area, mso, customer_prefix)
   247|            VALUES ('SSN Cables', 'Prabhu', '9787225577', 'Tirupur', 'GTPL', 'SSA')""")
   248|        op_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
   249|        results.append(f"Created default operator 'SSN Cables' (id={op_id})")
   250|
   251|        # Assign all existing data to this operator
   252|        for table in tables:
   253|            if table == "users":
   254|                conn.execute(f"UPDATE {table} SET operator_id = ? WHERE role != 'master'", (op_id,))
   255|            else:
   256|                conn.execute(f"UPDATE {table} SET operator_id = ? WHERE operator_id IS NULL", (op_id,))
   257|        results.append(f"Assigned all existing data to operator {op_id}")
   258|    else:
   259|        # Ensure existing operator has customer_prefix
   260|        ops = conn.execute("SELECT id, business_name FROM operators WHERE customer_prefix IS NULL OR customer_prefix = ''").fetchall()
   261|        for op in ops:
   262|            # Check if there are existing customers to detect prefix from
   263|            sample_cid = conn.execute(
   264|                "SELECT customer_id FROM customers WHERE operator_id = ? LIMIT 1", (op["id"],)
   265|            ).fetchone()
   266|            if sample_cid:
   267|                m = re.match(r'^([A-Za-z]+)-', sample_cid["customer_id"])
   268|                if m:
   269|                    prefix = m.group(1).upper()
   270|                else:
   271|                    words = re.findall(r'[A-Za-z]+', op["business_name"])
   272|                    prefix = "".join(w[0].upper() for w in words[:3])[:4] if words else "OP"
   273|            else:
   274|                words = re.findall(r'[A-Za-z]+', op["business_name"])
   275|                prefix = "".join(w[0].upper() for w in words[:3])[:4] if words else "OP"
   276|            conn.execute("UPDATE operators SET customer_prefix = ? WHERE id = ?", (prefix, op["id"]))
   277|            results.append(f"Set prefix '{prefix}' for operator '{op['business_name']}' (id={op['id']})")
   278|        results.append(f"Operators already exist ({op_count} found)")
   279|
   280|    # Ensure master user has no operator_id and correct role
   281|    conn.execute("UPDATE users SET operator_id = NULL WHERE role = 'master'")
   282|    # Promote first admin to master if no master exists
   283|    master_count = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'master'").fetchone()[0]
   284|    if master_count == 0:
   285|        conn.execute("UPDATE users SET role = 'master', operator_id = NULL WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)")
   286|        results.append("Promoted first admin to master")
   287|    results.append("Master user cleaned (operator_id=NULL)")
   288|
   289|    # SR fix: set status='assigned' for open SRs that have assigned_to
   290|    try:
   291|        # Debug: check what's actually in the DB
   292|        debug_rows = conn.execute(
   293|            "SELECT id, ticket_no, status, assigned_to FROM service_requests WHERE status = 'open'"
   294|        ).fetchall()
   295|        results.append(f"SR debug: found {len(debug_rows)} open SRs")
   296|        for r in debug_rows:
   297|            results.append(f"  SR id={r['id']} ticket={r['ticket_no']} assigned_to={r['assigned_to']!r}")
   298|
   299|        # Check if assigned_to column has empty strings instead of NULL
   300|        debug2 = conn.execute(
   301|            "SELECT id, ticket_no, status, assigned_to FROM service_requests WHERE status = 'open' AND (assigned_to IS NOT NULL AND assigned_to != '' AND assigned_to != 0)"
   302|        ).fetchall()
   303|        results.append(f"SR debug2: {len(debug2)} open SRs with non-null/non-empty assigned_to")
   304|
   305|        updated = conn.execute(
   306|            "UPDATE service_requests SET status = 'assigned', updated_at = CURRENT_TIMESTAMP "
   307|            "WHERE status = 'open' AND assigned_to IS NOT NULL AND assigned_to != '' AND assigned_to != 0"
   308|        )
   309|        conn.commit()
   310|        results.append(f"SR fix: updated {updated.rowcount} rows")
   311|    except Exception as e:
   312|        results.append(f"SR fix error: {e}")
   313|
   314|    # Ensure each operator has an admin (LCO) login
   315|    all_ops = conn.execute("SELECT id, business_name, phone FROM operators WHERE status != 'suspended'").fetchall()
   316|    for op in all_ops:
   317|        admin = conn.execute("SELECT id FROM users WHERE operator_id = ? AND role = 'admin'", (op["id"],)).fetchone()
   318|        if not admin:
   319|            username = re.sub(r'[^a-z0-9]', '', op["business_name"].lower())[:15]
   320|            if not username:
   321|                username = f"op{op['id']}"
   322|            # Ensure unique username
   323|            if conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
   324|                username = f"{username}{op['id']}"
   325|            temp_pwd = f"{username}@2025"
   326|            conn.execute(
   327|                """INSERT INTO users (username, password, name, role, phone, operator_id, status, created_at)
   328|                   VALUES (?, ?, ?, 'admin', ?, ?, 'Active', datetime('now'))""",
   329|                (username, hash_password(temp_pwd), f"{op['business_name']} Admin", op["phone"], op["id"]),
   330|            )
   331|            results.append(f"Created LCO admin '{username}' (password: {temp_pwd}) for operator '{op['business_name']}'")
   332|
   333|    conn.commit()
   334|    conn.close()
   335|    return {"ok": True, "results": results}
   336|
   337|
   338|# ============================================================
   339|# DATA IMPORT — Master admin only
   340|# Three sources: CSV upload, Paypakka API, Manual text
   341|# Flow: preview → confirm (two-step)
   342|# ============================================================
   343|
   344|# In-memory preview store (cleared on server restart, fine for import sessions)
   345|_import_previews = {}
   346|
   347|
   348|def _get_operator_prefix(conn, operator_id: int) -> str:
   349|    """Get customer_prefix for an operator."""
   350|    op = conn.execute("SELECT customer_prefix FROM operators WHERE id = ?", (operator_id,)).fetchone()
   351|    if not op or not op["customer_prefix"]:
   352|        raise HTTPException(400, f"Operator {operator_id} has no customer_prefix set")
   353|    return op["customer_prefix"]
   354|
   355|
   356|def _next_customer_num(conn, prefix: str) -> int:
   357|    """Get next customer number for a given prefix."""
   358|    last = conn.execute(
   359|        "SELECT customer_id FROM customers WHERE customer_id LIKE ? ORDER BY customer_id DESC LIMIT 1",
   360|        (f"{prefix}-%",),
   361|    ).fetchone()
   362|    if last:
   363|        m = re.search(r'-(\d+)', last["customer_id"])
   364|        return int(m.group(1)) + 1 if m else 1
   365|    return 1
   366|
   367|
   368|def _parse_csv(file_content: bytes) -> list:
   369|    """Parse CSV content into list of customer dicts."""
   370|    text = file_content.decode("utf-8-sig")  # handle BOM
   371|    reader = csv.DictReader(io.StringIO(text))
   372|    rows = []
   373|    for row in reader:
   374|        # Normalize column names (case-insensitive, strip spaces)
   375|        normalized = {}
   376|        for k, v in row.items():
   377|            key = (k or "").strip().lower().replace(" ", "_")
   378|            val = (v or "").strip()
   379|            normalized[key] = val
   380|        rows.append(normalized)
   381|    return rows
   382|
   383|
   384|def _parse_manual(text: str) -> list:
   385|    """Parse manual text entry into list of customer dicts.
   386|    Formats per line:
   387|    - name, phone, amount
   388|    - name, phone, amount, area
   389|    - name | phone | amount
   390|    Separators: comma, tab, pipe
   391|    """
   392|    rows = []
   393|    for line in text.strip().split("\n"):
   394|        line = line.strip()
   395|        if not line:
   396|            continue
   397|        # Detect separator
   398|        if "|" in line:
   399|            parts = [p.strip() for p in line.split("|")]
   400|        elif "\t" in line:
   401|            parts = [p.strip() for p in line.split("\t")]
   402|        else:
   403|            parts = [p.strip() for p in line.split(",")]
   404|
   405|        if len(parts) < 2:
   406|            continue  # skip lines with just name
   407|
   408|        row = {
   409|            "name": parts[0],
   410|            "phone": parts[1] if len(parts) > 1 else "",
   411|            "plan_amount": parts[2] if len(parts) > 2 else "",
   412|            "area": parts[3] if len(parts) > 3 else "",
   413|        }
   414|        rows.append(row)
   415|    return rows
   416|
   417|
   418|def _validate_customer_row(row: dict, idx: int) -> dict:
   419|    """Validate and normalize a single customer row. Returns {valid, errors, data}."""
   420|    errors = []
   421|    name = row.get("name", "").strip()
   422|    phone = row.get("phone", "").strip()
   423|    area = row.get("area", "").strip()
   424|    address = row.get("address", "").strip()
   425|    plan_name = row.get("plan_name", "").strip()
   426|    plan_amount_str = str(row.get("plan_amount", "") or row.get("amount", "")).strip()
   427|    stb_no = str(row.get("stb_no", "") or row.get("stb_number", "") or row.get("set_top_box", "")).strip()
   428|    can_id = str(row.get("can_id", "") or row.get("card_no", "")).strip()
   429|    mso = row.get("mso", "").strip() or "GTPL"
   430|
   431|    if not name:
   432|        errors.append(f"Row {idx}: Name is required")
   433|    if not phone:
   434|        errors.append(f"Row {idx}: Phone is required")
   435|
   436|    # Parse plan amount
   437|    plan_amount = None
   438|    if plan_amount_str:
   439|        try:
   440|            plan_amount = float(re.sub(r'[^\d.]', '', plan_amount_str))
   441|        except ValueError:
   442|            errors.append(f"Row {idx}: Invalid plan amount '{plan_amount_str}'")
   443|
   444|    return {
   445|        "valid": len(errors) == 0,
   446|        "errors": errors,
   447|        "data": {
   448|            "name": name,
   449|            "phone": phone,
   450|            "area": area,
   451|            "address": address,
   452|            "plan_name": plan_name,
   453|            "plan_amount": plan_amount,
   454|            "stb_no": stb_no,
   455|            "can_id": can_id,
   456|            "mso": mso,
   457|        }
   458|    }
   459|
   460|
   461|# --- STEP 1: PREVIEW IMPORT ---
   462|
   463|@router.post("/import/preview")
   464|async def import_preview(
   465|    operator_id: int = Form(...),
   466|    source: str = Form(...),
   467|    csv_file: Optional[UploadFile] = File(None),
   468|    paypakka_account_id: Optional[str] = Form(None),
   469|    paypakka_password: Optional[str] = Form(None),
   470|    manual_text: Optional[str] = Form(None),
   471|    user=Depends(require_master),
   472|):
   473|    """Step 1: Parse and validate import data. Returns preview with counts and errors."""
   474|    raw_rows = []
   475|
   476|    if source == "csv":
   477|        if not csv_file:
   478|            raise HTTPException(400, "CSV file required for CSV import")
   479|        content = await csv_file.read()
   480|        raw_rows = _parse_csv(content)
   481|
   482|    elif source == "paypakka":
   483|        if not paypakka_account_id or not paypakka_password:
   484|            raise HTTPException(400, "Paypakka account ID and password required")
   485|        # Login to Paypakka and fetch customer list
   486|        try:
   487|            async with httpx.AsyncClient(timeout=30) as client:
   488|                # Login
   489|                login_resp = await client.post(
   490|                    "https://api.paypakka.com/api/v2/auth/signin",
   491|                    json={"account_id": paypakka_account_id, "password": paypakka_password, "token": "***"},
   492|                    headers={"Content-Type": "application/json"},
   493|                )
   494|                if login_resp.status_code != 200:
   495|                    raise HTTPException(400, f"Paypakka login failed: {login_resp.text[:200]}")
   496|                auth_token = login_resp.json().get("auth_token") or login_resp.json().get("data", {}).get("auth_token")
   497|                if not auth_token:
   498|                    raise HTTPException(400, "No auth token from Paypakka")
   499|
   500|                # Get distributor_ref_id from login response
   501|                login_data = login_resp.json().get("data", login_resp.json())
   502|                dist_ref_id = login_data.get("distributor_ref_id", "")
   503|                if not dist_ref_id:
   504|                    # Try to get from config
   505|                    from config import PAYPAKKA_DISTRIBUTOR_REF_ID
   506|                    dist_ref_id = PAYPAKKA_DISTRIBUTOR_REF_ID
   507|
   508|                headers = {
   509|                    "x-access-token": auth_token,
   510|                    "x-app-version": "1.0",
   511|                    "x-user-agent": "Web",
   512|                    "x-app-id": "Distributor",
   513|                    "Content-Type": "application/json",
   514|                }
   515|
   516|                # Fetch active customers
   517|                resp = await client.post(
   518|                    "https://api.paypakka.com/api/v2/cust/list",
   519|                    json={"distributor_ref_id": dist_ref_id, "limit": 5000, "status": "Active"},
   520|                    headers=headers,
   521|                )
   522|                customers = resp.json().get("data", [])
   523|
   524|                # Fetch inactive too
   525|                resp2 = await client.post(
   526|                    "https://api.paypakka.com/api/v2/cust/list",
   527|                    json={"distributor_ref_id": dist_ref_id, "limit": 5000, "status": "Inactive"},
   528|                    headers=headers,
   529|                )
   530|                customers.extend(resp2.json().get("data", []))
   531|
   532|                # Convert Paypakka format to our import format
   533|                for c in customers:
   534|                    services = c.get("services", [])
   535|                    svc = services[0] if services else {}
   536|                    raw_rows.append({
   537|                        "name": c.get("name", ""),
   538|                        "phone": c.get("mobile_no", "").replace("+91", ""),
   539|                        "area": c.get("area", ""),
   540|                        "address": c.get("address", ""),
   541|                        "plan_name": svc.get("plan_name", ""),
   542|                        "plan_amount": str(svc.get("plan_amount", "")),
   543|                        "stb_no": svc.get("stb_no", ""),
   544|                        "can_id": svc.get("can_id", ""),
   545|                        "mso": svc.get("mso", "GTPL"),
   546|                    })
   547|        except httpx.HTTPError as e:
   548|            raise HTTPException(400, f"Paypakka connection error: {str(e)}")
   549|
   550|    elif source == "manual":
   551|        if not manual_text:
   552|            raise HTTPException(400, "Manual text required")
   553|        raw_rows = _parse_manual(manual_text)
   554|
   555|    else:
   556|        raise HTTPException(400, f"Unknown source: {source}. Use 'csv', 'paypakka', or 'manual'")
   557|
   558|    # Validate all rows
   559|    validated = []
   560|    errors = []
   561|    for i, row in enumerate(raw_rows):
   562|        result = _validate_customer_row(row, i + 1)
   563|        validated.append(result)
   564|        if result["errors"]:
   565|            errors.extend(result["errors"])
   566|
   567|    valid_rows = [v["data"] for v in validated if v["valid"]]
   568|    invalid_count = len(validated) - len(valid_rows)
   569|
   570|    # Check for duplicates within the import
   571|    seen_phones = {}
   572|    for r in valid_rows:
   573|        ph = r["phone"]
   574|        if ph in seen_phones:
   575|            errors.append(f"Duplicate phone in import: {ph} ({r['name']} and {seen_phones[ph]})")
   576|        seen_phones[ph] = r["name"]
   577|
   578|    # Check existing customers in DB
   579|    with get_conn() as conn:
   580|        existing_phones = set()
   581|        for r in valid_rows:
   582|            ex = conn.execute(
   583|                "SELECT customer_id, name FROM customers WHERE phone LIKE ? AND operator_id = ?",
   584|                (f"%{r['phone'][-10:]}", operator_id),
   585|            ).fetchone()
   586|            if ex:
   587|                existing_phones[r["phone"]] = f"{ex['name']} ({ex['customer_id']})"
   588|
   589|    # Existing plans for this operator
   590|    with get_conn() as conn:
   591|        existing_plans = {}
   592|        for p in conn.execute("SELECT id, name, amount FROM plans WHERE operator_id = ?", (operator_id,)).fetchall():
   593|            existing_plans[p["name"].lower()] = dict(p)
   594|
   595|    # Identify plans to create
   596|    plans_to_create = {}
   597|    for r in valid_rows:
   598|        if r["plan_name"] and r["plan_amount"]:
   599|            key = f"{r['plan_name']}|{r['plan_amount']}"
   600|            if r["plan_name"].lower() not in existing_plans and key not in plans_to_create:
   601|                plans_to_create[key] = {"name": r["plan_name"], "amount": r["plan_amount"], "mso": r["mso"]}
   602|
   603|    # Store preview for confirmation
   604|    preview_id = str(uuid.uuid4())[:8]
   605|    _import_previews[preview_id] = {
   606|        "operator_id": operator_id,
   607|        "source": source,
   608|        "valid_rows": valid_rows,
   609|        "plans_to_create": list(plans_to_create.values()),
   610|        "existing_phones": existing_phones,
   611|        "created_at": datetime.now().isoformat(),
   612|    }
   613|
   614|    return {
   615|        "preview_id": preview_id,
   616|        "total_rows": len(raw_rows),
   617|        "valid_count": len(valid_rows),
   618|        "invalid_count": invalid_count,
   619|        "errors": errors[:50],  # Cap errors to avoid huge responses
   620|        "existing_customers": existing_phones,  # phone → "name (ID)"
   621|        "plans_to_create": list(plans_to_create.values()),
   622|        "existing_plans": list(existing_plans.values()),
   623|        "sample_rows": valid_rows[:5],  # Preview first 5 rows
   624|    }
   625|
   626|
   627|# --- STEP 2: CONFIRM IMPORT ---
   628|
   629|class ImportConfirmRequest(BaseModel):
   630|    preview_id: str
   631|    skip_existing: bool = True  # Skip customers whose phone already exists
   632|    create_plans: bool = True  # Auto-create plans that don't exist
   633|
   634|
   635|@router.post("/import/confirm")
   636|def import_confirm(data: ImportConfirmRequest, user=Depends(require_master)):
   637|    """Step 2: Execute the import after preview confirmation."""
   638|    preview = _import_previews.get(data.preview_id)
   639|    if not preview:
   640|        raise HTTPException(400, "Preview not found or expired. Please preview again.")
   641|
   642|    # Preview expires after 30 minutes
   643|    elapsed = (datetime.now() - datetime.fromisoformat(preview["created_at"])).total_seconds()
   644|    if elapsed > 1800:
   645|        del _import_previews[data.preview_id]
   646|        raise HTTPException(400, "Preview expired. Please preview again.")
   647|
   648|    operator_id = preview["operator_id"]
   649|    valid_rows = preview["valid_rows"]
   650|    existing_phones = preview["existing_phones"]
   651|
   652|    with get_conn() as conn:
   653|        prefix = _get_operator_prefix(conn, operator_id)
   654|        next_num = _next_customer_num(conn, prefix)
   655|
   656|        # Create plans if requested
   657|        plan_map = {}  # "name|amount" → plan_id
   658|        if data.create_plans:
   659|            for plan_data in preview["plans_to_create"]:
   660|                # Check again (might have been created since preview)
   661|                existing = conn.execute(
   662|                    "SELECT id FROM plans WHERE name = ? AND operator_id = ?",
   663|                    (plan_data["name"], operator_id),
   664|                ).fetchone()
   665|                if existing:
   666|                    plan_map[f"{plan_data['name']}|{plan_data['amount']}"] = existing["id"]
   667|                else:
   668|                    conn.execute(
   669|                        """INSERT INTO plans (name, amount, validity_days, status, network, operator_id)
   670|                           VALUES (?, ?, 30, 'Active', ?, ?)""",
   671|                        (plan_data["name"], plan_data["amount"], plan_data.get("mso", "GTPL"), operator_id),
   672|                    )
   673|                    plan_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
   674|                    plan_map[f"{plan_data['name']}|{plan_data['amount']}"] = plan_id
   675|
   676|        # Also load existing plans
   677|        for p in conn.execute("SELECT id, name, amount FROM plans WHERE operator_id = ?", (operator_id,)).fetchall():
   678|            plan_map[f"{p['name']}|{p['amount']}"] = p["id"]
   679|            plan_map[p["name"].lower()] = p["id"]  # name-only lookup too
   680|
   681|        # Insert customers
   682|        created = 0
   683|        skipped = 0
   684|        errors = []
   685|
   686|        for row in valid_rows:
   687|            phone = row["phone"]
   688|            # Check if should skip
   689|            if data.skip_existing and phone in existing_phones:
   690|                skipped += 1
   691|                continue
   692|
   693|            # Double-check phone in DB
   694|            if data.skip_existing:
   695|                ex = conn.execute(
   696|                    "SELECT id FROM customers WHERE phone LIKE ? AND operator_id = ?",
   697|                    (f"%{phone[-10:]}", operator_id),
   698|                ).fetchone()
   699|                if ex:
   700|                    skipped += 1
   701|                    continue
   702|
   703|            customer_id = f"{prefix}-{next_num:06d}"
   704|            next_num += 1
   705|
   706|            try:
   707|                conn.execute(
   708|                    """INSERT INTO customers (customer_id, name, phone, area, address, status, operator_id)
   709|                       VALUES (?, ?, ?, ?, ?, 'Active', ?)""",
   710|                    (customer_id, row["name"], phone, row.get("area", ""), row.get("address", ""), operator_id),
   711|                )
   712|
   713|                # Create connection if STB provided
   714|                stb_no = row.get("stb_no", "")
   715|                if stb_no:
   716|                    network = "TACTV" if (stb_no.startswith("172") or stb_no.startswith("173")) else \
   717|                              ("SCV" if stb_no.startswith("5000") else "GTPL")
   718|                    conn.execute(
   719|                        """INSERT INTO connections (customer_id, stb_no, can_id, mso, service_type, billing_type,
   720|                           status, network, created_at, plan_name, plan_amount, operator_id)
   721|                           VALUES (?, ?, ?, ?, 'Cable', 'Prepaid', 'Active', ?, datetime('now'), ?, ?, ?)""",
   722|                        (customer_id, stb_no, row.get("can_id", ""), row.get("mso", "GTPL"), network,
   723|                         row.get("plan_name", ""), row.get("plan_amount"), operator_id),
   724|                    )
   725|
   726|                    # Assign plan if matched
   727|                    plan_id = None
   728|                    if row.get("plan_name") and row.get("plan_amount"):
   729|                        key = f"{row['plan_name']}|{row['plan_amount']}"
   730|                        plan_id = plan_map.get(key) or plan_map.get(row["plan_name"].lower())
   731|
   732|                    if plan_id and stb_no:
   733|                        # Get the connection we just created
   734|                        cn = conn.execute(
   735|                            "SELECT id FROM connections WHERE customer_id = ? AND stb_no = ?",
   736|                            (customer_id, stb_no),
   737|                        ).fetchone()
   738|                        if cn:
   739|                            today = datetime.now().strftime("%Y-%m-%d")
   740|                            from datetime import timedelta
   741|                            expiry = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
   742|                            conn.execute(
   743|                                """INSERT INTO customer_plans (customer_id, connection_id, plan_id, amount,
   744|                                   start_date, expiry_date, status, created_at, operator_id)
   745|                                   VALUES (?, ?, ?, ?, ?, ?, 'Active', datetime('now'), ?)""",
   746|                                (customer_id, cn["id"], plan_id, row.get("plan_amount", 0),
   747|                                 today, expiry, operator_id),
   748|                            )
   749|
   750|                created += 1
   751|            except Exception as e:
   752|                errors.append(f"Failed to import {row['name']}: {str(e)}")
   753|
   754|        conn.commit()
   755|
   756|    # Clean up preview
   757|    del _import_previews[data.preview_id]
   758|
   759|    return {
   760|        "ok": True,
   761|        "created": created,
   762|        "skipped": skipped,
   763|        "errors": errors[:20],
   764|        "operator_id": operator_id,
   765|    }
   766|
   767|
   768|# --- CSV TEMPLATE DOWNLOAD ---
   769|
   770|@router.post("/fix-sr-status")
   771|def fix_sr_status(user=Depends(require_master)):
   772|    """Force-fix all open SRs that have an assigned_to value."""
   773|    import sqlite3
   774|    conn = sqlite3.connect(DB_PATH)
   775|    conn.row_factory = sqlite3.Row
   776|    results = []
   777|
   778|    # Debug: show what's in the DB
   779|    debug = conn.execute("SELECT id, ticket_no, status, assigned_to FROM service_requests WHERE status = 'open'").fetchall()
   780|    results.append("Open SRs: {}".format(len(debug)))
   781|    for r in debug:
   782|        results.append("  id={} ticket={} assigned_to={} (type={})".format(r['id'], r['ticket_no'], r['assigned_to'], type(r['assigned_to']).__name__))
   783|
   784|    # Fix
   785|    cur = conn.execute(
   786|        "UPDATE service_requests SET status = 'assigned', updated_at = CURRENT_TIMESTAMP "
   787|        "WHERE status = 'open' AND assigned_to IS NOT NULL AND assigned_to != '' AND CAST(assigned_to AS INTEGER) != 0"
   788|    )
   789|    conn.commit()
   790|    results.append("Updated {} rows to assigned".format(cur.rowcount))
   791|
   792|    # Verify
   793|    still_open = conn.execute("SELECT COUNT(*) as c FROM service_requests WHERE status = 'open'").fetchone()['c']
   794|    now_assigned = conn.execute("SELECT COUNT(*) as c FROM service_requests WHERE status = 'assigned'").fetchone()['c']
   795|    results.append("After: open={}, assigned={}".format(still_open, now_assigned))
   796|    conn.close()
   797|    return {"ok": True, "results": results}
   798|
   799|
   800|@router.get("/import/template")
   801|def download_csv_template(user=Depends(require_master)):
   802|    """Download CSV import template with sample data."""
   803|    from fastapi.responses import StreamingResponse
   804|
   805|    output = io.StringIO()
   806|    writer = csv.writer(output)
   807|    writer.writerow(["name", "phone", "area", "address", "plan_name", "plan_amount", "stb_no", "can_id", "mso"])
   808|    writer.writerow(["Rajesh Kumar", "9876543210", "Gandhi Nagar", "12, Main Road", "TAMIL POWER", "280", "3381298100", "21103167", "GTPL"])
   809|    writer.writerow(["Meena Devi", "9123456789", "Nehru Colony", "", "Basic", "200", "", "", "GTPL"])
   810|    writer.writerow(["Sample Customer", "9000000000", "Area Name", "Address line", "Full Pack", "350", "5000123456", "", "SCV"])
   811|
   812|    output.seek(0)
   813|    return StreamingResponse(
   814|        io.BytesIO(output.getvalue().encode("utf-8-sig")),
   815|        media_type="text/csv",
   816|        headers={"Content-Disposition": "attachment; filename=cabletv_import_template.csv"},
   817|    )
   818|