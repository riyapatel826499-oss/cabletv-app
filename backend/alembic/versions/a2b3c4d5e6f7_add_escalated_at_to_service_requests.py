"""add escalated_at to service_requests

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
"""
from alembic import op
import sqlalchemy as sa

revision: str = 'a2b3c4d5e6f7'
down_revision: str = 'f1a2b3c4d5e6'


def upgrade() -> None:
    # Idempotent — add escalated_at only if missing
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if 'service_requests' in inspector.get_table_names():
        existing = {c['name'] for c in inspector.get_columns('service_requests')}
        if 'escalated_at' not in existing:
            op.add_column('service_requests',
                          sa.Column('escalated_at', sa.String(length=100),
                                    nullable=True, server_default=None))


def downgrade() -> None:
    # No downgrade — column is required by the ORM
    pass