import asyncio
import json
import os
import sys
import traceback
from pathlib import Path
from contextlib import asynccontextmanager

# Load .env file (for production: GTPL_SERVICE_URL etc.)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except ImportError:
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
from fastapi.responses import FileResponse, JSONResponse

# ── Import phase — catch ALL errors ──────────────────────────────────────
_import_errors = []
_router_map = {}
_payment_listeners = []
_manager = None

def _safe_import(name, from_module=None):
    """Import and track errors."""
    try:
        if from_module:
            mod = __import__(from_module, fromlist=[name])
            return getattr(mod, name)
        else:
            return __import__(name)
    except Exception as e:
        err = f"Failed to import {name} from {from_module}: {traceback.format_exc()}"
        _import_errors.append(err)
        print(f"IMPORT ERROR: {err}")
        return None

# Core deps — these should always work
limiter = _safe_import("limiter")
limiter_available = limiter is not None and hasattr(limiter, 'limiter_available') and limiter.limiter_available

if limiter_available:
    _safe_import("_rate_limit_exceeded_handler", "slowapi")
    _safe_import("RateLimitExceeded", "slowapi.errors")

# Database + migrations
init_db = _safe_import("init_db", "models.database")
run_migrations = _safe_import("run_migrations", "models.database")
import_customers = _safe_import("import_customers_from_json", "models.database")

# Route routers — each may fail independently
_routers = {
    "auth": ("routes.auth", "router"),
    "customers": ("routes.customers", "router"),
    "plans": ("routes.plans", "router"),
    "payments": ("routes.payments", "router"),
    "dashboard": ("routes.dashboard", "router"),
    "employees": ("routes.employees", "router"),
    "stb_inventory": ("routes.stb_inventory", "router"),
    "sms": ("routes.sms", "router"),
    "surrenders": ("routes.surrenders", "router"),
    "connections": ("routes.connections", "router"),
    "reports": ("routes.reports", "router"),
    "reminders": ("routes.reminders", "router"),
    "paypakka_sync": ("routes.paypakka_sync", "router"),
    "settings": ("routes.settings", "router"),
    "service_requests": ("routes.service_requests", "router"),
    "operators": ("routes.operators", "router"),
    "push": ("routes.push", "router"),
}

for route_name, (module, attr) in _routers.items():
    router = _safe_import(attr, module)
    if router is not None:
        _router_map[route_name] = router

# Special: payments also exports payment_listeners
try:
    from routes.payments import payment_listeners
    _payment_listeners = payment_listeners
except Exception:
    pass

# Special: websocket exports manager
try:
    from routes.websocket import manager
    _manager = manager
except Exception:
    pass

# CORS config
try:
    from config import CORS_ORIGINS
except Exception:
    CORS_ORIGINS = ["*"]

