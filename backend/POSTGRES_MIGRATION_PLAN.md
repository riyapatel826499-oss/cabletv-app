# PostgreSQL Migration Plan — cabletv-app Backend

## Overview
The app uses raw `sqlite3` connections everywhere with `sqlite3.Row` for dict-like row access.
This plan migrates to **psycopg2** (synchronous, matching current FastAPI sync pattern).

---

## 1. FILE-BY-FILE ANALYSIS

### `config.py`
- **Current**: `DB_PATH = os.path.join(..., "cabletv.db")`
- **Changes**: Add `DATABASE_URL` env var support, keep `DB_PATH` for backward compat

### `deps.py` (CRITICAL — central DB connection)
- **Current**: `sqlite3.connect(DB_PATH)`, `sqlite3.Row`, 7 PRAGMA statements
- **SQLite patterns**:
  - `sqlite3.connect(DB_PATH)` → need psycopg2 pool
  - `conn.row_factory = sqlite3.Row` → `psycopg2.extras.RealDictCursor`
  - `PRAGMA foreign_keys = ON` → remove (PG enforces FK by default)
  - `PRAGMA journal_mode = WAL` → remove
  - `PRAGMA busy_timeout = 5000` → remove
  - `PRAGMA synchronous = NORMAL` → remove
  - `PRAGMA cache_size = -64000` → remove
  - `PRAGMA temp_store = MEMORY` → remove
- **Return type**: `Generator[sqlite3.Connection, ...]` → `Generator[psycopg2.extensions.connection, ...]`
- **Access pattern**: `conn.execute(...)` → `conn.cursor(cursor_factory=RealDictCursor); cur.execute(...); cur.fetchall()`
- **NOTE**: To minimize changes, we wrap psycopg2 cursor results to provide the same `dict(row)` and `row["col"]` access pattern

### `models/database.py` (schema + migrations)
- **Current**: 20+ CREATE TABLE statements with `INTEGER PRIMARY KEY AUTOINCREMENT`
- **SQLite patterns**:
  - `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY` or `BIGSERIAL PRIMARY KEY`
  - `TEXT` columns → `TEXT` (PG supports it) or `VARCHAR`
  - `REAL` → `DOUBLE PRECISION` or `NUMERIC`
  - `TEXT DEFAULT CURRENT_TIMESTAMP` → `TIMESTAMP DEFAULT now()`
  - `INSERT OR IGNORE INTO` → `INSERT INTO ... ON CONFLICT DO NOTHING`
  - `PRAGMA table_info(X)` → `SELECT column_name FROM information_schema.columns WHERE table_name = X`
  - `sqlite3.OperationalError` → `psycopg2.errors.DuplicateTable` / `ProgrammingError`
  - `SELECT last_insert_rowid()` → `RETURNING id` on INSERT, or `cursor.lastrowid` (not supported in psycopg2 — use RETURNING)
  - `CREATE INDEX IF NOT EXISTS` → same syntax, PG supports it
  - `conn.commit()` → same
  - `conn.close()` → same

### `audit.py`
- Uses `get_db()` + `?` placeholders → change to `%s`

### `routes/auth.py`
- **Line 3**: `import sqlite3` → remove
- **Line 37**: `except sqlite3.OperationalError` → `except Exception`
- Uses `?` placeholders throughout → `%s`

### `routes/settings.py`
- **Line 5**: `import sqlite3` → `import psycopg2`
- **Line 23-24**: `sqlite3.connect(DB_PATH)` + `sqlite3.Row` → pool connection
- **Lines 25-30**: Inline `CREATE TABLE IF NOT EXISTS` → safe to keep, but replace sqlite3 syntax
- Uses `?` placeholders → `%s`
- Already uses `ON CONFLICT(key, operator_id) DO UPDATE` → PG compatible!

### `routes/push.py`
- **Lines 77-79, 126-128, 145-146, 170-172**: Local `sqlite3.connect(DB_PATH)` → use pool
- **Line 195**: `strftime('%Y-%m', collected_at) = strftime('%Y-%m', 'now')` → `TO_CHAR(collected_at, 'YYYY-MM') = TO_CHAR(CURRENT_DATE, 'YYYY-MM')`

### `routes/operators.py`
- **Line 5**: `import sqlite3` → remove
- **Lines 38-40**: `date('now', '+5 hours', '+30 minutes', 'start of month')` → `(CURRENT_DATE + interval '5 hours 30 minutes')::date` or use `date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')`
- **Lines 100, 243, 668**: `SELECT last_insert_rowid()` → use `RETURNING id`
- **Lines 181-183**: `sqlite3.connect(DB_PATH)` → pool
- **Line 197**: `PRAGMA table_info(X)` → `information_schema.columns`
- **Lines 208**: `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL PRIMARY KEY`
- **Line 224**: `PRAGMA table_info(operators)` → `information_schema`
- **Line 323**: `datetime('now')` → `CURRENT_TIMESTAMP` or `now()`
- **Lines 768-770**: `sqlite3.connect(DB_PATH)` → pool

