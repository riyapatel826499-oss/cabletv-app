"""Shared FastAPI dependencies: DB sessions, auth, role checks.

ORM version — uses SQLAlchemy sessions instead of raw SQL.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from sqlalchemy import select, update, or_, and_

from config import SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_HOURS, CUSTOMER_TOKEN_EXPIRE_DAYS
from models.base import get_db, SessionLocal
from models.tables import User, ActiveSession, Customer, Operator

security = HTTPBearer()


# ── JWT Token Creation ────────────────────────────────────────────────────

def create_token(subject: str, token_type: str = "staff",
                 extra_claims: dict = None, expires_hours: int = None,
                 session_id: str = None) -> str:
    """Create a JWT token. token_type: 'staff' or 'customer'."""
    hours = expires_hours or (ACCESS_TOKEN_EXPIRE_HOURS if token_type == "staff"
                             else CUSTOMER_TOKEN_EXPIRE_DAYS * 24)
    expire = datetime.now(timezone.utc) + timedelta(hours=hours)
    payload = {"sub": subject, "type": token_type, "exp": expire}
    if session_id:
        payload["sid"] = session_id
    if extra_claims:
        payload.update(extra_claims)
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    print(f"Created token: sub={subject}, type={token_type}, SECRET_KEY={SECRET_KEY[:10]}..., ALGORITHM={ALGORITHM}, token_len={len(token)}")
    return token


def _decode_token(credentials: HTTPAuthorizationCredentials) -> dict:
    """Decode and validate a JWT from the Authorization header."""
    token = credentials.credentials
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as e:
        print(f"JWT decode failed: {e}, SECRET_KEY={SECRET_KEY[:10]}..., ALGORITHM={ALGORITHM}, token_len={len(token)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )


# ── Staff Auth Dependency ─────────────────────────────────────────────────

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: SessionLocal = Depends(get_db),
) -> dict:
    """FastAPI dependency: returns the authenticated staff user dict.
    Includes operator_id for data isolation. Master admin has operator_id=NULL."""
    payload = _decode_token(credentials)
    if payload.get("type") not in ("staff", None):
        raise HTTPException(status_code=401, detail="Staff token required")

    user_id = payload.get("sub")
    session_id = payload.get("sid")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = db.execute(
        select(User).where(User.id == int(user_id))
    ).scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    u = {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "phone": user.phone,
        "status": user.status,
        "permissions": user.permissions,
        "operator_id": user.operator_id,
    }

    if u.get("status") == "Inactive":
        raise HTTPException(status_code=403, detail="Account deactivated")

    # Validate session_id (single-device enforcement)
    if session_id:
        session = db.execute(
            select(ActiveSession).where(
                ActiveSession.user_id == int(user_id),
                ActiveSession.session_id == session_id,
            )
        ).scalar_one_or_none()
        if not session:
            raise HTTPException(status_code=401, detail="Session expired. Please login again.")

        # Update last activity
        db.execute(
            update(ActiveSession)
            .where(ActiveSession.session_id == session_id)
            .values(last_activity=datetime.now(timezone.utc).isoformat())
        )
        db.commit()

    return u


def require_role(*roles: str):
    """Dependency factory: require user to have one of the given roles."""
    def checker(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return current_user
    return checker


def require_permission(permission: str):
    """Dependency factory: require user to have a specific permission."""
    def checker(current_user: dict = Depends(get_current_user)) -> dict:
        import json
        if current_user.get("role") in ("admin", "master"):
            return current_user
        perms_str = current_user.get("permissions", "") or ""
        try:
            perms = json.loads(perms_str) if perms_str else {}
        except (json.JSONDecodeError, TypeError):
            perms = {}
        perm_list = perms.get("permissions", [])
        if permission not in perm_list:
            raise HTTPException(status_code=403, detail=f"Missing permission: {permission}")
        return current_user
    return checker


def get_operator_id(current_user: dict = Depends(get_current_user)) -> int:
    """Return operator_id. Master admin can optionally pass ?operator_id=X to scope."""
    oid = current_user.get("operator_id")
    if oid is None and current_user.get("role") == "master":
        return None
    if oid is None:
        raise HTTPException(status_code=403, detail="No operator assigned")
    return oid


def apply_op_filter(query, model, user):
    """Apply operator_id filter to a SQLAlchemy query based on user role.
    
    - Master/admin with no operator_id: sees all data
    - Other users: only see their operator's data
    
    Usage:
        query = apply_op_filter(select(Customer), Customer, user)
    """
    oid = user.get("operator_id")
    if oid is not None:
        query = query.where(model.operator_id == oid)
    # If oid is None (master), no filter applied — sees everything
    return query


def op_id(user: dict):
    """Return operator_id as int, or None for master."""
    return user.get("operator_id")


def _op_flt(user: dict, prefix: str = "") -> str:
    """Raw SQL WHERE clause for operator_id filtering (for text() queries).
    
    Returns e.g. "operator_id = 1" or "c.operator_id = 1" (with prefix).
    Master admin (operator_id=None) gets "1=1" (no filter).
    """
    oid = user.get("operator_id")
    if oid is not None:
        return f"{prefix}operator_id = {oid}"
    return "1=1"


# ── Customer Auth Dependency ──────────────────────────────────────────────

def get_current_customer(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: SessionLocal = Depends(get_db),
) -> dict:
    """FastAPI dependency: returns the authenticated customer dict."""
    payload = _decode_token(credentials)
    if payload.get("type") != "customer":
        raise HTTPException(status_code=401, detail="Customer token required")

    customer_id = payload.get("sub")
    if not customer_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    customer = db.execute(
        select(Customer).where(Customer.customer_id == customer_id)
    ).scalar_one_or_none()

    if not customer:
        raise HTTPException(status_code=401, detail="Customer not found")

    # Return as dict for compatibility
    return {c.name: getattr(customer, c.name) for c in customer.__table__.columns}
