"""
Database abstraction layer — supports both SQLite (local dev) and PostgreSQL (Railway).

Usage (same API regardless of engine):
    from db import get_db
    with get_db() as conn:
        row = conn.execute("SELECT * FROM customers WHERE id = " + ph(), [customer_id]).fetchone()
        rows = conn.execute("SELECT * FROM customers").fetchall()
        conn.execute("INSERT INTO customers (...) VALUES (" + ph(3) + ")", [...])
        conn.commit()

The connection object always provides:
    - execute(sql, params) → cursor-like with fetchone()/fetchall()
    - commit() / rollback()
    - Row results are dict-like (access by column name)
"""
import os
from contextlib import contextmanager
from typing import Generator, Any, Optional

from config import DB_ENGINE

# ── SQLite Implementation ─────────────────────────────────────────────────
if DB_ENGINE == "sqlite":
    import sqlite3
    from config import DB_PATH

    @contextmanager
    def get_db() -> Generator[sqlite3.Connection, None, None]:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA cache_size = -64000")
        conn.execute("PRAGMA temp_store = MEMORY")
        try:
            yield conn
        finally:
            conn.close()

    def placeholder(n: int = 1) -> str:
        """Return SQLite placeholder(s): '?' x n"""
        return ", ".join(["?"] * n) if n > 1 else "?"

    def lastrowid(conn) -> int:
        return conn.execute("SELECT last_insert_rowid()").fetchone()[0]

    def table_has_column(conn, table: str, column: str) -> bool:
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        return column in cols

    def autoincrement() -> str:
        return "INTEGER PRIMARY KEY AUTOINCREMENT"

    def insert_or_ignore() -> str:
        return "INSERT OR IGNORE"

    def like() -> str:
        return "LIKE"  # SQLite LIKE is case-insensitive by default


