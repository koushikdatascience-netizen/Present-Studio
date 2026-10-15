"""remote control transition audit
Revision ID: 20261015_0008
Revises: 20260916_0007
"""
from alembic import op
import sqlalchemy as sa
revision = '20261015_0008'
down_revision = '20260916_0007'
branch_labels = None
depends_on = None

def upgrade():
    if 'remote_control_audit' in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table('remote_control_audit',
        sa.Column('id', sa.String(64), primary_key=True),
        sa.Column('session_id', sa.String(64), nullable=False),
        sa.Column('presentation_id', sa.String(64), nullable=False),
        sa.Column('controller_id', sa.String(64), nullable=False),
        sa.Column('guest_id', sa.String(128), nullable=False),
        sa.Column('event', sa.String(32), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    op.create_index('ix_remote_control_audit_session_id', 'remote_control_audit', ['session_id'])
    op.create_index('ix_remote_control_audit_presentation_id', 'remote_control_audit', ['presentation_id'])

def downgrade():
    op.drop_table('remote_control_audit')
