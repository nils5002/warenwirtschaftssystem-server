"""Schlanker, wiederverwendbarer SMTP-Mailservice.

Bewusst ohne neue Dependency (Standardbibliothek ``smtplib``/``email``) und
ohne eigene Queue/Retry-Infrastruktur — der Versand laeuft synchron im
Request und meldet Erfolg/Misserfolg ehrlich an den Aufrufer zurueck.

Eiserne Regeln:
* Konfiguration ausschliesslich serverseitig (ENV / Portainer-Stack).
* Zugangsdaten tauchen NIE in Logs oder HTTP-Antworten auf.
* TLS wird mit ``ssl.create_default_context()`` geprueft (Zertifikat +
  Hostname). Ein unverschluesselter Versand ist ausserhalb von Dev-Umgebungen
  blockiert.
* Ein Versandfehler wirft ``MailDeliveryError`` — er darf die Anwendung nie
  abstuerzen lassen, und der Aufrufer darf einen Fehlschlag nicht als Erfolg
  darstellen.
"""
from __future__ import annotations

import logging
import re
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr

from ..config.settings import Settings, get_settings

logger = logging.getLogger("cloud_web.email")

# Umgebungen, in denen unverschluesselter SMTP-Versand (``SMTP_SECURITY=none``)
# erlaubt ist — z. B. gegen einen lokalen Test-Relay wie MailHog.
_DEV_ENVIRONMENTS = {"development", "dev", "local", "test", "testing"}

SECURITY_STARTTLS = "starttls"
SECURITY_SSL = "ssl"
SECURITY_NONE = "none"
_VALID_SECURITY = {SECURITY_STARTTLS, SECURITY_SSL, SECURITY_NONE}


class MailError(RuntimeError):
    """Basisfehler des Mailversands (traegt nie Zugangsdaten)."""


class MailNotConfiguredError(MailError):
    """SMTP ist nicht aktiviert oder unvollstaendig konfiguriert."""


class MailDeliveryError(MailError):
    """Der Versand wurde versucht, ist aber fehlgeschlagen."""


@dataclass(frozen=True)
class MailConfig:
    host: str
    port: int
    username: str | None
    password: str | None
    from_email: str
    from_name: str
    security: str
    timeout: int

    @property
    def sender(self) -> str:
        return formataddr((self.from_name, self.from_email)) if self.from_name else self.from_email


def is_dev_environment(settings: Settings) -> bool:
    return (settings.app_env or "").strip().lower() in _DEV_ENVIRONMENTS


def build_config(
    *,
    host: str | None,
    port: object,
    security: str | None,
    username: str | None,
    password: str | None,
    from_email: str | None,
    from_name: str | None,
    timeout_seconds: object,
    allow_plain: bool,
    labels: tuple[str, str, str, str] = ("SMTP_HOST", "SMTP_FROM_EMAIL", "SMTP_PORT", "SMTP_SECURITY"),
) -> MailConfig:
    """Validiert SMTP-Rohwerte und baut daraus eine ``MailConfig``.

    Gemeinsame Validierung fuer BEIDE Konfigurationsquellen (Portainer-ENV und
    die in der Adminoberflaeche gepflegten Werte) — so gelten ueberall exakt
    dieselben Regeln, insbesondere das Verbot von Klartext-SMTP ausserhalb der
    Entwicklung. ``labels`` passt die Feldnamen der Fehlermeldung an die Quelle
    an. Die Meldungen sind log- und UI-sicher: nie Passwort, nie Benutzername.
    """
    host_label, from_label, port_label, security_label = labels
    host_value = (host or "").strip()
    from_value = (from_email or "").strip()
    missing = [
        name
        for name, value in ((host_label, host_value), (from_label, from_value))
        if not value
    ]
    if missing:
        raise MailNotConfiguredError(f"SMTP unvollstaendig konfiguriert: {', '.join(missing)} fehlt.")

    security_value = (security or SECURITY_STARTTLS).strip().lower()
    if security_value not in _VALID_SECURITY:
        raise MailNotConfiguredError(
            f"{security_label}='{security_value}' ist ungueltig (erlaubt: starttls, ssl, none)."
        )
    if security_value == SECURITY_NONE and not allow_plain:
        # Kein Klartext-Versand in Produktion: Zugangsdaten und Mailinhalt
        # wuerden sonst ungeschuetzt uebertragen.
        raise MailNotConfiguredError(
            f"{security_label}=none ist ausserhalb der Entwicklung nicht erlaubt "
            "(starttls oder ssl verwenden)."
        )

    try:
        port_value = int(port)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise MailNotConfiguredError(f"{port_label} ist keine gueltige Zahl.") from exc
    if not 1 <= port_value <= 65535:
        raise MailNotConfiguredError(f"{port_label} liegt ausserhalb des gueltigen Bereichs.")

    username_value = (username or "").strip() or None
    password_value = password or None
    if username_value and not password_value:
        raise MailNotConfiguredError(
            "Benutzername gesetzt, aber kein Passwort hinterlegt."
        )

    try:
        timeout_value = int(timeout_seconds)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        timeout_value = 15

    return MailConfig(
        host=host_value,
        port=port_value,
        username=username_value,
        password=password_value,
        from_email=from_value,
        from_name=(from_name or "").strip(),
        security=security_value,
        timeout=max(1, min(timeout_value, 120)),
    )


