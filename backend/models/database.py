"""Database schema, initialization, migrations, and data import."""
import os
import json
from datetime import datetime

from config import DB_PATH, DB_ENGINE, PAYPAKKA_CUSTOMER_JSON
from utils import hash_password

# Conditional imports
if DB_ENGINE == "sqlite":
    import sqlite3
else:
    import psycopg2
    from psycopg2.extras import RealDictCursor


def get_db():
    """Get a DB connection (for backward compat). Prefer deps.get_db() context manager."""
    if DB_ENGINE == "sqlite":
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("PRAGMA synchronous = NORMAL")
        return conn
    else:
        from config import DATABASE_URL_PG
        conn = psycopg2.connect(DATABASE_URL_PG)
        conn.autocommit = False
        return conn


# ── SQL Dialect Helpers ──────────────────────────────────────────────────
def _ph(n=1):
    """Placeholder: ? for SQLite, %s for PostgreSQL"""
    if DB_ENGINE == "sqlite":
        return ", ".join(["?"] * n) if n > 1 else "?"
    return ", ".join(["%s"] * n) if n > 1 else "%s"

def _pk():
    """Primary key: AUTOINCREMENT for SQLite, SERIAL for PostgreSQL"""
    return "INTEGER PRIMARY KEY AUTOINCREMENT" if DB_ENGINE == "sqlite" else "SERIAL PRIMARY KEY"

def _bool_default(val):
    """Boolean default: 0/1 for SQLite, true/false for PostgreSQL"""
    if DB_ENGINE == "sqlite":
        return str(val)
    return "true" if val else "false"

def _ts():
    """Timestamp type: TEXT for SQLite, TIMESTAMP for PostgreSQL"""
    return "TEXT" if DB_ENGINE == "sqlite" else "TIMESTAMP"

def _datetime():
    """Datetime type: TEXT for SQLite, TIMESTAMP for PostgreSQL"""
    return "TEXT" if DB_ENGINE == "sqlite" else "TIMESTAMP"

def _safe_alter(table, column, col_type):
    """Safe ALTER TABLE — catches 'column already exists' on both engines."""
    sql = f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"
    conn = None
    try:
        conn = get_db()
        conn.execute(sql)
        conn.commit()
        print(f"  Added column {table}.{column}")
    except Exception as e:
        print(f"  _safe_alter({table}.{column}): {e}")
        if conn:
            try:
                conn.rollback()
            except:
                pass
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass


def init_db():
    conn = get_db()
    c = conn.cursor()

    pk = _pk()

    # Users table (admin + agents)
    c.execute(f'''CREATE TABLE IF NOT EXISTS users (
        id {pk},
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agent',
        phone TEXT,
        operator_id INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'Active',
        permissions TEXT
    )''')

    # Customers table
    c.execute(f'''CREATE TABLE IF NOT EXISTS customers (
        id {pk},
        customer_id TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        phone2 TEXT,
        address TEXT,
        area TEXT,
        city TEXT DEFAULT 'Coimbatore',
        pincode TEXT,
        status TEXT DEFAULT 'Active',
        paypakka_id TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
        surrendered_date TEXT,
        surrender_reason TEXT
    )''')

    # Connections (STB/Cable)
    c.execute(f'''CREATE TABLE IF NOT EXISTS connections (
        id {pk},
        customer_id TEXT NOT NULL,
        stb_no TEXT UNIQUE NOT NULL,
        can_id TEXT,
        mso TEXT DEFAULT 'GTPL',
        service_type TEXT DEFAULT 'Cable',
        billing_type TEXT DEFAULT 'Prepaid',
        status TEXT DEFAULT 'Active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # Plans
    c.execute(f'''CREATE TABLE IF NOT EXISTS plans (
        id {pk},
        name TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        validity_days INTEGER DEFAULT 30,
        description TEXT,
        status TEXT DEFAULT 'Active'
    )''')

    # Customer Plans
    c.execute(f'''CREATE TABLE IF NOT EXISTS customer_plans (
        id {pk},
        customer_id TEXT NOT NULL,
        connection_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        start_date TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        status TEXT DEFAULT 'Active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # Payments
    c.execute(f'''CREATE TABLE IF NOT EXISTS payments (
        id {pk},
        customer_id TEXT NOT NULL,
        connection_id INTEGER NOT NULL,
        plan_id INTEGER,
        amount REAL NOT NULL CHECK (amount > 0),
        payment_mode TEXT DEFAULT 'Cash',
        collected_by INTEGER,
        collected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        month_year TEXT,
        notes TEXT
    )''')

    # Paypakka Plans
    c.execute(f'''CREATE TABLE IF NOT EXISTS paypakka_plans (
        id {pk},
        paypakka_plan_id TEXT UNIQUE NOT NULL,
        plan_name TEXT NOT NULL,
        plan_amount REAL NOT NULL,
        package_category TEXT NOT NULL DEFAULT 'package',
        billing_cycle TEXT DEFAULT 'monthly',
        billing_type TEXT DEFAULT 'Prepaid',
        service_type TEXT DEFAULT 'Cable',
        mso TEXT DEFAULT 'GTPL',
        sd_count INTEGER DEFAULT 0,
        hd_count INTEGER DEFAULT 0,
        inclusive_of_tax INTEGER DEFAULT 1,
        plan_validity TEXT DEFAULT '1 month',
        status TEXT DEFAULT 'Active',
        distributor_ref_id TEXT,
        paypakka_created_at TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # Paypakka Customer Plans
    c.execute(f'''CREATE TABLE IF NOT EXISTS paypakka_customer_plans (
        id {pk},
        customer_id TEXT NOT NULL,
        cust_plan_ref_id TEXT UNIQUE NOT NULL,
        plan_ref_id TEXT NOT NULL,
        service_ref_id TEXT,
        activate_date TEXT,
        expired_date TEXT,
        status TEXT DEFAULT 'Active',
        paypakka_created_at TEXT,
        paypakka_updated_at TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # Paypakka Payments
    c.execute(f'''CREATE TABLE IF NOT EXISTS paypakka_payments (
        id {pk},
        customer_id TEXT NOT NULL,
        payment_ref_id TEXT UNIQUE NOT NULL,
        transaction_id TEXT,
        service_ref_id TEXT,
        plan_amount REAL,
        bill_amount REAL,
        collection_amount REAL,
        discount_amount REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        payment_type TEXT,
        status TEXT DEFAULT 'Success',
        emp_ref_id TEXT,
        paypakka_created_at TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute(f'''CREATE TABLE IF NOT EXISTS paypakka_employees (
        emp_ref_id TEXT PRIMARY KEY,
        emp_name TEXT,
        emp_code TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # SMS Log
    c.execute(f'''CREATE TABLE IF NOT EXISTS sms_log (
        id {pk},
        customer_id TEXT,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        provider TEXT,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # ── Migrations (safe ALTER TABLE) ──────────────────────────────────────
    _safe_alter_list = [
        ("users", "status", "TEXT DEFAULT 'Active'"),
        ("users", "permissions", "TEXT"),
        ("customers", "status", "TEXT DEFAULT 'Active'"),
        ("customers", "surrendered_date", "TEXT"),
        ("customers", "surrender_reason", "TEXT"),
    ]
    # customer_auth may not exist yet, wrap in try
    _safe_alter_list.append(("customer_auth", "pin", "TEXT"))

    for table, col, typ in _safe_alter_list:
        _safe_alter(table, col, typ)

    # ── Additional Tables ──────────────────────────────────────────────────
    c.execute(f'''CREATE TABLE IF NOT EXISTS stb_inventory (
        id {pk},
        stb_no TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'spare',
        notes TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        added_by TEXT,
        operator_id INTEGER DEFAULT 1
    )''')

    c.execute(f'''CREATE TABLE IF NOT EXISTS surrender_requests (
        id {pk},
        customer_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        stb_no TEXT,
        reason TEXT,
        requested_by INTEGER NOT NULL,
        requested_by_name TEXT NOT NULL,
        requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'pending',
        reviewed_by INTEGER,
        reviewed_by_name TEXT,
        reviewed_at TEXT,
        review_notes TEXT,
        operator_id INTEGER DEFAULT 1
    )''')

    c.execute(f'''CREATE TABLE IF NOT EXISTS customer_auth (
        id {pk},
        customer_id TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        password TEXT,
        pin TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute(f'''CREATE TABLE IF NOT EXISTS complaints (
        id {pk},
        customer_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'normal',
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT,
        resolved_at TEXT,
        admin_notes TEXT
    )''')

    c.execute(f'''CREATE TABLE IF NOT EXISTS online_payments (
        id {pk},
        customer_id TEXT NOT NULL,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        razorpay_signature TEXT,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'created',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        captured_at TEXT
    )''')

    # Active Sessions
    c.execute(f'''CREATE TABLE IF NOT EXISTS active_sessions (
        id {pk},
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_activity TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # Operators (Multi-tenant)
    c.execute(f'''CREATE TABLE IF NOT EXISTS operators (
        id {pk},
        business_name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT DEFAULT '',
        area TEXT DEFAULT '',
        mso TEXT DEFAULT 'GTPL',
        status TEXT DEFAULT 'active',
        license_type TEXT DEFAULT 'active',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS notification_settings (
        key TEXT NOT NULL,
        operator_id INTEGER NOT NULL DEFAULT 1,
        value TEXT NOT NULL,
        PRIMARY KEY (key, operator_id)
    )''')

    # ── Performance Indexes ────────────────────────────────────────────────
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON active_sessions(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON active_sessions(session_id)",
        "CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)",
        "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)",
        "CREATE INDEX IF NOT EXISTS idx_customers_area ON customers(area)",
        "CREATE INDEX IF NOT EXISTS idx_customers_customer_id ON customers(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_connections_customer_id ON connections(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status)",
        "CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_payments_month_year ON payments(month_year)",
        "CREATE INDEX IF NOT EXISTS idx_payments_collected_by ON payments(collected_by)",
        "CREATE INDEX IF NOT EXISTS idx_ppayments_customer_id ON paypakka_payments(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_ppayments_created_at ON paypakka_payments(paypakka_created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ppayments_emp_ref_id ON paypakka_payments(emp_ref_id)",
        "CREATE INDEX IF NOT EXISTS idx_pcustplans_customer_id ON paypakka_customer_plans(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_custplans_customer_id ON customer_plans(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_smslog_customer_id ON sms_log(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_complaints_customer_id ON complaints(customer_id)",
    ]
    for idx_sql in indexes:
        try:
            c.execute(idx_sql)
        except Exception:
            pass

    conn.commit()

    # ── Seed Data ──────────────────────────────────────────────────────────
    c.execute("SELECT COUNT(*) FROM users WHERE role IN ('admin','master')")
    count = c.fetchone()
    count_val = count[0]

    if count_val == 0:
        ph = _ph(6)
        c.execute(
            f"INSERT INTO users (username, password, name, role, phone, operator_id) VALUES ({ph})",
            ('admin', hash_password('admin123'), 'Prabhu (Admin)', 'master', '9787225577', None)
        )
        c.execute(
            f"INSERT INTO users (username, password, name, role, phone, operator_id) VALUES ({ph})",
            ('agent1', hash_password('agent123'), 'Collection Agent 1', 'agent', None, 1)
        )

    c.execute("SELECT COUNT(*) FROM plans")
    count = c.fetchone()
    count_val = count[0]

    if count_val == 0:
        ph = _ph(4)
        plans = [
            ('TAMIL POWER', 280, 30, 'Tamil power package'),
            ('TAMIL POWER HD', 330, 30, 'Tamil power HD package'),
            ('Basic', 200, 30, 'Basic package'),
            ('Full Pack', 350, 30, 'Full channel pack'),
        ]
        for plan in plans:
            c.execute(
                f"INSERT INTO plans (name, amount, validity_days, description) VALUES ({ph})",
                plan,
            )

    conn.commit()
    conn.close()
    print("Database initialized successfully")


def import_customers_from_json():
    """Import all 593 customers from paypakka JSON export."""
    if not os.path.exists(PAYPAKKA_CUSTOMER_JSON):
        print(f"Customer JSON not found at {PAYPAKKA_CUSTOMER_JSON}")
        return 0

    conn = get_db()
    c = conn.cursor()

    c.execute("SELECT COUNT(*) FROM customers")
    existing = c.fetchone()[0]
    if existing > 0:
        print(f"Customers already imported ({existing} found). Skipping.")
        conn.close()
        return existing

    with open(PAYPAKKA_CUSTOMER_JSON, 'r') as f:
        customers_data = json.load(f)

    ph8 = _ph(8)
    ph7 = _ph(7)
    insert_ignore = "INSERT OR IGNORE" if DB_ENGINE == "sqlite" else "INSERT"
    on_conflict = "" if DB_ENGINE == "sqlite" else " ON CONFLICT DO NOTHING"

    imported = 0
    for cust in customers_data:
        try:
            customer_id = cust.get('paypakka_user_id', '')
            if not customer_id:
                continue

            name = cust.get('name', '').strip()
            phone = cust.get('mobile_no', '').replace(' ', '')
            area = cust.get('area', '')
            city = cust.get('city', 'Coimbatore')
            pincode = cust.get('pin_code', '')
            status = cust.get('status', 'Active')
            paypakka_id = cust.get('_id', '')

            c.execute(
                f"""{insert_ignore} INTO customers 
                   (customer_id, name, phone, area, city, pincode, status, paypakka_id)
                   VALUES ({ph8}){on_conflict}""",
                (customer_id, name, phone, area, city, pincode, status, paypakka_id),
            )

            services = cust.get('services', [])
            for svc in services:
                stb_no = svc.get('stb_no', '')
                if not stb_no:
                    continue
                can_id = svc.get('can_id', '')
                mso = svc.get('mso', 'GTPL')
                service_type = svc.get('service_type', 'Cable')
                billing_type = svc.get('billing_type', 'Prepaid')
                svc_status = svc.get('status', 'Active')

                c.execute(
                    f"""{insert_ignore} INTO connections
                       (customer_id, stb_no, can_id, mso, service_type, billing_type, status)
                       VALUES ({ph7}){on_conflict}""",
                    (customer_id, stb_no, can_id, mso, service_type, billing_type, svc_status),
                )

            imported += 1
        except Exception as e:
            print(f"Error importing {cust.get('paypakka_user_id', '?')}: {e}")
            continue

    conn.commit()
    conn.close()
    return imported


# ── Run Migrations ──
def run_migrations(db_path: str = None):
    """Add columns/tables that may not exist in older DBs."""
    conn = get_db() if DB_ENGINE == "postgresql" else sqlite3.connect(db_path or DB_PATH)
    if DB_ENGINE == "sqlite":
        conn.row_factory = sqlite3.Row
    c = conn.cursor()
    pk = _pk()

    # Column migrations
    migrations = [
        ("payment_type", "ALTER TABLE payments ADD COLUMN payment_type TEXT DEFAULT 'regular'"),
        ("acknowledged_at", f"ALTER TABLE service_requests ADD COLUMN acknowledged_at {_datetime()}"),
        ("on_the_way_at", f"ALTER TABLE service_requests ADD COLUMN on_the_way_at {_datetime()}"),
        ("ack_lat", "ALTER TABLE service_requests ADD COLUMN ack_lat REAL"),
        ("ack_lng", "ALTER TABLE service_requests ADD COLUMN ack_lng REAL"),
        ("otw_lat", "ALTER TABLE service_requests ADD COLUMN otw_lat REAL"),
        ("otw_lng", "ALTER TABLE service_requests ADD COLUMN otw_lng REAL"),
        ("settled_lat", "ALTER TABLE service_requests ADD COLUMN settled_lat REAL"),
        ("settled_lng", "ALTER TABLE service_requests ADD COLUMN settled_lng REAL"),
        ("con_notes", "ALTER TABLE connections ADD COLUMN notes TEXT DEFAULT ''"),
        ("con_updated_at", "ALTER TABLE connections ADD COLUMN updated_at TEXT"),
        ("con_disconnect_date", "ALTER TABLE connections ADD COLUMN disconnect_date TEXT"),
    ]
    for col_name, sql in migrations:
        try:
            c.execute(sql)
            conn.commit()
            print(f"Migration OK: {col_name}")
        except Exception:
            conn.rollback()  # Must rollback on PG after failed ALTER
            pass

    # Table migrations
    c.execute(f'''CREATE TABLE IF NOT EXISTS push_subscriptions (
        id {pk},
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL DEFAULT '',
        auth TEXT NOT NULL DEFAULT '',
        created_at {_ts()} DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, endpoint)
    )''')

    c.execute(f'''CREATE TABLE IF NOT EXISTS service_requests (
        id {pk},
        ticket_no TEXT UNIQUE NOT NULL,
        customer_id TEXT,
        type TEXT NOT NULL,
        category TEXT,
        priority TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        description TEXT NOT NULL,
        assigned_to INTEGER,
        created_by INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'app',
        resolution TEXT,
        resolution_notes TEXT,
        deadline {_ts()},
        tg_message_id INTEGER,
        acknowledged_at {_ts()},
        on_the_way_at {_ts()},
        resolved_at {_ts()},
        closed_at {_ts()},
        closed_by INTEGER,
        cancelled_at {_ts()},
        operator_id INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    sr_indexes = [
        "CREATE INDEX IF NOT EXISTS idx_sr_customer ON service_requests(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_sr_status ON service_requests(status)",
        "CREATE INDEX IF NOT EXISTS idx_sr_assigned ON service_requests(assigned_to)",
        "CREATE INDEX IF NOT EXISTS idx_sr_priority ON service_requests(priority)",
        "CREATE INDEX IF NOT EXISTS idx_sr_deadline ON service_requests(deadline)",
    ]
    for idx_sql in sr_indexes:
        try:
            c.execute(idx_sql)
        except Exception:
            conn.rollback()

    extra_indexes = [
        "CREATE INDEX IF NOT EXISTS idx_connections_expiry ON connections(expiry_date)",
        "CREATE INDEX IF NOT EXISTS idx_connections_mso ON connections(mso)",
        "CREATE INDEX IF NOT EXISTS idx_payments_collected_at ON payments(collected_at)",
        "CREATE INDEX IF NOT EXISTS idx_payments_deleted ON payments(deleted)",
    ]
    for idx_sql in extra_indexes:
        try:
            c.execute(idx_sql)
        except Exception:
            conn.rollback()

    c.execute(f'''CREATE TABLE IF NOT EXISTS audit_log (
        id {pk},
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        old_value TEXT,
        new_value TEXT,
        performed_by INTEGER,
        performed_by_name TEXT,
        operator_id INTEGER,
        ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')
    try:
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(performed_by)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)")
    except Exception:
        pass

    # Soft-delete migration
    migrations_v2 = [
        ("deleted", "ALTER TABLE payments ADD COLUMN deleted INTEGER DEFAULT 0"),
        ("deleted_by", "ALTER TABLE payments ADD COLUMN deleted_by INTEGER"),
        ("deleted_at", "ALTER TABLE payments ADD COLUMN deleted_at TEXT"),
        ("delete_reason", "ALTER TABLE payments ADD COLUMN delete_reason TEXT"),
    ]
    for col_name, sql in migrations_v2:
        try:
            c.execute(sql)
            conn.commit()
        except Exception:
            conn.rollback()  # Must rollback on PG
            pass

    c.execute(f'''CREATE TABLE IF NOT EXISTS request_timeline (
        id {pk},
        request_id INTEGER NOT NULL,
        old_status TEXT,
        new_status TEXT,
        changed_by INTEGER,
        changed_by_name TEXT,
        source TEXT DEFAULT 'app',
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    conn.commit()
    conn.close()


if __name__ == '__main__':
    init_db()
    run_migrations()
    import_customers_from_json()