### `routes/payments.py`
- **Lines 72, 131**: `dict(connection)` / `dict(plan)` comments → no change needed (RealDictCursor returns dicts)
- **Line 79**: `pragma_table_info('payments')` → `information_schema.columns`
- **Line 123**: `cursor.lastrowid` → use `RETURNING id`
- **Line 334**: `pragma_table_info('payments')` → same
- Uses `?` placeholders → `%s`

### `routes/customers.py`
- **Line 267**: `COLLATE NOCASE` → `LOWER(c.column)` or use `ILIKE` or PG's default case-insensitive
- Uses `?` placeholders → `%s`

### `routes/connections.py`
- **Lines 140, 289**: `datetime('now')` in SQL → `CURRENT_TIMESTAMP`
- Uses `?` placeholders → `%s`

### `routes/service_requests.py`
- **Lines 120, 568**: `SELECT last_insert_rowid()` → use `RETURNING id`
- Uses `?` placeholders → `%s`

### `routes/dashboard.py`
- **Lines 138**: `date('now', '+3 days')` → `CURRENT_DATE + INTERVAL '3 days'`
- **Lines 339-347**: `strftime(...)` + `date('now', '-6 months', 'start of month')` → `TO_CHAR()` + `date_trunc('month', CURRENT_DATE - INTERVAL '6 months')`

### `routes/tg_service_bot.py`
- **Lines 362-394**: `date('now', '+5 hours', '+30 minutes')` → `CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'::date` or just use proper timezone

### `routes/customer_portal.py`
- **Line 427**: `strftime('%m-%Y', ...)` → `TO_CHAR(..., 'MM-YYYY')`
- **Lines 494, 582**: `cursor.lastrowid` → `RETURNING id`

### `routes/reminders.py`
- **Lines 125-131**: `date('now', '+5 days')` etc → `CURRENT_DATE + INTERVAL '5 days'`
- **Line 301**: `date(sent_at) = date('now')` → `sent_at::date = CURRENT_DATE`

### `routes/paypakka_sync.py`
- **Lines 115**: `INSERT OR IGNORE INTO` → `INSERT INTO ... ON CONFLICT DO NOTHING`

### `routes/surrenders.py`
- Uses `?` → `%s`

### `routes/stb_inventory.py`
- Uses `?` → `%s`

### `routes/reports.py`
- Likely uses strftime/date functions → check

### `routes/employees.py`, `routes/sms.py`, `routes/gtpl.py`, `routes/wa_notify.py`, `routes/notifications.py`, `routes/websocket.py`
- All use `?` → `%s`

### `routes/customers.py` (more)
- **Line 970**: `datetime('now')` in SQL → `CURRENT_TIMESTAMP`
- **Line 998**: `pragma_table_info` → `information_schema`

### `services/payments.py`
- Check for any SQL patterns

### `migrate_multi_tenant.py`, `migrate_service_requests.py`
- Standalone migration scripts, can remain SQLite-specific or be updated

---

## 2. SQL PATTERN MAPPING (SQLite → PostgreSQL)

