"""
Multi-tenant migration — Phase 1 + 2
Creates operators table, adds operator_id to all tables, migrates existing data.
Run ONCE. Idempotent (safe to re-run).
"""
import sqlite3
import os

DB_PATH = os.environ.get("DB_PATH", "cabletv.db")

# Tables that need operator_id (all business tables)
BUSINESS_TABLES = [
    "customers",
    "connections",
    "plans",
    "customer_plans",
    "payments",
    "sms_log",
    "stb_inventory",
    "surrender_requests",
    "complaints",
    "online_payments",
    "customer_auth",
    "notification_settings",
    "paypakka_plans",
    "paypakka_customer_plans",
    "paypakka_payments",
    "paypakka_employees",
]

# Tables that DON'T need operator_id (system tables)
SKIP_TABLES = ["users", "active_sessions", "sqlite_sequence"]


def migrate():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = OFF")

    print("=== Multi-Tenant Migration ===\n")

    # 1. Create operators table
    print("[1/5] Creating operators table...")
    conn.execute("""CREATE TABLE IF NOT EXISTS operators (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        email TEXT DEFAULT '',
        area TEXT DEFAULT '',
        mso TEXT DEFAULT 'GTPL',
        status TEXT DEFAULT 'active',
        license_type TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now', '+5 hours', '+30 minutes')),
        notes TEXT DEFAULT ''
    )""")
    conn.commit()
    print("  ✓ operators table ready")

    # 2. Create default operator "SSN Cables" (Prabhu's business)
    print("\n[2/5] Creating default operator...")
    existing = conn.execute("SELECT id FROM operators WHERE business_name = 'SSN Cables'").fetchone()
    if existing:
        operator_id = existing[0]
        print(f"  ✓ SSN Cables already exists (id={operator_id})")
    else:
        conn.execute(
            "INSERT INTO operators (business_name, owner_name, phone, area, mso, status) VALUES (?, ?, ?, ?, ?, ?)",
            ("SSN Cables", "Prabhu", "9787225577", "Tirupur", "GTPL", "active"),
        )
        operator_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()
        print(f"  ✓ Created SSN Cables (id={operator_id})")

    # 3. Add operator_id column to users table + master role
    print("\n[3/5] Updating users table...")
    cols = [r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
    if "operator_id" not in cols:
        conn.execute("ALTER TABLE users ADD COLUMN operator_id INTEGER")
        print("  ✓ Added operator_id to users")
    else:
        print("  ✓ operator_id already in users")

    # Make current admin (id=1) the master
    conn.execute("UPDATE users SET operator_id = NULL, role = 'master' WHERE id = 1")
    conn.commit()
    print("  ✓ User id=1 set as master (operator_id=NULL)")

    # 4. Add operator_id to all business tables
    print("\n[4/5] Adding operator_id to business tables...")
    for table in BUSINESS_TABLES:
        try:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
            if "operator_id" not in cols:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN operator_id INTEGER DEFAULT {operator_id}")
                print(f"  ✓ {table}: added operator_id")
            else:
                # Ensure all existing rows have operator_id set
                null_count = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE operator_id IS NULL").fetchone()[0]
                if null_count > 0:
                    conn.execute(f"UPDATE {table} SET operator_id = {operator_id} WHERE operator_id IS NULL")
                    print(f"  ✓ {table}: updated {null_count} rows with operator_id")
                else:
                    print(f"  ✓ {table}: already set")
        except Exception as e:
            print(f"  ✗ {table}: {e}")

    conn.commit()

    # 5. Verify
    print("\n[5/5] Verification...")
    for table in BUSINESS_TABLES:
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        orphan = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE operator_id IS NULL").fetchone()[0]
        print(f"  {table}: {total} total, {orphan} orphaned")

    print(f"\n=== Migration Complete ===")
    print(f"Default operator: SSN Cables (id={operator_id})")
    print(f"Master admin: user id=1 (operator_id=NULL)")

    conn.close()


if __name__ == "__main__":
    migrate()
