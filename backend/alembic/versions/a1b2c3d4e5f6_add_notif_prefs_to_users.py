"""add notif_prefs column to users

Revision ID: a1b2c3d4e5f6
Revises: f1a2b3c4d5e6
Create Date: 2026-08-05 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f6'
down_revision = 'f1a2b3c4d5e6'
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    """Check column existence on both SQLite and PostgreSQL."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade():
    # Per-user notification preferences: JSON like
    # {"payment": true, "reconnection": false, "daily_summary": true}
    # Missing key = enabled (safe default). Admin-managed via Settings UI.
    if not _column_exists("users", "notif_prefs"):
        op.add_column(
            "users",
            sa.Column("notif_prefs", sa.Text(), nullable=True),
        )


def downgrade():
    if _column_exists("users", "notif_prefs"):
        op.drop_column("users", "notif_prefs")
