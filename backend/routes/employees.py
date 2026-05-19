import json as _json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List

from sqlalchemy import select, update, func, text, and_
from sqlalchemy.orm import Session

from models.base import get_db
from deps_orm import get_current_user, require_role, apply_op_filter, op_id
from models.tables import User, PaypakkaPayment, PaypakkaEmployee
from utils import hash_password

router = APIRouter(prefix="/api", tags=["Employees"])


def _obj_to_dict(obj):
    """Convert a SQLAlchemy model instance to a dict."""
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


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
def list_employees(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List all employees. Master views all, Admin and Support see their operator."""
    if current_user["role"] not in ["master", "admin", "support"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Build operator filter clause for text queries
    oid = current_user.get("operator_id")
    if oid is not None:
        flt_u = "u.operator_id = :op_id"
        flt_pp = "pp.operator_id = :op_id"
        params = {"op_id": oid}
    else:
        flt_u = "(u.operator_id > 0 OR u.operator_id IS NULL)"
        flt_pp = "(pp.operator_id > 0 OR pp.operator_id IS NULL)"
        params = {}

    rows = db.execute(
        text(f"""
            SELECT u.id, u.username, u.name, u.role, u.phone, u.status, u.created_at, u.permissions,
                   COALESCE(pc.cnt, 0) as payment_count
            FROM users u
            LEFT JOIN (
                SELECT LOWER(pe.emp_name) AS emp_name_lower, COUNT(*) AS cnt
                FROM paypakka_payments pp
                JOIN paypakka_employees pe ON pp.emp_ref_id = pe.emp_ref_id
                WHERE {flt_pp}
                GROUP BY LOWER(pe.emp_name)
            ) pc ON LOWER(u.name) = pc.emp_name_lower
            WHERE {flt_u}
            ORDER BY 
                CASE u.role 
                    WHEN 'admin' THEN 1 
                    WHEN 'support' THEN 2 
                    WHEN 'collection_agent' THEN 3 
                    WHEN 'service_agent' THEN 4 
                    ELSE 5 
                END,
                u.name
        """),
        params,
    ).fetchall()

    employees = []
    for r in rows:
        emp = dict(r._mapping)
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
    if current_user["role"] not in ["admin", "support"]:
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
def create_employee(
    data: EmployeeCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """Create a new employee. Admin/master only."""

    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    _oid = op_id(current_user)

    # Check username uniqueness
    existing_query = select(User).where(User.username == data.username.strip().lower())
    existing_query = apply_op_filter(existing_query, User, current_user)
    existing = db.execute(existing_query).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Username '{data.username}' already exists")

    user = User(
        username=data.username.strip().lower(),
        password=hash_password(data.password),
        name=data.name.strip(),
        role=data.role,
        phone=data.phone.strip() if data.phone else None,
        status="Active",
        operator_id=_oid,
    )
    db.add(user)
    db.commit()

    # Re-fetch to get auto-generated fields
    emp_query = select(User).where(User.username == data.username.strip().lower())
    emp_query = apply_op_filter(emp_query, User, current_user)
    emp = db.execute(emp_query).scalar_one_or_none()
    result = _obj_to_dict(emp)
    result["role_label"] = ROLE_LABELS.get(result["role"], result["role"])
    return {"message": "Employee created successfully", "employee": result}


@router.put("/employees/{emp_id}")
def update_employee(
    emp_id: int,
    data: EmployeeUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Update employee details. Admin can update all, Support can update limited fields."""
    if current_user["role"] not in ["admin", "support"]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Support cannot change roles to/from admin
    if current_user["role"] == "support":
        if data.role is not None:
            raise HTTPException(status_code=403, detail="Support cannot change employee roles")

    emp_query = select(User).where(User.id == emp_id)
    emp_query = apply_op_filter(emp_query, User, current_user)
    emp = db.execute(emp_query).scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp_dict = _obj_to_dict(emp)

    # Only admin can change role
    if data.role is not None:
        if current_user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Only Admin can assign roles")
        if data.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}")

    # Cannot demote the last admin
    if emp_dict["role"] == "admin" and data.role and data.role != "admin":
        admin_count_query = select(func.count()).select_from(User).where(
            User.role == "admin", User.status == "Active"
        )
        admin_count_query = apply_op_filter(admin_count_query, User, current_user)
        admin_count = db.execute(admin_count_query).scalar()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot demote the last active admin")

    # Cannot deactivate the last admin
    if emp_dict["role"] == "admin" and data.status == "Inactive":
        admin_count_query = select(func.count()).select_from(User).where(
            User.role == "admin", User.status == "Active"
        )
        admin_count_query = apply_op_filter(admin_count_query, User, current_user)
        admin_count = db.execute(admin_count_query).scalar()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot deactivate the last active admin")

    updates = {}
    if data.name is not None:
        updates["name"] = data.name.strip()
    if data.phone is not None:
        updates["phone"] = data.phone.strip()
    if data.role is not None:
        updates["role"] = data.role
    if data.status is not None:
        updates["status"] = data.status

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    db.execute(
        update(User).where(User.id == emp_id).values(**updates)
    )
    db.commit()

    updated_query = select(User).where(User.id == emp_id)
    updated_query = apply_op_filter(updated_query, User, current_user)
    updated = db.execute(updated_query).scalar_one_or_none()
    result = _obj_to_dict(updated)
    result["role_label"] = ROLE_LABELS.get(result["role"], result["role"])
    return {"message": "Employee updated successfully", "employee": result}


