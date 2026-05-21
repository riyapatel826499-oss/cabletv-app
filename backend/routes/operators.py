"""Operator management — Master admin only. CRUD for cable TV operators + data import."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List
import csv
import io
import json
import re
import uuid
import httpx
from datetime import datetime

from deps import get_current_user, op_id
from deps_orm import _op_flt
from conn import get_conn
from utils import hash_password

router = APIRouter(prefix="/api/operators", tags=["Operators"])


def require_master(user=Depends(get_current_user)):
    if user.get("role") != "master":
        raise HTTPException(403, "Master admin only")
    return user


@router.get("/")
def list_operators(user=Depends(require_master)):
    """List all operators with stats."""
    # Compute month start in IST (UTC+5:30) — replaces SQLite date('now','+5 hours','+30 minutes','start of month')
    from datetime import timedelta
    now_ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
    month_start = now_ist.strftime("%Y-%m-01")

    with get_conn() as conn:
        ops = conn.execute("""
            SELECT o.*,
                (SELECT COUNT(*) FROM customers WHERE operator_id = o.id) as customer_count,
                (SELECT COUNT(*) FROM customers WHERE operator_id = o.id AND status = 'Active') as active_count,
                (SELECT COUNT(*) FROM connections WHERE operator_id = o.id AND status = 'Active') as connection_count,
                (SELECT COUNT(*) FROM users WHERE operator_id = o.id) as staff_count,
                (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE operator_id = o.id
                    AND collected_at >= ?)
                + (SELECT COALESCE(SUM(collection_amount), 0) FROM paypakka_payments WHERE operator_id = o.id
                    AND paypakka_created_at >= ?)
                as month_collection,
                (SELECT username FROM users WHERE operator_id = o.id AND role = 'admin' LIMIT 1) as admin_username,
                (SELECT name FROM users WHERE operator_id = o.id AND role = 'admin' LIMIT 1) as admin_name,
                (SELECT phone FROM users WHERE operator_id = o.id AND role = 'admin' LIMIT 1) as admin_phone
            FROM operators o
            ORDER BY o.created_at DESC
        """, (month_start, month_start)).fetchall()
        return [dict(o) for o in ops]


@router.get("/{operator_id}")
def get_operator(operator_id: int, user=Depends(require_master)):
    with get_conn() as conn:
        op = conn.execute("SELECT * FROM operators WHERE id = ?", (operator_id,)).fetchone()
        if not op:
            raise HTTPException(404, "Operator not found")
        return dict(op)


class OperatorCreate(BaseModel):
    business_name: str
    owner_name: str
    phone: str
    email: Optional[str] = ""
    area: Optional[str] = ""
    mso: Optional[str] = "GTPL"
    notes: Optional[str] = ""
    customer_prefix: str  # 2-5 char prefix for customer IDs (e.g., "SSA", "TVC")
    # Admin login for this operator
    admin_username: str
    admin_password: str
    admin_name: Optional[str] = ""


@router.post("/")
def create_operator(data: OperatorCreate, user=Depends(require_master)):
    """Create a new operator + their admin login."""
    # Validate prefix: 2-5 uppercase alphanumeric
    prefix = data.customer_prefix.strip().upper()
    if not re.match(r'^[A-Z0-9]{2,5}$', prefix):
        raise HTTPException(400, "Customer prefix must be 2-5 uppercase letters/numbers (e.g., SSA, TVC)")

    with get_conn() as conn:
        # Check username uniqueness
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (data.admin_username,)).fetchone()
        if existing:
            raise HTTPException(400, f"Username '{data.admin_username}' already taken")

        # Check prefix uniqueness
        existing_prefix = conn.execute("SELECT id, business_name FROM operators WHERE customer_prefix = ?", (prefix,)).fetchone()
        if existing_prefix:
            raise HTTPException(400, f"Prefix '{prefix}' already used by {existing_prefix['business_name']}")

        # Create operator
        conn.execute(
            """INSERT INTO operators (business_name, owner_name, phone, email, area, mso, notes, customer_prefix)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (data.business_name, data.owner_name, data.phone, data.email, data.area, data.mso, data.notes, prefix),
        )
        new_op_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        # Create admin user for this operator
        conn.execute(
            """INSERT INTO users (username, password, name, role, phone, operator_id)
               VALUES (?, ?, ?, 'admin', ?, ?)""",
            (data.admin_username, hash_password(data.admin_password),
             data.admin_name or data.owner_name, data.phone, new_op_id),
        )
        conn.commit()

        return {"ok": True, "operator_id": new_op_id, "message": f"Operator '{data.business_name}' created with admin login '{data.admin_username}'"}


