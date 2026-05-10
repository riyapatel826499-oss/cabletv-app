"""Shared utility functions: hashing, dates, phone normalization."""
import bcrypt
from datetime import datetime, timedelta
from typing import Optional

from config import PIN_LENGTH


# ── Password & PIN Hashing (bcrypt) ────────────────────────────────────────

def hash_password(password: str) -> str:
    """Hash a password using bcrypt. Returns UTF-8 string."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash. Also supports legacy SHA256 for migration."""
    # Try bcrypt first
    try:
        if bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8")):
            return True
    except (ValueError, TypeError):
        pass

    # Fallback: legacy SHA256 (for migration from old hashes)
    import hashlib
    legacy_hash = hashlib.sha256(plain.encode()).hexdigest()
    if legacy_hash == hashed:
        return True

    return False


def needs_rehash(hashed: str) -> bool:
    """Check if a hash is legacy SHA256 and needs upgrading to bcrypt."""
    return not hashed.startswith("$2b$")


# ── Date Helpers ───────────────────────────────────────────────────────────

def get_current_month() -> str:
    """Return current month in MM-YYYY format (e.g. '04-2026')."""
    return datetime.now().strftime("%m-%Y")


def get_month_range(reference: datetime = None) -> tuple[str, str]:
    """Return (month_start, month_end) as YYYY-MM-DD strings for the given month."""
    now = reference or datetime.now()
    month_start = now.strftime("%Y-%m-01")
    if now.month == 12:
        month_end = f"{now.year}-12-31 23:59:59"
    else:
        next_mo = now.replace(month=now.month + 1, day=1)
        month_end = (next_mo - timedelta(days=1)).strftime("%Y-%m-%d") + " 23:59:59"
    return month_start, month_end


# ── Phone Normalization ────────────────────────────────────────────────────

def normalize_phone(phone: str) -> str:
    """Strip +91 prefix and spaces from phone number."""
    return phone.replace("+91", "").replace(" ", "").strip()


PHONE_NORMALIZE_SQL = "REPLACE(REPLACE(phone, '+91', ''), ' ', '')"


def find_customer_by_phone(conn, phone: str) -> Optional[dict]:
    """Look up a customer by normalized phone (checks both phone and phone2)."""
    clean = normalize_phone(phone)
    row = conn.execute(
        f"""SELECT * FROM customers
           WHERE {PHONE_NORMALIZE_SQL} = ?
              OR REPLACE(REPLACE(phone2, '+91', ''), ' ', '') = ?
           LIMIT 1""",
        (clean, clean),
    ).fetchone()
    return dict(row) if row else None
