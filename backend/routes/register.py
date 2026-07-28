"""Public operator self-registration — no auth required.
Rate-limited (3/hour per IP). Creates operator + admin user.
"""
import re
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, field_validator

from conn import get_conn, insert_and_get_id
from utils import hash_password
from config import PASSWORD_MIN_LENGTH

router = APIRouter(prefix="/api", tags=["Registration"])

# In-memory rate limit: {ip: [timestamp, ...]}
_rate_store: dict[str, list[float]] = {}
RATE_LIMIT = 3       # max attempts
RATE_WINDOW = 3600   # seconds (1 hour)


def _check_rate_limit(ip: str):
    now = datetime.utcnow().timestamp()
    window = now - RATE_WINDOW
    hits = [t for t in _rate_store.get(ip, []) if t > window]
    if len(hits) >= RATE_LIMIT:
        raise HTTPException(429, "Too many signup attempts. Try again in an hour.")
    hits.append(now)
    _rate_store[ip] = hits


class RegisterRequest(BaseModel):
    business_name: str
    owner_name: str
    phone: str
    email: Optional[str] = ""
    area: Optional[str] = ""
    mso: Optional[str] = "GTPL"
    admin_username: str
    admin_password: str

    @field_validator("business_name")
    @classmethod
    def name_not_empty(cls, v):
        if not v.strip():
            raise ValueError("Business name is required")
        return v.strip()

    @field_validator("phone")
    @classmethod
    def valid_phone(cls, v):
        digits = re.sub(r"\D", "", v)
        if len(digits) < 10:
            raise ValueError("Enter a valid 10-digit mobile number")
        return v.strip()

    @field_validator("admin_username")
    @classmethod
    def valid_username(cls, v):
        v = v.strip().lower()
        if not re.match(r"^[a-z0-9_]{3,20}$", v):
            raise ValueError("Username must be 3-20 lowercase letters, numbers, or underscores")
        return v

    @field_validator("admin_password")
    @classmethod
    def valid_password(cls, v):
        if len(v) < PASSWORD_MIN_LENGTH:
            raise ValueError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters")
        return v


@router.post("/register")
def register(body: RegisterRequest, request: Request):
    """Public self-registration for new operators. Rate-limited."""
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(ip)

    prefix = _derive_prefix(body.business_name)

    with get_conn() as conn:
        # Check username
        existing = conn.execute(
            "SELECT id FROM users WHERE username = ?", (body.admin_username,)
        ).fetchone()
        if existing:
            raise HTTPException(400, "Username already taken. Choose another.")

        # Check prefix uniqueness
        existing_prefix = conn.execute(
            "SELECT id FROM operators WHERE customer_prefix = ?", (prefix,)
        ).fetchone()
        if existing_prefix:
            prefix = _derive_prefix(body.business_name, attempt=2)
            existing_prefix = conn.execute(
                "SELECT id FROM operators WHERE customer_prefix = ?", (prefix,)
            ).fetchone()
            if existing_prefix:
                # Fallback: use first 3 chars of username
                prefix = body.admin_username[:4].upper()
                existing_prefix = conn.execute(
                    "SELECT id FROM operators WHERE customer_prefix = ?", (prefix,)
                ).fetchone()
                if existing_prefix:
                    import random
                    prefix = f"{body.admin_username[:3].upper()}{random.randint(10, 99)}"

        # Create operator
        new_op_id = insert_and_get_id(conn,
            """INSERT INTO operators (business_name, owner_name, phone, email, area, mso, customer_prefix, license_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'trial')""",
            (body.business_name, body.owner_name, body.phone, body.email, body.area, body.mso, prefix),
        )

        # Create admin user for this operator
        conn.execute(
            """INSERT INTO users (username, password, name, role, phone, operator_id)
               VALUES (?, ?, ?, 'admin', ?, ?)""",
            (body.admin_username.strip().lower(),
             hash_password(body.admin_password),
             body.owner_name or body.business_name,
             body.phone, new_op_id),
        )
        conn.commit()

    return {
        "ok": True,
        "operator_id": new_op_id,
        "customer_prefix": prefix,
        "message": f"Welcome, {body.business_name}! Login with username '{body.admin_username.strip().lower()}' and your password.",
    }


def _derive_prefix(name: str, attempt: int = 1) -> str:
    """Derive a 3-4 char customer prefix from the business name."""
    # Take first letters of each word
    words = re.findall(r"[A-Za-z]+", name)
    if len(words) >= 2:
        prefix = "".join(w[0].upper() for w in words[:3])
    else:
        # Single word: take first 4 chars
        prefix = words[0][:4].upper() if words else "NEW"
    if len(prefix) < 2:
        prefix = (prefix + "TV")[:4]
    if attempt > 1 and len(prefix) > 2:
        # Append a digit on retry
        import random
        prefix = prefix[:2] + str(random.randint(10, 99))
    return prefix[:5]