class OperatorUpdate(BaseModel):
    business_name: Optional[str] = None
    owner_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    area: Optional[str] = None
    mso: Optional[str] = None
    status: Optional[str] = None  # active, suspended
    license_type: Optional[str] = None  # active, trial, expired
    notes: Optional[str] = None
    customer_prefix: Optional[str] = None


@router.put("/{operator_id}")
def update_operator(operator_id: int, data: OperatorUpdate, user=Depends(require_master)):
    with get_conn() as conn:
        op = conn.execute("SELECT id FROM operators WHERE id = ?", (operator_id,)).fetchone()
        if not op:
            raise HTTPException(404, "Operator not found")

        updates = data.model_dump(exclude_unset=True)
        if not updates:
            raise HTTPException(400, "No fields to update")

        set_clause = ", ".join([f"{k} = ?" for k in updates])
        conn.execute(
            f"UPDATE operators SET {set_clause} WHERE id = ?",
            list(updates.values()) + [operator_id],
        )
        conn.commit()
        return {"ok": True, "updated": list(updates.keys())}


@router.delete("/{operator_id}")
def delete_operator(operator_id: int, user=Depends(require_master)):
    """Suspend operator (soft delete — data preserved)."""
    with get_conn() as conn:
        op = conn.execute("SELECT id, business_name FROM operators WHERE id = ?", (operator_id,)).fetchone()
        if not op:
            raise HTTPException(404, "Operator not found")

        conn.execute("UPDATE operators SET status = 'suspended' WHERE id = ?", (operator_id,))
        # Deactivate all users for this operator
        conn.execute("UPDATE users SET status = 'Inactive' WHERE operator_id = ?", (operator_id,))
        conn.commit()
        return {"ok": True, "message": f"Operator '{op['business_name']}' suspended. All staff deactivated."}


@router.post("/{operator_id}/reset-admin-password")
def reset_admin_password(operator_id: int, new_password: str, user=Depends(require_master)):
    """Reset the admin password for an operator."""
    with get_conn() as conn:
        admin = conn.execute(
            "SELECT id, name FROM users WHERE operator_id = ? AND role = 'admin' LIMIT 1",
            (operator_id,),
        ).fetchone()
        if not admin:
            raise HTTPException(404, "No admin user found for this operator")

        conn.execute("UPDATE users SET password = ? WHERE id = ?", (hash_password(new_password), admin["id"]))
        conn.commit()
        return {"ok": True, "message": f"Password reset for {admin['name']}"}


