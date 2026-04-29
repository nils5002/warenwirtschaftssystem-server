"""initial_wms_schema

Revision ID: 20260417_0001
Revises:
Create Date: 2026-04-17 23:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260417_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=140), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("timestamp_text", sa.String(length=80), nullable=False),
        sa.Column("asset_external_id", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_activities_asset_external_id"), "activities", ["asset_external_id"], unique=False)
    op.create_index(op.f("ix_activities_external_id"), "activities", ["external_id"], unique=True)
    op.create_index(op.f("ix_activities_id"), "activities", ["id"], unique=False)

    op.create_table(
        "assets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=False),
        sa.Column("location", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("assigned_to", sa.String(length=120), nullable=False),
        sa.Column("next_return", sa.String(length=120), nullable=False),
        sa.Column("tag_number", sa.String(length=64), nullable=False),
        sa.Column("serial_number", sa.String(length=128), nullable=False),
        sa.Column("qr_code", sa.String(length=255), nullable=False),
        sa.Column("maintenance_state", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("last_checkout", sa.String(length=120), nullable=False),
        sa.Column("next_reservation", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_assets_external_id"), "assets", ["external_id"], unique=True)
    op.create_index(op.f("ix_assets_id"), "assets", ["id"], unique=False)
    op.create_index(op.f("ix_assets_name"), "assets", ["name"], unique=False)
    op.create_index(op.f("ix_assets_serial_number"), "assets", ["serial_number"], unique=True)
    op.create_index(op.f("ix_assets_tag_number"), "assets", ["tag_number"], unique=True)

    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("capacity", sa.String(length=64), nullable=False),
        sa.Column("assigned_assets", sa.Integer(), nullable=False),
        sa.Column("available_assets", sa.Integer(), nullable=False),
        sa.Column("manager", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_locations_id"), "locations", ["id"], unique=False)
    op.create_index(op.f("ix_locations_name"), "locations", ["name"], unique=True)

    op.create_table(
        "maintenance_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("asset_name", sa.String(length=255), nullable=False),
        sa.Column("issue", sa.Text(), nullable=False),
        sa.Column("reported_at", sa.String(length=80), nullable=False),
        sa.Column("due_date", sa.String(length=80), nullable=False),
        sa.Column("priority", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("comment", sa.Text(), nullable=False),
        sa.Column("location", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_maintenance_items_external_id"), "maintenance_items", ["external_id"], unique=True)
    op.create_index(op.f("ix_maintenance_items_id"), "maintenance_items", ["id"], unique=False)

    op.create_table(
        "reservations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("requested_by", sa.String(length=120), nullable=False),
        sa.Column("team", sa.String(length=120), nullable=False),
        sa.Column("period", sa.String(length=120), nullable=False),
        sa.Column("assets", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=64), nullable=False),
        sa.Column("location", sa.String(length=120), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_reservations_external_id"), "reservations", ["external_id"], unique=True)
    op.create_index(op.f("ix_reservations_id"), "reservations", ["id"], unique=False)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("role", sa.String(length=64), nullable=False),
        sa.Column("last_active", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_external_id"), "users", ["external_id"], unique=True)
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_index(op.f("ix_users_external_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

    op.drop_index(op.f("ix_reservations_id"), table_name="reservations")
    op.drop_index(op.f("ix_reservations_external_id"), table_name="reservations")
    op.drop_table("reservations")

    op.drop_index(op.f("ix_maintenance_items_id"), table_name="maintenance_items")
    op.drop_index(op.f("ix_maintenance_items_external_id"), table_name="maintenance_items")
    op.drop_table("maintenance_items")

    op.drop_index(op.f("ix_locations_name"), table_name="locations")
    op.drop_index(op.f("ix_locations_id"), table_name="locations")
    op.drop_table("locations")

    op.drop_index(op.f("ix_assets_tag_number"), table_name="assets")
    op.drop_index(op.f("ix_assets_serial_number"), table_name="assets")
    op.drop_index(op.f("ix_assets_name"), table_name="assets")
    op.drop_index(op.f("ix_assets_id"), table_name="assets")
    op.drop_index(op.f("ix_assets_external_id"), table_name="assets")
    op.drop_table("assets")

    op.drop_index(op.f("ix_activities_id"), table_name="activities")
    op.drop_index(op.f("ix_activities_external_id"), table_name="activities")
    op.drop_index(op.f("ix_activities_asset_external_id"), table_name="activities")
    op.drop_table("activities")

