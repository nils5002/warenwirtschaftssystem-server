"""Mobile-API (`/api/mobile`) für die iPhone-App.

Bewusst dünn: jeder Endpoint delegiert an die bereits vorhandene Fach-/Service-
Logik (Auth, WMS-Repository, Planning, Sammel-QR) — es wird **keine** WMS-Logik
kopiert oder neu erfunden. Die Mobile-API ist strikt getrennt vom Web-Auth-Flow:
sie nutzt ausschließlich Bearer-/Refresh-Token im Response-Body und setzt
**kein** HttpOnly-Cookie. Der bestehende Web-Login (`routes/auth.py`) bleibt
unverändert.

Sicherheit:
  - Alle buchenden/lesenden Endpoints laufen über ``get_access_context``
    (erzwingt Auth; ein Refresh-Token wird dort als Bearer abgelehnt) und prüfen
    zusätzlich das Recht ``checkinout.use`` (inkl. Mitarbeiter).
  - Ausgabe/Rücknahme laufen über ``WmsService.upsert_asset`` mit
    ``actor_user_id`` → das vorhandene Audit/Activity wird sauber geschrieben.
  - Refresh-Token wird nur über ``/auth/refresh`` akzeptiert.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import AssetRecord, UserRecord
from ..database.session import get_db
from ..repositories import qr_group_repository
from ..schemas.mobile import (
    MobileAsset,
    MobileBookingResult,
    MobileCheckinRequest,
    MobileCheckoutRequest,
    MobileLoginRequest,
    MobileLogoutResponse,
    MobileProject,
    MobileRefreshRequest,
    MobileScanHistoryEntry,
    MobileScanRequest,
    MobileScanResponse,
    MobileTokenResponse,
)
from ..schemas.auth import AuthUserInfo
from ..schemas.wms import (
    AssetItem,
    QrGroupBookingResult,
    QrGroupCheckinPayload,
    QrGroupCheckoutPayload,
)
from ..services.auth_service import (
    AUTH_REFRESH_TOKEN_EXPIRY_SECONDS,
    AUTH_TOKEN_EXPIRY_SECONDS,
    authenticate_refresh_token,
    authenticate_token,
    authenticate_user,
    invalidate_sessions,
    issue_access_token,
    issue_refresh_token,
)
from ..services.label_audit_service import resolve_asset_by_scan
from ..services.planning_service import PlanningService
from ..services.rate_limiter import client_ip, login_rate_limiter, too_many_requests
from ..services.role_service import RoleService
from ..services.wms_service import WmsService
from .dependencies import (
    AccessContext,
    _normalize_role,
    extract_request_token,
    get_access_context,
    require_permission,
)

router = APIRouter(prefix="/api/mobile", tags=["Mobile"])
logger = logging.getLogger("cloud_web.mobile")

# Kanonische Statuswerte (siehe wms_repository) — hier nur referenziert, NICHT
# neu definiert, damit keine abweichende Schreibweise entsteht.
STATUS_AVAILABLE = "Verfuegbar"
STATUS_LOANED = "Verliehen"
STATUS_DEFECT = "Defekt"
STATUS_MAINTENANCE = "In Wartung"


# --- interne Helfer (kein Fach-Workflow, nur Mapping/Default) -------------

def _with_permissions(db: Session, user: AuthUserInfo) -> AuthUserInfo:
    """Hängt die effektiven Rechte der Rolle an (wie /auth/me im Web)."""
    perms = RoleService.effective_permissions(db, _normalize_role(user.role))
    return user.model_copy(update={"permissions": perms})


def _ensure_booking_access(context: AccessContext, db: Session) -> None:
    """Jeder mobile (buchende/lesende) Zugriff verlangt das Recht checkinout.use."""
    require_permission(context, db, "checkinout.use")


def _current_user_name(db: Session, user_id: str | None) -> str | None:
    if not user_id:
        return None
    record = db.scalar(select(UserRecord).where(UserRecord.external_id == user_id))
    if record is None:
        return None
    return (record.name or "").strip() or None


def _build_assigned_to(recipient: str | None, project_name: str | None) -> str:
    """Baut den assignedTo-String im bestehenden Format „Empfänger · Projekt".

    Entspricht exakt dem Format, das wms_repository._extract_checkout_assignee_and_project
    erwartet (Trennzeichen „·"); fehlender Empfänger wird als „-" kodiert.
    """
    recipient_part = (recipient or "").strip() or "-"
    project_part = (project_name or "").strip()
    if project_part:
        return f"{recipient_part} · {project_part}"
    return recipient_part


def _to_mobile_asset(item: AssetItem) -> MobileAsset:
    return MobileAsset(
        id=item.id,
        name=item.name,
        category=item.category,
        status=item.status,
        assignedTo=item.assignedTo,
        serialNumber=item.serialNumber,
        tagNumber=item.tagNumber,
        maintenanceState=item.maintenanceState,
    )


def _bookable_state(status: str) -> tuple[bool, str | None]:
    """Leitet aus dem Status ab, ob eine Buchung möglich ist (+ Begründung)."""
    if status == STATUS_AVAILABLE:
        return True, None
    if status == STATUS_LOANED:
        return True, None
    if status == STATUS_DEFECT:
        return False, "Gerät ist als defekt gemeldet und kann nicht gebucht werden."
    if status == STATUS_MAINTENANCE:
        return False, "Gerät ist in Wartung und kann nicht gebucht werden."
    return False, "Gerät ist aktuell nicht buchbar."


# --- Auth -----------------------------------------------------------------

@router.post("/auth/login", response_model=MobileTokenResponse)
def mobile_login(
    payload: MobileLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> MobileTokenResponse:
    """Login für die App: gibt Access- + Refresh-Token zurück (kein Cookie)."""
    email = payload.email.strip().lower()
    rate_key = f"{client_ip(request)}|{email}"
    blocked = login_rate_limiter.is_blocked(rate_key)
    if blocked.limited:
        raise too_many_requests(blocked.retry_after)
    try:
        user, token_version = authenticate_user(db, payload.email, payload.password)
    except HTTPException as exc:
        # Nur echte Fehlversuche (401) zaehlen — analog zum Web-Login.
        if exc.status_code == 401:
            login_rate_limiter.record_attempt(rate_key)
        raise
    login_rate_limiter.reset(rate_key)
    access = issue_access_token(user, token_version=token_version, expires_in=AUTH_TOKEN_EXPIRY_SECONDS)
    refresh = issue_refresh_token(user, token_version=token_version)
    return MobileTokenResponse(
        accessToken=access,
        refreshToken=refresh,
        expiresIn=AUTH_TOKEN_EXPIRY_SECONDS,
        refreshExpiresIn=AUTH_REFRESH_TOKEN_EXPIRY_SECONDS,
        user=_with_permissions(db, user),
    )


@router.post("/auth/refresh", response_model=MobileTokenResponse)
def mobile_refresh(
    payload: MobileRefreshRequest,
    db: Session = Depends(get_db),
) -> MobileTokenResponse:
    """Erneuert den Access-Token gegen einen gültigen Refresh-Token (Rotation)."""
    user, token_version = authenticate_refresh_token(db, payload.refreshToken)
    access = issue_access_token(user, token_version=token_version, expires_in=AUTH_TOKEN_EXPIRY_SECONDS)
    # Rotation: bei jedem Refresh wird ein frischer Refresh-Token ausgegeben.
    refresh = issue_refresh_token(user, token_version=token_version)
    return MobileTokenResponse(
        accessToken=access,
        refreshToken=refresh,
        expiresIn=AUTH_TOKEN_EXPIRY_SECONDS,
        refreshExpiresIn=AUTH_REFRESH_TOKEN_EXPIRY_SECONDS,
        user=_with_permissions(db, user),
    )


@router.get("/auth/me", response_model=AuthUserInfo)
def mobile_me(request: Request, db: Session = Depends(get_db)) -> AuthUserInfo:
    token = extract_request_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Nicht authentifiziert.")
    # authenticate_token lehnt einen Refresh-Token bewusst ab (nur Access gültig).
    info = authenticate_token(db, token)
    return _with_permissions(db, info)


@router.post("/auth/logout", response_model=MobileLogoutResponse)
def mobile_logout(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MobileLogoutResponse:
    """Widerruft alle Tokens des Nutzers (Access + Refresh) über token_version."""
    if context.user_id:
        invalidate_sessions(db, context.user_id)
    return MobileLogoutResponse(ok=True)


# --- Projekte -------------------------------------------------------------

@router.get("/projects", response_model=list[MobileProject])
def mobile_projects(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[MobileProject]:
    _ensure_booking_access(context, db)
    items = PlanningService.list_plannings(db)
    return [
        MobileProject(
            id=item.id,
            name=item.projectName,
            customerName=item.customerName,
            status=item.status,
            startDate=item.startDate.isoformat() if item.startDate else None,
            endDate=item.endDate.isoformat() if item.endDate else None,
        )
        for item in items
    ]


# --- Scan -----------------------------------------------------------------

@router.post("/assets/scan", response_model=MobileScanResponse)
def mobile_scan(
    payload: MobileScanRequest,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MobileScanResponse:
    """Löst einen Scan-Rohwert auf: Einzelgerät, Sammel-QR oder unbekannt."""
    _ensure_booking_access(context, db)
    raw = payload.value.strip()

    # 1) Einzelgerät (QR / Inventar- / Seriennummer) — vorhandene Service-Logik.
    records = list(db.scalars(select(AssetRecord)).all())
    record = resolve_asset_by_scan(records, raw)
    if record is not None:
        item = WmsService.get_asset(db, record.external_id)
        if item is not None:
            bookable, reason = _bookable_state(item.status)
            return MobileScanResponse(
                found=True,
                kind="asset",
                bookable=bookable,
                reason=reason,
                asset=_to_mobile_asset(item),
            )

    # 2) Sammel-QR (Format "GROUP:<token>" oder reiner Token).
    token = raw[len("GROUP:"):].strip() if raw.upper().startswith("GROUP:") else raw
    try:
        group = qr_group_repository.resolve_by_token(db, token)
        return MobileScanResponse(found=True, kind="group", bookable=True, group=group)
    except HTTPException as exc:
        if exc.status_code == 410:
            return MobileScanResponse(
                found=True,
                kind="group",
                bookable=False,
                reason="Dieser Sammel-QR ist deaktiviert.",
            )
        # 404 → kein Gruppentreffer, regulär als unbekannt behandeln.

    return MobileScanResponse(
        found=False,
        kind="unknown",
        bookable=False,
        reason="Kein passendes Gerät oder Sammel-QR gefunden.",
    )


# --- Ausgabe / Rücknahme (Einzelgerät) ------------------------------------

@router.post("/checkout", response_model=MobileBookingResult)
def mobile_checkout(
    payload: MobileCheckoutRequest,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MobileBookingResult:
    """Gibt ein verfügbares Einzelgerät aus (Status → Verliehen)."""
    _ensure_booking_access(context, db)
    item = WmsService.get_asset(db, payload.assetId)
    if item is None:
        raise HTTPException(status_code=404, detail="Gerät nicht gefunden.")
    if item.status != STATUS_AVAILABLE:
        if item.status == STATUS_LOANED:
            detail = "Gerät ist bereits verliehen."
        elif item.status == STATUS_DEFECT:
            detail = "Gerät ist als defekt gemeldet und kann nicht ausgegeben werden."
        elif item.status == STATUS_MAINTENANCE:
            detail = "Gerät ist in Wartung und kann nicht ausgegeben werden."
        else:
            detail = "Gerät ist nicht verfügbar."
        raise HTTPException(status_code=409, detail=detail)

    recipient = (payload.recipient or "").strip() or _current_user_name(db, context.user_id)
    assigned_to = _build_assigned_to(recipient, payload.projectName)
    updated = item.model_copy(
        update={
            "status": STATUS_LOANED,
            "assignedTo": assigned_to,
            "assignedPlanningId": payload.projectId,
        }
    )
    # actor_user_id sorgt dafür, dass upsert_asset den Audit-/Activity-Eintrag schreibt.
    result = WmsService.upsert_asset(db, updated, actor_user_id=context.user_id)
    return MobileBookingResult(
        assetId=result.id,
        status=result.status,
        message="Ausgabe gebucht.",
    )


@router.post("/checkin", response_model=MobileBookingResult)
def mobile_checkin(
    payload: MobileCheckinRequest,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> MobileBookingResult:
    """Nimmt ein verliehenes Einzelgerät zurück (Status → Verfuegbar)."""
    _ensure_booking_access(context, db)
    item = WmsService.get_asset(db, payload.assetId)
    if item is None:
        raise HTTPException(status_code=404, detail="Gerät nicht gefunden.")
    if item.status == STATUS_AVAILABLE:
        # Idempotent: bereits zurückgenommen → saubere Meldung, kein Fehler.
        return MobileBookingResult(
            assetId=item.id,
            status=item.status,
            message="Gerät war bereits verfügbar.",
        )
    if item.status != STATUS_LOANED:
        if item.status == STATUS_DEFECT:
            detail = "Gerät ist als defekt gemeldet — Rücknahme nicht über die App möglich."
        elif item.status == STATUS_MAINTENANCE:
            detail = "Gerät ist in Wartung — Rücknahme nicht über die App möglich."
        else:
            detail = "Gerät kann in diesem Status nicht zurückgenommen werden."
        raise HTTPException(status_code=409, detail=detail)

    # Zuordnung beim Checkin zurücksetzen (wie im Web). Schritt-B-Aufräumarbeit
    # (expected_return_date, assigned_planning_id) erledigt upsert_asset selbst.
    updated = item.model_copy(update={"status": STATUS_AVAILABLE, "assignedTo": "-", "nextReturn": ""})
    result = WmsService.upsert_asset(db, updated, actor_user_id=context.user_id)
    return MobileBookingResult(
        assetId=result.id,
        status=result.status,
        message="Rücknahme gebucht.",
    )


# --- Sammel-QR (Mengenbuchung) -------------------------------------------

@router.post("/qr-groups/{group_id}/checkout", response_model=QrGroupBookingResult)
def mobile_group_checkout(
    group_id: str,
    payload: QrGroupCheckoutPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> QrGroupBookingResult:
    _ensure_booking_access(context, db)
    return qr_group_repository.bulk_checkout(db, group_id, payload, actor_user_id=context.user_id)


@router.post("/qr-groups/{group_id}/checkin", response_model=QrGroupBookingResult)
def mobile_group_checkin(
    group_id: str,
    payload: QrGroupCheckinPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> QrGroupBookingResult:
    _ensure_booking_access(context, db)
    return qr_group_repository.bulk_checkin(db, group_id, payload, actor_user_id=context.user_id)


# --- Scan-Historie (optional) --------------------------------------------

@router.get("/scan-history", response_model=list[MobileScanHistoryEntry])
def mobile_scan_history(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[MobileScanHistoryEntry]:
    """Letzte Buchungs-Aktivitäten (Ausgabe/Rücknahme) aus dem Verlauf."""
    _ensure_booking_access(context, db)
    activities = WmsService.list_activities(db)
    return [
        MobileScanHistoryEntry(
            id=act.id,
            title=act.title,
            detail=act.detail,
            timestamp=act.timestamp,
            assetId=act.assetId,
        )
        for act in activities
    ]
