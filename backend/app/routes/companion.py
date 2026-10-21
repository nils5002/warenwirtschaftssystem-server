"""Companion App: Einstellungen, QR-Kopplung und Geraetesitzungen.

Rollen: Jeder angemeldete Benutzer verwaltet ausschliesslich SEINE EIGENEN
Geraete. Gekoppelte Geraete arbeiten danach ueber dieselben API-Endpunkte und
Rechtepruefungen wie der Desktop — es gibt keine Sonderrechte fuer Mobilgeraete.

Schutz schreibender Cookie-Anfragen: ``X-Requested-With`` (CSRF) + Origin-
Pruefung. Geraete- und Kopplungs-Cookies sind HttpOnly, ``SameSite=Strict``
und nur unter ``/api/companion`` gueltig.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import CompanionDeviceRecord, CompanionPairingRecord, UserRecord
from ..database.session import get_db
from ..schemas.auth import AuthUserInfo
from ..schemas.companion import (
    CompanionDevice,
    CompanionLockedResponse,
    CompanionRevokeResponse,
    CompanionSessionResponse,
    CompanionSettingsPayload,
    CompanionSettingsResponse,
    PairingClaimPayload,
    PairingClaimResponse,
    PairingClaimStatusResponse,
    PairingStartResponse,
    PairingStatusResponse,
    PasskeyOptionsResponse,
    PasskeyVerifyPayload,
)
from ..services import companion_passkey_service as passkeys
from ..services import companion_service as companion
from ..services import mail_config_service
from ..services import security_event_service as sec
from ..services.auth_service import issue_access_token, normalize_user_role
from ..services.email_service import mask_email
from ..services.rate_limiter import (
    RateLimiter,
    client_ip,
    companion_claim_rate_limiter,
    companion_pairing_start_rate_limiter,
    companion_poll_rate_limiter,
    companion_session_rate_limiter,
    too_many_requests,
)
from ..services.role_service import RoleService
from .auth import _request_is_https
from .dependencies import (
    AUTH_COOKIE_NAME,
    AccessContext,
    _normalize_role,
    get_access_context,
    require_csrf_header,
    require_trusted_origin,
    trusted_origins,
)

router = APIRouter(prefix="/api/companion", tags=["Companion"])
logger = logging.getLogger("cloud_web.companion")


# --- Hilfen -------------------------------------------------------------------


def _fmt(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.isoformat()


def _seconds_left(value: datetime) -> int:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return max(0, int((value - datetime.now(UTC)).total_seconds()))


def _limit(limiter: RateLimiter, key: str) -> None:
    blocked = limiter.is_blocked(key)
    if blocked.limited:
        raise too_many_requests(blocked.retry_after)
    limiter.record_attempt(key)


def _write_guard(request: Request) -> None:
    require_csrf_header(request)
    require_trusted_origin(request)


def _current_user(db: Session, context: AccessContext) -> UserRecord:
    user = db.scalar(select(UserRecord).where(UserRecord.external_id == context.user_id))
    if user is None:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    return user


def _require_browser_session(context: AccessContext) -> None:
    """Kopplungen starten/bestaetigen nur am PC — nie von einem Handy aus."""
    if context.device_id:
        raise HTTPException(
            status_code=403,
            detail="Neue Geraete koennen nur am PC verbunden werden.",
        )


def _device_item(db: Session, device: CompanionDeviceRecord, current_id: str | None) -> CompanionDevice:
    return CompanionDevice(
        id=device.external_id,
        name=device.name,
        platform=device.platform,
        connectedAt=_fmt(device.created_at),
        lastSeenAt=_fmt(device.last_seen_at),
        passkeyRegistered=companion.has_passkey(db, device),
        current=device.external_id == current_id,
    )


def _settings_response(db: Session, user: UserRecord, context: AccessContext) -> CompanionSettingsResponse:
    devices = companion.active_devices(db, user.external_id) if companion.is_enabled(user) else []
    return CompanionSettingsResponse(
        enabled=companion.is_enabled(user),
        devices=[_device_item(db, item, context.device_id) for item in devices],
        maxDevices=companion.MAX_DEVICES_PER_USER,
        currentDeviceId=context.device_id,
    )


def _set_companion_cookie(response: Response, request: Request, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        key=name,
        value=value,
        max_age=max_age,
        path=companion.COMPANION_COOKIE_PATH,
        httponly=True,
        secure=_request_is_https(request),
        samesite="strict",
    )


def _clear_companion_cookie(response: Response, request: Request, name: str) -> None:
    _set_companion_cookie(response, request, name, "", 0)


def _set_device_access_cookie(
    response: Response, request: Request, user: UserRecord, device: CompanionDeviceRecord
) -> AuthUserInfo:
    info = AuthUserInfo(
        userId=user.external_id,
        name=user.name,
        email=user.email,
        role=normalize_user_role(user.role),
        deviceId=device.external_id,
    )
    token = issue_access_token(
        info,
        token_version=int(user.token_version or 0),
        expires_in=companion.DEVICE_ACCESS_TOKEN_SECONDS,
        session_id=device.external_id,
    )
    # Gleicher Cookie-Name wie im Browser: Alle bestehenden Endpunkte und
    # Rechtepruefungen funktionieren unveraendert. Lax wie beim Desktop, damit
    # der Start der Homescreen-App (Top-Level-Navigation) das Cookie mitsendet.
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=companion.DEVICE_ACCESS_TOKEN_SECONDS,
        path="/",
        httponly=True,
        secure=_request_is_https(request),
        samesite="lax",
    )
    return info


def _with_permissions(db: Session, info: AuthUserInfo) -> AuthUserInfo:
    perms = RoleService.effective_permissions(db, _normalize_role(info.role))
    return info.model_copy(update={"permissions": perms})


# --- Einstellungen + eigene Geraete ---------------------------------------------


@router.get("/settings", response_model=CompanionSettingsResponse)
def get_settings_(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> CompanionSettingsResponse:
    return _settings_response(db, _current_user(db, context), context)


@router.put("/settings", response_model=CompanionSettingsResponse)
def update_settings(
    payload: CompanionSettingsPayload,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> CompanionSettingsResponse:
    _write_guard(request)
    user = _current_user(db, context)
    if payload.enabled and context.device_id:
        _require_browser_session(context)
    was_enabled = companion.is_enabled(user)
    revoked = companion.set_enabled(db, user, payload.enabled)
    if was_enabled != payload.enabled:
        sec.record_event(
            db,
            sec.COMPANION_ENABLED if payload.enabled else sec.COMPANION_DISABLED,
            request=request, success=True, user_id=user.external_id, identifier=user.email,
            meta={"revokedDevices": revoked},
        )
    return _settings_response(db, user, context)


@router.delete("/devices/{device_id}", response_model=CompanionRevokeResponse)
def revoke_device(
    device_id: str,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> CompanionRevokeResponse:
    _write_guard(request)
    user = _current_user(db, context)
    device = companion.own_device_or_404(db, user.external_id, device_id)
    was_active = device.revoked_at is None
    companion.revoke_device(db, device, companion.REASON_USER)
    if was_active:
        sec.record_event(
            db, sec.COMPANION_DEVICE_REVOKED, request=request, success=True,
            user_id=user.external_id, identifier=user.email,
            reason=companion.REASON_USER, meta={"deviceId": device_id},
        )
    return CompanionRevokeResponse(revoked=1 if was_active else 0)


@router.post("/devices/revoke-all", response_model=CompanionRevokeResponse)
def revoke_all_devices(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> CompanionRevokeResponse:
    _write_guard(request)
    user = _current_user(db, context)
    revoked = companion.revoke_all_devices(db, user.external_id, companion.REASON_ALL)
    sec.record_event(
        db, sec.COMPANION_DEVICE_REVOKED, request=request, success=True,
        user_id=user.external_id, identifier=user.email,
        reason=companion.REASON_ALL, meta={"revokedDevices": revoked},
    )
    return CompanionRevokeResponse(revoked=revoked)


# --- Kopplung: PC-Seite ----------------------------------------------------------


def _pairing_status(pairing: CompanionPairingRecord) -> PairingStatusResponse:
    claimed = pairing.status in (companion.STATUS_CLAIMED, companion.STATUS_APPROVED, companion.STATUS_CONSUMED)
    return PairingStatusResponse(
        pairingId=pairing.external_id,
        status=pairing.status,
        expiresAt=_fmt(pairing.expires_at) or "",
        expiresInSeconds=_seconds_left(pairing.expires_at),
        deviceName=pairing.device_name if claimed else None,
        devicePlatform=pairing.device_platform if claimed else None,
        matchCode=pairing.match_code if pairing.status == companion.STATUS_CLAIMED else None,
    )


@router.post("/pairing", response_model=PairingStartResponse)
def start_pairing(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PairingStartResponse:
    _write_guard(request)
    _require_browser_session(context)
    _limit(companion_pairing_start_rate_limiter, f"pair-start:{context.user_id}")
    user = _current_user(db, context)
    started = companion.start_pairing(db, user)
    sec.record_event(
        db, sec.COMPANION_PAIRING_STARTED, request=request, success=True,
        user_id=user.external_id, identifier=user.email,
        meta={"pairingId": started.pairing.external_id},
    )
    return PairingStartResponse(
        pairingId=started.pairing.external_id,
        pairingCode=started.code,
        expiresAt=_fmt(started.pairing.expires_at) or "",
        expiresInSeconds=_seconds_left(started.pairing.expires_at),
    )


@router.get("/pairing/{pairing_id}", response_model=PairingStatusResponse)
def pairing_status(
    pairing_id: str,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PairingStatusResponse:
    _limit(companion_poll_rate_limiter, f"poll-pc:{context.user_id}")
    pairing = companion.own_pairing_or_404(db, context.user_id or "", pairing_id)
    return _pairing_status(pairing)


def _decide(
    pairing_id: str, approve: bool, request: Request, db: Session, context: AccessContext
) -> PairingStatusResponse:
    _write_guard(request)
    _require_browser_session(context)
    user = _current_user(db, context)
    pairing = companion.own_pairing_or_404(db, user.external_id, pairing_id)
    pairing = companion.decide_pairing(db, pairing, approve=approve)
    sec.record_event(
        db,
        sec.COMPANION_PAIRING_APPROVED if approve else sec.COMPANION_PAIRING_REJECTED,
        request=request, success=True, user_id=user.external_id, identifier=user.email,
        meta={"pairingId": pairing.external_id, "platform": pairing.device_platform},
    )
    return _pairing_status(pairing)


@router.post("/pairing/{pairing_id}/approve", response_model=PairingStatusResponse)
def approve_pairing(
    pairing_id: str,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PairingStatusResponse:
    return _decide(pairing_id, True, request, db, context)


@router.post("/pairing/{pairing_id}/reject", response_model=PairingStatusResponse)
def reject_pairing(
    pairing_id: str,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PairingStatusResponse:
    return _decide(pairing_id, False, request, db, context)


@router.post("/pairing/{pairing_id}/cancel", response_model=PairingStatusResponse)
def cancel_pairing(
    pairing_id: str,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PairingStatusResponse:
    _write_guard(request)
    pairing = companion.own_pairing_or_404(db, context.user_id or "", pairing_id)
    if pairing.status in (companion.STATUS_PENDING, companion.STATUS_CLAIMED, companion.STATUS_APPROVED):
        pairing.status = companion.STATUS_CANCELLED
        pairing.claim_hash = None
        db.commit()
    return _pairing_status(pairing)


# --- Kopplung: Handy-Seite (ohne Anmeldung) ------------------------------------


@router.post("/pairing-claim", response_model=PairingClaimResponse)
def claim_pairing(
    payload: PairingClaimPayload,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> PairingClaimResponse:
    _write_guard(request)
    ip = client_ip(request)
    _limit(companion_claim_rate_limiter, f"claim:{ip}")
    try:
        claim = companion.claim_pairing(db, payload.code, user_agent=request.headers.get("user-agent"))
    except HTTPException:
        sec.record_event(
            db, sec.COMPANION_PAIRING_INVALID, request=request, severity="warning",
            reason="invalid_or_used_code",
        )
        raise
    _set_companion_cookie(
        response, request, companion.PAIRING_COOKIE_NAME, claim.claim_secret,
        int(companion.PAIRING_DECISION_TTL.total_seconds()),
    )
    sec.record_event(
        db, sec.COMPANION_PAIRING_CLAIMED, request=request, success=True,
        user_id=claim.user.external_id, identifier=claim.user.email,
        meta={"pairingId": claim.pairing.external_id, "platform": claim.pairing.device_platform},
    )
    return PairingClaimResponse(
        accountName=claim.user.name,
        accountEmail=mask_email(claim.user.email),
        matchCode=claim.pairing.match_code or "",
        expiresInSeconds=_seconds_left(claim.pairing.expires_at),
    )


@router.get("/pairing-claim/status", response_model=PairingClaimStatusResponse)
def claim_status(request: Request, db: Session = Depends(get_db)) -> PairingClaimStatusResponse:
    _limit(companion_poll_rate_limiter, f"poll-phone:{client_ip(request)}")
    pairing = companion.pairing_from_claim(db, request.cookies.get(companion.PAIRING_COOKIE_NAME))
    return PairingClaimStatusResponse(
        status=pairing.status, expiresInSeconds=_seconds_left(pairing.expires_at)
    )


@router.post("/pairing-claim/complete", response_model=CompanionSessionResponse)
def complete_pairing(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> CompanionSessionResponse:
    _write_guard(request)
    _limit(companion_session_rate_limiter, f"session:{client_ip(request)}")
    pairing = companion.pairing_from_claim(db, request.cookies.get(companion.PAIRING_COOKIE_NAME))
    credential = companion.complete_pairing(db, pairing)
    device = credential.device
    _set_companion_cookie(
        response, request, companion.DEVICE_COOKIE_NAME, credential.cookie_value or "",
        companion.DEVICE_COOKIE_MAX_AGE,
    )
    _clear_companion_cookie(response, request, companion.PAIRING_COOKIE_NAME)
    info = _set_device_access_cookie(response, request, credential.user, device)
    sec.record_event(
        db, sec.COMPANION_DEVICE_PAIRED, request=request, success=True,
        user_id=credential.user.external_id, identifier=credential.user.email,
        meta={"deviceId": device.external_id, "platform": device.platform},
    )
    return CompanionSessionResponse(
        user=_with_permissions(db, info),
        deviceId=device.external_id,
        deviceName=device.name,
    )


@router.post("/pairing-claim/cancel")
def cancel_claim(request: Request, response: Response, db: Session = Depends(get_db)) -> dict[str, bool]:
    _write_guard(request)
    try:
        pairing = companion.pairing_from_claim(db, request.cookies.get(companion.PAIRING_COOKIE_NAME))
    except HTTPException:
        pairing = None
    if pairing is not None and pairing.status in (companion.STATUS_CLAIMED, companion.STATUS_APPROVED):
        pairing.status = companion.STATUS_CANCELLED
        pairing.claim_hash = None
        db.commit()
    _clear_companion_cookie(response, request, companion.PAIRING_COOKIE_NAME)
    return {"ok": True}


# --- Geraetesitzung ------------------------------------------------------------


@router.post("/session/refresh", response_model=CompanionSessionResponse)
def refresh_session(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    """Neues Access-Token fuer ein gekoppeltes Geraet (rotiert das Secret)."""
    _write_guard(request)
    _limit(companion_session_rate_limiter, f"session:{client_ip(request)}")
    try:
        credential = companion.refresh_device(db, request.cookies.get(companion.DEVICE_COOKIE_NAME))
    except companion.DeviceLockedError as locked:
        # Gekoppelt, aber gesperrt: Cookie behalten, Sperrbildschirm zeigen.
        return JSONResponse(
            status_code=423,
            content=CompanionLockedResponse(
                deviceId=locked.device.external_id, deviceName=locked.device.name
            ).model_dump(),
        )
    except HTTPException as exc:
        if "Sicherheitsgruenden" in str(exc.detail):
            sec.record_event(
                db, sec.COMPANION_SECRET_REUSE, request=request, severity="critical",
                reason=companion.REASON_REUSE,
            )
        failed = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        _clear_companion_cookie(failed, request, companion.DEVICE_COOKIE_NAME)
        return failed
    if credential.cookie_value:
        _set_companion_cookie(
            response, request, companion.DEVICE_COOKIE_NAME, credential.cookie_value,
            companion.DEVICE_COOKIE_MAX_AGE,
        )
    info = _set_device_access_cookie(response, request, credential.user, credential.device)
    return CompanionSessionResponse(
        user=_with_permissions(db, info),
        deviceId=credential.device.external_id,
        deviceName=credential.device.name,
        passkeyRegistered=companion.has_passkey(db, credential.device),
    )


@router.post("/session/logout")
def logout_device(request: Request, response: Response, db: Session = Depends(get_db)) -> dict[str, bool]:
    """Beendet genau diese Geraetesitzung (Desktop und andere Geraete bleiben)."""
    _write_guard(request)
    device = companion.device_from_cookie(db, request.cookies.get(companion.DEVICE_COOKIE_NAME))
    if device is not None:
        companion.revoke_device(db, device, companion.REASON_LOGOUT)
        sec.record_event(
            db, sec.COMPANION_DEVICE_REVOKED, request=request, success=True,
            user_id=device.user_external_id, reason=companion.REASON_LOGOUT,
            meta={"deviceId": device.external_id},
        )
    _clear_companion_cookie(response, request, companion.DEVICE_COOKIE_NAME)
    response.set_cookie(
        key=AUTH_COOKIE_NAME, value="", max_age=0, path="/", httponly=True,
        secure=_request_is_https(request), samesite="lax",
    )
    return {"ok": True}


@router.get("/session", response_model=CompanionSessionResponse)
def session_info(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> CompanionSessionResponse:
    """Infos zur aktuellen Geraetesitzung (nur auf gekoppelten Geraeten)."""
    device, user = _current_device(db, context)
    info = AuthUserInfo(
        userId=user.external_id, name=user.name, email=user.email,
        role=normalize_user_role(user.role), deviceId=device.external_id,
    )
    return CompanionSessionResponse(
        user=_with_permissions(db, info),
        deviceId=device.external_id,
        deviceName=device.name,
        passkeyRegistered=companion.has_passkey(db, device),
    )


# --- Passkeys / Entsperren -------------------------------------------------------


def _current_device(db: Session, context: AccessContext) -> tuple[CompanionDeviceRecord, UserRecord]:
    if not context.device_id:
        raise HTTPException(status_code=403, detail="Nur auf einem gekoppelten Geraet verfuegbar.")
    user = _current_user(db, context)
    device = companion.own_device_or_404(db, user.external_id, context.device_id)
    if device.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Geraetesitzung ist nicht mehr gueltig.")
    return device, user


def _webauthn_origin(request: Request, db: Session) -> tuple[str, str]:
    public = mail_config_service.public_base_url(db)
    return passkeys.resolve_origin(request, trusted_origins(request, extra=(public.url,)))


@router.post("/passkey/register/options", response_model=PasskeyOptionsResponse)
def passkey_register_options(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PasskeyOptionsResponse:
    _write_guard(request)
    _limit(companion_session_rate_limiter, f"session:{client_ip(request)}")
    device, user = _current_device(db, context)
    _origin, rp_id = _webauthn_origin(request, db)
    return PasskeyOptionsResponse(options=passkeys.registration_options(db, device, user, rp_id))


@router.post("/passkey/register/verify", response_model=CompanionSessionResponse)
def passkey_register_verify(
    payload: PasskeyVerifyPayload,
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> CompanionSessionResponse:
    _write_guard(request)
    _limit(companion_session_rate_limiter, f"session:{client_ip(request)}")
    device, user = _current_device(db, context)
    origin, rp_id = _webauthn_origin(request, db)
    passkeys.verify_registration(db, device, user, payload.credential, origin=origin, rp_id=rp_id)
    companion.mark_unlocked(device)
    db.commit()
    sec.record_event(
        db, sec.COMPANION_PASSKEY_REGISTERED, request=request, success=True,
        user_id=user.external_id, identifier=user.email, meta={"deviceId": device.external_id},
    )
    return session_info(db, context)


def _locked_device(request: Request, db: Session) -> CompanionDeviceRecord:
    device = companion.device_from_cookie(db, request.cookies.get(companion.DEVICE_COOKIE_NAME))
    if device is None:
        raise HTTPException(status_code=401, detail="Geraetesitzung ist nicht mehr gueltig. Bitte erneut verbinden.")
    return device


@router.post("/unlock/options", response_model=PasskeyOptionsResponse)
def unlock_options(request: Request, db: Session = Depends(get_db)) -> PasskeyOptionsResponse:
    _write_guard(request)
    _limit(companion_session_rate_limiter, f"session:{client_ip(request)}")
    device = _locked_device(request, db)
    _origin, rp_id = _webauthn_origin(request, db)
    return PasskeyOptionsResponse(options=passkeys.unlock_options(db, device, rp_id))


@router.post("/unlock/verify", response_model=CompanionSessionResponse)
def unlock_verify(
    payload: PasskeyVerifyPayload,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    _write_guard(request)
    _limit(companion_session_rate_limiter, f"session:{client_ip(request)}")
    device = _locked_device(request, db)
    origin, rp_id = _webauthn_origin(request, db)
    try:
        passkeys.verify_unlock(db, device, payload.credential, origin=origin, rp_id=rp_id)
    except HTTPException:
        sec.record_event(
            db, sec.COMPANION_UNLOCK_FAILED, request=request, severity="warning",
            user_id=device.user_external_id, meta={"deviceId": device.external_id},
        )
        raise
    companion.mark_unlocked(device)
    db.commit()
    sec.record_event(
        db, sec.COMPANION_UNLOCK_SUCCESS, request=request, success=True,
        user_id=device.user_external_id, meta={"deviceId": device.external_id},
    )
    # Jetzt regulaer erneuern (rotiert das Secret, setzt frische Cookies).
    return refresh_session(request, response, db)
