"""Shared context-manager DB connection for raw SQL routes.

FastAPI's Depends(get_db) returns a generator — can't be used as `with get_db()`.
This provides a context-manager alternative for routes still using raw SQL.
"""
from contextlib import contextmanager
from models.base import SessionLocal


@contextmanager
def get_conn():
    """Get a SQLAlchemy Session as a context manager for raw SQL operations."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
