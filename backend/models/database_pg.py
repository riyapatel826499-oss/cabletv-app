"""PostgreSQL schema — replaces models/database.py for PG.

All tables converted from SQLite syntax to PostgreSQL.
Key changes:
- INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
- REAL → DOUBLE PRECISION
- TEXT DEFAULT CURRENT_TIMESTAMP → TIMESTAMP DEFAULT now()
- INSERT OR IGNORE → ON CONFLICT DO NOTHING
- PRAGMA table_info → information_schema check
"""
import os
from db import get_pg_connection, check_column_exists
from config import PAYPAKKA_CUSTOMER_JSON
from utils import hash_password


def init_db():
    """Create all tables and seed data in PostgreSQL."""
    conn = get_pg_connection()
    cur = conn.cursor()

    # Enable FK constraints (on by default in PG, but explicit is good)
    cur.execute("SET session_replication_role = DEFAULT;")  # no-op, just for clarity

    # ── Users table (admin + agents) ──
    cur.execute('''CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'agent',
        phone TEXT,
        status TEXT DEFAULT 'Active',
        permissions TEXT,
        operator_id INTEGER,
        created_at TIMESTAMP DEFAULT now()
    )''')

    # ── Customers table ──
    cur.execute('''CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
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
        operator_id INTEGER,
        surrendered_date TEXT,
        surrender_reason TEXT,
        imported_at TIMESTAMP DEFAULT now()
    )''')

    # ── Connections (STB/Cable) ──
    cur.execute('''CREATE TABLE IF NOT EXISTS connections (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        stb_no TEXT UNIQUE NOT NULL,
        can_id TEXT,
        mso TEXT DEFAULT 'GTPL',
        network TEXT DEFAULT 'GTPL',
        service_type TEXT DEFAULT 'Cable',
        billing_type TEXT DEFAULT 'Prepaid',
        status TEXT DEFAULT 'Active',
        plan_name TEXT,
        plan_amount DOUBLE PRECISION,
        activation_date TEXT,
        expiry_date TEXT,
        notes TEXT DEFAULT '',
        updated_at TIMESTAMP,
        disconnect_date TEXT,
        created_at TIMESTAMP DEFAULT now(),
        operator_id INTEGER,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # ── Plans ──
    cur.execute('''CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
        validity_days INTEGER DEFAULT 30,
        description TEXT,
        network TEXT DEFAULT 'GTPL',
        status TEXT DEFAULT 'Active',
        operator_id INTEGER
    )''')

    # ── Customer Plans ──
    cur.execute('''CREATE TABLE IF NOT EXISTS customer_plans (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        connection_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        start_date TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        status TEXT DEFAULT 'Active',
        operator_id INTEGER,
        created_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
        FOREIGN KEY (connection_id) REFERENCES connections(id),
        FOREIGN KEY (plan_id) REFERENCES plans(id)
    )''')

    # ── Payments ──
    cur.execute('''CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        connection_id INTEGER NOT NULL,
        plan_id INTEGER,
        amount DOUBLE PRECISION NOT NULL CHECK (amount > 0),
        payment_mode TEXT DEFAULT 'Cash',
        payment_type TEXT DEFAULT 'regular',
        collected_by INTEGER,
        collected_at TIMESTAMP DEFAULT now(),
        month_year TEXT,
        months_paid INTEGER DEFAULT 1,
        notes TEXT,
        latitude DOUBLE PRECISION,
        longitude DOUBLE PRECISION,
        previous_balance DOUBLE PRECISION DEFAULT 0,
        bill_amount DOUBLE PRECISION DEFAULT 0,
        operator_id INTEGER,
        deleted INTEGER DEFAULT 0,
        deleted_by INTEGER,
        deleted_at TEXT,
        delete_reason TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
        FOREIGN KEY (collected_by) REFERENCES users(id)
    )''')

    # ── Paypakka Plans ──
    cur.execute('''CREATE TABLE IF NOT EXISTS paypakka_plans (
        id SERIAL PRIMARY KEY,
        paypakka_plan_id TEXT UNIQUE NOT NULL,
        plan_name TEXT NOT NULL,
        plan_amount DOUBLE PRECISION NOT NULL,
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
        operator_id INTEGER,
        imported_at TIMESTAMP DEFAULT now()
    )''')

    # ── Paypakka Customer Plans ──
    cur.execute('''CREATE TABLE IF NOT EXISTS paypakka_customer_plans (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        cust_plan_ref_id TEXT UNIQUE NOT NULL,
        plan_ref_id TEXT NOT NULL,
        service_ref_id TEXT,
        activate_date TEXT,
        expired_date TEXT,
        status TEXT DEFAULT 'Active',
        paypakka_created_at TEXT,
        paypakka_updated_at TEXT,
        operator_id INTEGER,
        imported_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # ── Paypakka Payments ──
    cur.execute('''CREATE TABLE IF NOT EXISTS paypakka_payments (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        payment_ref_id TEXT UNIQUE NOT NULL,
        transaction_id TEXT,
        service_ref_id TEXT,
        plan_amount DOUBLE PRECISION,
        bill_amount DOUBLE PRECISION,
        collection_amount DOUBLE PRECISION,
        discount_amount DOUBLE PRECISION DEFAULT 0,
        tax DOUBLE PRECISION DEFAULT 0,
        payment_type TEXT,
        status TEXT DEFAULT 'Success',
        emp_ref_id TEXT,
        paypakka_created_at TEXT,
        operator_id INTEGER,
        imported_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    cur.execute('''CREATE TABLE IF NOT EXISTS paypakka_employees (
        emp_ref_id TEXT PRIMARY KEY,
        emp_name TEXT,
        emp_code TEXT,
        operator_id INTEGER,
        created_at TIMESTAMP DEFAULT now()
    )''')

    # ── SMS Log ──
    cur.execute('''CREATE TABLE IF NOT EXISTS sms_log (
        id SERIAL PRIMARY KEY,
        customer_id TEXT,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        provider TEXT,
        operator_id INTEGER,
        sent_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # ── STB Inventory ──
    cur.execute('''CREATE TABLE IF NOT EXISTS stb_inventory (
        id SERIAL PRIMARY KEY,
        stb_no TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'spare',
        notes TEXT,
        operator_id INTEGER DEFAULT 1,
        added_at TIMESTAMP DEFAULT now(),
        added_by TEXT
    )''')

    # ── Surrender Requests ──
    cur.execute('''CREATE TABLE IF NOT EXISTS surrender_requests (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        customer_name TEXT NOT NULL,
        stb_no TEXT,
        reason TEXT,
        requested_by INTEGER NOT NULL,
        requested_by_name TEXT NOT NULL,
        requested_at TIMESTAMP DEFAULT now(),
        status TEXT DEFAULT 'pending',
        reviewed_by INTEGER,
        reviewed_by_name TEXT,
        reviewed_at TIMESTAMP,
        review_notes TEXT,
        operator_id INTEGER DEFAULT 1,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
        FOREIGN KEY (requested_by) REFERENCES users(id)
    )''')

    # ── Customer Auth ──
    cur.execute('''CREATE TABLE IF NOT EXISTS customer_auth (
        id SERIAL PRIMARY KEY,
        customer_id TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        password TEXT,
        pin TEXT,
        created_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # ── Complaints ──
    cur.execute('''CREATE TABLE IF NOT EXISTS complaints (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'normal',
        status TEXT DEFAULT 'open',
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP,
        resolved_at TIMESTAMP,
        admin_notes TEXT,
        operator_id INTEGER,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # ── Online Payments ──
    cur.execute('''CREATE TABLE IF NOT EXISTS online_payments (
        id SERIAL PRIMARY KEY,
        customer_id TEXT NOT NULL,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        razorpay_signature TEXT,
        amount DOUBLE PRECISION NOT NULL,
        status TEXT DEFAULT 'created',
        operator_id INTEGER,
        created_at TIMESTAMP DEFAULT now(),
        captured_at TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    )''')

    # ── Active Sessions ──
    cur.execute('''CREATE TABLE IF NOT EXISTS active_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT now(),
        last_activity TIMESTAMP DEFAULT now(),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )''')

    # ── Operators (Multi-tenant) ──
    cur.execute('''CREATE TABLE IF NOT EXISTS operators (
        id SERIAL PRIMARY KEY,
        business_name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT DEFAULT '',
        area TEXT DEFAULT '',
        mso TEXT DEFAULT 'GTPL',
        status TEXT DEFAULT 'active',
        license_type TEXT DEFAULT 'active',
        notes TEXT DEFAULT '',
        customer_prefix TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT now()
    )''')

    # ── Notification Settings ──
    cur.execute('''CREATE TABLE IF NOT EXISTS notification_settings (
        key TEXT NOT NULL,
        operator_id INTEGER NOT NULL DEFAULT 1,
        value TEXT NOT NULL,
        PRIMARY KEY (key, operator_id)
    )''')

    # ── Push Subscriptions ──
    cur.execute('''CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL DEFAULT '',
        auth TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, endpoint)
    )''')

    # ── Service Requests ──
    cur.execute('''CREATE TABLE IF NOT EXISTS service_requests (
        id SERIAL PRIMARY KEY,
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
        deadline TIMESTAMP,
        tg_message_id INTEGER,
        acknowledged_at TIMESTAMP,
        on_the_way_at TIMESTAMP,
        ack_lat DOUBLE PRECISION,
        ack_lng DOUBLE PRECISION,
        otw_lat DOUBLE PRECISION,
        otw_lng DOUBLE PRECISION,
        settled_lat DOUBLE PRECISION,
        settled_lng DOUBLE PRECISION,
        resolved_at TIMESTAMP,
        closed_at TIMESTAMP,
        closed_by INTEGER,
        cancelled_at TIMESTAMP,
        operator_id INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
        FOREIGN KEY (assigned_to) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
    )''')

    # ── Request Timeline ──
    cur.execute('''CREATE TABLE IF NOT EXISTS request_timeline (
        id SERIAL PRIMARY KEY,
        request_id INTEGER NOT NULL,
        old_status TEXT,
        new_status TEXT,
        changed_by INTEGER,
        changed_by_name TEXT,
        source TEXT DEFAULT 'app',
        note TEXT,
        created_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (request_id) REFERENCES service_requests(id),
        FOREIGN KEY (changed_by) REFERENCES users(id)
    )''')

    # ── Audit Log ──
    cur.execute('''CREATE TABLE IF NOT EXISTS audit_log (
        id SERIAL PRIMARY KEY,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT,
        old_value TEXT,
        new_value TEXT,
        performed_by INTEGER,
        performed_by_name TEXT,
        operator_id INTEGER,
        ip_address TEXT,
        created_at TIMESTAMP DEFAULT now(),
        FOREIGN KEY (performed_by) REFERENCES users(id)
    )''')

    # ── Performance Indexes ──
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON active_sessions(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON active_sessions(session_id)",
        "CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)",
        "CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)",
        "CREATE INDEX IF NOT EXISTS idx_customers_area ON customers(area)",
        "CREATE INDEX IF NOT EXISTS idx_customers_customer_id ON customers(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_customers_operator ON customers(operator_id)",
        "CREATE INDEX IF NOT EXISTS idx_connections_customer_id ON connections(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status)",
        "CREATE INDEX IF NOT EXISTS idx_connections_expiry ON connections(expiry_date)",
        "CREATE INDEX IF NOT EXISTS idx_connections_mso ON connections(mso)",
        "CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_payments_month_year ON payments(month_year)",
        "CREATE INDEX IF NOT EXISTS idx_payments_collected_by ON payments(collected_by)",
        "CREATE INDEX IF NOT EXISTS idx_payments_collected_at ON payments(collected_at)",
        "CREATE INDEX IF NOT EXISTS idx_payments_deleted ON payments(deleted)",
        "CREATE INDEX IF NOT EXISTS idx_ppayments_customer_id ON paypakka_payments(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_ppayments_created_at ON paypakka_payments(paypakka_created_at)",
        "CREATE INDEX IF NOT EXISTS idx_ppayments_emp_ref_id ON paypakka_payments(emp_ref_id)",
        "CREATE INDEX IF NOT EXISTS idx_pcustplans_customer_id ON paypakka_customer_plans(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_custplans_customer_id ON customer_plans(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_smslog_customer_id ON sms_log(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_complaints_customer_id ON complaints(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_sr_customer ON service_requests(customer_id)",
        "CREATE INDEX IF NOT EXISTS idx_sr_status ON service_requests(status)",
        "CREATE INDEX IF NOT EXISTS idx_sr_assigned ON service_requests(assigned_to)",
        "CREATE INDEX IF NOT EXISTS idx_sr_priority ON service_requests(priority)",
        "CREATE INDEX IF NOT EXISTS idx_sr_deadline ON service_requests(deadline)",
        "CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id)",
        "CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(performed_by)",
        "CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)",
    ]
    for idx_sql in indexes:
        cur.execute(idx_sql)

    conn.commit()

    # ── Seed Data ──
    cur.execute("SELECT COUNT(*) as cnt FROM users WHERE role IN ('admin','master')")
    if cur.fetchone()['cnt'] == 0:
        cur.execute(
            "INSERT INTO users (username, password, name, role, phone, operator_id) VALUES (%s, %s, %s, %s, %s, %s)",
            ('admin', hash_password('admin123'), 'Prabhu (Admin)', 'master', '9787225577', None)
        )
        cur.execute(
            "INSERT INTO users (username, password, name, role, phone, operator_id) VALUES (%s, %s, %s, %s, %s, %s)",
            ('agent1', hash_password('agent123'), 'Collection Agent 1', 'agent', None, 1)
        )

    cur.execute("SELECT COUNT(*) as cnt FROM plans")
    if cur.fetchone()['cnt'] == 0:
        plans = [
            ('TAMIL POWER', 280, 30, 'Tamil power package'),
            ('TAMIL POWER HD', 330, 30, 'Tamil power HD package'),
            ('Basic', 200, 30, 'Basic package'),
            ('Full Pack', 350, 30, 'Full channel pack'),
        ]
        for p in plans:
            cur.execute(
                "INSERT INTO plans (name, amount, validity_days, description) VALUES (%s, %s, %s, %s)",
                p
            )

    conn.commit()
    conn.close()
    print("PostgreSQL database initialized successfully")


def import_customers_from_json():
    """Import customers from Paypakka JSON export (same logic, PG syntax)."""
    if not os.path.exists(PAYPAKKA_CUSTOMER_JSON):
        print(f"Customer JSON not found at {PAYPAKKA_CUSTOMER_JSON}")
        return 0

    conn = get_pg_connection()

    cur = conn.execute("SELECT COUNT(*) as cnt FROM customers")
    existing = cur.fetchone()['cnt']
    if existing > 0:
        print(f"Customers already imported ({existing} found). Skipping.")
        conn.close()
        return existing

    import json
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

            conn.execute(
                """INSERT INTO customers
                   (customer_id, name, phone, area, city, pincode, status, paypakka_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (customer_id) DO NOTHING""",
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

                conn.execute(
                    """INSERT INTO connections
                       (customer_id, stb_no, can_id, mso, service_type, billing_type, status)
                       VALUES (%s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (stb_no) DO NOTHING""",
                    (customer_id, stb_no, can_id, mso, service_type, billing_type, svc_status),
                )

            imported += 1
        except Exception as e:
            print(f"Error importing {cust.get('paypakka_user_id', '?')}: {e}")
            continue

    conn.commit()
    conn.close()
    return imported


def run_migrations():
    """Add columns/tables that may not exist in older DBs."""
    conn = get_pg_connection()

    # Column migrations — use IF NOT EXISTS equivalent via information_schema
    column_migrations = [
        ("users", "status", "ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Active'"),
        ("users", "permissions", "ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions TEXT"),
        ("users", "operator_id", "ALTER TABLE users ADD COLUMN IF NOT EXISTS operator_id INTEGER"),
        ("customers", "surrendered_date", "ALTER TABLE customers ADD COLUMN IF NOT EXISTS surrendered_date TEXT"),
        ("customers", "surrender_reason", "ALTER TABLE customers ADD COLUMN IF NOT EXISTS surrender_reason TEXT"),
        ("customers", "operator_id", "ALTER TABLE customers ADD COLUMN IF NOT EXISTS operator_id INTEGER"),
        ("connections", "network", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS network TEXT DEFAULT 'GTPL'"),
        ("connections", "plan_name", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS plan_name TEXT"),
        ("connections", "plan_amount", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS plan_amount DOUBLE PRECISION"),
        ("connections", "activation_date", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS activation_date TEXT"),
        ("connections", "expiry_date", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS expiry_date TEXT"),
        ("connections", "notes", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''"),
        ("connections", "updated_at", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP"),
        ("connections", "disconnect_date", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS disconnect_date TEXT"),
        ("connections", "operator_id", "ALTER TABLE connections ADD COLUMN IF NOT EXISTS operator_id INTEGER"),
        ("plans", "network", "ALTER TABLE plans ADD COLUMN IF NOT EXISTS network TEXT DEFAULT 'GTPL'"),
        ("plans", "operator_id", "ALTER TABLE plans ADD COLUMN IF NOT EXISTS operator_id INTEGER"),
        ("payments", "payment_type", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'regular'"),
        ("payments", "months_paid", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS months_paid INTEGER DEFAULT 1"),
        ("payments", "latitude", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION"),
        ("payments", "longitude", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION"),
        ("payments", "previous_balance", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS previous_balance DOUBLE PRECISION DEFAULT 0"),
        ("payments", "bill_amount", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS bill_amount DOUBLE PRECISION DEFAULT 0"),
        ("payments", "operator_id", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS operator_id INTEGER"),
        ("payments", "deleted", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted INTEGER DEFAULT 0"),
        ("payments", "deleted_by", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_by INTEGER"),
        ("payments", "deleted_at", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS deleted_at TEXT"),
        ("payments", "delete_reason", "ALTER TABLE payments ADD COLUMN IF NOT EXISTS delete_reason TEXT"),
        ("sms_log", "operator_id", "ALTER TABLE sms_log ADD COLUMN IF NOT EXISTS operator_id INTEGER"),
    ]

    for table, col, sql in column_migrations:
        try:
            conn.execute(sql)
            conn.commit()
        except Exception:
            pass  # Column already exists

    conn.commit()
    conn.close()
    print("PostgreSQL migrations complete")


if __name__ == '__main__':
    init_db()
    run_migrations()
    import_customers_from_json()
