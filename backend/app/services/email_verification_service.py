"""E-Mail-Bestaetigung der Selbst-Registrierung (Token-Lebenszyklus + Versand).

Sicherheitsmodell:
* Token aus ``secrets.token_urlsafe(32)`` (256 Bit Entropie).
* In der DB liegt ausschliesslich der SHA-256-Hash — ein DB-/Backup-Leak gibt
  keinen einloesbaren Link her.
* Einmalig verwendbar (``consumed_at``), zeitlich begrenzt (``expires_at``,
  Default 24 h), und bei erneutem Versand werden alle offenen Tokens des
  Benutzers sofort entwertet (``invalidated_at``).
* Der Bestaetigungslink wird ausschliesslich aus der in der Administration
  hinterlegten oeffentlichen Adresse bzw. ``FRONTEND_URL`` gebaut — nie aus
  einem Request-Header (Host-Header-Injection). In Produktion ist HTTPS Pflicht.
* Weder Token noch vollstaendige Bestaetigungs-URL werden jemals geloggt.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config.settings import Settings, get_settings
from ..database.models import EmailVerificationTokenRecord, UserRecord
from . import email_service, mail_config_service
from .email_service import MailDeliveryError, MailError, MailNotConfiguredError
from .email_templates import verification_email

logger = logging.getLogger("cloud_web.email_verification")

# Pfad der Bestaetigungsseite in der SPA (siehe frontend/src/routing).
VERIFICATION_PATH = "/registrierung-bestaetigen"


class VerificationConfigError(RuntimeError):
    """FRONTEND_URL fehlt oder ist fuer Produktion nicht sicher genug."""


class VerificationResult:
    """Ergebnis-Codes der Token-Einloesung."""

    VERIFIED = "verified"
    ALREADY_VERIFIED = "already_verified"
    INVALID = "invalid"
    EXPIRED = "expired"


@dataclass(frozen=True)
class SendOutcome:
    """Ergebnis eines Versandversuchs (fuer ehrliche UI-Rueckmeldung)."""

    sent: bool
    # Log-sicherer Grund bei ``sent is False`` (keine Zugangsdaten, kein Token).
    reason: str | None = None
    # True, wenn der Fehlschlag an fehlender/unvollstaendiger Konfiguration lag
    # (im Gegensatz zu einem echten Zustellfehler).
    not_configured: bool = False


def token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def expiry_hours(settings: Settings | None = None) -> int:
    settings = settings or get_settings()
    try:
        hours = int(settings.email_verification_expiry_hours)
    except (TypeError, ValueError):
        hours = 24
    return hours if 1 <= hours <= 24 * 14 else 24


def _as_aware_utc(value: datetime | None) -> datetime | None:
    """SQLite liefert DateTime-Spalten naiv zurueck — fuer Vergleiche anheben."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def frontend_base_url(settings: Settings | None = None, db: Session | None = None) -> str:
    """Validierte oeffentliche Basis-URL der SPA.

    Mit ``db`` hat die in der Administration gepflegte Adresse Vorrang vor
    ``FRONTEND_URL`` (siehe ``mail_config_service.public_base_url``). Wirft
    ``VerificationConfigError``, wenn keine brauchbare Adresse vorliegt oder sie
    — ausserhalb der Entwicklung — nicht ueber HTTPS laeuft. Lieber gar keine
    Mail als ein Bestaetigungslink ueber eine unverschluesselte Verbindung.
    """
    resolved = mail_config_service.public_base_url(db, settings or get_settings())
    if resolved.url is None:
        raise VerificationConfigError(resolved.problem or "Keine oeffentliche WWS-Adresse.")
    return resolved.url


def build_verification_url(
    raw_token: str, settings: Settings | None = None, db: Session | None = None
) -> str:
    """Baut den Bestaetigungslink. Das Ergebnis wird NIE geloggt."""
    return f"{frontend_base_url(settings, db)}{VERIFICATION_PATH}?token={quote(raw_token, safe='')}"