# ── Startup ──────────────────────────────────────────────────────────────
_startup_error = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init DB + import customers, then start notification task."""
    global _startup_error
    try:
        print("Starting init_db()...")
        if init_db:
            init_db()
            print("init_db() done. Running migrations...")
        if run_migrations:
            run_migrations()
            print("Migrations done. Importing customers...")
        if import_customers:
            import_customers()
        print("Backend ready - Wasool")
    except Exception as e:
        _startup_error = traceback.format_exc()
        print(f"STARTUP ERROR: {_startup_error}")

    # Background task: relay payment events to WebSocket
    if _payment_listeners and _manager:
        async def payment_notifier():
            queue = asyncio.Queue()
            _payment_listeners.append(queue)
            while True:
                try:
                    event = await queue.get()
                    await _manager.broadcast(event)
                except Exception as e:
                    print(f"Notification error: {e}")

        task = asyncio.create_task(payment_notifier())
    else:
        task = None

    yield
    if task:
        task.cancel()


app = FastAPI(
    title="Wasool",
    description="Backend API for Cable TV customer management, payments, and collections",
    version="2.0.0",
    lifespan=lifespan,
)

# Rate limiting
if limiter_available and limiter:
    app.state.limiter = limiter.limiter
    try:
        from slowapi import _rate_limit_exceeded_handler
        from slowapi.errors import RateLimitExceeded
        app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    except Exception:
        pass

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
for name, router in _router_map.items():
    app.include_router(router)
    print(f"Registered route: {name}")

# ── Debug endpoints (always available) ───────────────────────────────────

@app.get("/api/debug-startup")
def debug_startup():
    """Return startup + import error details for debugging."""
    return {
        "startup_error": _startup_error,
        "import_errors": _import_errors,
        "loaded_routes": list(_router_map.keys()),
        "database_url_set": bool(os.getenv("DATABASE_URL")),
        "port": os.getenv("PORT", "not set"),
        "python_version": sys.version,
        "cwd": os.getcwd(),
        "files_in_cwd": os.listdir(".")[:20],
    }


@app.get("/api/health")
def health():
    """Health check — verifies DB connectivity."""
    try:
        from deps import get_db
        with get_db() as conn:
            conn.execute("SELECT 1").fetchone()
        return {"status": "ok", "db": "connected", "startup_error": _startup_error}
    except Exception as e:
        return {"status": "error", "db": str(e), "startup_error": _startup_error, "import_errors": _import_errors}


@app.get("/")
async def root():
    return RedirectResponse(url="/login")


@app.post("/api/backup")
def backup_db():
    """Daily DB backup — copies cabletv.db to backups/ folder, keeps last 7 days."""
    import shutil
    from datetime import datetime
    try:
        from config import DB_PATH
    except Exception:
        return {"ok": False, "error": "DB_PATH not available"}
    if not DB_PATH:
        return {"ok": False, "error": "No SQLite DB (using PostgreSQL)"}

    backup_dir = os.path.join(os.path.dirname(DB_PATH), "backups")
    os.makedirs(backup_dir, exist_ok=True)

    date_str = datetime.now().strftime("%Y-%m-%d")
    backup_path = os.path.join(backup_dir, f"cabletv_{date_str}.db")

    shutil.copy2(DB_PATH, backup_path)

    kept = 0
    removed = 0
    for f in sorted(os.listdir(backup_dir)):
        if not f.startswith("cabletv_") or not f.endswith(".db"):
            continue
        fp = os.path.join(backup_dir, f)
        if len(os.listdir(backup_dir)) - removed > 7:
            if f != f"cabletv_{date_str}.db":
                os.remove(fp)
                removed += 1
            else:
                kept += 1
        else:
            kept += 1

    size_mb = os.path.getsize(backup_path) / (1024 * 1024)
    return {"ok": True, "file": backup_path, "size_mb": round(size_mb, 2), "kept": kept, "removed": removed}


# ── One-time data import endpoint ──────────────────────────────────────
@app.post("/api/import-local-data")
async def import_local_data(request: Request):
    """Import data from local SQLite export JSON into PostgreSQL. One-time use."""
    import json as _json
    from deps_orm import get_current_user as _gcu
    from models.base import engine
    
    # Auth check
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = auth[7:]
    # Decode JWT directly
    from jose import jwt as _jwt, JWTError
    from config import SECRET_KEY, ALGORITHM
    try:
        payload = _jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("role") != "master":
            raise HTTPException(403, "Master admin only")
    except JWTError:
        raise HTTPException(403, "Invalid token")
    
    export_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data_export.json")
    if not os.path.exists(export_path):
        return {"error": "No data_export.json found"}
    
    with open(export_path) as f:
        data = _json.load(f)
    
    from sqlalchemy import text
    results = {}
    OPERATOR_ID = 1
    
    with engine.connect() as conn:
        # Import order (FK constraints)
        import_order = [
            ('plans', True, []),
            ('customers', True, []),
            ('connections', True, []),
            ('customer_plans', True, []),
            ('stb_inventory', True, []),
        ]
        
        for table_name, has_op_id, skip_roles in import_order:
            if table_name not in data:
                results[table_name] = "skipped (not in export)"
                continue
            
            cols = data[table_name]['columns']
            rows = data[table_name]['rows']
            
            # Get actual PG columns
            pg_cols_result = conn.execute(text(
                f"SELECT column_name FROM information_schema.columns WHERE table_name = '{table_name}' ORDER BY ordinal_position"
            ))
            pg_cols = [r[0] for r in pg_cols_result]
            common = [c for c in cols if c in pg_cols]
            
            # Clear existing
            conn.execute(text(f"DELETE FROM {table_name}"))
            
            col_str = ', '.join(common)
            placeholders = ', '.join([f':{c}' for c in common])
            
            count = 0
            for row in rows:
                params = {}
                for c in common:
                    v = row.get(c)
                    if c == 'operator_id' and has_op_id:
                        params[c] = None if row.get('role') in ('master',) else OPERATOR_ID
                    else:
                        params[c] = None if v is None or v == '' else v
                
                try:
                    conn.execute(text(f"INSERT INTO {table_name} ({col_str}) VALUES ({placeholders})"), params)
                    count += 1
                except Exception as e:
                    results[f"{table_name}_error_{count}"] = str(e)[:100]
            
            conn.commit()
            results[table_name] = f"{count} imported"
        
        # Import users (skip existing)
        if 'users' in data:
            count = 0
            for row in data['users']['rows']:
                username = row.get('username')
                existing = conn.execute(text("SELECT id FROM users WHERE username = :u"), {"u": username}).fetchone()
                if existing:
                    results[f"user_{username}"] = "skipped (exists)"
                    continue
                
                cols = data['users']['columns']
                pg_cols_result = conn.execute(text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position"
                ))
                pg_cols = [r[0] for r in pg_cols_result]
                common = [c for c in cols if c in pg_cols]
                
                col_str = ', '.join(common)
                placeholders = ', '.join([f':{c}' for c in common])
                
                params = {}
                for c in common:
                    v = row.get(c)
                    if c == 'operator_id':
                        params[c] = None if row.get('role') == 'master' else OPERATOR_ID
                    else:
                        params[c] = None if v is None or v == '' else v
                
                try:
                    conn.execute(text(f"INSERT INTO users ({col_str}) VALUES ({placeholders})"), params)
                    count += 1
                except Exception as e:
                    results[f"user_{username}_error"] = str(e)[:100]
            
            conn.commit()
            results['users'] = f"{count} imported"
    
    # Verify
    for t in ['customers','connections','plans','users','customer_plans','stb_inventory']:
        with engine.connect() as conn:
            cnt = conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            results[f"verify_{t}"] = cnt
    
    return {"status": "ok", "results": results}


# ── Paypakka payments bulk import ──────────────────────────────────────
@app.post("/api/import-paypakka-payments")
async def import_paypakka_payments(request: Request):
    """Bulk import paypakka_payments from local SQLite. Master only. Batches of 500."""
    from deps_orm import get_current_user as _gcu
    from models.base import engine
    from sqlalchemy import text

    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Not authenticated")
    token = auth[7:]
    from jose import jwt as _jwt, JWTError
    from config import SECRET_KEY, ALGORITHM
    try:
        payload = _jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("role") != "master":
            raise HTTPException(403, "Master admin only")
    except JWTError:
        raise HTTPException(403, "Invalid token")

    body = await request.json()
    rows = body.get("rows", [])
    if not rows:
        return {"status": "error", "message": "No rows provided"}

    columns = [
        "id", "customer_id", "payment_ref_id", "transaction_id",
        "service_ref_id", "plan_amount", "bill_amount", "collection_amount",
        "discount_amount", "tax", "payment_type", "status",
        "paypakka_created_at", "imported_at", "emp_ref_id", "operator_id"
    ]
    col_str = ", ".join(columns)
    placeholders = ", ".join([f":{c}" for c in columns])

    with engine.connect() as conn:
        count = 0
        errors = []
        for row in rows:
            params = {}
            for c in columns:
                v = row.get(c)
                params[c] = None if v is None or v == "" else v
            try:
                conn.execute(text(f"INSERT INTO paypakka_payments ({col_str}) VALUES ({placeholders})"), params)
                count += 1
            except Exception as e:
                if "unique" not in str(e).lower() and "duplicate" not in str(e).lower():
                    errors.append(f"row {row.get('id','?')}: {str(e)[:80]}")
                # Skip duplicates silently
        conn.commit()

    return {"status": "ok", "imported": count, "errors": errors[:10]}


# Serve frontend static files
STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
LEGACY_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
BUNDLED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "legacy-frontend")

print(f"DEBUG: LEGACY_DIR={LEGACY_DIR}, exists={os.path.exists(LEGACY_DIR)}")
print(f"DEBUG: BUNDLED_DIR={BUNDLED_DIR}, exists={os.path.exists(BUNDLED_DIR)}")
print(f"DEBUG: STATIC_DIR={STATIC_DIR}, exists={os.path.exists(STATIC_DIR)}")
print(f"DEBUG: BUNDLED_DIR contents={os.listdir(BUNDLED_DIR) if os.path.exists(BUNDLED_DIR) else 'N/A'}")
print(f"DEBUG: dashboard.html exists={os.path.exists(os.path.join(BUNDLED_DIR, 'dashboard.html'))}")

if os.path.exists(os.path.join(LEGACY_DIR, "dashboard.html")):
    FRONTEND_DIR = LEGACY_DIR
elif os.path.exists(os.path.join(BUNDLED_DIR, "dashboard.html")):
    FRONTEND_DIR = BUNDLED_DIR
elif os.path.exists(os.path.join(STATIC_DIR, "index.html")):
    FRONTEND_DIR = STATIC_DIR
else:
    FRONTEND_DIR = None
    print("WARNING: No frontend directory found!")
    print(f"DEBUG: All files in cwd: {os.listdir(os.path.dirname(os.path.abspath(__file__)))}")

if FRONTEND_DIR:
    print(f"Serving frontend from: {FRONTEND_DIR}")

    # Mount static files (JS, CSS, images, etc.) from FRONTEND_DIR
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    async def serve_root():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/login")

    @app.get("/debug-frontend")
    async def debug_frontend():
        return {
            "frontend_dir": FRONTEND_DIR,
            "exists": os.path.isdir(FRONTEND_DIR) if FRONTEND_DIR else False,
            "files": os.listdir(FRONTEND_DIR) if FRONTEND_DIR and os.path.isdir(FRONTEND_DIR) else [],
            "legacy_dir": LEGACY_DIR,
            "legacy_exists": os.path.isdir(LEGACY_DIR),
            "bundled_dir": BUNDLED_DIR,
            "bundled_exists": os.path.isdir(BUNDLED_DIR),
            "static_dir": STATIC_DIR,
            "static_exists": os.path.isdir(STATIC_DIR),
        }

    @app.get("/dashboard")
    async def serve_dashboard():
        return FileResponse(os.path.join(FRONTEND_DIR, "dashboard.html"))

    @app.get("/login")
    async def serve_login():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/start")
    async def serve_start():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    # Catch-all: serve static files from FRONTEND_DIR (JS, CSS, images, etc.)
    # Only matches paths that don't start with /api/ — those are handled by routers
    @app.get("/{filename:path}")
    async def serve_static_file(filename: str):
        # Don't intercept API routes or the routes we already defined
        if filename.startswith("api/") or filename in ("dashboard", "login", "start"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        filepath = os.path.join(FRONTEND_DIR, filename)
        if os.path.isfile(filepath):
            return FileResponse(filepath)
        return JSONResponse({"detail": "Not Found"}, status_code=404)
else:
    @app.get("/login")
    async def serve_login():
        return JSONResponse({"error": "No frontend built", "debug": "/api/debug-startup"})

    @app.get("/dashboard")
    async def serve_dashboard():
        return JSONResponse({"error": "No frontend built", "debug": "/api/debug-startup"})

    print("No frontend directory — serving API-only mode")
