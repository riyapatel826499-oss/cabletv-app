"""add created_at and updated_at to service_requests

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
"""
from alembic import op
import sqlalchemy as sa

revision: str = 'e6f7a8b9c0d1'
down_revision: str = 'd5e6f7a8b9c0'


def upgrade() -> None:
    # Check if column exists before adding (idempotent)
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    # service_requests
    if 'service_requests' in inspector.get_table_names():
        existing = {c['name'] for c in inspector.get_columns('service_requests')}
        if 'created_at' not in existing:
            op.add_column('service_requests',
                          sa.Column('created_at', sa.String(length=100),
                                    nullable=True, server_default='now()'))
        if 'updated_at' not in existing:
            op.add_column('service_requests',
                          sa.Column('updated_at', sa.String(length=100),
                                    nullable=True, server_default='now()'))

    # customers — prod PG is missing this column
    if 'customers' in inspector.get_table_names():
        existing = {c['name'] for c in inspector.get_columns('customers')}
        if 'created_at' not in existing:
            op.add_column('customers',
                          sa.Column('created_at', sa.String(length=100),
                                    nullable=True, server_default='now()'))

    # connections — may also be missing
    if 'connections' in inspector.get_table_names():
        existing = {c['name'] for c in inspector.get_columns('connections')}
        if 'created_at' not in existing:
            op.add_column('connections',
                          sa.Column('created_at', sa.String(length=100),
                                    nullable=True, server_default='now()'))


def downgrade() -> None:
    # No downgrade — these columns are required by the ORM
    pass
