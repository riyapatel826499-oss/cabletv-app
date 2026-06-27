"""add password_hint to users

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-06-27 09:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = 'd5e6f7a8b9c0'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('password_hint', sa.String(200), nullable=True))


def downgrade():
    op.drop_column('users', 'password_hint')
