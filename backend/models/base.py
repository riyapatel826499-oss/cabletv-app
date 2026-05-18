"""SQLAlchemy 2.0 base configuration — engine, session, and Base declarative model."""

import os
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session

# ---------------------------------------------------------------------------
# Database URL — prefer DATABASE_URL env var, fall back to local SQLite
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv("DATABASE_URL") or os.getenv("DB_PATH") and f"sqlite:///{os.getenv('DB_PATH')}" or "sqlite:///./cabletv.db"

# SQLite needs check_same_thread=False when used with FastAPI
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ---------------------------------------------------------------------------
# Declarative base — all models inherit from this
# ---------------------------------------------------------------------------
class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# FastAPI dependency — yields a Session, closes in finally block
# ---------------------------------------------------------------------------
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
