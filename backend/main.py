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

# Structured logging + optional Sentry — configure before anything logs.
from logging_config import configure_logging, request_id_var
configure_logging()

import logging as _logging
_log = _logging.getLogger("wasool.main")

_sentry_dsn = os.getenv("SENTRY_DSN", "")
if _sentry_dsn:
    try:
        import sentry_sdk
        sentry_sdk.init(
            dsn=_sentry_dsn,
            traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0")),
            environment=os.getenv("ENVIRONMENT", "production"),
        )
        _log.info("Sentry error tracking enabled")
    except Exception as e:  # noqa: BLE001 — never let monitoring break startup
        _log.warning("Sentry init failed: %s", e)

from uuid import uuid4
from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
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
    "notifications": ("routes.notifications", "router"),
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
    # Never fall back to "*" with allow_credentials=True (invalid + insecure).
    # Use the known production/dev origins instead.
    CORS_ORIGINS = [
        "http://localhost:8000", "http://127.0.0.1:8000",
        "http://0.0.0.0:8000", "https://rscloud.live",
    ]

# ── Startup ──────────────────────────────────────────────────────────────
_startup_error = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init DB + import customers, then start notification task."""
    global _startup_error
    try:
        if os.getenv("DATABASE_URL"):
            # Production (Postgres): schema is managed by the Alembic release step
            # (migrate.py via railway preDeployCommand), NOT by startup DDL.
            _log.info("Startup: DATABASE_URL set — skipping startup DDL (Alembic release step manages schema)")
        else:
            # Local/dev/CI (SQLite): build & migrate the schema in-process so a
            # fresh checkout (no separate migration step) just works.
            if init_db:
                init_db()
            if run_migrations:
                run_migrations()
        if import_customers:
            import_customers()
        _log.info("Backend ready - Wasool")
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

# Correlate logs per request: accept an inbound X-Request-ID or generate one,
# expose it on the context var (for JSON logs) and echo it back on the response.
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid4().hex[:12]
    token = request_id_var.set(rid)
    try:
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    response.headers["X-Request-ID"] = rid
    return response


# Gzip responses larger than 1 KB (JSON API payloads, JS/CSS assets)
app.add_middleware(GZipMiddleware, minimum_size=1000)

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

# ── Auth gate for destructive/maintenance admin endpoints ─────────────────

def require_master(request: Request):
    """FastAPI dependency: require a valid master-role staff JWT.

    Gates the destructive/maintenance admin endpoints below (nuke, raw SQL,
    bulk import, backup). Mirrors the manual master check already used by
    /api/migrate so behaviour for legitimate master callers is unchanged.
    """
    from jose import jwt as _jwt, JWTError
    from config import SECRET_KEY, ALGORITHM
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = _jwt.decode(auth[7:], SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if payload.get("role") != "master":
        raise HTTPException(status_code=403, detail="Master admin only")
    return payload


@app.post("/api/nuke-data")
def nuke_data(_auth: dict = Depends(require_master)):
    """Nuclear wipe: delete all business data (keep operators, users, settings).
    Only callable by master. USE WITH CAUTION."""
    from deps_orm import get_db as get_db_orm
    from sqlalchemy import text
    from models.base import engine
    db = next(get_db_orm())
    try:
        # Get actual table names from PostgreSQL
        existing_tables = db.execute(text(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )).fetchall()
        existing = {t[0] for t in existing_tables}
        
        tables_to_wipe = [
            "service_request_timeline", "service_requests",
            "surrender_requests", "complaints", "notifications_settings",
            "online_payments", "sms_logs", "push_subscriptions",
            "audit_log", "audit_logs",
            "customer_plans", "payments", "connections", "customers",
            "stb_inventory", "paypakka_payments", "paypakka_plans",
            "paypakka_customer_plans", "paypakka_employees",
            "plans", "active_sessions", "customer_auth",
        ]
        results = {}
        for table in tables_to_wipe:
            if table not in existing:
                results[table] = "skipped (not exists)"
                continue
            try:
                count = db.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar()
                if count > 0:
                    db.execute(text(f'DELETE FROM "{table}"'))
                    db.commit()
                results[table] = count
            except Exception as e:
                db.rollback()
                results[table] = f"error: {str(e)[:80]}"
        
        # Reset sequences
        for seq in ["customers_id_seq", "payments_id_seq", "connections_id_seq", "plans_id_seq"]:
            try:
                db.execute(text(f"ALTER SEQUENCE IF EXISTS {seq} RESTART WITH 1"))
                db.commit()
            except:
                db.rollback()
        
        return {"ok": True, "wiped": results}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)}


@app.post("/api/cleanup-hard-delete-payments")
def cleanup_hard_delete(_auth: dict = Depends(require_master)):
    """Hard-delete all soft-deleted payments (deleted=1). One-time cleanup."""
    from deps_orm import get_db as get_db_orm
    from sqlalchemy import text
    db = next(get_db_orm())
    try:
        count = db.execute(text("SELECT COUNT(*) FROM payments WHERE deleted = 1")).scalar()
        if count == 0:
            return {"ok": True, "deleted": 0, "message": "No soft-deleted payments to clean up"}
        db.execute(text("DELETE FROM payments WHERE deleted = 1"))
        db.commit()
        return {"ok": True, "deleted": count, "message": f"Hard-deleted {count} soft-deleted payments"}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/sql")
def admin_sql(body: dict, _auth: dict = Depends(require_master)):
    """Execute raw SQL on the DB. Master only. USE WITH EXTREME CAUTION."""
    from deps_orm import get_db as get_db_orm
    from sqlalchemy import text
    db = next(get_db_orm())
    sql = body.get("sql", "")
    try:
        if sql.strip().upper().startswith("SELECT"):
            rows = db.execute(text(sql)).fetchall()
            cols = list(db.execute(text(sql)).keys())
            return {"ok": True, "columns": cols, "rows": [list(r) for r in rows]}
        else:
            db.execute(text(sql))
            db.commit()
            return {"ok": True, "message": "Executed"}
    except Exception as e:
        db.rollback()
        return {"ok": False, "error": str(e)}


@app.post("/api/admin/bulk-payments")
def admin_bulk_payments(body: dict, _auth: dict = Depends(require_master)):
    """Bulk import payments. Master only."""
    from deps_orm import get_db as get_db_orm
    from sqlalchemy import text
    db = next(get_db_orm())
    payments = body.get("payments", [])
    ok = 0
    fail = 0
    errors = {}
    for p in payments:
        try:
            db.execute(text("""
                INSERT INTO payments (customer_id, connection_id, amount, payment_mode,
                                      collected_at, month_year, previous_balance, bill_amount, operator_id, payment_type)
                VALUES (:cid, :conn_id, :amount, :mode, :collected_at, :my, :prev_bal, :bill_amt, :op_id, :ptype)
            """), {
                "cid": p.get("customer_id"),
                "conn_id": p.get("connection_id"),
                "amount": p.get("amount", 0),
                "mode": p.get("payment_mode", "Cash"),
                "collected_at": p.get("collected_at"),
                "my": p.get("month_year", "05-2026"),
                "prev_bal": p.get("previous_balance", 0),
                "bill_amt": p.get("bill_amount"),
                "op_id": 1,
                "ptype": p.get("payment_type", "regular"),
            })
            db.commit()
            ok += 1
        except Exception as e:
            db.rollback()
            fail += 1
            err = str(e)[:60]
            errors[err] = errors.get(err, 0) + 1
    return {"ok": True, "imported": ok, "failed": fail, "errors": errors}


@app.get("/api/health")
def health():
    """Health check — verifies DB connectivity."""
    try:
        from deps_orm import get_db as get_db_orm
        from sqlalchemy import text
        db = next(get_db_orm())
        return {
            "status": "ok",
            "db": "connected",
            "startup_error": _startup_error,
        }
    except Exception as e:
        return {"status": "error", "db": str(e), "startup_error": _startup_error, "import_errors": _import_errors}


@app.get("/api/ready")
def ready():
    """Readiness probe — returns 200 only when the DB is reachable, else 503.

    Distinct from /api/health (liveness): orchestrators should route traffic
    based on this so a process with a broken DB connection is taken out of
    rotation instead of serving errors.
    """
    try:
        from deps_orm import get_db as get_db_orm
        from sqlalchemy import text
        db = next(get_db_orm())
        db.execute(text("SELECT 1"))
        return {"status": "ready"}
    except Exception as e:
        return JSONResponse({"status": "not_ready", "error": str(e)[:200]}, status_code=503)


@app.post("/api/backup")
def backup_db(_auth: dict = Depends(require_master)):
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


# ── Direct Migration (accepts JSON body, uses ORM) ────────────────────
@app.post("/api/migrate")
async def migrate_data(request: Request):
    """Insert customers, connections, payments from JSON body. Master only. Uses SQLAlchemy text() for PG compat."""
    import json as _json
    from sqlalchemy import text
    from models.base import engine

    # Auth check — master only
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

    data = await request.json()
    results = {}
    OPERATOR_ID = 1

    with engine.connect() as conn:
        # 1. Customers
        if "customers" in data:
            count = 0
            for c in data["customers"]:
                cid = c.get("customer_id")
                if not cid:
                    continue
                existing = conn.execute(text("SELECT 1 FROM customers WHERE customer_id = :cid"), {"cid": cid}).fetchone()
                if existing:
                    continue
                try:
                    conn.execute(text("""
                        INSERT INTO customers (customer_id, name, phone, phone2, area, address, city, pincode, status, operator_id)
                        VALUES (:customer_id, :name, :phone, :phone2, :area, :address, :city, :pincode, :status, :operator_id)
                    """), {
                        "customer_id": cid,
                        "name": c.get("name", ""),
                        "phone": c.get("phone", ""),
                        "phone2": c.get("phone2"),
                        "area": c.get("area"),
                        "address": c.get("address"),
                        "city": c.get("city"),
                        "pincode": c.get("pincode"),
                        "status": c.get("status", "Active"),
                        "operator_id": OPERATOR_ID,
                    })
                    count += 1
                except Exception as e:
                    results[f"customer_error_{cid}"] = str(e)[:100]
            conn.commit()
            results["customers"] = count

        # 2. Connections
        if "connections" in data:
            count = 0
            for cn in data["connections"]:
                cid = cn.get("customer_id")
                stb = cn.get("stb_no")
                if not cid or not stb:
                    continue
                existing = conn.execute(text("SELECT 1 FROM connections WHERE customer_id = :cid AND stb_no = :stb"), {"cid": cid, "stb": stb}).fetchone()
                if existing:
                    continue
                try:
                    conn.execute(text("""
                        INSERT INTO connections (customer_id, stb_no, can_id, mso, service_type, billing_type, status, created_at, plan_name, plan_amount, network, operator_id)
                        VALUES (:customer_id, :stb_no, :can_id, :mso, :service_type, :billing_type, :status, :created_at, :plan_name, :plan_amount, :network, :operator_id)
                    """), {
                        "customer_id": cid,
                        "stb_no": stb,
                        "can_id": cn.get("can_id"),
                        "mso": cn.get("mso"),
                        "service_type": cn.get("service_type", "Cable"),
                        "billing_type": cn.get("billing_type", "Prepaid"),
                        "status": cn.get("status", "Active"),
                        "created_at": cn.get("created_at"),
                        "plan_name": cn.get("plan_name"),
                        "plan_amount": cn.get("plan_amount"),
                        "network": cn.get("network", cn.get("mso")),
                        "operator_id": OPERATOR_ID,
                    })
                    count += 1
                except Exception as e:
                    results[f"conn_error_{cid}_{stb}"] = str(e)[:100]
            conn.commit()
            results["connections"] = count

        # 3. Payments
        if "payments" in data:
            count = 0
            for p in data["payments"]:
                cid = p.get("customer_id")
                amount = p.get("amount")
                if not cid or amount is None:
                    continue
                # Find connection_id for this customer
                conn_row = conn.execute(text("SELECT id FROM connections WHERE customer_id = :cid LIMIT 1"), {"cid": cid}).fetchone()
                conn_id = conn_row[0] if conn_row else None

                # Find collected_by employee
                collected_by_val = p.get("collected_by")
                emp_id = None
                if collected_by_val:
                    emp = conn.execute(text("SELECT id FROM employees WHERE emp_name = :name LIMIT 1"), {"name": str(collected_by_val)}).fetchone()
                    if emp:
                        emp_id = emp[0]

                try:
                    conn.execute(text("""
                        INSERT INTO payments (customer_id, amount, payment_mode, month_year, collected_at, collected_by, connection_id, notes, operator_id)
                        VALUES (:customer_id, :amount, :payment_mode, :month_year, :collected_at, :collected_by, :connection_id, :notes, :operator_id)
                    """), {
                        "customer_id": cid,
                        "amount": float(amount),
                        "payment_mode": p.get("payment_mode", "Cash"),
                        "month_year": p.get("month_year", "05-2026"),
                        "collected_at": p.get("collected_at") or p.get("created_at"),
                        "collected_by": emp_id,
                        "connection_id": conn_id,
                        "notes": p.get("notes", ""),
                        "operator_id": OPERATOR_ID,
                    })
                    count += 1
                except Exception as e:
                    results[f"payment_error_{cid}"] = str(e)[:100]
            conn.commit()
            results["payments"] = count

    # Verify counts
    for t in ["customers", "connections", "payments"]:
        try:
            cnt = conn.execute(text(f"SELECT COUNT(*) FROM {t}")).scalar()
            results[f"verify_{t}"] = cnt
        except:
            pass

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

if os.path.exists(os.path.join(LEGACY_DIR, "dashboard.html")):
    FRONTEND_DIR = LEGACY_DIR
elif os.path.exists(os.path.join(BUNDLED_DIR, "dashboard.html")):
    FRONTEND_DIR = BUNDLED_DIR
elif os.path.exists(os.path.join(STATIC_DIR, "index.html")):
    FRONTEND_DIR = STATIC_DIR
else:
    FRONTEND_DIR = None
    print("WARNING: No frontend directory found!")

# ── React app (Vite build) served under /app — coexists with the legacy app ──
# Registered BEFORE the legacy catch-all so /app/* is matched here first.
_REACT_INDEX = os.path.join(STATIC_DIR, "index.html")
if os.path.exists(_REACT_INDEX):
    _REACT_ROOT = os.path.realpath(STATIC_DIR)
    print(f"Serving React app under /app from: {STATIC_DIR}")

    @app.get("/app")
    async def serve_react_root():
        return FileResponse(_REACT_INDEX)

    @app.get("/app/{path:path}")
    async def serve_react(path: str):
        # Serve a real build asset if it exists within the build dir; otherwise
        # fall back to index.html for client-side (SPA) routes.
        real = os.path.realpath(os.path.join(STATIC_DIR, path))
        if (real == _REACT_ROOT or real.startswith(_REACT_ROOT + os.sep)) and os.path.isfile(real):
            return FileResponse(real)
        return FileResponse(_REACT_INDEX)

if FRONTEND_DIR:
    print(f"Serving frontend from: {FRONTEND_DIR}")

    @app.get("/")
    async def serve_root():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/app/")

    # Legacy vanilla routes — all redirect to React app
    @app.get("/dashboard")
    async def serve_dashboard():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/app/")

    @app.get("/login")
    async def serve_login():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/app/")

    @app.get("/start")
    async def serve_start():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/app/")

    # Catch-all: serve static files from FRONTEND_DIR (JS, CSS, images, etc.)
    _FRONTEND_ROOT = os.path.realpath(FRONTEND_DIR)

    @app.get("/{filename:path}")
    async def serve_static_file(filename: str):
        if filename.startswith("api/") or filename in ("dashboard", "login", "start"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # Resolve the requested path and ensure it stays within FRONTEND_DIR
        # (prevents path traversal via ../ or absolute paths).
        real = os.path.realpath(os.path.join(FRONTEND_DIR, filename))
        if real != _FRONTEND_ROOT and not real.startswith(_FRONTEND_ROOT + os.sep):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        if os.path.isfile(real):
            return FileResponse(real)
        return JSONResponse({"detail": "Not Found"}, status_code=404)
else:
    @app.get("/login")
    async def serve_login():
        return JSONResponse({"error": "No frontend built", "debug": "/api/health"})

    @app.get("/dashboard")
    async def serve_dashboard():
        return JSONResponse({"error": "No frontend built", "debug": "/api/health"})

    print("No frontend directory — serving API-only mode")
