"""mail_settings

Persistente, in der Adminoberflaeche gepflegte SMTP-Konfiguration.

Rueckwaertskompatibel: Die Tabelle startet leer. Solange keine Zeile existiert,
gilt unveraendert die bisherige Prioritaet "SMTP-Umgebungsvariablen, sonst
deaktiviert". Das Registrierungsverfahren liegt bewusst NICHT hier, sondern im
bestehenden Key/Value-Store ``system_settings`` (Key ``registration_mode``) —
fehlender Key = klassischer Ablauf mit Admin-Freigabe.

Revision ID: 20260421_0007
Revises: 20260420_0006
Create Date: 2026-04-21 09:00:00
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "20260421_0007"
down_revision = "20260420_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_settings",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("host", sa.String(length=255), nullable=True),
        sa.Column("port", sa.Integer(), nullable=False, server_default="587"),
        sa.Column("security", sa.String(length=16), nullable=False, server_default="starttls"),
        sa.Column("username", sa.String(length=255), nullable=True),
        # Ausschliesslich Fernet-Chiffretext — nie Klartext.
        sa.Column("password_encrypted", sa.Text(), nullable=True),
        sa.Column("from_email", sa.String(length=255), nullable=True),
        sa.Column("from_name", sa.String(length=120), nullable=True),
        sa.Column("timeout_seconds", sa.Integer(), nullable=False, server_default="15"),
        sa.Column(
            "verification_expiry_hours", sa.Integer(), nullable=False, server_default="24"
        ),
        sa.Column("last_test_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_test_success", sa.Boolean(), nullable=True),
        sa.Column("last_test_error", sa.String(length=500), nullable=True),
        sa.Column("last_send_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_send_success", sa.Boolean(), nullable=True),
        sa.Column("last_send_error", sa.String(length=500), nullable=True),
        sa.Column("test_mail_accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_by", sa.String(length=64), nullable=True),
        # Oeffentliche WWS-Adresse fuer Bestaetigungslinks (NULL = FRONTEND_URL).
        sa.Column("public_base_url", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("mail_settings")