def configuration_problem(
    db: Session | None = None, settings: Settings | None = None
) -> str | None:
    """Grund, warum derzeit ueberhaupt keine Bestaetigungsmail moeglich ist.

    Haengt ausschliesslich an der Serverkonfiguration (SMTP + FRONTEND_URL),
    nie an einem konkreten Konto — der Wert ist damit kein Enumerations-Kanal.
    Log-sicher: enthaelt weder Zugangsdaten noch Tokens.

    Mit ``db`` wird die aufgeloeste Konfiguration (Admin vor ENV) geprueft,
    ohne nur die Umgebungsvariablen.
    """
    settings = settings or get_settings()
    hint = (
        mail_config_service.configuration_problem(db, settings)
        if db is not None
        else email_service.configuration_hint(settings)
    )
    if hint:
        return hint
    try:
        frontend_base_url(settings, db)
    except VerificationConfigError as exc:
        return str(exc)
    return None


def invalidate_open_tokens(db: Session, user_external_id: str) -> None:
    """Entwertet alle noch offenen Tokens eines Benutzers (vor Neuausstellung)."""
    db.execute(
        update(EmailVerificationTokenRecord)
        .where(
            EmailVerificationTokenRecord.user_external_id == user_external_id,
            EmailVerificationTokenRecord.consumed_at.is_(None),
            EmailVerificationTokenRecord.invalidated_at.is_(None),
        )
        .values(invalidated_at=datetime.now(UTC))
    )


def issue_token(db: Session, user: UserRecord, settings: Settings | None = None) -> str:
    """Stellt einen frischen Einmal-Token aus und liefert ihn im Klartext.

    Der Klartext verlaesst diese Funktion ausschliesslich in Richtung
    Mailversand — er wird weder persistiert noch geloggt.
    """
    settings = settings or get_settings()
    invalidate_open_tokens(db, user.external_id)
    raw_token = secrets.token_urlsafe(32)
    db.add(
        EmailVerificationTokenRecord(
            user_external_id=user.external_id,
            token_hash=token_hash(raw_token),
            # Adminwert vor ENV-Wert (mail_config_service kennt beide).
            expires_at=datetime.now(UTC)
            + timedelta(hours=mail_config_service.verification_expiry_hours(db, settings)),
        )
    )
    db.commit()
    return raw_token


def send_verification_email(
    db: Session,
    user: UserRecord,
    settings: Settings | None = None,
) -> SendOutcome:
    """Stellt einen Token aus und verschickt die Bestaetigungsmail.

    Liefert IMMER ein ``SendOutcome`` zurueck statt zu werfen — ein
    Mailproblem darf weder die Registrierung abbrechen noch die Anwendung
    abstuerzen lassen. Der Aufrufer entscheidet, wie er den Fehlschlag
    kommuniziert (er darf ihn nicht als Erfolg darstellen).
    """
    settings = settings or get_settings()

    # Konfiguration ZUERST pruefen: ohne Versandweg gar nicht erst einen Token
    # ausstellen (sonst entwerten wir einen evtl. noch gueltigen alten Link).
    # Quelle ist die aufgeloeste Konfiguration — Admin-Einstellungen vor ENV.
    resolved = mail_config_service.resolve(db, settings)
    if not resolved.usable:
        logger.warning("Bestaetigungsmail nicht versendet: %s", resolved.problem)
        return SendOutcome(sent=False, reason=resolved.problem, not_configured=True)
    try:
        base_url = frontend_base_url(settings, db)
    except VerificationConfigError as exc:
        logger.error("Bestaetigungsmail nicht versendet: %s", exc)
        return SendOutcome(sent=False, reason=str(exc), not_configured=True)

    raw_token = issue_token(db, user, settings)
    hours = mail_config_service.verification_expiry_hours(db, settings)
    subject, text_body, html_body = verification_email(
        name=user.name,
        verification_url=f"{base_url}{VERIFICATION_PATH}?token={quote(raw_token, safe='')}",
        expiry_hours=hours,
    )

    try:
        email_service.send_mail(
            to_email=user.email,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            settings=settings,
            config=resolved.config,
        )
    except MailNotConfiguredError as exc:  # Race: Konfig zwischenzeitlich weg.
        logger.warning("Bestaetigungsmail nicht versendet: %s", exc)
        mail_config_service.note_send_result(db, success=False, error=str(exc))
        return SendOutcome(sent=False, reason=str(exc), not_configured=True)
    except MailDeliveryError as exc:
        logger.error(
            "Bestaetigungsmail konnte nicht zugestellt werden (empfaenger=%s): %s",
            email_service.mask_email(user.email),
            exc,
        )
        mail_config_service.note_send_result(db, success=False, error=str(exc))
        return SendOutcome(sent=False, reason=str(exc))
    except MailError as exc:  # Defensive Klammer — nie die App killen.
        logger.exception("Unerwarteter Mailfehler beim Bestaetigungsversand")
        mail_config_service.note_send_result(db, success=False, error=str(exc))
        return SendOutcome(sent=False, reason=str(exc))
    except Exception as exc:  # noqa: BLE001 — Versand darf nie durchschlagen.
        logger.exception("Unerwarteter Fehler beim Bestaetigungsversand")
        return SendOutcome(sent=False, reason=type(exc).__name__)
    mail_config_service.note_send_result(db, success=True)

    logger.info(
        "Bestaetigungsmail versendet (user_id=%s, empfaenger=%s, gueltig=%sh)",
        user.external_id,
        email_service.mask_email(user.email),
        hours,
    )
    return SendOutcome(sent=True)


