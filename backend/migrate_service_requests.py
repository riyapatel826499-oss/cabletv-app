"""Add CHECK constraints to service_requests table."""
import sqlite3
from pathlib import Path

DB_PATH = Path.home() / "cabletv-app" / "backend" / "cabletv.db"

conn = sqlite3.connect(str(DB_PATH))
c = conn.cursor()

# Drop and recreate with constraints (safe since table is new)
c.execute("DROP TABLE IF EXISTS service_requests")
c.execute("DROP TABLE IF EXISTS request_timeline")

c.execute('''CREATE TABLE service_requests (
id INTEGER PRIMARY KEY AUTOINCREMENT,
ticket_no TEXT UNIQUE NOT NULL,
customer_id TEXT,
type TEXT NOT NULL CHECK(type IN ('complaint','new_connection','reconnection','plan_change','stb_swap','address_shift','disconnect')),
category TEXT CHECK(category IN ('signal','billing','equipment','wire','other','none')),
priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('urgent','high','medium','low')),
status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','resolved','closed','cancelled')),
description TEXT NOT NULL,
assigned_to INTEGER,
created_by INTEGER NOT NULL,
source TEXT NOT NULL DEFAULT 'app',
resolution TEXT,
resolution_notes TEXT,
deadline DATETIME,
tg_message_id INTEGER,
resolved_at DATETIME,
closed_at DATETIME,
closed_by INTEGER,
cancelled_at DATETIME,
operator_id INTEGER DEFAULT 1,
created_at TEXT DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (customer_id) REFERENCES customers(customer_id),
FOREIGN KEY (assigned_to) REFERENCES users(id),
FOREIGN KEY (created_by) REFERENCES users(id)
)''')

c.execute("CREATE INDEX idx_sr_customer ON service_requests(customer_id)")
c.execute("CREATE INDEX idx_sr_status ON service_requests(status)")
c.execute("CREATE INDEX idx_sr_assigned ON service_requests(assigned_to)")
c.execute("CREATE INDEX idx_sr_priority ON service_requests(priority)")
c.execute("CREATE INDEX idx_sr_deadline ON service_requests(deadline)")

c.execute('''CREATE TABLE request_timeline (
id INTEGER PRIMARY KEY AUTOINCREMENT,
request_id INTEGER NOT NULL,
old_status TEXT,
new_status TEXT,
changed_by INTEGER,
changed_by_name TEXT,
source TEXT DEFAULT 'app',
note TEXT,
created_at TEXT DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (request_id) REFERENCES service_requests(id),
FOREIGN KEY (changed_by) REFERENCES users(id)
)''')

conn.commit()
print("✅ service_requests table recreated with CHECK constraints")
conn.close()
