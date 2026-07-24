"""
One-off migration: add `latitude` and `longitude` columns to the customers table.

Safe to run multiple times (checks first). Works for both SQLite and PostgreSQL
by reading your existing config (DB_ENGINE).

Run from the backend/ folder:
    python migrate_customer_location.py
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import DB_ENGINE


def _sqlite_has_column(conn, table, col):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r[1] == col for r in rows)


def run():
    if DB_ENGINE == "sqlite":
        import sqlite3
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        try:
            for col in ("latitude", "longitude"):
                if not _sqlite_has_column(conn, "customers", col):
                    conn.execute(f"ALTER TABLE customers ADD COLUMN {col} REAL")
                    print(f"[sqlite] added customers.{col}")
                else:
                    print(f"[sqlite] customers.{col} already exists — skipped")
            conn.commit()
        finally:
            conn.close()
    else:
        import psycopg2
        from config import DATABASE_URL_PG
        conn = psycopg2.connect(DATABASE_URL_PG)
        try:
            cur = conn.cursor()
            # Postgres supports IF NOT EXISTS on ADD COLUMN — fully idempotent.
            cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION")
            cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION")
            conn.commit()
            print("[postgres] ensured customers.latitude and customers.longitude exist")
        finally:
            conn.close()

    print("Migration complete.")


if __name__ == "__main__":
    run()
