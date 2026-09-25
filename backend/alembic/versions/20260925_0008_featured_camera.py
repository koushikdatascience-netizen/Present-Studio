"""persist presenter-selected featured camera

Revision ID: 20260925_0008
Revises: 20260916_0007
Create Date: 2026-09-25
"""
from alembic import op
import sqlalchemy as sa


revision = "20260925_0008"
down_revision = "20260916_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("live_sessions")}
    if "featured_camera_identity" not in columns:
        op.add_column("live_sessions", sa.Column("featured_camera_identity", sa.String(length=128), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("live_sessions")}
    if "featured_camera_identity" in columns:
        op.drop_column("live_sessions", "featured_camera_identity")
