"""Single source of truth for all application configuration."""
import os

# Database — auto-detect SQLite vs PostgreSQL
DATABASE_URL_PG = os.getenv("DATABASE_URL", "")
if DATABASE_URL_PG:
    DB_ENGINE = "postgresql"
    DB_PATH = None
    # Railway internal connections need sslmode=disable
    if "sslmode" not in DATABASE_URL_PG:
        sep = "&" if "?" in DATABASE_URL_PG else "?"
        DATABASE_URL_PG += f"{sep}sslmode=disable"
else:
    DB_ENGINE = "sqlite"
    DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cabletv.db")

# JWT Authentication — MUST set env var in production
_secret = os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET")
if not _secret:
    # Only allow fallback in development — warn loudly
    _secret = "dev-only-secret-key-CHANGE-IN-PROD"
    print("⚠️  WARNING: Using default SECRET_KEY. Set SECRET_KEY env var for production!")
SECRET_KEY = _secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8760  # 365 days — stay logged in until manual logout
CUSTOMER_TOKEN_EXPIRE_DAYS = 30

# Razorpay — load from env only, never hardcode
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET", "")

# Paypakka integration
PAYPAKKA_ACCOUNT_ID = os.getenv("PAYPAKKA_ACCOUNT_ID", "1002385")
PAYPAKKA_DISTRIBUTOR_REF_ID = os.getenv("PAYPAKKA_DISTRIBUTOR_REF_ID", "5e9d475db9d83920ec941ce4")
PAYPAKKA_CUSTOMER_JSON = os.getenv("PAYPAKKA_CUSTOMER_JSON", "/tmp/paypakka_all_customers.json")

# Password policy
PASSWORD_MIN_LENGTH = 4
PIN_LENGTH = 4

# CORS — restrict to actual origins
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000,http://0.0.0.0:8000,https://rscloud.live").split(",")

# Rate limiting
AUTH_RATE_LIMIT=os.getenv("AUTH_RATE_LIMIT", "5/minute")

# Telegram notifications
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8738324317:AAE-8zaNhMixSs7cKZHoTtxObm9WiQSrhLk")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "1632880933")

# Telegram Service Requests Bot
SR_BOT_TOKEN = os.getenv("SR_BOT_TOKEN", "8738324317:AAE-8zaNhMixSs7cKZHoTtxObm9WiQSrhLk")
SR_GROUP_ID = os.getenv("SR_GROUP_ID", "-5136685396")
SR_ADMIN_IDS = os.getenv("SR_ADMIN_IDS", "1632880933").split(",")  # Prabhu's TG ID
# Telegram webhook secret token. When set, the SR webhook verifies the
# X-Telegram-Bot-Api-Secret-Token header. Leave empty to disable the check
# (e.g. if the webhook was registered without a secret_token).
SR_WEBHOOK_SECRET = os.getenv("SR_WEBHOOK_SECRET", "")

# Web Push Notifications (VAPID)
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "BD1ZpMaOEZfw50sY69dHcXY8rNUIL16KSzIFHVlU3to_sQGjHpAA7EADOfSPE4AHPrKmOUXmCwpHYcsJb1E0hAU")
VAPID_PRIVATE_KEY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vapid_private.pem")
VAPID_CLAIMS = {"sub": "mailto:admin@rscloud.live"}
