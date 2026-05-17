"""sed / search-replace mapping for SQLite → PostgreSQL migration.

This file documents EVERY find-replace pattern needed to convert the codebase.
Apply these in order. After applying, test each route file.
"""

# ═══════════════════════════════════════════════════════════════
# PATTERN 1: Placeholder ? → %s  (ALL .py files in routes/, audit.py)
# ═══════════════════════════════════════════════════════════════
# In psycopg2, %s is the placeholder. But note: % inside f-strings needs escaping (%%).
#
# IMPORTANT: This is the MOST widespread change. Every SQL query with ? must change.
#
# Pattern: (?, ?, ?, ...) → (%s, %s, %s, ...)
# Pattern: WHERE x = ? → WHERE x = %s
# Pattern: LIKE ? → LIKE %s  (or ILIKE %s for case-insensitive)
#
# NOTE: The ",".join(["?"] * len(roles)) pattern in push.py needs special handling:
#   ",".join(["%s"] * len(roles))

# ═══════════════════════════════════════════════════════════════
# PATTERN 2: LIKE → ILIKE (case-insensitive matching)
# ═══════════════════════════════════════════════════════════════
# SQLite's LIKE is case-insensitive for ASCII. PostgreSQL's LIKE is case-sensitive.
# Change LIKE to ILIKE everywhere that case-insensitive matching is intended.
#
# Files to check:
#   routes/customers.py:   lines 119, 227, 439, etc.
#   routes/operators.py:   line 578
#   routes/connections.py: search queries
#   routes/reminders.py:   search queries
#
# sed -i 's/LIKE ?/ILIKE ?/g' → but AFTER ? → %s change: s/ILIKE %s/ILIKE %s/g

# ═══════════════════════════════════════════════════════════════
# PATTERN 3: datetime('now') → CURRENT_TIMESTAMP (in SQL strings)
# ═══════════════════════════════════════════════════════════════
# sed patterns (inside SQL string literals):
#   "datetime('now')"  →  "CURRENT_TIMESTAMP"
#   "datetime('now')"  →  "now()"
#
# Files:
#   routes/connections.py:    lines 140, 289
#   routes/operators.py:      line 323, 716, 740
#   routes/customers.py:      line 970
#   models/database.py:       various

# ═══════════════════════════════════════════════════════════════
# PATTERN 4: date('now', ...) → PostgreSQL equivalents
# ═══════════════════════════════════════════════════════════════
# These are ALL unique and need manual conversion:
#
# "date('now', '+5 hours', '+30 minutes', 'start of month')"
#   →  "date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date"
#
# "date('now', '+3 days')"
#   →  "CURRENT_DATE + INTERVAL '3 days'"
#
# "date('now', '+5 days')"
#   →  "CURRENT_DATE + INTERVAL '5 days'"
#
# "date('now', '-6 months', 'start of month')"
#   →  "date_trunc('month', CURRENT_DATE - INTERVAL '6 months')::date"
#
# "date('now')"
#   →  "CURRENT_DATE"
#
# "date('now', '+5 hours', '+30 minutes')"
#   →  "(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date"
#
# "date(created_at) = date('now')"
#   →  "created_at::date = CURRENT_DATE"
#
# Files:
#   routes/operators.py:      lines 38-40, 362-394
#   routes/dashboard.py:      lines 138, 339-347
#   routes/tg_service_bot.py: lines 362-394
#   routes/reminders.py:      lines 125-131, 301, 306

# ═══════════════════════════════════════════════════════════════
# PATTERN 5: strftime() → TO_CHAR()
# ═══════════════════════════════════════════════════════════════
# "strftime('%Y-%m', col)"  →  "TO_CHAR(col, 'YYYY-MM')"
# "strftime('%m-%Y', col)"  →  "TO_CHAR(col, 'MM-YYYY')"
# "strftime('%Y-%m', 'now')" → "TO_CHAR(CURRENT_DATE, 'YYYY-MM')"
#
# Files:
#   routes/dashboard.py:      lines 339-347
#   routes/push.py:           line 195
#   routes/customer_portal.py: line 427

