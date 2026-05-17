"""Complete count of all changes needed by file.
Format: FILE: pattern_type → count
"""
# ═══════════════════════════════════════════════════════════════
# TOTAL ? → %s placeholder changes per file
# ═══════════════════════════════════════════════════════════════

# audit.py:                   9 × ? → %s
# services/payments.py:       14 × ? → %s

# routes/auth.py:             12 × ? → %s, 1 × sqlite3 import, 1 × sqlite3.OperationalError
# routes/settings.py:         12 × ? → %s, 1 × sqlite3 import, sqlite3.connect → pool
# routes/push.py:             4 × sqlite3.connect → pool, 1 × strftime → TO_CHAR
# routes/payments.py:         35+ × ? → %s, 2 × pragma_table_info, 1 × lastrowid
# routes/customers.py:        40+ × ? → %s, 1 × COLLATE NOCASE, 1 × datetime('now'), 1 × pragma_table_info, INSTR/SUBSTR
# routes/operators.py:        30+ × ? → %s, 2 × sqlite3.connect, 2 × PRAGMA, 3 × last_insert_rowid, 2 × date('now'...), datetime('now')
# routes/connections.py:      10+ × ? → %s, 2 × datetime('now')
# routes/service_requests.py: 10+ × ? → %s, 2 × last_insert_rowid
# routes/dashboard.py:        5+ × ? → %s, 4 × date('now'...), 4 × strftime → TO_CHAR
# routes/customer_portal.py:  8+ × ? → %s, 1 × strftime → TO_CHAR, 2 × lastrowid
# routes/tg_service_bot.py:   4 × date('now'...)
# routes/reminders.py:        8+ × ? → %s, 4 × date('now'...)
# routes/paypakka_sync.py:    5+ × ? → %s, 1 × INSERT OR IGNORE
# routes/surrenders.py:       5+ × ? → %s
# routes/stb_inventory.py:    10+ × ? → %s
# routes/reports.py:          ? → %s (need to check)
# routes/employees.py:        15+ × ? → %s
# routes/sms.py:              5+ × ? → %s
# routes/gtpl.py:             ? → %s (need to check)
# routes/wa_notify.py:        (check)
# routes/notifications.py:    ? → %s (need to check)

# ═══════════════════════════════════════════════════════════════
# ESTIMATED TOTAL CHANGES
# ═══════════════════════════════════════════════════════════════
# ? → %s:                    ~250+ replacements
# sqlite3.connect → pool:     7 locations
# sqlite3 import removal:      6 files
# PRAGMA removal:              5 locations (deps.py + database.py)
# last_insert_rowid:           5 → RETURNING id
# lastrowid:                   3 → RETURNING id
# datetime('now') in SQL:      6 → CURRENT_TIMESTAMP
# date('now'...) in SQL:      12 → PG equivalents
# strftime → TO_CHAR:          5 → TO_CHAR
# INSERT OR IGNORE:             3 → ON CONFLICT DO NOTHING
# COLLATE NOCASE:               1 → LOWER()
# pragma_table_info:            4 → information_schema
# LIKE → ILIKE:               ~8 locations
# INSTR → POSITION:             2
# backup function:              1 → pg_dump
# INTEGER PK AUTOINCREMENT:   20+ → SERIAL (in schema file)
