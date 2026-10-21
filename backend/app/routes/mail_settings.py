"""Admin-Endpunkte „E-Mail-Einstellungen" (SMTP + Registrierungsverfahren).

Alle Endpunkte sind ausschliesslich fuer Admins erreichbar: geprueft wird
serverseitig sowohl die normalisierte Rolle als auch das Recht
``mail.manage`` — der UI-Filter im Frontend ist reiner Komfort.

Antworten enthalten NIEMALS ein SMTP-Passwort (weder Klartext noch
Chiffretext). Dass ein Passwort hinterlegt ist, wird nur als Boolean
mitgeteilt.
"""
from __future__ import annotations

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..database.models import MailSettingsRecord
from ..database.session import get_db
from ..routes.dependencies import (
    AccessContext,
    get_access_context,
    require_csrf_header,
    require_permission,
    require_roles,
)
from ..schemas.mail_settings import (
    MailSendTestPayload,
    MailSendTestResponse,
    MailSettingsPayload,
    MailSettingsResponse,
    MailStatusResponse,
    MailTestConnectionResponse,
    RegistrationModePayload,
    RegistrationModeResponse,
)
from ..services import email_service
from ..services import mail_config_service as mail_config
from ..services import secret_store
from ..services import security_event_service as sec
from ..services.auth_service import is_valid_email
from ..services.email_service import MailDeliveryError, MailNotConfiguredError
from ..services.email_templates import smtp_test_email
from ..services.rate_limiter import (
    RateLimiter,
    client_ip,
    mail_settings_change_rate_limiter,
    mail_test_rate_limiter,
    too_many_requests,
)

router = APIRouter(prefix="/api/admin/email", tags=["Mail Settings"])
logger = logging.getLogger("cloud_web.mail_settings")


def _require_mail_admin(context: AccessContext, db: Session) -> None:
    """Serverseitige Rechtepruefung: Rolle *und* Recht muessen stimmen.

    Die Rolle ist der harte Riegel: Selbst wenn ``mail.manage`` im Rollen-
    editor versehentlich einer anderen Rolle gewaehrt wird, bleibt der Zugriff
    Admins vorbehalten. (Die Authentifizierung selbst — 401 — erledigt
    ``get_access_context``.)
    """
    require_roles(context, "admin")
    require_permission(context, db, "mail.manage")


def _require_mail_admin_write(
    request: Request, context: AccessContext, db: Session, limiter: RateLimiter
) -> None:
    """Wie ``_require_mail_admin`` plus CSRF-Header und Rate-Limit."""
    _require_mail_admin(context, db)
    require_csrf_header(request)
    _rate_limit(request, context, limiter)


def _rate_limit(request: Request, context: AccessContext, limiter: RateLimiter) -> None:
    """Bremst Test-Aktionen und Konfigurationsaenderungen pro Admin + IP."""
    key = f"{context.user_id or 'unknown'}|{client_ip(request)}"
    blocked = limiter.is_blocked(key)
    if blocked.limited:
        raise too_many_requests(blocked.retry_after)
    limiter.record_attempt(key)


def _fmt(value: datetime | None) -> str | None:
    return value.strftime("%d.%m.%Y %H:%M") if value else None


def _to_response(record: MailSettingsRecord | None) -> MailSettingsResponse:
    if record is None:
        return MailSettingsResponse()
    return MailSettingsResponse(
        enabled=bool(record.enabled),
        host=record.host,
        port=int(record.port or 587),
        security=record.security if record.security in {"starttls", "ssl", "none"} else "starttls",
        username=record.username,
        # Nur die Tatsache, nie der Wert.
        passwordSet=bool(record.password_encrypted),
        fromEmail=record.from_email,
        fromName=record.from_name,
        timeoutSeconds=int(record.timeout_seconds or 15),
        verificationExpiryHours=int(record.verification_expiry_hours or 24),
        publicBaseUrl=record.public_base_url or None,
        updatedAt=_fmt(record.updated_at),
        updatedBy=record.updated_by,
    )


