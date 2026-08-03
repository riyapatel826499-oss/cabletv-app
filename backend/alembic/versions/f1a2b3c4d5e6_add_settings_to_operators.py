"""add settings column to operators

Revision ID: f1a2b3c4d5e6
Revises: e6f7a8b9c0d1
Create Date: 2026-08-03 17:10:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'f1a2b3c4d5e6'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def _column_exists(table: str, column: str) -> bool:
    """Check column existence on both SQLite and PostgreSQL."""
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade():
    # JSON settings blob per operator (white-label branding + prorata config).
    # server_default '{}' keeps legacy rows valid; idempotent so a manually
    # patched prod DB (no settings column in baseline) doesn't crash the deploy.
    if not _column_exists("operators", "settings"):
        op.add_column(
            "operators",
            sa.Column("settings", sa.Text(), nullable=True, server_default="{}"),
        )


def downgrade():
    if _column_exists("operators", "settings"):
        op.drop_column("operators", "settings")
