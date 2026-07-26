"""
Migration: create the `reminder_logs` table (WhatsApp reminders sent per customer).

Records which template an agent sent to which customer, when, and by whom — so you can
see per-customer counts across all agents. Safe to run multiple times.

Run from backend/ (against the PRODUCTION database):
    python migrate_reminder_logs.py
"""

from config import DB_ENGINE


def run():
    if DB_ENGINE == "sqlite":
        import sqlite3
        from config import DB_PATH
        conn = sqlite3.connect(DB_PATH)
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS reminder_logs ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, template TEXT, "
                "sent_by INTEGER, sent_by_name TEXT, sent_at TEXT, month TEXT, operator_id INTEGER)"
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_reminder_logs_cust_month ON reminder_logs (customer_id, month)")
            conn.commit()
            print("[sqlite] ensured reminder_logs table + index")
        finally:
            conn.close()
    else:
        import psycopg2
        from config import DATABASE_URL_PG
        conn = psycopg2.connect(DATABASE_URL_PG)
        try:
            cur = conn.cursor()
            cur.execute(
                "CREATE TABLE IF NOT EXISTS reminder_logs ("
                "id SERIAL PRIMARY KEY, customer_id TEXT, template TEXT, "
                "sent_by INTEGER, sent_by_name TEXT, sent_at TEXT, month TEXT, operator_id INTEGER)"
            )
            cur.execute("CREATE INDEX IF NOT EXISTS idx_reminder_logs_cust_month ON reminder_logs (customer_id, month)")
            conn.commit()
            print("[postgres] ensured reminder_logs table + index")
        finally:
            conn.close()

    print("Migration complete.")


if __name__ == "__main__":
    run()