| SQLite | PostgreSQL | Notes |
|--------|-----------|-------|
| `?` placeholder | `%s` placeholder | psycopg2 uses `%s` |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` or `BIGSERIAL PRIMARY KEY` | |
| `INSERT OR IGNORE INTO t ...` | `INSERT INTO t ... ON CONFLICT DO NOTHING` | |
| `INSERT OR REPLACE INTO t ...` | `INSERT INTO t ... ON CONFLICT (...) DO UPDATE SET ...` | |
| `SELECT last_insert_rowid()` | `INSERT INTO ... RETURNING id` | Or use `RETURNING` clause |
| `cursor.lastrowid` | Use `RETURNING id` on INSERT | psycopg2 doesn't support lastrowid reliably |
| `PRAGMA foreign_keys = ON` | Remove | PG enforces FK always |
| `PRAGMA journal_mode = WAL` | Remove | N/A |
| `PRAGMA busy_timeout = N` | Remove | N/A |
| `PRAGMA table_info(X)` | `SELECT column_name FROM information_schema.columns WHERE table_name='x'` | |
| `pragma_table_info('x')` (in SQL) | Same as above (cannot be used in SQL — must be Python check) | |
| `sqlite3.OperationalError` | `psycopg2.errors.DuplicateColumn` / `ProgrammingError` | |
| `sqlite3.Row` / `dict(row)` | `RealDictCursor` returns actual dicts | |
| `datetime('now')` in SQL | `CURRENT_TIMESTAMP` or `now()` | |
| `date('now')` | `CURRENT_DATE` | |
| `date('now', '+N days')` | `CURRENT_DATE + INTERVAL 'N days'` | |
| `date('now', 'start of month')` | `date_trunc('month', CURRENT_DATE)` | |
| `strftime('%Y-%m', col)` | `TO_CHAR(col, 'YYYY-MM')` | |
| `COLLATE NOCASE` | Remove (use `ILIKE` for case-insensitive matching) | PG text comparison is case-sensitive |
| `LIKE` (case-insensitive in SQLite) | `ILIKE` (for case-insensitive) or `LIKE` (case-sensitive) | **CRITICAL**: SQLite LIKE is case-insensitive for ASCII! |
| `REAL` | `DOUBLE PRECISION` or `NUMERIC(10,2)` | |
| `TEXT DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMP DEFAULT now()` | |
| `CHECK (amount > 0)` | Same syntax | PG compatible |
| `CREATE TABLE IF NOT EXISTS` | Same | PG compatible |
| `CREATE INDEX IF NOT EXISTS` | Same | PG compatible |
| `ON CONFLICT(...) DO UPDATE SET` | Same syntax | PG compatible (this is actually PG-native!) |
| `conn.execute(sql).fetchone()` | `cur.execute(sql); cur.fetchone()` | Need cursor |
| `conn.execute(sql).fetchall()` | `cur.execute(sql); cur.fetchall()` | Need cursor |
| `conn.commit()` | `conn.commit()` | Same |
| `conn.close()` | `conn.close()` (or return to pool) | |

---

## 3. FILES THAT NEED CHANGES (PRIORITY ORDER)

### Tier 1 — Core Infrastructure (MUST change first)
1. **`config.py`** — Add DATABASE_URL
2. **`db.py`** (NEW) — Connection pool manager
3. **`deps.py`** — Replace get_db() to use pool
4. **`models/database.py`** — Rewrite schema for PG

### Tier 2 — Routes with direct sqlite3 usage
5. **`routes/auth.py`** — Remove sqlite3 import, fix exception
6. **`routes/settings.py`** — Replace sqlite3.connect + _get_conn()
7. **`routes/push.py`** — Replace 4x sqlite3.connect blocks
8. **`routes/operators.py`** — Replace 2x sqlite3.connect, PRAGMA, last_insert_rowid, date functions
9. **`routes/payments.py`** — pragma_table_info → information_schema, lastrowid
10. **`routes/service_requests.py`** — last_insert_rowid
11. **`routes/customers.py`** — COLLATE NOCASE, datetime('now'), pragma_table_info
12. **`routes/connections.py`** — datetime('now') in SQL
13. **`routes/dashboard.py`** — date() and strftime() functions
14. **`routes/tg_service_bot.py`** — date('now'...) functions
15. **`routes/customer_portal.py`** — strftime, lastrowid
16. **`routes/reminders.py`** — date('now'...) functions
17. **`routes/paypakka_sync.py`** — INSERT OR IGNORE

### Tier 3 — Routes with only `?` → `%s` changes
18. **`routes/surrenders.py`**
19. **`routes/stb_inventory.py`**
20. **`routes/reports.py`**
21. **`routes/employees.py`**
22. **`routes/sms.py`**
23. **`routes/gtpl.py`**
24. **`routes/wa_notify.py`**
25. **`routes/notifications.py`**
26. **`routes/websocket.py`**

### Tier 4 — Support files
27. **`audit.py`** — `?` → `%s`
28. **`services/payments.py`** — Check for SQL patterns
29. **`main.py`** — backup_db() needs rethinking (pg_dump instead of file copy)
30. **`migrate_multi_tenant.py`** — One-time script, optional
31. **`migrate_service_requests.py`** — One-time script, optional

---

## 4. CRITICAL BEHAVIORAL DIFFERENCES

1. **`LIKE` is case-insensitive in SQLite but case-sensitive in PostgreSQL**
   - Every `LIKE` in WHERE clauses must be evaluated: change to `ILIKE` if case-insensitive matching is intended
   - Files affected: customers.py, connections.py, reminders.py, operators.py

2. **`cursor.lastrowid` doesn't work in psycopg2**
   - Must refactor all INSERT+lastrowid to use `INSERT ... RETURNING id`
   - Files: payments.py, service_requests.py, customer_portal.py, operators.py

3. **`conn.execute()` returns cursor in sqlite3 but NOT in psycopg2**
   - sqlite3: `conn.execute(sql, params).fetchall()` works
   - psycopg2: must use `cur = conn.cursor(); cur.execute(sql, params); cur.fetchall()`
   - **Solution**: Create a wrapper connection class that provides `execute()` returning a cursor-like object

4. **Transaction handling**
   - sqlite3: autocommit by default (each statement auto-commits unless in transaction)
   - psycopg2: autocommit is OFF by default; must `conn.commit()` explicitly
   - Current code already calls `conn.commit()` — mostly compatible

5. **Connection pooling**
   - sqlite3: direct file access, no pool needed
   - psycopg2: must use `psycopg2.pool.ThreadedConnectionPool` for FastAPI (thread-based)

6. **`dict(row)` conversion**
   - sqlite3.Row needs `dict(row)` to get a real dict
   - RealDictCursor already returns dicts — the `dict()` calls are harmless but unnecessary
