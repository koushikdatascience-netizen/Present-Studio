"""Persist shared owner computation quotas."""
from alembic import op
import sqlalchemy as sa

revision = '20261004_0010'
down_revision = '20261004_0009'
branch_labels = None
depends_on = None


def upgrade():
    if 'math_compute_usage' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table('math_compute_usage', sa.Column('owner_id', sa.String(64), sa.ForeignKey('users.id', ondelete='CASCADE'), primary_key=True), sa.Column('day', sa.String(10), primary_key=True), sa.Column('calls', sa.Integer(), nullable=False, server_default='0'))


def downgrade():
    if 'math_compute_usage' in sa.inspect(op.get_bind()).get_table_names():
        op.drop_table('math_compute_usage')
