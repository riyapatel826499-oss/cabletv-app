import asyncio
import json
import os
from pathlib import Path
from contextlib import asynccontextmanager

# Load .env file (for production: GTPL_SERVICE_URL etc.)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
    # Manual .env loading fallback
    _env = Path(__file__).parent / ".env"
    if _env.exists():
        for line in _env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from limiter import limiter, limiter_available
if limiter_available:
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded

from models.database import init_db, import_customers_from_json, run_migrations
from routes.auth import router as auth_router
from routes.customers import router as customers_router
from routes.plans import router as plans_router
from routes.payments import router as payments_router, payment_listeners
from routes.dashboard import router as dashboard_router
from routes.employees import router as employees_router
from routes.stb_inventory import router as stb_inventory_router
from routes.sms import router as sms_router
from routes.websocket import router as ws_router, manager
# from routes.customer_portal import router as customer_portal_router
from routes.surrenders import router as surrenders_router
from routes.connections import router as connections_router
from routes.reports import router as reports_router
from routes.reminders import router as reminders_router
from routes.paypakka_sync import router as paypakka_sync_router
from routes.settings import router as settings_router
from routes.operators import router as operators_router
from routes.push import router as push_router
from routes.service_requests import router as service_requests_router
from routes.gtpl import router as gtpl_router
from config import CORS_ORIGINS

# Rate limiter (shared instance from limiter.py)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init DB + import customers, then start notification task."""
    init_db()
    run_migrations()
    import_customers_from_json()
    print("Backend ready - Sree Selvanaayakki Amman Cables")

    # Background task: relay payment events to WebSocket
    async def payment_notifier():
        queue = asyncio.Queue()
        payment_listeners.append(queue)
        while True:
            try:
                event = await queue.get()
                await manager.broadcast(event)
            except Exception as e:
                print(f"Notification error: {e}")

    task = asyncio.create_task(payment_notifier())
    yield
    task.cancel()


app = FastAPI(
    title="Sree Selvanaayakki Amman Cables - Cable TV Management",
    description="Backend API for Cable TV customer management, payments, and collections",
    version="2.0.0",
    lifespan=lifespan,
)

# Rate limiting
if limiter_available:
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — restricted to configured origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(customers_router)
app.include_router(plans_router)
app.include_router(payments_router)
app.include_router(dashboard_router)
app.include_router(sms_router)
app.include_router(ws_router)
app.include_router(employees_router)
app.include_router(stb_inventory_router)
# app.include_router(customer_portal_router)  # Disabled: no frontend yet
app.include_router(surrenders_router)
app.include_router(connections_router)
app.include_router(reports_router)
app.include_router(reminders_router)
app.include_router(paypakka_sync_router)
app.include_router(settings_router)
app.include_router(operators_router)
app.include_router(push_router)
app.include_router(service_requests_router)
app.include_router(gtpl_router, prefix="/api")


@app.get("/")
async def root():
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/login")


@app.get("/api/health")
def health():
    """Health check — verifies DB connectivity."""
    from deps import get_db
    try:
        with get_db() as conn:
            conn.execute("SELECT 1").fetchone()
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return {"status": "error", "db": str(e)}


@app.post("/api/backup")
def backup_db():
    """Daily DB backup — copies cabletv.db to backups/ folder, keeps last 7 days."""
    import shutil
    from datetime import datetime
    from config import DB_PATH

    backup_dir = os.path.join(os.path.dirname(DB_PATH), "backups")
    os.makedirs(backup_dir, exist_ok=True)

    date_str = datetime.now().strftime("%Y-%m-%d")
    backup_path = os.path.join(backup_dir, f"cabletv_{date_str}.db")

    # Copy the current DB
    shutil.copy2(DB_PATH, backup_path)

    # Clean up backups older than 7 days
    kept = 0
    removed = 0
    for f in sorted(os.listdir(backup_dir)):
        if not f.startswith("cabletv_") or not f.endswith(".db"):
            continue
        fp = os.path.join(backup_dir, f)
        if len(os.listdir(backup_dir)) - removed > 7:
            # Too many files, remove oldest
            if f != f"cabletv_{date_str}.db":
                os.remove(fp)
                removed += 1
            else:
                kept += 1
        else:
            kept += 1

    size_mb = os.path.getsize(backup_path) / (1024 * 1024)
    return {"ok": True, "file": backup_path, "size_mb": round(size_mb, 2), "kept": kept, "removed": removed}


# Serve frontend static files
# Priority: React build (static/) > legacy HTML (frontend/)
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
LEGACY_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

# Use React build if it exists, otherwise fall back to legacy frontend
if os.path.exists(os.path.join(STATIC_DIR, "index.html")):
    FRONTEND_DIR = STATIC_DIR
else:
    FRONTEND_DIR = LEGACY_DIR

print(f"Serving frontend from: {FRONTEND_DIR}")


@app.get("/dashboard")
async def serve_dashboard():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/login")
async def serve_login():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


# Mount static files last (catch-all for CSS/JS/images)
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
