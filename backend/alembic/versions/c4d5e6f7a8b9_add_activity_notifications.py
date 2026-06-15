"""add activity_notifications table

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-06-15 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, Sequence[str], None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create activity_notifications table."""
    op.create_table(
        'activity_notifications',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('type', sa.String(length=50), nullable=True),
        sa.Column('title', sa.String(length=200), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=True),
        sa.Column('mso', sa.String(length=50), nullable=True),
        sa.Column('stb_no', sa.String(length=50), nullable=True),
        sa.Column('customer_id', sa.String(length=20), nullable=True),
        sa.Column('operator_id', sa.Integer(), nullable=True),
        sa.Column('is_read', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('created_at', sa.String(length=100), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('idx_activity_notif_created', 'activity_notifications', ['created_at'])
    op.create_index('idx_activity_notif_unread', 'activity_notifications', ['is_read'])


def downgrade() -> None:
    """Drop activity_notifications table."""
    op.drop_index('idx_activity_notif_unread', table_name='activity_notifications')
    op.drop_index('idx_activity_notif_created', table_name='activity_notifications')
    op.drop_table('activity_notifications')
