"""
One-off migration: add a `map_note` column to the customers table.

`map_note` is a short free-text label shown in the map's building popup — used to
tell apart connections stacked in a multi-floor building (e.g. "1st floor").

Safe to run multiple times. Works for SQLite and PostgreSQL. Run from backend/:
    python migrate_customer_map_note.py
"""

from config import DB_ENGINE


def _sqlite_has_column(conn, table, col):
    return any(r[1] == col for r in conn.execute(f"PRAGMA table_info({table})").fetchall())


def run():
    if DB_ENGINE == "sqlite":
        import sqlite3
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        try:
            if not _sqlite_has_column(conn, "customers", "map_note"):
                conn.execute("ALTER TABLE customers ADD COLUMN map_note TEXT")
                print("[sqlite] added customers.map_note")
            else:
                print("[sqlite] customers.map_note already exists — skipped")
            conn.commit()
        finally:
            conn.close()
    else:
        import psycopg2
        from config import DATABASE_URL_PG
        conn = psycopg2.connect(DATABASE_URL_PG)
        try:
            cur = conn.cursor()
            cur.execute("ALTER TABLE customers ADD COLUMN IF NOT EXISTS map_note TEXT")
            conn.commit()
            print("[postgres] ensured customers.map_note exists")
        finally:
            conn.close()

    print("Migration complete.")


if __name__ == "__main__":
    run()
