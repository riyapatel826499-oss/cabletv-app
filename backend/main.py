import asyncio
import json
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from limiter import limiter

from models.database import init_db, import_customers_from_json
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
from config import CORS_ORIGINS

# Rate limiter (shared instance from limiter.py)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init DB + import customers, then start notification task."""
    init_db()
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


@app.get("/")
def root():
    return {
        "app": "Sree Selvanaayakki Amman Cables",
        "version": "2.0.0",
        "status": "running",
    }


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


# Serve frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")


@app.get("/dashboard")
async def serve_dashboard():
    return FileResponse(os.path.join(FRONTEND_DIR, "dashboard.html"))


@app.get("/login")
async def serve_login():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


# Mount static files last (catch-all for CSS/JS/images)
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
