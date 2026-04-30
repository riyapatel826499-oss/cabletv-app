"""Single source of truth for all application configuration."""
import os

# Database
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cabletv.db")

# JWT Authentication — MUST set env var in production
_secret = os.getenv("SECRET_KEY") or os.getenv("JWT_SECRET")
if not _secret:
    # Only allow fallback in development — warn loudly
    _secret = "dev-only-secret-key-CHANGE-IN-PROD"
    print("⚠️  WARNING: Using default SECRET_KEY. Set SECRET_KEY env var for production!")
SECRET_KEY = _secret
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
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
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000,http://0.0.0.0:8000").split(",")

# Rate limiting
AUTH_RATE_LIMIT = os.getenv("AUTH_RATE_LIMIT", "5/minute")
