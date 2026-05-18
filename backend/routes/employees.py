import json as _json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List

from deps import get_db, get_current_user, require_role, op_filter, op_id
from utils import hash_password

router = APIRouter(prefix="/api", tags=["Employees"])

class EmployeeCreate(BaseModel):
    username: str
    password: str
    name: str
    phone: Optional[str] = None
    role: str = "collection_agent"  # admin, support, collection_agent, service_agent


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None


class PasswordUpdate(BaseModel):
    password: str


VALID_ROLES = ["admin", "support", "collection_agent", "service_agent"]
ROLE_LABELS = {
    "admin": "Admin",
    "support": "Support",
    "collection_agent": "Collection Agent",
    "service_agent": "Service Agent",
}

@router.get("/employees")
def list_employees(current_user=Depends(get_current_user)):
    """List all employees. Admin and Support can access."""
    if current_user["role"] not in ["master", "admin", "support"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    flt = op_filter(current_user)
    with get_db() as conn:
        # Single query with LEFT JOIN & GROUP BY to avoid N+1 per-employee queries
        rows = conn.execute(f"""
            SELECT u.id, u.username, u.name, u.role, u.phone, u.status, u.created_at, u.permissions,
                   COALESCE(pc.cnt, 0) as payment_count
            FROM users u
            LEFT JOIN (
                SELECT LOWER(pe.emp_name) AS emp_name_lower, COUNT(*) AS cnt
                FROM paypakka_payments pp
                JOIN paypakka_employees pe ON pp.emp_ref_id = pe.emp_ref_id
                WHERE pp.{flt}
                GROUP BY LOWER(pe.emp_name)
            ) pc ON LOWER(u.name) = pc.emp_name_lower
            WHERE u.{flt}
            ORDER BY 
                CASE u.role 
                    WHEN 'admin' THEN 1 
                    WHEN 'support' THEN 2 
                    WHEN 'collection_agent' THEN 3 
                    WHEN 'service_agent' THEN 4 
                    ELSE 5 
                END,
                u.name
        """).fetchall()

        employees = []
        for r in rows:
            emp = dict(r)
            emp["role_label"] = ROLE_LABELS.get(emp["role"], emp["role"])
            # Parse permissions JSON
            if emp.get("permissions"):
                try:
                    emp["permissions"] = _json.loads(emp["permissions"])
                except Exception:
                    emp["permissions"] = None
            else:
                emp["permissions"] = None
            employees.append(emp)
        return {"employees": employees, "total": len(employees)}


@router.get("/employees/roles")
def get_roles(current_user=Depends(get_current_user)):
    """Get available roles. Admin and Support can access."""
    if current_user["role"] not in ["master", "admin", "support"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return {
        "roles": [
            {"value": "admin", "label": "Admin", "description": "Full access to all features including sensitive operations"},
            {"value": "support", "label": "Support", "description": "Manage employees, collect payments, view customers. Cannot delete payments/customers"},
            {"value": "collection_agent", "label": "Collection Agent", "description": "Collect payments, view and search customers"},
            {"value": "service_agent", "label": "Service Agent", "description": "Collect payments, handle service requests and complaints"},
        ]
    }


@router.post("/employees")
def create_employee(data: EmployeeCreate, current_user=Depends(require_role("admin", "master"))):
    """Create a new employee. Admin/master only."""

    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    flt = op_filter(current_user)
    _oid = op_id(current_user)

    with get_db() as conn:
        # Check username uniqueness
        existing = conn.execute(f"SELECT id FROM users WHERE username = ? AND {flt}", [data.username.strip().lower()]).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail=f"Username '{data.username}' already exists")

        conn.execute("""
            INSERT INTO users (username, password, name, role, phone, status, operator_id)
            VALUES (?, ?, ?, ?, ?, 'Active', ?)
        """, [
            data.username.strip().lower(),
            hash_password(data.password),
            data.name.strip(),
            data.role,
            data.phone.strip() if data.phone else None,
            _oid
        ])
        conn.commit()

        emp = conn.execute(f"SELECT id, username, name, role, phone, status, created_at FROM users WHERE username = ? AND {flt}",
                           [data.username.strip().lower()]).fetchone()
        result = dict(emp)
        result["role_label"] = ROLE_LABELS.get(result["role"], result["role"])
        return {"message": "Employee created successfully", "employee": result}


@router.put("/employees/{emp_id}")
def update_employee(emp_id: int, data: EmployeeUpdate, current_user=Depends(get_current_user)):
    """Update employee details. Admin can update all, Support can update limited fields."""
    if current_user["role"] not in ["master", "admin", "support"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Support cannot change roles to/from admin
    if current_user["role"] == "support":
        if data.role is not None:
            raise HTTPException(status_code=403, detail="Support cannot change employee roles")

    flt = op_filter(current_user)
    _oid = op_id(current_user)

    with get_db() as conn:
        emp = conn.execute(f"SELECT id, username, name, role, status FROM users WHERE id = ? AND {flt}", [emp_id]).fetchone()
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")

        # Only admin can change role
        if data.role is not None:
            if current_user["role"] != "admin":
                raise HTTPException(status_code=403, detail="Only Admin can assign roles")
            if data.role not in VALID_ROLES:
                raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

        # Cannot demote the last admin
        if emp["role"] == "admin" and data.role and data.role != "admin":
            admin_count = conn.execute(f"SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND status = 'Active' AND {flt}").fetchone()
            if admin_count["cnt"] <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last active admin")

        # Cannot deactivate the last admin
        if emp["role"] == "admin" and data.status == "Inactive":
            admin_count = conn.execute(f"SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND status = 'Active' AND {flt}").fetchone()
            if admin_count["cnt"] <= 1:
                raise HTTPException(status_code=400, detail="Cannot deactivate the last active admin")

        updates = []
        params = []
        if data.name is not None:
            updates.append("name = ?")
            params.append(data.name.strip())
        if data.phone is not None:
            updates.append("phone = ?")
            params.append(data.phone.strip())
        if data.role is not None:
            updates.append("role = ?")
            params.append(data.role)
        if data.status is not None:
            updates.append("status = ?")
            params.append(data.status)

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        params.append(emp_id)
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ? AND {flt}", params)
        conn.commit()

        updated = conn.execute(f"SELECT id, username, name, role, phone, status, created_at FROM users WHERE id = ? AND {flt}", [emp_id]).fetchone()
        result = dict(updated)
        result["role_label"] = ROLE_LABELS.get(result["role"], result["role"])
        return {"message": "Employee updated successfully", "employee": result}


@router.put("/employees/{emp_id}/password")
def update_password(emp_id: int, data: PasswordUpdate, current_user=Depends(get_current_user)):
    """Set/reset employee password. Admin can set any, users can set their own."""
    # Admin or master can change anyone's password
    if current_user["role"] in ("admin", "master"):
        pass
    # User can change their own password
    elif current_user["id"] == emp_id:
        pass
    else:
        raise HTTPException(status_code=403, detail="Can only change your own password")

    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    flt = op_filter(current_user)

    with get_db() as conn:
        emp = conn.execute(f"SELECT id FROM users WHERE id = ? AND {flt}", [emp_id]).fetchone()
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")

        conn.execute(f"UPDATE users SET password = ? WHERE id = ? AND {flt}", [hash_password(data.password), emp_id])
        conn.commit()
        return {"message": "Password updated successfully"}


@router.delete("/employees/{emp_id}")
def delete_employee(emp_id: int, current_user=Depends(require_role("admin", "master"))):
    """Delete/deactivate employee. Admin/master only."""

    flt = op_filter(current_user)

    with get_db() as conn:
        emp = conn.execute(f"SELECT id, username, name, role, status FROM users WHERE id = ? AND {flt}", [emp_id]).fetchone()
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")

        # Cannot delete the last admin
        if emp["role"] == "admin":
            admin_count = conn.execute(f"SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND status = 'Active' AND {flt}").fetchone()
            if admin_count["cnt"] <= 1:
                raise HTTPException(status_code=400, detail="Cannot delete the last active admin")

        # Soft delete — set status to Inactive instead of actually deleting
        conn.execute(f"UPDATE users SET status = 'Inactive' WHERE id = ? AND {flt}", [emp_id])
        conn.commit()
        return {"message": f"Employee '{emp['name']}' deactivated successfully"}



# ========== PERMISSIONS ==========

# All available permissions with labels and default per role
ALL_PERMISSIONS = [
    {"key": "dashboard", "label": "Dashboard", "desc": "View dashboard stats and overview"},
    {"key": "customers_view", "label": "View Customers", "desc": "View customer list and details"},
    {"key": "customers_add", "label": "Add Customer", "desc": "Create new customers"},
    {"key": "customers_edit", "label": "Edit Customer", "desc": "Modify customer details and connections"},
    {"key": "customers_delete", "label": "Delete Customer", "desc": "Remove customers permanently"},
    {"key": "payments_collect", "label": "Collect Payments", "desc": "Record new payments"},
    {"key": "payments_view", "label": "View Payments", "desc": "View payment history"},
    {"key": "payments_delete", "label": "Delete Payments", "desc": "Remove payment records"},
    {"key": "plans_view", "label": "View Plans", "desc": "View available plans"},
    {"key": "plans_manage", "label": "Manage Plans", "desc": "Create, edit, delete plans"},
    {"key": "reports", "label": "Reports", "desc": "View collection and area reports"},
    {"key": "employees_view", "label": "View Employees", "desc": "See employee list"},
    {"key": "employees_manage", "label": "Manage Employees", "desc": "Add, edit, deactivate employees"},
    {"key": "settings", "label": "Settings", "desc": "Access app settings"},
]

DEFAULT_PERMISSIONS = {
    "admin": {p["key"] for p in ALL_PERMISSIONS},  # Admin gets everything
    "support": {"dashboard", "customers_view", "customers_add", "customers_edit",
                "payments_collect", "payments_view", "plans_view", "reports",
                "employees_view", "employees_manage"},
    "collection_agent": {"dashboard", "customers_view", "payments_collect", "payments_view"},
    "service_agent": {"dashboard", "customers_view", "customers_add",
                      "payments_collect", "payments_view"},
}


@router.get("/employees/{emp_id}/permissions")
def get_permissions(emp_id: int, current_user=Depends(get_current_user)):
    """Get employee permissions. Admin only."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admin can manage permissions")
    flt = op_filter(current_user)
    with get_db() as conn:
        emp = conn.execute(f"SELECT id, name, role, permissions FROM users WHERE id = ? AND {flt}", [emp_id]).fetchone()
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")

        # Parse stored permissions or use role defaults
        stored = None
        if emp["permissions"]:
            try:
                stored = _json.loads(emp["permissions"])
            except Exception:
                pass

        if stored and isinstance(stored, dict) and "permissions" in stored:
            allowed = set(stored["permissions"])
        else:
            allowed = DEFAULT_PERMISSIONS.get(emp["role"], set())

        return {
            "employee": {"id": emp["id"], "name": emp["name"], "role": emp["role"]},
            "all_permissions": ALL_PERMISSIONS,
            "allowed": list(allowed),
            "role_defaults": {k: list(v) for k, v in DEFAULT_PERMISSIONS.items()},
        }


class PermissionsUpdate(BaseModel):
    role: Optional[str] = None
    permissions: Optional[list] = None


@router.put("/employees/{emp_id}/permissions")
def update_permissions(emp_id: int, data: PermissionsUpdate, current_user=Depends(get_current_user)):
    """Update employee role and permissions. Admin only."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admin can manage permissions")
    flt = op_filter(current_user)
    with get_db() as conn:
        emp = conn.execute(f"SELECT id, name, role FROM users WHERE id = ? AND {flt}", [emp_id]).fetchone()
        if not emp:
            raise HTTPException(status_code=404, detail="Employee not found")

        updates = []
        params = []
        new_role = emp["role"]

        if data.role is not None:
            if data.role not in VALID_ROLES:
                raise HTTPException(status_code=400, detail="Invalid role")
            # Cannot demote last admin
            if emp["role"] == "admin" and data.role != "admin":
                admin_count = conn.execute(f"SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND status = 'Active' AND {flt}").fetchone()
                if admin_count["cnt"] <= 1:
                    raise HTTPException(status_code=400, detail="Cannot demote the last active admin")
            updates.append("role = ?")
            params.append(data.role)
            new_role = data.role

        if data.permissions is not None:
            updates.append("permissions = ?")
            params.append(_json.dumps({"permissions": data.permissions}))

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        params.append(emp_id)
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ? AND {flt}", params)
        conn.commit()

        updated = conn.execute(f"SELECT id, username, name, role, phone, status, permissions FROM users WHERE id = ? AND {flt}", [emp_id]).fetchone()
        result = dict(updated)
        result["role_label"] = ROLE_LABELS.get(result["role"], result["role"])
        if result.get("permissions"):
            try:
                result["permissions"] = _json.loads(result["permissions"])
            except Exception:
                pass
        return {"message": "Permissions updated", "employee": result}
