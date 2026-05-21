"""Shared context-manager DB connection for raw SQL routes.

Returns a connection that:
- Auto-translates ? → %s for PostgreSQL
- Returns dict-like rows supporting both row["col"] and row[0] access
"""
from contextlib import contextmanager
from config import DB_ENGINE, DB_PATH, DATABASE_URL_PG


@contextmanager
def get_conn():
    """Get a DB connection as context manager for legacy raw SQL routes."""
    if DB_ENGINE == "sqlite":
        import sqlite3
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
    else:
        conn = _PgConnection(DATABASE_URL_PG)
    
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


class _Row(dict):
    """Dict that also supports integer indexing: row[0], row["col"]."""
    def __init__(self, columns, values):
        super().__init__(zip(columns, values))
        self._values = tuple(values)
    
    def __getitem__(self, key):
        if isinstance(key, int):
            return self._values[key]
        return super().__getitem__(key)
    
    def __contains__(self, key):
        if isinstance(key, int):
            return 0 <= key < len(self._values)
        return super().__contains__(key)


class _PgConnection:
    """psycopg2 wrapper: auto-translates ? → %s, returns _Row dicts."""
    
    def __init__(self, dsn):
        import psycopg2
        self._conn = psycopg2.connect(dsn)
        self._conn.autocommit = False
    
    def execute(self, query, params=None):
        q = query.replace("?", "%s")
        cur = self._conn.cursor()
        if params:
            cur.execute(q, params)
        else:
            cur.execute(q)
        return _PgResult(cur)
    
    def commit(self):
        self._conn.commit()
    
    def rollback(self):
        self._conn.rollback()
    
    def close(self):
        try:
            self._conn.close()
        except Exception:
            pass


class _PgResult:
    """Wraps psycopg2 cursor: fetchall/fetchone return _Row dicts."""
    
    def __init__(self, cursor):
        self._cur = cursor
    
    def _cols(self):
        return [d[0] for d in self._cur.description] if self._cur.description else []
    
    def fetchall(self):
        rows = self._cur.fetchall()
        cols = self._cols()
        if not cols:
            return rows
        return [_Row(cols, row) for row in rows]
    
    def fetchone(self):
        row = self._cur.fetchone()
        cols = self._cols()
        if not cols or not row:
            return row
        return _Row(cols, row)
    
    @property
    def lastrowid(self):
        return self._cur.fetchone()[0] if self._cur.description else None
    
    def close(self):
        self._cur.close()