def load_config(settings: Settings | None = None) -> MailConfig:
    """Liest + validiert die SMTP-Konfiguration aus den Umgebungsvariablen.

    Wirft ``MailNotConfiguredError`` mit einer Begruendung, die gefahrlos
    geloggt werden kann (keine Zugangsdaten, keine Passwortlaenge, nichts
    Ableitbares).
    """
    settings = settings or get_settings()
    if not settings.smtp_enabled:
        raise MailNotConfiguredError("SMTP ist deaktiviert (SMTP_ENABLED=false).")

    return build_config(
        host=settings.smtp_host,
        port=settings.smtp_port,
        security=settings.smtp_security,
        username=settings.smtp_username,
        password=settings.smtp_password,
        from_email=settings.smtp_from_email,
        from_name=settings.smtp_from_name,
        timeout_seconds=settings.smtp_timeout_seconds,
        allow_plain=is_dev_environment(settings),
    )


def is_configured(settings: Settings | None = None) -> bool:
    """True, wenn ein Versand grundsaetzlich moeglich waere (ohne Verbindung)."""
    try:
        load_config(settings)
    except MailNotConfiguredError:
        return False
    return True


def configuration_hint(settings: Settings | None = None) -> str | None:
    """Begruendung, warum kein Versand moeglich ist (oder None). Log-sicher."""
    try:
        load_config(settings)
    except MailNotConfiguredError as exc:
        return str(exc)
    return None


