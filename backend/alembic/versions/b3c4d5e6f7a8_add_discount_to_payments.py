"""add discount and discount_reason to payments

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Create Date: 2026-06-14 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3c4d5e6f7a8'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add discount and discount_reason columns to payments table."""
    op.add_column('payments', sa.Column('discount', sa.Float(), nullable=True, server_default='0'))
    op.add_column('payments', sa.Column('discount_reason', sa.String(length=200), nullable=True))


def downgrade() -> None:
    """Remove discount and discount_reason columns from payments table."""
    op.drop_column('payments', 'discount_reason')
    op.drop_column('payments', 'discount')
