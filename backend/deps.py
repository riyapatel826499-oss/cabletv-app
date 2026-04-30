"""Shared FastAPI dependencies: DB connections, auth, pagination."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from typing import Optional, Generator

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from config import DB_PATH, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_HOURS, CUSTOMER_TOKEN_EXPIRE_DAYS

security = HTTPBearer()


# ── Database ──────────────────────────────────────────────────────────────

@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Yield a DB connection with auto-close (prevents leaks). WAL mode for concurrency."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA cache_size = -64000")  # 64MB cache
    conn.execute("PRAGMA temp_store = MEMORY")
    try:
        yield conn
    finally:
        conn.close()


# ── JWT Token Creation ────────────────────────────────────────────────────

def create_token(subject: str, token_type: str = "staff",
                 extra_claims: dict = None, expires_hours: int = None) -> str:
    """Create a JWT token. token_type: 'staff' or 'customer'."""
    hours = expires_hours or (ACCESS_TOKEN_EXPIRE_HOURS if token_type == "staff"
                              else CUSTOMER_TOKEN_EXPIRE_DAYS * 24)
    expire = datetime.now(timezone.utc) + timedelta(hours=hours)
    payload = {"sub": subject, "type": token_type, "exp": expire}
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
    """FastAPI dependency: returns the authenticated staff user dict."""
    payload = _decode_token(credentials)
    if payload.get("type") not in ("staff", None):
        raise HTTPException(status_code=401, detail="Staff token required")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username, name, role, phone, status, permissions FROM users WHERE id = ?",
            [int(user_id)],
        ).fetchone()

    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    u = dict(user)
    if u.get("status") == "Inactive":
        raise HTTPException(status_code=403, detail="Account deactivated")
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
        if current_user.get("role") == "admin":
            return current_user  # admin has all permissions
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
            "SELECT * FROM customers WHERE customer_id = ?",
            [customer_id],
        ).fetchone()

    if not customer:
        raise HTTPException(status_code=401, detail="Customer not found")

    return dict(customer)
