"""Persist multi-page whiteboard documents."""
from alembic import op
import sqlalchemy as sa

revision = '20261004_0009'
down_revision = '20260925_0008'
branch_labels = None
depends_on = None


def upgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('live_sessions')}
    if 'whiteboard_document' not in columns:
        op.add_column('live_sessions', sa.Column('whiteboard_document', sa.Text(), nullable=True))


def downgrade():
    columns = {column['name'] for column in sa.inspect(op.get_bind()).get_columns('live_sessions')}
    if 'whiteboard_document' in columns:
        op.drop_column('live_sessions', 'whiteboard_document')
