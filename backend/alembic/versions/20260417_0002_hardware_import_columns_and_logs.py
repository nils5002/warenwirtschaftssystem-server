"""hardware_import_columns_and_logs

Revision ID: 20260417_0002
Revises: 20260417_0001
Create Date: 2026-04-17 23:50:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260417_0002"
down_revision = "20260417_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("assets", sa.Column("device_model", sa.String(length=255), nullable=True))
    op.add_column("assets", sa.Column("ip_address", sa.String(length=64), nullable=True))
    op.add_column("assets", sa.Column("mac_lan", sa.String(length=32), nullable=True))
    op.add_column("assets", sa.Column("mac_wlan", sa.String(length=32), nullable=True))
    op.add_column("assets", sa.Column("source_file", sa.String(length=255), nullable=True))

    op.create_table(
        "hardware_import_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("import_path", sa.String(length=255), nullable=False),
        sa.Column("files_total", sa.Integer(), nullable=False),
        sa.Column("files_processed", sa.Integer(), nullable=False),
        sa.Column("rows_total", sa.Integer(), nullable=False),
        sa.Column("created_count", sa.Integer(), nullable=False),
        sa.Column("updated_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("error_count", sa.Integer(), nullable=False),
        sa.Column("details_json", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_hardware_import_runs_id"), "hardware_import_runs", ["id"], unique=False)

    op.create_table(
        "hardware_import_row_errors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("sheet_name", sa.String(length=128), nullable=False),
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("serial_number", sa.String(length=128), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("raw_data", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_hardware_import_row_errors_id"),
        "hardware_import_row_errors",
        ["id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_hardware_import_row_errors_run_id"),
        "hardware_import_row_errors",
        ["run_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_hardware_import_row_errors_run_id"), table_name="hardware_import_row_errors")
    op.drop_index(op.f("ix_hardware_import_row_errors_id"), table_name="hardware_import_row_errors")
    op.drop_table("hardware_import_row_errors")

    op.drop_index(op.f("ix_hardware_import_runs_id"), table_name="hardware_import_runs")
    op.drop_table("hardware_import_runs")

    op.drop_column("assets", "source_file")
    op.drop_column("assets", "mac_wlan")
    op.drop_column("assets", "mac_lan")
    op.drop_column("assets", "ip_address")
    op.drop_column("assets", "device_model")