# ── PostgreSQL Implementation ─────────────────────────────────────────────
else:
    import psycopg2
    from psycopg2.extras import RealDictCursor
    from psycopg2.pool import ThreadedConnectionPool
    from config import DATABASE_URL_PG

    _pool: Optional[ThreadedConnectionPool] = None

    class PgRow(dict):
        """Dict subclass that also supports integer index access (row[0], row[1]...)."""
        def __getitem__(self, key):
            if isinstance(key, int):
                return list(self.values())[key]
            return super().__getitem__(key)

    class PgCursor:
        """Cursor wrapper that returns PgRow objects supporting both dict and tuple access."""
        def __init__(self, cur):
            self._cur = cur

        def fetchone(self):
            row = self._cur.fetchone()
            if row is None:
                return None
            if isinstance(row, dict):
                return PgRow(row)
            return row

        def fetchall(self):
            rows = self._cur.fetchall()
            if rows and isinstance(rows[0], dict):
                return [PgRow(r) for r in rows]
            return rows

        @property
        def description(self):
            return self._cur.description

        @property
        def rowcount(self):
            return self._cur.rowcount

    class PgConnection:
        """Wrapper around psycopg2 connection that mimics sqlite3.Connection API.
        - conn.execute(sql, params) → returns cursor (with fetchone/fetchall)
        - conn.commit() / conn.rollback() → delegates to underlying connection
        - Automatically converts ? placeholders to %s for compatibility
        - Results are dict-like (via RealDictCursor)
        - fetchone()[0] works (returns tuple, not dict)
        """
        def __init__(self, raw_conn):
            self._conn = raw_conn

        def execute(self, sql, params=None):
            # Auto-translate SQLite SQL to PostgreSQL
            sql = _translate_sql(sql)
            cur = self._conn.cursor()
            cur.execute(sql, params)
            return PgCursor(cur)

        def executemany(self, sql, params_list):
            sql = _translate_sql(sql)
            cur = self._conn.cursor()
            cur.executemany(sql, params_list)
            return PgCursor(cur)

        def commit(self):
            self._conn.commit()

        def rollback(self):
            self._conn.rollback()

        def close(self):
            self._conn.close()

        @property
        def row_factory(self):
            return None

    def _get_pool() -> ThreadedConnectionPool:
        global _pool
        if _pool is None or _pool.closed:
            _pool = ThreadedConnectionPool(
                minconn=2,
                maxconn=10,
                dsn=DATABASE_URL_PG,
                cursor_factory=RealDictCursor,
            )
        return _pool

    @contextmanager
    def get_db() -> Generator:
        pool = _get_pool()
        raw_conn = pool.getconn()
        conn = PgConnection(raw_conn)
        try:
            yield conn
        except Exception:
            conn.rollback()
            raise
        finally:
            pool.putconn(raw_conn)

    def placeholder(n: int = 1) -> str:
        """Return PostgreSQL placeholder(s): %s x n"""
        return ", ".join(["%s"] * n) if n > 1 else "%s"

    def lastrowid(conn) -> int:
        """Not typically needed — use RETURNING id in INSERT instead."""
        raise NotImplementedError("Use INSERT ... RETURNING id with PostgreSQL")

    def table_has_column(conn, table: str, column: str) -> bool:
        cur = conn.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s AND column_name = %s",
            [table, column]
        )
        return cur.fetchone() is not None

    def autoincrement() -> str:
        return "SERIAL PRIMARY KEY"

    def insert_or_ignore() -> str:
        return "INSERT"

    def like() -> str:
        return "ILIKE"  # PostgreSQL LIKE is case-sensitive, ILIKE is not

    # ── SQL Translation ────────────────────────────────────────────────────
    import re as _re

    # Pre-compiled patterns for performance
    _DATE_NOW_RE = _re.compile(r"\bdate\(\s*'now'\s*(?:,\s*([^)]+))?\)", _re.IGNORECASE)
    _COLLATE_RE = _re.compile(r'\s+COLLATE\s+NOCASE\s*', _re.IGNORECASE)
    _SUBSTR_RE = _re.compile(r'\bSUBSTR\(([^)]+)\)', _re.IGNORECASE)
    _INSTR_RE = _re.compile(r'\bINSTR\(([^)]+)\)', _re.IGNORECASE)
    _STRFTIME_RE = _re.compile(r"\bstrftime\(\s*'([^']+)'\s*,\s*([^)]+)\)", _re.IGNORECASE)

    # SQLite → PostgreSQL strftime format mapping
    _STRFTIME_MAP = {
        '%Y': 'YYYY', '%m': 'MM', '%d': 'DD',
        '%H': 'HH24', '%M': 'MI', '%S': 'SS',
        '%-m': 'FMMM', '%-d': 'FMDD',
    }

    def _translate_sql(query: str) -> str:
        """Translate SQLite-specific SQL to PostgreSQL-compatible SQL."""
        if not query:
            return query
        q = query

        # 1. Replace ? placeholders with %s
        if '?' in q:
            q = q.replace('?', '%s')

        # 2. date('now', '+N days') → CURRENT_DATE + N days
        def _replace_date(m):
            args_str = m.group(1) or ''
            if args_str.strip():
                args = [a.strip().strip("'") for a in args_str.split(',')]
            else:
                args = []
            modifiers = args  # All captured args are modifiers (regex already excluded 'now')
            days_offset = 0
            months_offset = 0
            hours_offset = 0
            minutes_offset = 0
            start_of_month = False
            for mod in modifiers:
                mod = mod.strip()
                if mod == 'start of month':
                    start_of_month = True
                elif 'day' in mod and 'month' not in mod:
                    val = int(mod.replace('days', '').replace('day', '').replace('+', '').replace('-', '').replace(' ', ''))
                    if mod.strip().startswith('-'):
                        days_offset -= val
                    else:
                        days_offset += val
                elif 'month' in mod:
                    val = int(mod.replace('months', '').replace('month', '').replace('+', '').replace('-', '').replace(' ', ''))
                    if mod.strip().startswith('-'):
                        months_offset -= val
                    else:
                        months_offset += val
                elif 'hour' in mod:
                    hours_offset += int(mod.replace('hours', '').replace('hour', '').replace('+', '').replace(' ', ''))
                elif 'minute' in mod:
                    minutes_offset += int(mod.replace('minutes', '').replace('minute', '').replace('+', '').replace(' ', ''))
            # Build interval expression
            base = "CURRENT_DATE"
            parts = []
            if hours_offset or minutes_offset:
                # Use CURRENT_TIMESTAMP for time-aware calculations
                hm = []
                if hours_offset:
                    hm.append(f"'{hours_offset} hours'")
                if minutes_offset:
                    hm.append(f"'{minutes_offset} minutes'")
                base = f"(CURRENT_TIMESTAMP + {' + '.join(['INTERVAL ' + h for h in hm])})::date"
            if days_offset != 0:
                parts.append(f"'{days_offset} days'")
            if months_offset != 0:
                parts.append(f"'{months_offset} months'")
            if parts:
                interval = " + ".join([f"INTERVAL {p}" for p in parts])
                if base == "CURRENT_DATE":
                    base = f"(CURRENT_DATE + {interval})"
                else:
                    base = f"({base} + {interval})"
            if start_of_month:
                return f"date_trunc('month', {base})::date"
            # Return as date — PG auto-casts parameterized strings for comparison
            return f"({base})::date"

        q = _DATE_NOW_RE.sub(_replace_date, q)

        # 3. COLLATE NOCASE → remove
        q = _COLLATE_RE.sub(' ', q)

        # 4. SUBSTR(x, pos, len) → SUBSTRING(x FROM pos FOR len)
        def _replace_substr(m):
            parts = [p.strip() for p in m.group(1).split(',')]
            if len(parts) == 3:
                return f"SUBSTRING({parts[0]} FROM {parts[1]} FOR {parts[2]})"
            elif len(parts) == 2:
                return f"SUBSTRING({parts[0]} FROM {parts[1]})"
            return m.group(0)
        q = _SUBSTR_RE.sub(_replace_substr, q)

        # 5. INSTR(x, y) → POSITION(y IN x)
        def _replace_instr(m):
            parts = [p.strip() for p in m.group(1).split(',')]
            if len(parts) == 2:
                return f"POSITION({parts[1]} IN {parts[0]})"
            return m.group(0)
        q = _INSTR_RE.sub(_replace_instr, q)

        # 6. strftime('%Y-%m', col) → TO_CHAR(col::timestamp, 'YYYY-MM')
        def _replace_strftime(m):
            fmt = m.group(1)
            col = m.group(2).strip()
            pg_fmt = fmt
            for sqlite_pat, pg_pat in _STRFTIME_MAP.items():
                pg_fmt = pg_fmt.replace(sqlite_pat, pg_pat)
            return f"TO_CHAR({col}::timestamp, '{pg_fmt}')"
        q = _STRFTIME_RE.sub(_replace_strftime, q)

        return q

    def sql(query: str) -> str:
        """Public alias for _translate_sql — use when building SQL strings outside execute()."""
        return _translate_sql(query)
