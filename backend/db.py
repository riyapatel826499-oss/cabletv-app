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

    class PgConnection:
        """Wrapper around psycopg2 connection that mimics sqlite3.Connection API.
        - conn.execute(sql, params) → returns cursor (with fetchone/fetchall)
        - conn.commit() / conn.rollback() → delegates to underlying connection
        """
        def __init__(self, raw_conn):
            self._conn = raw_conn

        def execute(self, sql, params=None):
            cur = self._conn.cursor()
            cur.execute(sql, params)
            return cur

        def executemany(self, sql, params_list):
            cur = self._conn.cursor()
            cur.executemany(sql, params_list)
            return cur

        def commit(self):
            self._conn.commit()

        def rollback(self):
            self._conn.rollback()

        def close(self):
            self._conn.close()

        @property
        def row_factory(self):
            return None  # Already using RealDictCursor

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
