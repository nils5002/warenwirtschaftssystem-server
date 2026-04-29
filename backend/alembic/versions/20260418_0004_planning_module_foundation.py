"""planning_module_foundation

Revision ID: 20260418_0004
Revises: 20260418_0003
Create Date: 2026-04-18 20:10:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260418_0004"
down_revision = "20260418_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("planning"):
        op.create_table(
            "planning",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("external_id", sa.String(length=64), nullable=False),
            sa.Column("customer_name", sa.String(length=160), nullable=False),
            sa.Column("project_name", sa.String(length=180), nullable=False),
            sa.Column("event_name", sa.String(length=180), nullable=True),
            sa.Column("project_manager_user_id", sa.String(length=64), nullable=True),
            sa.Column("calendar_week", sa.Integer(), nullable=True),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=False),
            sa.Column("status", sa.String(length=32), nullable=False),
            sa.Column("template_source_planning_id", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
            sa.ForeignKeyConstraint(["project_manager_user_id"], ["users.external_id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )

    if not inspector.has_table("planning_days"):
        op.create_table(
            "planning_days",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("planning_id", sa.Integer(), nullable=False),
            sa.Column("planning_date", sa.Date(), nullable=False),
            sa.Column("weekday", sa.String(length=16), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
            sa.ForeignKeyConstraint(["planning_id"], ["planning.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("planning_id", "planning_date", name="uq_planning_days_planning_date"),
        )

    if not inspector.has_table("planning_items"):
        op.create_table(
            "planning_items",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("planning_day_id", sa.Integer(), nullable=False),
            sa.Column("category_key", sa.String(length=120), nullable=False),
            sa.Column("qty", sa.Integer(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
            sa.ForeignKeyConstraint(["planning_day_id"], ["planning_days.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("planning_day_id", "category_key", name="uq_planning_items_day_category"),
        )

    inspector = sa.inspect(bind)

    def create_missing_index(index_name: str, table_name: str, columns: list[str], unique: bool = False) -> None:
        existing = {item["name"] for item in inspector.get_indexes(table_name)}
        if index_name not in existing:
            op.create_index(index_name, table_name, columns, unique=unique)

    create_missing_index(op.f("ix_planning_id"), "planning", ["id"])
    create_missing_index(op.f("ix_planning_external_id"), "planning", ["external_id"], unique=True)
    create_missing_index(op.f("ix_planning_customer_name"), "planning", ["customer_name"])
    create_missing_index(op.f("ix_planning_project_name"), "planning", ["project_name"])
    create_missing_index(op.f("ix_planning_project_manager_user_id"), "planning", ["project_manager_user_id"])
    create_missing_index(op.f("ix_planning_calendar_week"), "planning", ["calendar_week"])
    create_missing_index(op.f("ix_planning_start_date"), "planning", ["start_date"])
    create_missing_index(op.f("ix_planning_end_date"), "planning", ["end_date"])
    create_missing_index(op.f("ix_planning_status"), "planning", ["status"])

    create_missing_index(op.f("ix_planning_days_id"), "planning_days", ["id"])
    create_missing_index(op.f("ix_planning_days_planning_id"), "planning_days", ["planning_id"])
    create_missing_index(op.f("ix_planning_days_planning_date"), "planning_days", ["planning_date"])

    create_missing_index(op.f("ix_planning_items_id"), "planning_items", ["id"])
    create_missing_index(op.f("ix_planning_items_planning_day_id"), "planning_items", ["planning_day_id"])
    create_missing_index(op.f("ix_planning_items_category_key"), "planning_items", ["category_key"])


def downgrade() -> None:
    op.drop_index(op.f("ix_planning_items_category_key"), table_name="planning_items")
    op.drop_index(op.f("ix_planning_items_planning_day_id"), table_name="planning_items")
    op.drop_index(op.f("ix_planning_items_id"), table_name="planning_items")
    op.drop_table("planning_items")

    op.drop_index(op.f("ix_planning_days_planning_date"), table_name="planning_days")
    op.drop_index(op.f("ix_planning_days_planning_id"), table_name="planning_days")
    op.drop_index(op.f("ix_planning_days_id"), table_name="planning_days")
    op.drop_table("planning_days")

    op.drop_index(op.f("ix_planning_status"), table_name="planning")
    op.drop_index(op.f("ix_planning_end_date"), table_name="planning")
    op.drop_index(op.f("ix_planning_start_date"), table_name="planning")
    op.drop_index(op.f("ix_planning_calendar_week"), table_name="planning")
    op.drop_index(op.f("ix_planning_project_manager_user_id"), table_name="planning")
    op.drop_index(op.f("ix_planning_project_name"), table_name="planning")
    op.drop_index(op.f("ix_planning_customer_name"), table_name="planning")
    op.drop_index(op.f("ix_planning_external_id"), table_name="planning")
    op.drop_index(op.f("ix_planning_id"), table_name="planning")
    op.drop_table("planning")