def _build_message(
    config: MailConfig,
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None,
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = config.sender
    message["To"] = to_email
    message["Subject"] = subject
    # Auto-Responder (Abwesenheitsnotizen) unterdruecken — es handelt sich um
    # eine rein transaktionale Nachricht.
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")
    return message


def _connect(config: MailConfig) -> smtplib.SMTP:
    """Baut die (ggf. verschluesselte) SMTP-Verbindung auf.

    ``create_default_context`` prueft Zertifikatskette UND Hostname — ein
    Downgrade auf ungeprueftes TLS findet nicht statt.
    """
    if config.security == SECURITY_SSL:
        context = ssl.create_default_context()
        return smtplib.SMTP_SSL(config.host, config.port, timeout=config.timeout, context=context)

    client = smtplib.SMTP(config.host, config.port, timeout=config.timeout)
    if config.security == SECURITY_STARTTLS:
        try:
            client.starttls(context=ssl.create_default_context())
            client.ehlo()
        except Exception:
            try:
                client.close()
            except Exception:  # noqa: BLE001 — Aufraeumen darf nie maskieren.
                pass
            raise
    return client


def test_connection(config: MailConfig) -> None:
    """Prueft Verbindung + Anmeldung, ohne eine Mail zu verschicken.

    Wirft ``MailDeliveryError`` mit einer bereinigten Meldung. Technische
    SMTP-Details (Servertext, Zugangsdaten) bleiben im Serverlog bzw. werden
    gar nicht erst uebernommen.
    """
    try:
        client = _connect(config)
    except (OSError, smtplib.SMTPException) as exc:
        logger.error(
            "SMTP-Verbindungstest fehlgeschlagen (host=%s port=%s security=%s): %s",
            config.host,
            config.port,
            config.security,
            type(exc).__name__,
        )
        raise MailDeliveryError(
            "Verbindung zum SMTP-Server nicht moeglich (Host, Port oder Verschluesselung pruefen)."
        ) from exc
    try:
        if config.username and config.password:
            client.login(config.username, config.password)
    except smtplib.SMTPAuthenticationError as exc:
        logger.error("SMTP-Anmeldung abgelehnt (host=%s port=%s)", config.host, config.port)
        raise MailDeliveryError(
            "Der SMTP-Server hat die Anmeldung abgelehnt (Benutzername oder Passwort pruefen)."
        ) from exc
    except (OSError, smtplib.SMTPException) as exc:
        logger.error(
            "SMTP-Verbindungstest fehlgeschlagen (host=%s port=%s): %s",
            config.host,
            config.port,
            type(exc).__name__,
        )
        raise MailDeliveryError("Der SMTP-Server hat den Verbindungsaufbau abgebrochen.") from exc
    finally:
        try:
            client.quit()
        except Exception:  # noqa: BLE001
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass
    logger.info("SMTP-Verbindungstest erfolgreich (host=%s, port=%s)", config.host, config.port)


def send_mail(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
    settings: Settings | None = None,
    config: MailConfig | None = None,
) -> None:
    """Versendet eine Mail. Wirft bei Fehlschlag, liefert sonst still zurueck.

    ``config`` hat Vorrang (aufgeloeste Admin-/ENV-Konfiguration); ohne sie
    wird aus den Umgebungsvariablen geladen. Es wird bewusst NICHT der
    Mailinhalt geloggt (er kann personenbezogene Daten oder — wie beim
    Bestaetigungslink — einen Token enthalten).
    """
    config = config or load_config(settings)
    recipient = (to_email or "").strip()
    if not recipient:
        raise MailDeliveryError("Kein Empfaenger angegeben.")

    message = _build_message(
        config,
        to_email=recipient,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )

    try:
        client = _connect(config)
    except (OSError, smtplib.SMTPException) as exc:
        # Nur Host/Port + Fehlerklasse — niemals Benutzername/Passwort.
        logger.error(
            "SMTP-Verbindung fehlgeschlagen (host=%s port=%s security=%s): %s",
            config.host,
            config.port,
            config.security,
            type(exc).__name__,
        )
        raise MailDeliveryError("SMTP-Verbindung fehlgeschlagen.") from exc

    try:
        if config.username and config.password:
            client.login(config.username, config.password)
        client.send_message(message)
    except smtplib.SMTPAuthenticationError as exc:
        logger.error(
            "SMTP-Anmeldung abgelehnt (host=%s port=%s) — Zugangsdaten pruefen.",
            config.host,
            config.port,
        )
        raise MailDeliveryError("SMTP-Anmeldung fehlgeschlagen.") from exc
    except (OSError, smtplib.SMTPException) as exc:
        logger.error(
            "SMTP-Versand fehlgeschlagen (host=%s port=%s): %s",
            config.host,
            config.port,
            type(exc).__name__,
        )
        raise MailDeliveryError("SMTP-Versand fehlgeschlagen.") from exc
    finally:
        try:
            client.quit()
        except Exception:  # noqa: BLE001 — Verbindungsabbau darf nie werfen.
            try:
                client.close()
            except Exception:  # noqa: BLE001
                pass

    logger.info("E-Mail versendet (host=%s, empfaenger=%s)", config.host, mask_email(recipient))


_EMAIL_SPLIT = re.compile(r"^([^@]+)@(.+)$")


def mask_email(value: str | None) -> str:
    """Kuerzt eine Adresse fuer Logs: ``max.mustermann@example.com`` -> ``m***@example.com``."""
    raw = (value or "").strip()
    if not raw:
        return "?"
    match = _EMAIL_SPLIT.match(raw)
    if not match:
        return "***"
    local, domain = match.group(1), match.group(2)
    head = local[0] if local else "*"
    return f"{head}***@{domain}"
