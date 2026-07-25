"""
Performance migration: add indexes to `paypakka_payments`.

This table is scanned by almost every money query (dashboard, reports, unpaid list,
map, customers list) via the paid-customer lookup, but it had NO indexes — causing a
full table scan every time. These two indexes fix that. Safe to run multiple times.
Works for SQLite and PostgreSQL (both support CREATE INDEX IF NOT EXISTS).

Run from the backend/ folder (against the PRODUCTION database):
    python migrate_paypakka_indexes.py
"""

from config import DB_ENGINE

INDEXES = [
    ("idx_paypakka_created_at", "paypakka_payments", "paypakka_created_at"),
    ("idx_paypakka_customer_id", "paypakka_payments", "customer_id"),
]


def run():
    if DB_ENGINE == "sqlite":
        import sqlite3
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        try:
            for name, table, col in INDEXES:
                conn.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({col})")
                print(f"[sqlite] ensured index {name} on {table}({col})")
            conn.commit()
        finally:
            conn.close()
    else:
        import psycopg2
        from config import DATABASE_URL_PG
        conn = psycopg2.connect(DATABASE_URL_PG)
        try:
            cur = conn.cursor()
            for name, table, col in INDEXES:
                cur.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({col})")
                print(f"[postgres] ensured index {name} on {table}({col})")
            conn.commit()
        finally:
            conn.close()

    print("Index migration complete.")


if __name__ == "__main__":
    run()
