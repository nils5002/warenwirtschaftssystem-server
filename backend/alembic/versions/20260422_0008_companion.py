"""companion app: device sessions, pairing requests, passkeys

Rueckwaertskompatibel: Alle Tabellen starten leer, ``users.companion_enabled``
hat den Default 0. Ohne bewusste Aktivierung durch den Benutzer aendert sich
am bestehenden Desktop- und Mobile-Login nichts.

Revision ID: 20260422_0008
Revises: 20260421_0007
Create Date: 2026-04-22 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260422_0008"
down_revision = "20260421_0007"
branch_labels = None
depends_on = None


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("companion_enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
    )
    op.create_table(
        "companion_devices",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("user_external_id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("platform", sa.String(length=120), nullable=True),
        # Nur SHA-256-Hashes des Geraete-Secrets, nie das Secret selbst.
        sa.Column("secret_hash", sa.String(length=64), nullable=True),
        sa.Column("previous_secret_hash", sa.String(length=64), nullable=True),
        sa.Column("secret_rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.String(length=40), nullable=True),
        sa.Column("unlocked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("webauthn_challenge", sa.String(length=255), nullable=True),
        sa.Column("webauthn_challenge_purpose", sa.String(length=16), nullable=True),
        sa.Column("webauthn_challenge_expires_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_companion_devices_external_id", "companion_devices", ["external_id"], unique=True)
    op.create_index("ix_companion_devices_user_external_id", "companion_devices", ["user_external_id"])
    op.create_index("ix_companion_devices_secret_hash", "companion_devices", ["secret_hash"])
    op.create_index(
        "ix_companion_devices_previous_secret_hash", "companion_devices", ["previous_secret_hash"]
    )

    op.create_table(
        "companion_pairing_requests",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("external_id", sa.String(length=64), nullable=False, unique=True),
        sa.Column("user_external_id", sa.String(length=64), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claim_hash", sa.String(length=64), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("match_code", sa.String(length=8), nullable=True),
        sa.Column("device_name", sa.String(length=120), nullable=True),
        sa.Column("device_platform", sa.String(length=120), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("device_external_id", sa.String(length=64), nullable=True),
        *_timestamps(),
    )
    op.create_index(
        "ix_companion_pairing_requests_external_id", "companion_pairing_requests", ["external_id"], unique=True
    )
    op.create_index(
        "ix_companion_pairing_requests_user_external_id", "companion_pairing_requests", ["user_external_id"]
    )
    op.create_index(
        "ix_companion_pairing_requests_code_hash", "companion_pairing_requests", ["code_hash"], unique=True
    )
    op.create_index(
        "ix_companion_pairing_requests_claim_hash", "companion_pairing_requests", ["claim_hash"]
    )

    op.create_table(
        "companion_passkeys",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_external_id", sa.String(length=64), nullable=False),
        sa.Column("device_external_id", sa.String(length=64), nullable=False),
        sa.Column("credential_id", sa.String(length=512), nullable=False, unique=True),
        sa.Column("public_key", sa.Text(), nullable=False),
        sa.Column("sign_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("transports", sa.String(length=120), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        *_timestamps(),
    )
    op.create_index("ix_companion_passkeys_user_external_id", "companion_passkeys", ["user_external_id"])
    op.create_index("ix_companion_passkeys_device_external_id", "companion_passkeys", ["device_external_id"])
    op.create_index("ix_companion_passkeys_credential_id", "companion_passkeys", ["credential_id"], unique=True)


def downgrade() -> None:
    op.drop_table("companion_passkeys")
    op.drop_table("companion_pairing_requests")
    op.drop_table("companion_devices")
    op.drop_column("users", "companion_enabled")
