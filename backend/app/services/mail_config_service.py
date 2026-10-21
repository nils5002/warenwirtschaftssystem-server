"""Aufloesung der aktiven SMTP-Konfiguration + Registrierungsverfahren.

Dieses Modul ist die EINZIGE Stelle, die entscheidet, ob und womit das System
E-Mails verschickt, und ob eine Registrierung eine E-Mail-Bestaetigung
verlangt.

## Konfigurationsprioritaet (bewusst eindeutig, keine Mischformen)

1. **Adminkonfiguration** aus der Tabelle ``mail_settings`` — aber nur, wenn
   sie aktiviert, vollstaendig UND (falls ein Passwort hinterlegt ist)
   entschluesselbar ist.
2. **Umgebungsvariablen** (``SMTP_*``, Portainer-Stack) — unveraendertes
   bisheriges Verhalten.
3. Sonst: **SMTP deaktiviert**.

Eine unvollstaendige oder nicht entschluesselbare Adminkonfiguration faellt
NICHT still auf die ENV zurueck, solange der Admin sie aktiviert hat — sonst
wuerde unbemerkt mit einem anderen Absender verschickt. Stattdessen gilt die
Konfiguration als kaputt und wird als solche gemeldet.

## Registrierungsverfahren

``classic_admin_approval`` (Default, auch bei fehlendem Key) oder
``email_verification``. Der Default ist bewusst der klassische Ablauf: Ohne
funktionierenden Mailversand muss sich jeder weiterhin registrieren koennen.
Die Umschaltung auf ``email_verification`` ist immer eine bewusste
Adminentscheidung — sie passiert NIE automatisch, auch nicht nach einem
erfolgreichen SMTP-Test.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config.settings import Settings, get_settings
from ..database.models import MailSettingsRecord, SystemSettingRecord
from . import email_service, secret_store
from .email_service import MailConfig, MailNotConfiguredError

logger = logging.getLogger("cloud_web.mail_config")

# --- Registrierungsverfahren --------------------------------------------------
REGISTRATION_MODE_KEY = "registration_mode"
MODE_CLASSIC = "classic_admin_approval"
MODE_EMAIL_VERIFICATION = "email_verification"
VALID_MODES = (MODE_CLASSIC, MODE_EMAIL_VERIFICATION)

# --- Konfigurationsquellen ----------------------------------------------------
SOURCE_ADMIN = "admin"
SOURCE_ENV = "env"
SOURCE_NONE = "none"

# Platzhalter, der dem Frontend signalisiert "Passwort ist hinterlegt". Er
# verlaesst den Server nur in diese Richtung; kommt er zurueck, bleibt das
# gespeicherte Passwort unveraendert.
PASSWORD_PLACEHOLDER = "********"


@dataclass(frozen=True)
class ResolvedMail:
    """Aktiv verwendete Mailkonfiguration inkl. Herkunft."""

    config: MailConfig | None
    source: str
    # Log-/UI-sichere Begruendung, wenn ``config is None`` (nie Zugangsdaten).
    problem: str | None = None

    @property
    def usable(self) -> bool:
        return self.config is not None


def get_record(db: Session) -> MailSettingsRecord | None:
    """Liefert die (einzige) Adminkonfiguration oder None."""
    return db.scalar(select(MailSettingsRecord).order_by(MailSettingsRecord.id.asc()))


def _record_is_configured(record: MailSettingsRecord | None) -> bool:
    """Mindestangaben vorhanden? (Aktivierung wird separat geprueft.)"""
    if record is None:
        return False
    return bool((record.host or "").strip()) and bool((record.from_email or "").strip())


def _config_from_record(record: MailSettingsRecord, settings: Settings) -> MailConfig:
    """Baut eine MailConfig aus der Adminkonfiguration (inkl. Entschluesselung)."""
    password = None
    if record.password_encrypted:
        # Wirft SecretKeyMissingError/SecretDecryptionError — der Aufrufer
        # macht daraus eine sichtbare Fehlermeldung statt still weiterzulaufen.
        password = secret_store.decrypt(record.password_encrypted, settings)
    return email_service.build_config(
        host=record.host,
        port=record.port,
        security=record.security,
        username=record.username,
        password=password,
        from_email=record.from_email,
        from_name=record.from_name,
        timeout_seconds=record.timeout_seconds,
        allow_plain=email_service.is_dev_environment(settings),
        labels=("Hostname", "Absender-E-Mail", "Port", "Verschluesselung"),
    )


def resolve(db: Session, settings: Settings | None = None) -> ResolvedMail:
    """Ermittelt die aktive Konfiguration nach der dokumentierten Prioritaet."""
    settings = settings or get_settings()
    record = get_record(db)

    if record is not None and record.enabled:
        if not _record_is_configured(record):
            return ResolvedMail(
                None,
                SOURCE_ADMIN,
                "Die SMTP-Konfiguration in der Administration ist unvollstaendig "
                "(Hostname und Absender-E-Mail sind Pflicht).",
            )
        try:
            return ResolvedMail(_config_from_record(record, settings), SOURCE_ADMIN)
        except secret_store.SecretStoreError as exc:
            return ResolvedMail(None, SOURCE_ADMIN, str(exc))
        except MailNotConfiguredError as exc:
            return ResolvedMail(None, SOURCE_ADMIN, str(exc))

    # Keine aktivierte Adminkonfiguration -> Umgebungsvariablen versuchen.
    try:
        return ResolvedMail(email_service.load_config(settings), SOURCE_ENV)
    except MailNotConfiguredError as exc:
        # "Nicht konfiguriert" ist hier der Normalfall und kein Fehler: Das
        # System laeuft dann schlicht im klassischen Registrierungsmodus.
        if _record_is_configured(record):
            return ResolvedMail(
                None,
                SOURCE_NONE,
                "SMTP ist in der Administration hinterlegt, aber nicht aktiviert.",
            )
        return ResolvedMail(None, SOURCE_NONE, str(exc))


def configuration_problem(db: Session, settings: Settings | None = None) -> str | None:
    """Grund, warum aktuell nicht versendet werden kann (oder None)."""
    resolved = resolve(db, settings)
    return None if resolved.usable else resolved.problem


# --- Oeffentliche WWS-Adresse (Basis der Bestaetigungslinks) -------------------

_DEV_ENVIRONMENTS = {"development", "dev", "local", "test", "testing"}


class PublicUrlError(ValueError):
    """Oeffentliche Adresse fehlt oder ist (fuer diese Umgebung) unzulaessig."""


@dataclass(frozen=True)
class PublicBaseUrl:
    """Wirksame oeffentliche Adresse inkl. Herkunft (``admin``/``env``/``none``)."""

    url: str | None
    source: str
    problem: str | None = None


def validate_public_base_url(raw: str, settings: Settings | None = None, *, label: str) -> str:
    """Prueft eine oeffentliche Adresse und liefert sie normalisiert zurueck.

    Erlaubt ist nur ``scheme://host[:port][/pfad]`` — ohne Zugangsdaten, Query
    oder Fragment. Ausserhalb der Entwicklung ist HTTPS Pflicht: Ein
    Bestaetigungslink ueber eine unverschluesselte Verbindung wird nie erzeugt.
    """
    from urllib.parse import urlsplit

    settings = settings or get_settings()
    value = (raw or "").strip().rstrip("/")
    if not value:
        raise PublicUrlError(f"{label} ist nicht gesetzt.")
    try:
        parts = urlsplit(value)
        parts.port  # noqa: B018 — wirft bei ungueltigem Port
    except ValueError as exc:
        raise PublicUrlError(f"{label} ist keine gueltige URL.") from exc
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise PublicUrlError(f"{label} muss eine absolute http(s)-Adresse sein.")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise PublicUrlError(
            f"{label} darf weder Zugangsdaten noch Parameter (?, #) enthalten."
        )
    if any(ch.isspace() for ch in value):
        raise PublicUrlError(f"{label} darf keine Leerzeichen enthalten.")
    is_dev = (settings.app_env or "").strip().lower() in _DEV_ENVIRONMENTS
    if parts.scheme != "https" and not is_dev:
        raise PublicUrlError(f"{label} muss in Produktion mit https:// beginnen.")
    return value


def public_base_url(db: Session | None, settings: Settings | None = None) -> PublicBaseUrl:
    """Wirksame Basis fuer Bestaetigungslinks: Admin-Wert vor FRONTEND_URL.

    Eine gespeicherte, aber (z. B. nach Wechsel auf Produktion) unzulaessige
    Admin-Adresse faellt NICHT still auf die ENV zurueck, sondern wird als
    Problem gemeldet — sonst wuerden Links unbemerkt auf eine andere Adresse
    zeigen.
    """
    settings = settings or get_settings()
    record = get_record(db) if db is not None else None
    admin_value = (record.public_base_url or "").strip() if record is not None else ""
    if admin_value:
        try:
            return PublicBaseUrl(
                validate_public_base_url(admin_value, settings, label="Die oeffentliche WWS-Adresse"),
                SOURCE_ADMIN,
            )
        except PublicUrlError as exc:
            return PublicBaseUrl(None, SOURCE_ADMIN, str(exc))
    env_value = (settings.frontend_url or settings.base_url or "").strip()
    if not env_value:
        return PublicBaseUrl(
            None,
            SOURCE_NONE,
            "Keine oeffentliche WWS-Adresse hinterlegt — ohne sie kann kein "
            "Bestaetigungslink erzeugt werden.",
        )
    try:
        return PublicBaseUrl(
            validate_public_base_url(env_value, settings, label="FRONTEND_URL"), SOURCE_ENV
        )
    except PublicUrlError as exc:
        return PublicBaseUrl(None, SOURCE_ENV, str(exc))


def verification_expiry_hours(db: Session, settings: Settings | None = None) -> int:
    """Gueltigkeit der Bestaetigungslinks — Adminwert vor ENV-Wert."""
    settings = settings or get_settings()
    record = get_record(db)
    raw = record.verification_expiry_hours if record is not None else None
    if not raw:
        raw = settings.email_verification_expiry_hours
    try:
        hours = int(raw)
    except (TypeError, ValueError):
        hours = 24
    return hours if 1 <= hours <= 24 * 14 else 24


# --- Registrierungsverfahren --------------------------------------------------


def get_registration_mode(db: Session) -> str:
    """Aktives Verfahren. Fehlender/kaputter Wert = klassischer Ablauf.

    Der Default ist die sichere Seite: Ohne ausdrueckliche Entscheidung des
    Admins wird nie eine E-Mail-Bestaetigung verlangt — sonst koennte sich bei
    fehlendem SMTP niemand mehr registrieren.
    """
    record = db.scalar(
        select(SystemSettingRecord).where(SystemSettingRecord.key == REGISTRATION_MODE_KEY)
    )
    if record is None:
        return MODE_CLASSIC
    value = (record.value or "").strip().lower()
    return value if value in VALID_MODES else MODE_CLASSIC


def email_verification_active(db: Session) -> bool:
    """True, wenn NEUE Registrierungen eine E-Mail-Bestaetigung verlangen."""
    return get_registration_mode(db) == MODE_EMAIL_VERIFICATION


def set_registration_mode(db: Session, mode: str) -> str:
    """Setzt das Verfahren (reine Persistenz — Vorbedingungen prueft die Route)."""
    value = (mode or "").strip().lower()
    if value not in VALID_MODES:
        raise ValueError(f"Unbekanntes Registrierungsverfahren: {mode!r}")
    record = db.scalar(
        select(SystemSettingRecord).where(SystemSettingRecord.key == REGISTRATION_MODE_KEY)
    )
    if record is None:
        db.add(SystemSettingRecord(key=REGISTRATION_MODE_KEY, value=value))
    else:
        record.value = value
    db.commit()
    return value


@dataclass(frozen=True)
class ModeRequirements:
    """Pruefergebnis: Darf auf "E-Mail-Bestaetigung" umgestellt werden?"""

    ok: bool
    # Offene Punkte in Klartext (fuer die Adminoberflaeche).
    missing: tuple[str, ...]


def email_verification_requirements(db: Session, settings: Settings | None = None) -> ModeRequirements:
    """Vorbedingungen fuer Modus B.

    Alle vier Punkte aus der Fachvorgabe: konfiguriert, aktiviert,
    Verbindungstest erfolgreich, Test-E-Mail vom Server angenommen. Der
    Verbindungstest muss zum AKTUELLEN Stand passen — wird die Konfiguration
    geaendert, werden die Testergebnisse zurueckgesetzt (siehe Route).
    """
    settings = settings or get_settings()
    resolved = resolve(db, settings)
    record = get_record(db)
    missing: list[str] = []

    if not resolved.usable:
        missing.append(resolved.problem or "SMTP ist nicht einsatzbereit.")
        return ModeRequirements(False, tuple(missing))

    if resolved.source == SOURCE_ENV:
        # ENV-Konfiguration kann nicht ueber die Oberflaeche getestet werden —
        # der Testlauf wird trotzdem in mail_settings protokolliert, damit auch
        # dieser Weg freigeschaltet werden kann.
        pass

    if record is None or record.last_test_success is not True:
        missing.append("Es liegt kein erfolgreicher SMTP-Verbindungstest vor.")
    if record is None or record.test_mail_accepted_at is None:
        missing.append("Es wurde noch keine Test-E-Mail vom SMTP-Server angenommen.")

    return ModeRequirements(not missing, tuple(missing))


# --- Testergebnisse protokollieren --------------------------------------------


def _ensure_record(db: Session) -> MailSettingsRecord:
    record = get_record(db)
    if record is None:
        record = MailSettingsRecord()
        db.add(record)
        db.flush()
    return record


def note_test_result(db: Session, *, success: bool, error: str | None = None) -> None:
    """Haelt das Ergebnis eines Verbindungstests fest."""
    record = _ensure_record(db)
    record.last_test_at = datetime.now(UTC)
    record.last_test_success = success
    record.last_test_error = (error or None) if not success else None
    db.commit()


def note_send_result(
    db: Session, *, success: bool, error: str | None = None, was_test_mail: bool = False
) -> None:
    """Haelt das Ergebnis eines Versands fest (Test-Mail oder Fachmail)."""
    record = get_record(db)
    if record is None and not was_test_mail:
        # Bei reiner ENV-Konfiguration ohne Adminzeile wird nichts angelegt,
        # solange es nur um einen normalen Versand geht.
        return
    record = _ensure_record(db)
    record.last_send_at = datetime.now(UTC)
    record.last_send_success = success
    record.last_send_error = (error or None) if not success else None
    if success and was_test_mail:
        record.test_mail_accepted_at = datetime.now(UTC)
    db.commit()


def reset_test_results(record: MailSettingsRecord) -> None:
    """Verwirft alte Testergebnisse (nach einer Konfigurationsaenderung).

    Ohne das koennte ein Admin eine funktionierende Konfiguration testen,
    danach den Host aendern und Modus B mit einem Test aktivieren, der fuer
    eine ganz andere Konfiguration galt.
    """
    record.last_test_at = None
    record.last_test_success = None
    record.last_test_error = None
    record.test_mail_accepted_at = None
