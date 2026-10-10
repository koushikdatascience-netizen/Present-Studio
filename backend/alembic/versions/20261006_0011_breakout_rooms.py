"""Isolated breakout rooms and persistent assignments."""
from alembic import op
import sqlalchemy as sa

revision = "20261006_0011"
down_revision = "20261004_0010"
branch_labels = None
depends_on = None


def upgrade():
    from app.models import BreakoutRoom, BreakoutAssignment
    for table in (BreakoutRoom.__table__, BreakoutAssignment.__table__):
        table.create(op.get_bind(), checkfirst=True)


def downgrade():
    op.drop_table("breakout_assignments")
    op.drop_table("breakout_rooms")
