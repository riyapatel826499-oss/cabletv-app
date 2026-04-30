"""Database schema, initialization, migrations, and data import."""
import sqlite3
import os
import json
from datetime import datetime

from config import DB_PATH, PAYPAKKA_CUSTOMER_JSON
from utils import hash_password


def get_db():
    """Get a DB connection (for backward compat). Prefer deps.get_db() context manager."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()

    # Users table (admin + agents)
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agent',
        phone TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # Customers table
    c.execute('''CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # Connections (STB/Cable)
    c.execute('''CREATE TABLE IF NOT EXISTS connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        stb_no TEXT UNIQUE NOT NULL,
        can_id TEXT,
        mso TEXT DEFAULT 'GTPL',
        service_type TEXT DEFAULT 'Cable',
        billing_type TEXT DEFAULT 'Prepaid',
        status TEXT DEFAULT 'Active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # Plans
    c.execute('''CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount REAL NOT NULL CHECK (amount > 0),
        validity_days INTEGER DEFAULT 30,
        description TEXT,
        status TEXT DEFAULT 'Active'
    )''')

    # Customer Plans
    c.execute('''CREATE TABLE IF NOT EXISTS customer_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        connection_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        start_date TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        status TEXT DEFAULT 'Active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
        FOREIGN KEY (connection_id) REFERENCES connections(id),
        FOREIGN KEY (plan_id) REFERENCES plans(id)
    )''')

    # Payments
    c.execute('''CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        connection_id INTEGER NOT NULL,
        plan_id INTEGER,
        amount REAL NOT NULL CHECK (amount > 0),
        payment_mode TEXT DEFAULT 'Cash',
        collected_by INTEGER,
        collected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        month_year TEXT,
        notes TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
        FOREIGN KEY (collected_by) REFERENCES users(id)
    )''')

    # Paypakka Plans
    c.execute('''CREATE TABLE IF NOT EXISTS paypakka_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    c.execute('''CREATE TABLE IF NOT EXISTS paypakka_customer_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        cust_plan_ref_id TEXT UNIQUE NOT NULL,
        plan_ref_id TEXT NOT NULL,
        service_ref_id TEXT,
        activate_date TEXT,
        expired_date TEXT,
        status TEXT DEFAULT 'Active',
        paypakka_created_at TEXT,
        paypakka_updated_at TEXT,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # Paypakka Payments
    c.execute('''CREATE TABLE IF NOT EXISTS paypakka_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS paypakka_employees (
        emp_ref_id TEXT PRIMARY KEY,
        emp_name TEXT,
        emp_code TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )''')

    # SMS Log
    c.execute('''CREATE TABLE IF NOT EXISTS sms_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        provider TEXT,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # ── Migrations (safe ALTER TABLE) ──────────────────────────────────────
    _safe_alter = [
        "ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'Active'",
        "ALTER TABLE users ADD COLUMN permissions TEXT",
        "ALTER TABLE customers ADD COLUMN status TEXT DEFAULT 'Active'",
        "ALTER TABLE customers ADD COLUMN surrendered_date TEXT",
        "ALTER TABLE customers ADD COLUMN surrender_reason TEXT",
        "ALTER TABLE customer_auth ADD COLUMN pin TEXT",
    ]
    for sql in _safe_alter:
        try:
            c.execute(sql)
        except sqlite3.OperationalError:
            pass  # Column already exists

    # ── Additional Tables ──────────────────────────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS stb_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stb_no TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'spare',
        notes TEXT,
        added_at TEXT DEFAULT CURRENT_TIMESTAMP,
        added_by TEXT
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS surrender_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
        FOREIGN KEY (requested_by) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS customer_auth (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        password TEXT,
        pin TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS complaints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'normal',
        status TEXT DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT,
        resolved_at TEXT,
        admin_notes TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS online_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id TEXT NOT NULL,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        razorpay_signature TEXT,
        amount REAL NOT NULL,
        status TEXT DEFAULT 'created',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        captured_at TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # ── Active Sessions (single-device login) ────────────────────────────
    c.execute('''CREATE TABLE IF NOT EXISTS active_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON active_sessions(user_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON active_sessions(session_id)")

    # ── Performance Indexes ────────────────────────────────────────────────
    indexes = [
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
        c.execute(idx_sql)

    conn.commit()

    # ── Seed Data ──────────────────────────────────────────────────────────
    c.execute("SELECT COUNT(*) FROM users WHERE role='admin'")
    if c.fetchone()[0] == 0:
        c.execute(
            "INSERT INTO users (username, password, name, role, phone) VALUES (?, ?, ?, ?, ?)",
            ('admin', hash_password('admin123'), 'Prabhu (Admin)', 'admin', '9787225577')
        )
        c.execute(
            "INSERT INTO users (username, password, name, role, phone) VALUES (?, ?, ?, ?, ?)",
            ('agent1', hash_password('agent123'), 'Collection Agent 1', 'agent', None)
        )

    c.execute("SELECT COUNT(*) FROM plans")
    if c.fetchone()[0] == 0:
        plans = [
            ('TAMIL POWER', 280, 30, 'Tamil power package'),
            ('TAMIL POWER HD', 330, 30, 'Tamil power HD package'),
            ('Basic', 200, 30, 'Basic package'),
            ('Full Pack', 350, 30, 'Full channel pack'),
        ]
        c.executemany(
            "INSERT INTO plans (name, amount, validity_days, description) VALUES (?, ?, ?, ?)",
            plans,
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
                """INSERT OR IGNORE INTO customers 
                   (customer_id, name, phone, area, city, pincode, status, paypakka_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
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
                    """INSERT OR IGNORE INTO connections
                       (customer_id, stb_no, can_id, mso, service_type, billing_type, status)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (customer_id, stb_no, can_id, mso, service_type, billing_type, svc_status),
                )

            imported += 1
        except Exception as e:
            print(f"Error importing {cust.get('paypakka_user_id', '?')}: {e}")
            continue

    conn.commit()
    conn.close()
    print(f"Imported {imported} customers successfully")
    return imported


if __name__ == '__main__':
    init_db()
    import_customers_from_json()
