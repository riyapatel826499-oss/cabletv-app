"""add prev_expiry to payments

Revision ID: a1b2c3d4e5f6
Revises: 95097dc96149
Create Date: 2026-06-13 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '95097dc96149'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add prev_expiry column to payments table."""
    op.add_column('payments', sa.Column('prev_expiry', sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Remove prev_expiry column from payments table."""
    op.drop_column('payments', 'prev_expiry')
