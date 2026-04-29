"""user_profile_fields_and_normalization

Revision ID: 20260418_0003
Revises: 20260417_0002
Create Date: 2026-04-18 02:20:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260418_0003"
down_revision = "20260417_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("department", sa.String(length=120), nullable=True))
    op.add_column("users", sa.Column("location", sa.String(length=120), nullable=True))

    op.execute(
        sa.text(
            """
            UPDATE users
            SET role = 'Mitarbeiter'
            WHERE role NOT IN ('Admin', 'Mitarbeiter')
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE users
            SET status = 'Inaktiv'
            WHERE status IN ('Eingeschraenkt', 'Inaktiv')
            """
        )
    )


def downgrade() -> None:
    op.drop_column("users", "location")
    op.drop_column("users", "department")