# ═══════════════════════════════════════════════════════════════
# PATTERN 6: COLLATE NOCASE → remove or use ILIKE
# ═══════════════════════════════════════════════════════════════
# "ORDER BY c.name COLLATE NOCASE ASC"
#   →  "ORDER BY LOWER(c.name) ASC"
# or →  "ORDER BY c.name ASC"  (if PG locale is case-insensitive)
#
# Files:
#   routes/customers.py: line 267

# ═══════════════════════════════════════════════════════════════
# PATTERN 7: INSERT OR IGNORE → INSERT ... ON CONFLICT DO NOTHING
# ═══════════════════════════════════════════════════════════════
# "INSERT OR IGNORE INTO table (...)" → "INSERT INTO table (...) ON CONFLICT DO NOTHING"
#
# Files:
#   models/database.py:       lines 390, 408
#   routes/paypakka_sync.py:  line 115

# ═══════════════════════════════════════════════════════════════
# PATTERN 8: SELECT last_insert_rowid() → RETURNING id
# ═══════════════════════════════════════════════════════════════
# BEFORE:
#   conn.execute("INSERT INTO ... VALUES (?, ?, ...)", (a, b, c))
#   new_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
#
# AFTER:
#   row = conn.execute("INSERT INTO ... VALUES (%s, %s, ...) RETURNING id", (a, b, c)).fetchone()
#   new_id = row['id']
#
# Files:
#   routes/operators.py:      lines 100, 243, 668
#   routes/service_requests.py: lines 120, 568

# ═══════════════════════════════════════════════════════════════
# PATTERN 9: cursor.lastrowid → RETURNING id
# ═══════════════════════════════════════════════════════════════
# BEFORE:
#   cursor = conn.execute("INSERT INTO ... VALUES (?, ...)", (...))
#   payment_id = cursor.lastrowid
#
# AFTER:
#   row = conn.execute("INSERT INTO ... VALUES (%s, ...) RETURNING id", (...)).fetchone()
#   payment_id = row['id']
#
# Files:
#   routes/payments.py:       lines 123
#   routes/customer_portal.py: lines 494, 582

# ═══════════════════════════════════════════════════════════════
# PATTERN 10: PRAGMA table_info() → information_schema
# ═══════════════════════════════════════════════════════════════
# BEFORE:
#   conn.execute(f"PRAGMA table_info({table})").fetchall()
#   cols = [r[1] for r in ...]
#
# AFTER:
#   conn.execute(
#       "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
#       [table]
#   ).fetchall()
#   cols = [r['column_name'] for r in ...]
#
# BEFORE (in SQL):
#   "SELECT COUNT(*) FROM pragma_table_info('payments') WHERE name='payment_type'"
#
# AFTER (separate check):
#   Use db.check_column_exists('payments', 'payment_type') in Python,
#   or use try/except on the query.
#
# Files:
#   routes/operators.py:      lines 197, 224 (PRAGMA table_info)
#   routes/payments.py:       lines 79, 334 (pragma_table_info in SQL)
#   routes/customers.py:      line 998 (pragma_table_info in SQL)

# ═══════════════════════════════════════════════════════════════
# PATTERN 11: sqlite3.connect() → pool (direct usage)
# ═══════════════════════════════════════════════════════════════
# BEFORE:
#   import sqlite3
#   conn = sqlite3.connect(DB_PATH)
#   conn.row_factory = sqlite3.Row
#   ...
#   conn.close()
#
# AFTER:
#   from db import get_pg_connection
#   conn = get_pg_connection()
#   ...
#   conn.close()  # returns to pool
#
# Files:
#   routes/settings.py:       _get_conn() function (lines 22-31)
#   routes/push.py:           lines 77-84, 126-135, 145-149, 170-172
#   routes/operators.py:      lines 181-183, 768-770
#   models/database.py:       get_db(), run_migrations()