@router.put("/employees/{emp_id}/password")
def update_password(
    emp_id: int,
    data: PasswordUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Set/reset employee password. Admin can set any, users can set their own."""
    # Admin or master can change anyone's password
    if current_user["role"] == "admin":
        pass
    # User can change their own password
    elif current_user["id"] == emp_id:
        pass
    else:
        raise HTTPException(status_code=403, detail="Can only change your own password")

    if len(data.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    emp_query = select(User).where(User.id == emp_id)
    emp_query = apply_op_filter(emp_query, User, current_user)
    emp = db.execute(emp_query).scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    db.execute(
        update(User).where(User.id == emp_id).values(password=hash_password(data.password))
    )
    db.commit()
    return {"message": "Password updated successfully"}


@router.delete("/employees/{emp_id}")
def delete_employee(
    emp_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_role("admin")),
):
    """Delete/deactivate employee. Admin/master only."""

    emp_query = select(User).where(User.id == emp_id)
    emp_query = apply_op_filter(emp_query, User, current_user)
    emp = db.execute(emp_query).scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp_dict = _obj_to_dict(emp)

    # Cannot delete the last admin
    if emp_dict["role"] == "admin":
        admin_count_query = select(func.count()).select_from(User).where(
            User.role == "admin", User.status == "Active"
        )
        admin_count_query = apply_op_filter(admin_count_query, User, current_user)
        admin_count = db.execute(admin_count_query).scalar()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last active admin")

    # Soft delete — set status to Inactive instead of actually deleting
    db.execute(
        update(User).where(User.id == emp_id).values(status="Inactive")
    )
    db.commit()
    return {"message": f"Employee '{emp_dict['name']}' deactivated successfully"}



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
def get_permissions(
    emp_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get employee permissions. Admin only."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admin can manage permissions")

    emp_query = select(User).where(User.id == emp_id)
    emp_query = apply_op_filter(emp_query, User, current_user)
    emp = db.execute(emp_query).scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp_dict = _obj_to_dict(emp)

    # Parse stored permissions or use role defaults
    stored = None
    if emp_dict["permissions"]:
        try:
            stored = _json.loads(emp_dict["permissions"])
        except Exception:
            pass

    if stored and isinstance(stored, dict) and "permissions" in stored:
        allowed = set(stored["permissions"])
    else:
        allowed = DEFAULT_PERMISSIONS.get(emp_dict["role"], set())

    return {
        "employee": {"id": emp_dict["id"], "name": emp_dict["name"], "role": emp_dict["role"]},
        "all_permissions": ALL_PERMISSIONS,
        "allowed": list(allowed),
        "role_defaults": {k: list(v) for k, v in DEFAULT_PERMISSIONS.items()},
    }


class PermissionsUpdate(BaseModel):
    role: Optional[str] = None
    permissions: Optional[list] = None


@router.put("/employees/{emp_id}/permissions")
def update_permissions(
    emp_id: int,
    data: PermissionsUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Update employee role and permissions. Admin only."""
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Only Admin can manage permissions")

    emp_query = select(User).where(User.id == emp_id)
    emp_query = apply_op_filter(emp_query, User, current_user)
    emp = db.execute(emp_query).scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp_dict = _obj_to_dict(emp)

    updates = {}
    new_role = emp_dict["role"]

    if data.role is not None:
        if data.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        # Cannot demote last admin
        if emp_dict["role"] == "admin" and data.role != "admin":
            admin_count_query = select(func.count()).select_from(User).where(
                User.role == "admin", User.status == "Active"
            )
            admin_count_query = apply_op_filter(admin_count_query, User, current_user)
            admin_count = db.execute(admin_count_query).scalar()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last active admin")
        updates["role"] = data.role
        new_role = data.role

    if data.permissions is not None:
        updates["permissions"] = _json.dumps({"permissions": data.permissions})

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    db.execute(
        update(User).where(User.id == emp_id).values(**updates)
    )
    db.commit()

    updated_query = select(User).where(User.id == emp_id)
    updated_query = apply_op_filter(updated_query, User, current_user)
    updated = db.execute(updated_query).scalar_one_or_none()
    result = _obj_to_dict(updated)
    result["role_label"] = ROLE_LABELS.get(result["role"], result["role"])
    if result.get("permissions"):
        try:
            result["permissions"] = _json.loads(result["permissions"])
        except Exception:
            pass
    return {"message": "Permissions updated", "employee": result}