@router.post("/migrate")
def run_migration(user=Depends(require_master)):
    """Run multi-tenant migration on DB — idempotent, safe to re-run."""
    conn = get_conn()
    results = []

    # Tables that need operator_id
    tables = [
        "customers", "connections", "plans", "customer_plans",
        "payments", "paypakka_payments", "paypakka_plans",
        "paypakka_customer_plans", "paypakka_employees",
        "stb_inventory", "surrender_requests", "complaints",
        "sms_log", "online_payments", "users",
    ]

    for table in tables:
        try:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            if "operator_id" not in cols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN operator_id INTEGER DEFAULT NULL")
                results.append(f"Added operator_id to {table}")
            else:
                results.append(f"{table} already has operator_id")
        except Exception as e:
            results.append(f"{table}: {e}")

    # Create operators table if not exists
    conn.execute("""CREATE TABLE IF NOT EXISTS operators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT DEFAULT '',
        area TEXT DEFAULT '',
        mso TEXT DEFAULT 'GTPL',
        status TEXT DEFAULT 'active',
        license_type TEXT DEFAULT 'active',
        notes TEXT DEFAULT '',
        customer_prefix TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    results.append("operators table ensured")

    # Ensure customer_prefix column exists
    op_cols = [r[1] for r in conn.execute("PRAGMA table_info(operators)").fetchall()]
    if "customer_prefix" not in op_cols:
        conn.execute("ALTER TABLE operators ADD COLUMN customer_prefix TEXT DEFAULT ''")
        results.append("Added customer_prefix to operators")

    # Create notification_settings with composite PK
    conn.execute("""CREATE TABLE IF NOT EXISTS notification_settings (
        key TEXT NOT NULL,
        operator_id INTEGER NOT NULL DEFAULT 1,
        value TEXT NOT NULL,
        PRIMARY KEY (key, operator_id)
    )""")
    results.append("notification_settings table ensured")

    # Seed default operator if not exists
    op_count = conn.execute("SELECT COUNT(*) FROM operators").fetchone()[0]
    if op_count == 0:
        conn.execute("""INSERT INTO operators (business_name, owner_name, phone, area, mso, customer_prefix)
            VALUES ('SSN Cables', 'Prabhu', '9787225577', 'Tirupur', 'GTPL', 'SSA')""")
        op_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        results.append(f"Created default operator 'SSN Cables' (id={op_id})")

        # Assign all existing data to this operator
        for table in tables:
            if table == "users":
                conn.execute(f"UPDATE {table} SET operator_id = ? WHERE role != 'master'", (op_id,))
            else:
                conn.execute(f"UPDATE {table} SET operator_id = ? WHERE operator_id IS NULL", (op_id,))
        results.append(f"Assigned all existing data to operator {op_id}")
    else:
        # Ensure existing operator has customer_prefix
        ops = conn.execute("SELECT id, business_name FROM operators WHERE customer_prefix IS NULL OR customer_prefix = ''").fetchall()
        for op in ops:
            # Check if there are existing customers to detect prefix from
            sample_cid = conn.execute(
                "SELECT customer_id FROM customers WHERE operator_id = ? LIMIT 1", (op["id"],)
            ).fetchone()
            if sample_cid:
                m = re.match(r'^([A-Za-z]+)-', sample_cid["customer_id"])
                if m:
                    prefix = m.group(1).upper()
                else:
                    words = re.findall(r'[A-Za-z]+', op["business_name"])
                    prefix = "".join(w[0].upper() for w in words[:3])[:4] if words else "OP"
            else:
                words = re.findall(r'[A-Za-z]+', op["business_name"])
                prefix = "".join(w[0].upper() for w in words[:3])[:4] if words else "OP"
            conn.execute("UPDATE operators SET customer_prefix = ? WHERE id = ?", (prefix, op["id"]))
            results.append(f"Set prefix '{prefix}' for operator '{op['business_name']}' (id={op['id']})")
        results.append(f"Operators already exist ({op_count} found)")

    # Ensure master user has no operator_id and correct role
    conn.execute("UPDATE users SET operator_id = NULL WHERE role = 'master'")
    # Promote first admin to master if no master exists
    master_count = conn.execute("SELECT COUNT(*) FROM users WHERE role = 'master'").fetchone()[0]
    if master_count == 0:
        conn.execute("UPDATE users SET role = 'master', operator_id = NULL WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1)")
        results.append("Promoted first admin to master")
    results.append("Master user cleaned (operator_id=NULL)")

    # SR fix: set status='assigned' for open SRs that have assigned_to
    try:
        # Debug: check what's actually in the DB
        debug_rows = conn.execute(
            "SELECT id, ticket_no, status, assigned_to FROM service_requests WHERE status = 'open'"
        ).fetchall()
        results.append(f"SR debug: found {len(debug_rows)} open SRs")
        for r in debug_rows:
            results.append(f"  SR id={r['id']} ticket={r['ticket_no']} assigned_to={r['assigned_to']!r}")

        # Check if assigned_to column has empty strings instead of NULL
        debug2 = conn.execute(
            "SELECT id, ticket_no, status, assigned_to FROM service_requests WHERE status = 'open' AND (assigned_to IS NOT NULL AND assigned_to != '' AND assigned_to != 0)"
        ).fetchall()
        results.append(f"SR debug2: {len(debug2)} open SRs with non-null/non-empty assigned_to")

        updated = conn.execute(
            "UPDATE service_requests SET status = 'assigned', updated_at = CURRENT_TIMESTAMP "
            "WHERE status = 'open' AND assigned_to IS NOT NULL AND assigned_to != '' AND assigned_to != 0"
        )
        conn.commit()
        results.append(f"SR fix: updated {updated.rowcount} rows")
    except Exception as e:
        results.append(f"SR fix error: {e}")

    # Ensure each operator has an admin (LCO) login
    all_ops = conn.execute("SELECT id, business_name, phone FROM operators WHERE status != 'suspended'").fetchall()
    for op in all_ops:
        admin = conn.execute("SELECT id FROM users WHERE operator_id = ? AND role = 'admin'", (op["id"],)).fetchone()
        if not admin:
            username = re.sub(r'[^a-z0-9]', '', op["business_name"].lower())[:15]
            if not username:
                username = f"op{op['id']}"
            # Ensure unique username
            if conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
                username = f"{username}{op['id']}"
            temp_pwd = f"{username}@2025"
            conn.execute(
                """INSERT INTO users (username, password, name, role, phone, operator_id, status, created_at)
                   VALUES (?, ?, ?, 'admin', ?, ?, 'Active', NOW())""",
                (username, hash_password(temp_pwd), f"{op['business_name']} Admin", op["phone"], op["id"]),
            )
            results.append(f"Created LCO admin '{username}' (password: {temp_pwd}) for operator '{op['business_name']}'")

    conn.commit()
    conn.close()
    return {"ok": True, "results": results}


# ============================================================
# DATA IMPORT — Master admin only
# Three sources: CSV upload, Paypakka API, Manual text
# Flow: preview → confirm (two-step)
# ============================================================

# In-memory preview store (cleared on server restart, fine for import sessions)
_import_previews = {}


def _get_operator_prefix(conn, operator_id: int) -> str:
    """Get customer_prefix for an operator."""
    op = conn.execute("SELECT customer_prefix FROM operators WHERE id = ?", (operator_id,)).fetchone()
    if not op or not op["customer_prefix"]:
        raise HTTPException(400, f"Operator {operator_id} has no customer_prefix set")
    return op["customer_prefix"]


def _next_customer_num(conn, prefix: str) -> int:
    """Get next customer number for a given prefix."""
    last = conn.execute(
        "SELECT customer_id FROM customers WHERE customer_id LIKE ? ORDER BY customer_id DESC LIMIT 1",
        (f"{prefix}-%",),
    ).fetchone()
    if last:
        m = re.search(r'-(\d+)', last["customer_id"])
        return int(m.group(1)) + 1 if m else 1
    return 1


def _parse_csv(file_content: bytes) -> list:
    """Parse CSV content into list of customer dicts."""
    text = file_content.decode("utf-8-sig")  # handle BOM
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        # Normalize column names (case-insensitive, strip spaces)
        normalized = {}
        for k, v in row.items():
            key = (k or "").strip().lower().replace(" ", "_")
            val = (v or "").strip()
            normalized[key] = val
        rows.append(normalized)
    return rows


def _parse_manual(text: str) -> list:
    """Parse manual text entry into list of customer dicts.
    Formats per line:
    - name, phone, amount
    - name, phone, amount, area
    - name | phone | amount
    Separators: comma, tab, pipe
    """
    rows = []
    for line in text.strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        # Detect separator
        if "|" in line:
            parts = [p.strip() for p in line.split("|")]
        elif "\t" in line:
            parts = [p.strip() for p in line.split("\t")]
        else:
            parts = [p.strip() for p in line.split(",")]

        if len(parts) < 2:
            continue  # skip lines with just name

        row = {
            "name": parts[0],
            "phone": parts[1] if len(parts) > 1 else "",
            "plan_amount": parts[2] if len(parts) > 2 else "",
            "area": parts[3] if len(parts) > 3 else "",
        }
        rows.append(row)
    return rows


def _validate_customer_row(row: dict, idx: int) -> dict:
    """Validate and normalize a single customer row. Returns {valid, errors, data}."""
    errors = []
    name = row.get("name", "").strip()
    phone = row.get("phone", "").strip()
    area = row.get("area", "").strip()
    address = row.get("address", "").strip()
    plan_name = row.get("plan_name", "").strip()
    plan_amount_str = str(row.get("plan_amount", "") or row.get("amount", "")).strip()
    stb_no = str(row.get("stb_no", "") or row.get("stb_number", "") or row.get("set_top_box", "")).strip()
    can_id = str(row.get("can_id", "") or row.get("card_no", "")).strip()
    mso = row.get("mso", "").strip() or "GTPL"

    if not name:
        errors.append(f"Row {idx}: Name is required")
    if not phone:
        errors.append(f"Row {idx}: Phone is required")

    # Parse plan amount
    plan_amount = None
    if plan_amount_str:
        try:
            plan_amount = float(re.sub(r'[^\d.]', '', plan_amount_str))
        except ValueError:
            errors.append(f"Row {idx}: Invalid plan amount '{plan_amount_str}'")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "data": {
            "name": name,
            "phone": phone,
            "area": area,
            "address": address,
            "plan_name": plan_name,
            "plan_amount": plan_amount,
            "stb_no": stb_no,
            "can_id": can_id,
            "mso": mso,
        }
    }


# --- STEP 1: PREVIEW IMPORT ---

@router.post("/import/preview")
async def import_preview(
    operator_id: int = Form(...),
    source: str = Form(...),
    csv_file: Optional[UploadFile] = File(None),
    paypakka_account_id: Optional[str] = Form(None),
    paypakka_password: Optional[str] = Form(None),
    manual_text: Optional[str] = Form(None),
    user=Depends(require_master),
):
    """Step 1: Parse and validate import data. Returns preview with counts and errors."""
    raw_rows = []

    if source == "csv":
        if not csv_file:
            raise HTTPException(400, "CSV file required for CSV import")
        content = await csv_file.read()
        raw_rows = _parse_csv(content)

    elif source == "paypakka":
        if not paypakka_account_id or not paypakka_password:
            raise HTTPException(400, "Paypakka account ID and password required")
        # Login to Paypakka and fetch customer list
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # Login
                login_resp = await client.post(
                    "https://api.paypakka.com/api/v2/auth/signin",
                    json={"account_id": paypakka_account_id, "password": paypakka_password, "token": "web"},
                    headers={"Content-Type": "application/json"},
                )
                if login_resp.status_code != 200:
                    raise HTTPException(400, f"Paypakka login failed: {login_resp.text[:200]}")
                auth_token = login_resp.json().get("auth_token") or login_resp.json().get("data", {}).get("auth_token")
                if not auth_token:
                    raise HTTPException(400, "No auth token from Paypakka")

                # Get distributor_ref_id from login response
                login_data = login_resp.json().get("data", login_resp.json())
                dist_ref_id = login_data.get("distributor_ref_id", "")
                if not dist_ref_id:
                    # Try to get from config
                    from config import PAYPAKKA_DISTRIBUTOR_REF_ID
                    dist_ref_id = PAYPAKKA_DISTRIBUTOR_REF_ID

                headers = {
                    "x-access-token": auth_token,
                    "x-app-version": "1.0",
                    "x-user-agent": "Web",
                    "x-app-id": "Distributor",
                    "Content-Type": "application/json",
                }

                # Fetch active customers
                resp = await client.post(
                    "https://api.paypakka.com/api/v2/cust/list",
                    json={"distributor_ref_id": dist_ref_id, "limit": 5000, "status": "Active"},
                    headers=headers,
                )
                customers = resp.json().get("data", [])

                # Fetch inactive too
                resp2 = await client.post(
                    "https://api.paypakka.com/api/v2/cust/list",
                    json={"distributor_ref_id": dist_ref_id, "limit": 5000, "status": "Inactive"},
                    headers=headers,
                )
                customers.extend(resp2.json().get("data", []))

                # Convert Paypakka format to our import format
                for c in customers:
                    services = c.get("services", [])
                    svc = services[0] if services else {}
                    raw_rows.append({
                        "name": c.get("name", ""),
                        "phone": c.get("mobile_no", "").replace("+91", ""),
                        "area": c.get("area", ""),
                        "address": c.get("address", ""),
                        "plan_name": svc.get("plan_name", ""),
                        "plan_amount": str(svc.get("plan_amount", "")),
                        "stb_no": svc.get("stb_no", ""),
                        "can_id": svc.get("can_id", ""),
                        "mso": svc.get("mso", "GTPL"),
                    })
        except httpx.HTTPError as e:
            raise HTTPException(400, f"Paypakka connection error: {str(e)}")

    elif source == "manual":
        if not manual_text:
            raise HTTPException(400, "Manual text required")
        raw_rows = _parse_manual(manual_text)

    else:
        raise HTTPException(400, f"Unknown source: {source}. Use 'csv', 'paypakka', or 'manual'")

    # Validate all rows
    validated = []
    errors = []
    for i, row in enumerate(raw_rows):
        result = _validate_customer_row(row, i + 1)
        validated.append(result)
        if result["errors"]:
            errors.extend(result["errors"])

    valid_rows = [v["data"] for v in validated if v["valid"]]
    invalid_count = len(validated) - len(valid_rows)

    # Check for duplicates within the import
    seen_phones = {}
    for r in valid_rows:
        ph = r["phone"]
        if ph in seen_phones:
            errors.append(f"Duplicate phone in import: {ph} ({r['name']} and {seen_phones[ph]})")
        seen_phones[ph] = r["name"]

    # Check existing customers in DB
    with get_conn() as conn:
        existing_phones = set()
        for r in valid_rows:
            ex = conn.execute(
                "SELECT customer_id, name FROM customers WHERE phone LIKE ? AND operator_id = ?",
                (f"%{r['phone'][-10:]}", operator_id),
            ).fetchone()
            if ex:
                existing_phones[r["phone"]] = f"{ex['name']} ({ex['customer_id']})"

    # Existing plans for this operator
    with get_conn() as conn:
        existing_plans = {}
        for p in conn.execute("SELECT id, name, amount FROM plans WHERE operator_id = ?", (operator_id,)).fetchall():
            existing_plans[p["name"].lower()] = dict(p)

    # Identify plans to create
    plans_to_create = {}
    for r in valid_rows:
        if r["plan_name"] and r["plan_amount"]:
            key = f"{r['plan_name']}|{r['plan_amount']}"
            if r["plan_name"].lower() not in existing_plans and key not in plans_to_create:
                plans_to_create[key] = {"name": r["plan_name"], "amount": r["plan_amount"], "mso": r["mso"]}

    # Store preview for confirmation
    preview_id = str(uuid.uuid4())[:8]
    _import_previews[preview_id] = {
        "operator_id": operator_id,
        "source": source,
        "valid_rows": valid_rows,
        "plans_to_create": list(plans_to_create.values()),
        "existing_phones": existing_phones,
        "created_at": datetime.now().isoformat(),
    }

    return {
        "preview_id": preview_id,
        "total_rows": len(raw_rows),
        "valid_count": len(valid_rows),
        "invalid_count": invalid_count,
        "errors": errors[:50],  # Cap errors to avoid huge responses
        "existing_customers": existing_phones,  # phone → "name (ID)"
        "plans_to_create": list(plans_to_create.values()),
        "existing_plans": list(existing_plans.values()),
        "sample_rows": valid_rows[:5],  # Preview first 5 rows
    }


# --- STEP 2: CONFIRM IMPORT ---

class ImportConfirmRequest(BaseModel):
    preview_id: str
    skip_existing: bool = True  # Skip customers whose phone already exists
    create_plans: bool = True  # Auto-create plans that don't exist


@router.post("/import/confirm")
def import_confirm(data: ImportConfirmRequest, user=Depends(require_master)):
    """Step 2: Execute the import after preview confirmation."""
    preview = _import_previews.get(data.preview_id)
    if not preview:
        raise HTTPException(400, "Preview not found or expired. Please preview again.")

    # Preview expires after 30 minutes
    elapsed = (datetime.now() - datetime.fromisoformat(preview["created_at"])).total_seconds()
    if elapsed > 1800:
        del _import_previews[data.preview_id]
        raise HTTPException(400, "Preview expired. Please preview again.")

    operator_id = preview["operator_id"]
    valid_rows = preview["valid_rows"]
    existing_phones = preview["existing_phones"]

    with get_conn() as conn:
        prefix = _get_operator_prefix(conn, operator_id)
        next_num = _next_customer_num(conn, prefix)

        # Create plans if requested
        plan_map = {}  # "name|amount" → plan_id
        if data.create_plans:
            for plan_data in preview["plans_to_create"]:
                # Check again (might have been created since preview)
                existing = conn.execute(
                    "SELECT id FROM plans WHERE name = ? AND operator_id = ?",
                    (plan_data["name"], operator_id),
                ).fetchone()
                if existing:
                    plan_map[f"{plan_data['name']}|{plan_data['amount']}"] = existing["id"]
                else:
                    conn.execute(
                        """INSERT INTO plans (name, amount, validity_days, status, network, operator_id)
                           VALUES (?, ?, 30, 'Active', ?, ?)""",
                        (plan_data["name"], plan_data["amount"], plan_data.get("mso", "GTPL"), operator_id),
                    )
                    plan_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
                    plan_map[f"{plan_data['name']}|{plan_data['amount']}"] = plan_id

        # Also load existing plans
        for p in conn.execute("SELECT id, name, amount FROM plans WHERE operator_id = ?", (operator_id,)).fetchall():
            plan_map[f"{p['name']}|{p['amount']}"] = p["id"]
            plan_map[p["name"].lower()] = p["id"]  # name-only lookup too

        # Insert customers
        created = 0
        skipped = 0
        errors = []

        for row in valid_rows:
            phone = row["phone"]
            # Check if should skip
            if data.skip_existing and phone in existing_phones:
                skipped += 1
                continue

            # Double-check phone in DB
            if data.skip_existing:
                ex = conn.execute(
                    "SELECT id FROM customers WHERE phone LIKE ? AND operator_id = ?",
                    (f"%{phone[-10:]}", operator_id),
                ).fetchone()
                if ex:
                    skipped += 1
                    continue

            customer_id = f"{prefix}-{next_num:06d}"
            next_num += 1

            try:
                conn.execute(
                    """INSERT INTO customers (customer_id, name, phone, area, address, status, operator_id)
                       VALUES (?, ?, ?, ?, ?, 'Active', ?)""",
                    (customer_id, row["name"], phone, row.get("area", ""), row.get("address", ""), operator_id),
                )

                # Create connection if STB provided
                stb_no = row.get("stb_no", "")
                if stb_no:
                    network = "TACTV" if (stb_no.startswith("172") or stb_no.startswith("173")) else \
                              ("SCV" if stb_no.startswith("5000") else "GTPL")
                    conn.execute(
                        """INSERT INTO connections (customer_id, stb_no, can_id, mso, service_type, billing_type,
                           status, network, created_at, plan_name, plan_amount, operator_id)
                           VALUES (?, ?, ?, ?, 'Cable', 'Prepaid', 'Active', ?, NOW(), ?, ?, ?)""",
                        (customer_id, stb_no, row.get("can_id", ""), row.get("mso", "GTPL"), network,
                         row.get("plan_name", ""), row.get("plan_amount"), operator_id),
                    )

                    # Assign plan if matched
                    plan_id = None
                    if row.get("plan_name") and row.get("plan_amount"):
                        key = f"{row['plan_name']}|{row['plan_amount']}"
                        plan_id = plan_map.get(key) or plan_map.get(row["plan_name"].lower())

                    if plan_id and stb_no:
                        # Get the connection we just created
                        cn = conn.execute(
                            "SELECT id FROM connections WHERE customer_id = ? AND stb_no = ?",
                            (customer_id, stb_no),
                        ).fetchone()
                        if cn:
                            today = datetime.now().strftime("%Y-%m-%d")
                            from datetime import timedelta
                            expiry = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
                            conn.execute(
                                """INSERT INTO customer_plans (customer_id, connection_id, plan_id, amount,
                                   start_date, expiry_date, status, created_at, operator_id)
                                   VALUES (?, ?, ?, ?, ?, ?, 'Active', NOW(), ?)""",
                                (customer_id, cn["id"], plan_id, row.get("plan_amount", 0),
                                 today, expiry, operator_id),
                            )

                created += 1
            except Exception as e:
                errors.append(f"Failed to import {row['name']}: {str(e)}")

        conn.commit()

    # Clean up preview
    del _import_previews[data.preview_id]

    return {
        "ok": True,
        "created": created,
        "skipped": skipped,
        "errors": errors[:20],
        "operator_id": operator_id,
    }


# --- CSV TEMPLATE DOWNLOAD ---

@router.post("/fix-sr-status")
def fix_sr_status(user=Depends(require_master)):
    """Force-fix all open SRs that have an assigned_to value."""
    conn = get_conn()
    results = []

    # Debug: show what's in the DB
    debug = conn.execute("SELECT id, ticket_no, status, assigned_to FROM service_requests WHERE status = 'open'").fetchall()
    results.append("Open SRs: {}".format(len(debug)))
    for r in debug:
        results.append("  id={} ticket={} assigned_to={} (type={})".format(r['id'], r['ticket_no'], r['assigned_to'], type(r['assigned_to']).__name__))

    # Fix
    cur = conn.execute(
        "UPDATE service_requests SET status = 'assigned', updated_at = CURRENT_TIMESTAMP "
        "WHERE status = 'open' AND assigned_to IS NOT NULL AND assigned_to != '' AND CAST(assigned_to AS INTEGER) != 0"
    )
    conn.commit()
    results.append("Updated {} rows to assigned".format(cur.rowcount))

    # Verify
    still_open = conn.execute("SELECT COUNT(*) as c FROM service_requests WHERE status = 'open'").fetchone()['c']
    now_assigned = conn.execute("SELECT COUNT(*) as c FROM service_requests WHERE status = 'assigned'").fetchone()['c']
    results.append("After: open={}, assigned={}".format(still_open, now_assigned))
    conn.close()
    return {"ok": True, "results": results}


@router.get("/import/template")
def download_csv_template(user=Depends(require_master)):
    """Download CSV import template with sample data."""
    from fastapi.responses import StreamingResponse

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["name", "phone", "area", "address", "plan_name", "plan_amount", "stb_no", "can_id", "mso"])
    writer.writerow(["Rajesh Kumar", "9876543210", "Gandhi Nagar", "12, Main Road", "TAMIL POWER", "280", "3381298100", "21103167", "GTPL"])
    writer.writerow(["Meena Devi", "9123456789", "Nehru Colony", "", "Basic", "200", "", "", "GTPL"])
    writer.writerow(["Sample Customer", "9000000000", "Area Name", "Address line", "Full Pack", "350", "5000123456", "", "SCV"])

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8-sig")),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cabletv_import_template.csv"},
    )