# ═══════════════════════════════════════════════════════════════
# PATTERN 12: Remove sqlite3 imports and exception types
# ═══════════════════════════════════════════════════════════════
# "import sqlite3"  →  remove (or replace with "from db import get_pg_connection")
# "sqlite3.OperationalError"  →  "Exception"
# "sqlite3.Row"  →  remove (PgConnection handles this)
#
# Files:
#   routes/auth.py:       line 3 (import), line 37 (exception)
#   routes/settings.py:   line 5 (import)
#   routes/push.py:       lines 77, 126, 145, 170 (inline import)
#   routes/operators.py:  line 5 (import), lines 181, 768 (inline import)
#   models/database.py:   line 2 (import), line 197 (exception)

# ═══════════════════════════════════════════════════════════════
# PATTERN 13: dict(row) comments → keep or remove
# ═══════════════════════════════════════════════════════════════
# "# sqlite3.Row doesn't have .get()"  →  remove comment (dict works fine)
# "# sqlite3.Row → dict for .get()"    →  remove comment
# dict(row) calls are harmless with RealDictCursor (returns a copy), keep them.
#
# Files:
#   routes/payments.py:       lines 72, 131
#   routes/settings.py:       various dict() calls
#   deps.py:                  line 93, 196

# ═══════════════════════════════════════════════════════════════
# PATTERN 14: INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
# ═══════════════════════════════════════════════════════════════
# Only in DDL (CREATE TABLE) statements — handled in database_pg.py
# "INTEGER PRIMARY KEY AUTOINCREMENT" → "SERIAL PRIMARY KEY"
#
# Files:
#   models/database.py:       20+ occurrences
#   routes/operators.py:      line 208 (inline CREATE TABLE)

# ═══════════════════════════════════════════════════════════════
# PATTERN 15: Auto-migrate script for ? → %s
# ═══════════════════════════════════════════════════════════════
# This sed command handles most cases but needs manual review:
#
#   find . -name "*.py" -not -path "./venv/*" -exec \
#     sed -i "s/VALUES (?\,/VALUES (%s,/g; s/, ?/, %s/g; s/(?)/(%s)/g; s/= ?/= %s/g; s/LIKE ?/ILIKE %s/g" \
#     {} +
#
# WARNING: This is imperfect — some ? in SQL might be inside string literals
# that aren't SQL. Always review manually.

# ═══════════════════════════════════════════════════════════════
# PATTERN 16: Aggregate expressions
# ═══════════════════════════════════════════════════════════════
# "UNION" → same in PG, no change needed
# "COALESCE(...)" → same in PG, no change needed
# "COUNT(*)" → same
# "SUM(amount)" → same
# "DISTINCT" → same

# ═══════════════════════════════════════════════════════════════
# PATTERN 17: CAST and SUBSTR
# ═══════════════════════════════════════════════════════════════
# SQLite: SUBSTR(x, pos)  →  PG: SUBSTRING(x FROM pos) or SUBSTR(x, pos)
# NOTE: PostgreSQL supports SUBSTR() as an alias, so no change needed.
#
# SQLite: CAST(x AS INTEGER)  →  PG: same syntax, works fine
# SQLite: INSTR(x, '-')  →  PG: POSITION('-' IN x)
#
# Files to check:
#   routes/customers.py:  line 265, 342 (SUBSTR, INSTR)
#     "CAST(SUBSTR(c.customer_id, INSTR(c.customer_id, '-') + 1) AS INTEGER)"
#     → "CAST(SUBSTRING(c.customer_id FROM POSITION('-' IN c.customer_id) + 1) AS INTEGER)"
#     or keep SUBSTR (PG supports it as alias)

# ═══════════════════════════════════════════════════════════════
# PATTERN 18: Backup function (main.py)
# ═══════════════════════════════════════════════════════════════
# The backup_db() function copies the .db file — needs to use pg_dump instead:
#
# BEFORE:  shutil.copy2(DB_PATH, backup_path)
# AFTER:   os.system(f"pg_dump {db_url} | gzip > {backup_path}.sql.gz")
