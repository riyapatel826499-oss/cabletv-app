"""Single source of truth for all application configuration.
Supports both SQLite (local dev) and PostgreSQL (Railway production).
"""
import os

# ── Database ──────────────────────────────────────────────────────────────
# Railway provides DATABASE_URL automatically when you add a PostgreSQL service
# Format: postgresql://user:pass@host:port/dbname
DATABASE_URL = os.getenv("DATABASE_URL", "")

if DATABASE_URL:
    # PostgreSQL (production)
    DB_ENGINE = "postgresql"
    # psycopg2 needs postgres://, Railway provides postgresql://
    if DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL_PG = DATABASE_URL
    elif DATABASE_URL.startswith("postgres://"):
        DATABASE_URL_PG = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    else:
        DATABASE_URL_PG = DATABASE_URL
else:
    # SQLite (local dev)
    DB_ENGINE = "sqlite"
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cabletv.db")

# ── JWT Authentication ────────────────────────────────────────────────────
_secret = os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET")
if not _secret:
    _secret = "dev-only-secret-key-CHANGE-IN-PROD"
    print("⚠️  WARNING: Using default SECRET_KEY. Set SECRET_KEY env var for production!")
SECRET_KEY = _secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = int(os.getenv("ACCESS_TOKEN_EXPIRE_HOURS", "8760"))  # 365 days
CUSTOMER_TOKEN_EXPIRE_DAYS = int(os.getenv("CUSTOMER_TOKEN_EXPIRE_DAYS", "30"))

# ── Razorpay ──────────────────────────────────────────────────────────────
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")

# ── Paypakka integration ──────────────────────────────────────────────────
PAYPAKKA_ACCOUNT_ID = os.getenv("PAYPAKKA_ACCOUNT_ID", "1002385")
PAYPAKKA_DISTRIBUTOR_REF_ID = os.getenv("PAYPAKKA_DISTRIBUTOR_REF_ID", "5e9d475db9d83920ec941ce4")
PAYPAKKA_CUSTOMER_JSON = os.getenv("PAYPAKKA_CUSTOMER_JSON", "/tmp/paypakka_all_customers.json")

# ── Password policy ──────────────────────────────────────────────────────
PASSWORD_MIN_LENGTH = int(os.getenv("PASSWORD_MIN_LENGTH", "4"))
PIN_LENGTH = 4

# ── CORS ──────────────────────────────────────────────────────────────────
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:8000,http://127.0.0.1:8000,http://0.0.0.0:8000,https://rscloud.live"
).split(",")

# ── Rate limiting ─────────────────────────────────────────────────────────
AUTH_RATE_LIMIT = os.getenv("AUTH_RATE_LIMIT", "5/minute")

# ── Telegram notifications ────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# ── Telegram Service Requests Bot ────────────────────────────────────────
SR_BOT_TOKEN = os.getenv("SR_BOT_TOKEN", "")
SR_GROUP_ID = os.getenv("SR_GROUP_ID", "")
SR_ADMIN_IDS = os.getenv("SR_ADMIN_IDS", "").split(",") if os.getenv("SR_ADMIN_IDS") else []

# ── Web Push Notifications (VAPID) ───────────────────────────────────────
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY_PATH = os.getenv(
    "VAPID_PRIVATE_KEY_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "vapid_private.pem")
)
VAPID_CLAIMS = {"sub": os.getenv("VAPID_SUB", "mailto:admin@rscloud.live")}

# ── GTPL Service (local only, not needed on Railway) ─────────────────────
GTPL_SERVICE_URL = os.getenv("GTPL_SERVICE_URL", "http://localhost:8199")
GTPL_SERVICE_TOKEN = os.getenv("GTPL_SERVICE_TOKEN", "")

# ── Server ────────────────────────────────────────────────────────────────
PORT = int(os.getenv("PORT", "8000"))