def mark_verified(db: Session, user: UserRecord) -> None:
    """Setzt den Bestaetigungszeitpunkt — ohne das Konto freizugeben.

    Die Admin-Freigabe (``is_active``/``status``) bleibt bewusst unberuehrt:
    E-Mail-Bestaetigung und Freigabe sind zwei getrennte Bedingungen.
    """
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)


def consume_token(db: Session, raw_token: str) -> tuple[str, UserRecord | None]:
    """Loest einen Bestaetigungstoken ein.

    Liefert ``(VerificationResult.*, user_or_None)``. Es wird bewusst nicht
    unterschieden, ob ein Token nie existiert hat oder bereits verbraucht ist
    — beides ist ``INVALID`` (keine Account-Enumeration).
    """
    candidate = (raw_token or "").strip()
    if not candidate:
        return VerificationResult.INVALID, None

    record = db.scalar(
        select(EmailVerificationTokenRecord).where(
            EmailVerificationTokenRecord.token_hash == token_hash(candidate)
        )
    )
    if record is None or record.consumed_at is not None or record.invalidated_at is not None:
        return VerificationResult.INVALID, None

    user = db.scalar(
        select(UserRecord).where(UserRecord.external_id == record.user_external_id)
    )
    if user is None:
        return VerificationResult.INVALID, None

    expires_at = _as_aware_utc(record.expires_at)
    if expires_at is None or expires_at <= datetime.now(UTC):
        return VerificationResult.EXPIRED, user

    already = user.email_verified_at is not None
    record.consumed_at = datetime.now(UTC)
    mark_verified(db, user)
    db.commit()
    return (VerificationResult.ALREADY_VERIFIED if already else VerificationResult.VERIFIED), user


def cleanup_expired_tokens(db: Session, *, older_than_days: int = 30) -> int:
    """Raeumt alte/verbrauchte Tokens auf (Startup-Job)."""
    from sqlalchemy import delete

    cutoff = datetime.now(UTC) - timedelta(days=max(1, older_than_days))
    result = db.execute(
        delete(EmailVerificationTokenRecord).where(
            EmailVerificationTokenRecord.expires_at < cutoff
        )
    )
    db.commit()
    deleted = int(result.rowcount or 0)
    if deleted:
        logger.info("E-Mail-Verifizierung: %s abgelaufene Tokens entfernt", deleted)
    return deleted
