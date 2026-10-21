"""email_verification

E-Mail-Bestaetigung der Selbst-Registrierung.

Rueckwaertskompatibel: ``email_verification_required`` startet fuer ALLE
bestehenden Benutzer auf 0 (= keine Bestaetigung noetig). Nur Konten, die
danach ueber die Selbst-Registrierung entstehen, setzen den Wert auf 1.
Bestandsbenutzer werden dadurch nie ausgesperrt.

Revision ID: 20260420_0006
Revises: 20260418_0005
Create Date: 2026-04-20 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260420_0006"
down_revision = "20260418_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "email_verification_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("0"),
        ),
    )
    op.add_column(
        "users",
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "email_verification_tokens",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_external_id", sa.String(length=64), nullable=False),
        # Nur der SHA-256-Hash des Tokens — aus der DB laesst sich kein
        # gueltiger Bestaetigungslink rekonstruieren.
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "ix_email_verification_tokens_user_external_id",
        "email_verification_tokens",
        ["user_external_id"],
    )
    op.create_index(
        "ix_email_verification_tokens_token_hash",
        "email_verification_tokens",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_email_verification_tokens_token_hash", table_name="email_verification_tokens")
    op.drop_index(
        "ix_email_verification_tokens_user_external_id", table_name="email_verification_tokens"
    )
    op.drop_table("email_verification_tokens")
    op.drop_column("users", "email_verified_at")
    op.drop_column("users", "email_verification_required")