@router.get("/settings", response_model=MailSettingsResponse)
def get_mail_settings(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MailSettingsResponse:
    _require_mail_admin(context, db)
    return _to_response(mail_config.get_record(db))


@router.put("/settings", response_model=MailSettingsResponse)
def update_mail_settings(
    payload: MailSettingsPayload,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MailSettingsResponse:
    """Speichert die SMTP-Konfiguration.

    Das Passwort wird ausschliesslich verschluesselt abgelegt. Ein leeres
    Passwortfeld laesst ein bereits gespeichertes Secret unveraendert — nur
    ``clearPassword`` entfernt es bewusst.
    """
    _require_mail_admin_write(request, context, db, mail_settings_change_rate_limiter)

    host = (payload.host or "").strip()
    from_email = (payload.fromEmail or "").strip()
    if payload.enabled and (not host or not from_email):
        raise HTTPException(
            status_code=400,
            detail="Zum Aktivieren werden mindestens Hostname und Absender-E-Mail benötigt.",
        )
    if from_email and not is_valid_email(from_email):
        raise HTTPException(status_code=400, detail="Bitte eine gültige Absender-E-Mail angeben.")
    if payload.security == "none" and not email_service.is_dev_environment(
        mail_config.get_settings()
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Unverschlüsselter SMTP-Versand ist im Produktivbetrieb nicht erlaubt. "
                "Bitte STARTTLS oder SSL/TLS wählen."
            ),
        )

    public_base_url: str | None = None
    if payload.publicBaseUrl is not None and payload.publicBaseUrl.strip():
        try:
            public_base_url = mail_config.validate_public_base_url(
                payload.publicBaseUrl,
                mail_config.get_settings(),
                label="Die öffentliche WWS-Adresse",
            )
        except mail_config.PublicUrlError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    record = mail_config.get_record(db)
    if record is None:
        record = MailSettingsRecord()
        db.add(record)

    # Vorher merken, ob sich etwas Verbindungsrelevantes ändert — dann sind
    # alte Testergebnisse nicht mehr aussagekräftig.
    connection_before = (
        record.host,
        record.port,
        record.security,
        record.username,
        record.from_email,
        bool(record.password_encrypted),
    )

    new_password_set: bool | None = None
    if payload.clearPassword:
        record.password_encrypted = None
        new_password_set = False
    elif payload.password:
        # Der Platzhalter aus der Oberfläche darf nie als echtes Passwort
        # gespeichert werden (sonst würde ein Formular-Roundtrip das Secret
        # durch Sternchen ersetzen).
        if payload.password.strip() == mail_config.PASSWORD_PLACEHOLDER:
            pass
        else:
            try:
                record.password_encrypted = secret_store.encrypt(payload.password)
            except secret_store.SecretKeyMissingError as exc:
                # Kontrolliert ablehnen statt im Klartext zu speichern.
                raise HTTPException(status_code=409, detail=str(exc)) from exc
            new_password_set = True

    record.enabled = bool(payload.enabled)
    record.host = host or None
    record.port = int(payload.port)
    record.security = payload.security
    record.username = (payload.username or "").strip() or None
    record.from_email = from_email or None
    record.from_name = (payload.fromName or "").strip() or None
    record.timeout_seconds = int(payload.timeoutSeconds)
    record.verification_expiry_hours = int(payload.verificationExpiryHours)
    if payload.publicBaseUrl is not None:
        # "" entfernt den Admin-Wert bewusst -> FRONTEND_URL gilt wieder.
        record.public_base_url = public_base_url
    record.updated_by = context.user_id

    connection_after = (
        record.host,
        record.port,
        record.security,
        record.username,
        record.from_email,
        bool(record.password_encrypted),
    )
    if connection_before != connection_after or new_password_set:
        # Alte Testergebnisse verwerfen: Sie galten für eine andere
        # Konfiguration und dürfen die Freischaltung von Modus B nicht tragen.
        mail_config.reset_test_results(record)

    db.commit()
    db.refresh(record)

    sec.record_event(
        db, sec.MAIL_SETTINGS_UPDATED, request=request, success=True,
        user_id=context.user_id, actor_id=context.user_id,
        meta={
            # Bewusst nur unkritische Metadaten — kein Benutzername, kein Passwort.
            "enabled": record.enabled,
            "security": record.security,
            "passwordSet": bool(record.password_encrypted),
            "publicBaseUrlSet": bool(record.public_base_url),
            "testResultsReset": connection_before != connection_after or bool(new_password_set),
        },
    )
    logger.info(
        "SMTP-Einstellungen gespeichert (aktiv=%s, security=%s, passwort_hinterlegt=%s)",
        record.enabled,
        record.security,
        bool(record.password_encrypted),
    )
    return _to_response(record)


@router.get("/status", response_model=MailStatusResponse)
def get_mail_status(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MailStatusResponse:
    """Systemstatus fuer die Statuskarte (inkl. Freischalt-Vorbedingungen)."""
    _require_mail_admin(context, db)
    settings = mail_config.get_settings()
    record = mail_config.get_record(db)
    resolved = mail_config.resolve(db, settings)
    requirements = mail_config.email_verification_requirements(db, settings)

    if resolved.usable:
        if record is not None and record.last_send_success is False:
            state = "send_failed"
        elif record is not None and record.last_test_success is False:
            state = "connection_failed"
        elif record is not None and record.last_test_success is True:
            state = "test_succeeded"
        else:
            state = "configured"
    elif record is not None and (record.host or record.from_email) and not record.enabled:
        state = "disabled"
    else:
        state = "not_configured"

    public_url = mail_config.public_base_url(db, settings)

    password_readable: bool | None = None
    if record is not None and record.password_encrypted:
        try:
            secret_store.decrypt(record.password_encrypted, settings)
            password_readable = True
        except secret_store.SecretStoreError:
            password_readable = False

    return MailStatusResponse(
        state=state,
        source=resolved.source,
        canSend=resolved.usable,
        problem=resolved.problem,
        lastTestAt=_fmt(record.last_test_at) if record else None,
        lastTestSuccess=record.last_test_success if record else None,
        lastTestError=record.last_test_error if record else None,
        lastSendAt=_fmt(record.last_send_at) if record else None,
        lastSendSuccess=record.last_send_success if record else None,
        lastSendError=record.last_send_error if record else None,
        testMailAcceptedAt=_fmt(record.test_mail_accepted_at) if record else None,
        registrationMode=mail_config.get_registration_mode(db),
        registrationEnabled=sec.registration_enabled(db),
        canEnableVerification=requirements.ok,
        verificationBlockers=list(requirements.missing),
        secretStorageAvailable=secret_store.is_available(settings),
        secretStorageHint=secret_store.availability_hint(settings),
        secretKeySource=secret_store.key_source(settings),
        passwordReadable=password_readable,
        frontendUrlReady=public_url.url is not None,
        frontendUrlHint=public_url.problem,
        publicBaseUrl=public_url.url,
        publicBaseUrlSource=public_url.source,
        verificationExpiryHours=mail_config.verification_expiry_hours(db, settings),
        plainSmtpAllowed=email_service.is_dev_environment(settings),
    )


@router.post("/test-connection", response_model=MailTestConnectionResponse)
def test_mail_connection(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MailTestConnectionResponse:
    """Prueft Verbindung + Anmeldung gegen den konfigurierten SMTP-Server."""
    _require_mail_admin_write(request, context, db, mail_test_rate_limiter)

    resolved = mail_config.resolve(db, mail_config.get_settings())
    if not resolved.usable or resolved.config is None:
        mail_config.note_test_result(db, success=False, error=resolved.problem)
        sec.record_event(
            db, sec.MAIL_TEST_CONNECTION, request=request, severity="warning",
            user_id=context.user_id, actor_id=context.user_id, reason="not_configured",
        )
        return MailTestConnectionResponse(
            success=False,
            message=resolved.problem or "SMTP ist nicht einsatzbereit.",
        )

    try:
        email_service.test_connection(resolved.config)
    except MailDeliveryError as exc:
        message = str(exc)
        mail_config.note_test_result(db, success=False, error=message)
        sec.record_event(
            db, sec.MAIL_TEST_CONNECTION, request=request, severity="warning",
            user_id=context.user_id, actor_id=context.user_id, reason="connection_failed",
        )
        # "Anmeldung abgelehnt" heisst: die Verbindung selbst stand bereits.
        authentication_stage = "Anmeldung" in message
        return MailTestConnectionResponse(
            success=False, message=message, connectionOk=authentication_stage
        )

    mail_config.note_test_result(db, success=True)
    sec.record_event(
        db, sec.MAIL_TEST_CONNECTION, request=request, success=True,
        user_id=context.user_id, actor_id=context.user_id,
    )
    return MailTestConnectionResponse(
        success=True,
        message="SMTP-Verbindung und Anmeldung erfolgreich.",
        connectionOk=True,
        authenticationOk=bool(resolved.config.username),
    )


@router.post("/send-test", response_model=MailSendTestResponse)
def send_test_mail(
    payload: MailSendTestPayload,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MailSendTestResponse:
    """Verschickt eine echte Test-E-Mail an eine frei waehlbare Adresse."""
    _require_mail_admin_write(request, context, db, mail_test_rate_limiter)

    recipient = payload.recipient.strip().lower()
    if not is_valid_email(recipient):
        raise HTTPException(status_code=400, detail="Bitte eine gültige E-Mail-Adresse angeben.")

    resolved = mail_config.resolve(db, mail_config.get_settings())
    if not resolved.usable or resolved.config is None:
        mail_config.note_send_result(
            db, success=False, error=resolved.problem, was_test_mail=True
        )
        sec.record_event(
            db, sec.MAIL_TEST_SEND, request=request, severity="warning",
            user_id=context.user_id, actor_id=context.user_id, reason="not_configured",
        )
        return MailSendTestResponse(
            success=False, message=resolved.problem or "SMTP ist nicht einsatzbereit."
        )

    subject, text_body, html_body = smtp_test_email()
    try:
        email_service.send_mail(
            to_email=recipient,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
            config=resolved.config,
        )
    except (MailDeliveryError, MailNotConfiguredError) as exc:
        message = str(exc)
        mail_config.note_send_result(db, success=False, error=message, was_test_mail=True)
        sec.record_event(
            db, sec.MAIL_TEST_SEND, request=request, severity="warning",
            user_id=context.user_id, actor_id=context.user_id, reason="send_failed",
        )
        return MailSendTestResponse(success=False, message=message)
    except Exception:  # noqa: BLE001 — ein Testversand darf nie 500 werfen.
        logger.exception("Unerwarteter Fehler beim Versand der Test-E-Mail")
        mail_config.note_send_result(
            db, success=False, error="Unerwarteter Fehler beim Versand.", was_test_mail=True
        )
        return MailSendTestResponse(
            success=False, message="Unerwarteter Fehler beim Versand. Bitte Serverlog prüfen."
        )

    mail_config.note_send_result(db, success=True, was_test_mail=True)
    sec.record_event(
        db, sec.MAIL_TEST_SEND, request=request, success=True,
        user_id=context.user_id, actor_id=context.user_id,
        # Empfaenger nur maskiert ins Audit-Log.
        meta={"recipient": email_service.mask_email(recipient)},
    )
    return MailSendTestResponse(
        success=True,
        message=(
            "Der SMTP-Server hat die Test-E-Mail zur Zustellung angenommen. "
            "Bitte prüfe jetzt das Postfach — eine Annahme ist noch kein Zustellnachweis."
        ),
        connectionOk=True,
        authenticationOk=bool(resolved.config.username),
        accepted=True,
    )


@router.put("/registration-mode", response_model=RegistrationModeResponse)
def update_registration_mode(
    payload: RegistrationModePayload,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> RegistrationModeResponse:
    """Schaltet zwischen klassischem Ablauf und E-Mail-Bestaetigung um.

    Der Wechsel auf ``email_verification`` ist nur erlaubt, wenn SMTP
    nachweislich funktioniert (konfiguriert, aktiviert, Verbindungstest und
    angenommene Test-E-Mail). Der Rueckweg auf den klassischen Ablauf ist
    IMMER erlaubt — er ist der sichere Fallback bei SMTP-Stoerungen.
    """
    _require_mail_admin_write(request, context, db, mail_settings_change_rate_limiter)
    previous = mail_config.get_registration_mode(db)

    if payload.mode == mail_config.MODE_EMAIL_VERIFICATION:
        requirements = mail_config.email_verification_requirements(db)
        if not requirements.ok:
            raise HTTPException(
                status_code=409,
                detail=(
                    "E-Mail-Bestätigung kann noch nicht aktiviert werden: "
                    + " ".join(requirements.missing)
                ),
            )

    mode = mail_config.set_registration_mode(db, payload.mode)
    sec.record_event(
        db, sec.REGISTRATION_MODE_CHANGED, request=request, success=True,
        user_id=context.user_id, actor_id=context.user_id,
        meta={"from": previous, "to": mode},
    )
    logger.info("Registrierungsverfahren geändert: %s -> %s", previous, mode)

    if mode == mail_config.MODE_EMAIL_VERIFICATION:
        message = (
            "Neue Registrierungen müssen ihre E-Mail-Adresse bestätigen. "
            "Die Admin-Freigabe bleibt zusätzlich erforderlich."
        )
    else:
        message = (
            "Neue Registrierungen werden ausschließlich über die Admin-Freigabe "
            "freigeschaltet. Bereits bestehende Bestätigungspflichten bleiben bestehen."
        )
    return RegistrationModeResponse(mode=mode, message=message)
