"""Shared FastAPI dependencies: DB connections, auth, pagination."""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional, Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from config import DB_ENGINE, DB_PATH, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_HOURS, CUSTOMER_TOKEN_EXPIRE_DAYS
from db import get_db  # Use the engine-aware connection from db.py
from db import placeholder as _ph

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
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def _decode_token(credentials: HTTPAuthorizationCredentials) -> dict:
    """Decode and validate a JWT from the Authorization header."""
    token = credentials.credentials
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )

# ── Staff Auth Dependency ─────────────────────────────────────────────────


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """FastAPI dependency: returns the authenticated staff user dict.
    Includes operator_id for data isolation. Master admin has operator_id=NULL."""
    payload = _decode_token(credentials)
    if payload.get("type") not in ("staff", None):
        raise HTTPException(status_code=401, detail="Staff token required")

    user_id = payload.get("sub")
    session_id = payload.get("sid")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    with get_db() as conn:
        # Try with operator_id (multi-tenant), fallback without (legacy/pre-migration)
        try:
            user = conn.execute(
                "SELECT id, username, name, role, phone, status, permissions, operator_id FROM users WHERE id = " + _ph(),
                [int(user_id)],
            ).fetchone()
        except Exception:
            user = conn.execute(
                "SELECT id, username, name, role, phone, status, permissions FROM users WHERE id = " + _ph(),
                [int(user_id)],
            ).fetchone()

        if not user:
            raise HTTPException(status_code=401, detail="User not found")

        u = dict(user)
        if u.get("status") == "Inactive":
            raise HTTPException(status_code=403, detail="Account deactivated")

        # Validate session_id (single-device enforcement)
        if session_id:
            session = conn.execute(
                "SELECT session_id FROM active_sessions WHERE user_id = " + _ph() + " AND session_id = " + _ph(),
                [int(user_id), session_id]
            ).fetchone()
            if not session:
                raise HTTPException(status_code=401, detail="Session expired. Please login again.")

            # Update last activity
            conn.execute(
                "UPDATE active_sessions SET last_activity = CURRENT_TIMESTAMP WHERE session_id = " + _ph(),
                [session_id]
            )
            conn.commit()

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
            return current_user # admin+master has all permissions
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
        # Master has no operator_id — they see everything or can scope via query param
        return None  # must handle in each route
    if oid is None:
        raise HTTPException(status_code=403, detail="No operator assigned")
    return oid


def op_filter(user: dict, alias: str = "") -> str:
    """Return SQL WHERE clause fragment for operator isolation.
    Usage: f"SELECT ... WHERE {op_filter(user)} AND ..."
    Optional alias for table prefix: op_filter(user, "c.") → "c.operator_id = 1"
    Master/admin with no operator_id sees all (> 0). Others get operator_id = X.
    """
    oid = user.get("operator_id")
    prefix = f"{alias}." if alias and not alias.endswith(".") else alias
    if oid is None:
        # master/admin with no operator_id assigned — sees all operators
        return f"{prefix}operator_id > 0" if prefix else "operator_id > 0"
    return f"{prefix}operator_id = {oid}"


def op_id(user: dict):
    """Return operator_id as int, or 'NULL' string for SQL interpolation."""
    oid = user.get("operator_id")
    return oid if oid is not None else "NULL"


# ── Customer Auth Dependency ──────────────────────────────────────────────


def get_current_customer(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """FastAPI dependency: returns the authenticated customer dict."""
    payload = _decode_token(credentials)
    if payload.get("type") != "customer":
        raise HTTPException(status_code=401, detail="Customer token required")

    customer_id = payload.get("sub")
    if not customer_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    with get_db() as conn:
        customer = conn.execute(
            "SELECT * FROM customers WHERE customer_id = " + _ph(),
            [customer_id],
        ).fetchone()

        if not customer:
            raise HTTPException(status_code=401, detail="Customer not found")

    return dict(customer)
