"""Schema migration entrypoint — run as the Railway release/pre-deploy step.

Idempotently brings the database to the latest Alembic revision:
  - If the DB already has the schema but no alembic_version (a legacy DB built by
    the old init_db startup code), it stamps the baseline first so `upgrade`
    won't try to recreate existing tables.
  - Then runs `alembic upgrade head`.

Safe to run repeatedly and on fresh or existing databases.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from alembic.config import Config
from alembic import command
from sqlalchemy import create_engine, inspect

from config import DATABASE_URL_PG, DB_PATH

_HERE = os.path.dirname(os.path.abspath(__file__))


def _db_url() -> str:
    return DATABASE_URL_PG or (f"sqlite:///{DB_PATH}" if DB_PATH else "")


def main() -> None:
    url = _db_url()
    if not url:
        print("migrate: no database configured; nothing to do")
        return

    cfg = Config(os.path.join(_HERE, "alembic.ini"))

    engine = create_engine(url)
    try:
        tables = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    if "alembic_version" not in tables and "users" in tables:
        print("migrate: existing schema with no alembic_version — stamping baseline")
        command.stamp(cfg, "head")

    print("migrate: upgrading to head")
    command.upgrade(cfg, "head")
    print("migrate: done")


if __name__ == "__main__":
    main()
