"""Persistentes Security-/Auth-Audit-Logging (Security-Paket „supman").

Zentrale Schreib- und Lese-Schicht für die Tabelle ``security_events``.
Aufgerufen wird ``record_event`` aus den ROUTEN (nur dort existiert das
``Request``-Objekt mit IP/User-Agent) — die Fach-Services bleiben frei von
HTTP-Concerns.

Eiserne Regeln:
* Best-effort: Ein Fehler beim Event-Schreiben darf Login/Registrierung/
  Admin-Aktionen NIEMALS brechen (eigenes try/except + Error-Log).
* NIEMALS geloggt: Passwörter, Passwort-Hashes, Tokens, Cookies,
  Authorization-Header. ``meta`` enthält nur unkritische Zusatzinfos.
* IP-Adressen verlassen die DB nur gekürzt (``shorten_ip``).
"""
from __future__ import annotations

import csv
import io
import json
import logging
from datetime import UTC, datetime, timedelta

from fastapi import Request
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..database.models import SecurityEventRecord, SystemSettingRecord, UserRecord
from ..schemas.security import (
    SecurityEventItem,
    SecurityEventListResponse,
    SecuritySummaryResponse,
)
from .rate_limiter import client_ip

logger = logging.getLogger("cloud_web.security")

# --- Event-Typen (verbindlicher snake_case-Katalog) --------------------------
REGISTER_ATTEMPT = "register_attempt"
REGISTER_SUCCESS_PENDING = "register_success_pending"
REGISTER_DUPLICATE = "register_duplicate"
REGISTER_REJECTED = "register_rejected"
REGISTER_BLOCKED_DOMAIN = "register_blocked_domain"
REGISTER_EXTERNAL_DOMAIN = "register_external_domain"
REGISTER_BLOCKED_DISABLED = "register_blocked_disabled"
REGISTER_BLOCKED_RATE_LIMIT = "register_blocked_rate_limit"
REGISTER_HONEYPOT = "register_honeypot"
REGISTER_INVALID_EMAIL = "register_invalid_email"
LOGIN_SUCCESS = "login_success"
LOGIN_FAILED = "login_failed"
LOGIN_BLOCKED_INACTIVE = "login_blocked_inactive"
LOGIN_BLOCKED_LOCKED = "login_blocked_locked"
LOGIN_RATE_LIMITED = "login_rate_limited"
LOGOUT = "logout"
PASSWORD_CHANGED = "password_changed"
PASSWORD_RESET_REQUESTED = "password_reset_requested"
PASSWORD_RESET_COMPLETED = "password_reset_completed"
USER_ACTIVATED = "user_activated"
USER_DEACTIVATED = "user_deactivated"
USER_LOCKED = "user_locked"
USER_UNLOCKED = "user_unlocked"
USER_DELETED = "user_deleted"
ROLE_CHANGED = "role_changed"
PERMISSION_CHANGED = "permission_changed"
ADMIN_ACTION_DENIED = "admin_action_denied"
SUSPICIOUS_ACTIVITY_DETECTED = "suspicious_activity_detected"
SESSION_REVOKED = "session_revoked"
SECURITY_EXPORT_CREATED = "security_export_created"
BACKUP_EXPORTED = "backup_exported"
BACKUP_IMPORTED = "backup_imported"
# Systemupdate (Portainer-Redeploy aus dem Adminbereich).
SYSTEM_UPDATE_REQUESTED = "system_update_requested"
SYSTEM_UPDATE_FAILED = "system_update_failed"

# Key im system_settings-Store: öffentliche Registrierung erlaubt?
# Fehlender Key == AUS (sicherer Default nach dem Vorfall).
REGISTRATION_ENABLED_KEY = "registration_enabled"

# Interne E-Mail-Domain — fremde Domains werden bei Registrierung nicht
# geblockt, aber als warning-Event markiert (Admin-Sichtbarkeit).
INTERNAL_EMAIL_DOMAIN = "conventex.com"


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed[:limit]


def shorten_ip(value: str | None) -> str | None:
    """Kürzt eine IP für die Ausgabe (Datenschutz): letztes Segment maskiert."""
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    if "." in raw:  # IPv4
        parts = raw.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3]) + ".xxx"
        return raw
    if ":" in raw:  # IPv6 — nur die ersten Blöcke behalten
        parts = [p for p in raw.split(":") if p]
        return ":".join(parts[:3]) + "::xxxx" if len(parts) > 3 else raw
    return raw


def shorten_user_agent(value: str | None, limit: int = 80) -> str | None:
    if not value:
        return None
    trimmed = value.strip()
    if len(trimmed) <= limit:
        return trimmed or None
    return trimmed[: limit - 1] + "…"


def record_event(
    db: Session,
    event_type: str,
    *,
    request: Request | None = None,
    severity: str = "info",
    success: bool = False,
    user_id: str | None = None,
    identifier: str | None = None,
    actor_id: str | None = None,
    reason: str | None = None,
    meta: dict | None = None,
) -> None:
    """Schreibt ein Security-Event (best-effort, bricht den Aufrufer nie)."""
    try:
        ip = None
        forwarded_for = None
        user_agent = None
        http_method = None
        path = None
        host = None
        origin = None
        referer = None
        request_id = None
        if request is not None:
            ip = client_ip(request)
            forwarded_for = _clip(request.headers.get("x-forwarded-for"), 255)
            user_agent = _clip(request.headers.get("user-agent"), 512)
            http_method = request.method
            path = _clip(request.url.path, 255)
            host = _clip(request.headers.get("host"), 255)
            origin = _clip(request.headers.get("origin"), 255)
            referer = _clip(request.headers.get("referer"), 255)
            request_id = _clip(request.headers.get("x-request-id"), 64)

        meta_json = None
        if meta:
            try:
                meta_json = json.dumps(meta, ensure_ascii=False, default=str)[:2000]
            except (TypeError, ValueError):
                meta_json = None

        db.add(
            SecurityEventRecord(
                event_type=event_type,
                severity=severity if severity in {"info", "warning", "critical"} else "info",
                success=bool(success),
                user_external_id=_clip(user_id, 64),
                entered_identifier=_clip((identifier or "").lower(), 255),
                actor_external_id=_clip(actor_id, 64),
                ip=_clip(ip, 64),
                forwarded_for=forwarded_for,
                user_agent=user_agent,
                http_method=http_method,
                path=path,
                host=host,
                origin=origin,
                referer=referer,
                reason_code=_clip(reason, 64),
                request_id=request_id,
                meta_json=meta_json,
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001 — Logging darf den Fachfluss nie brechen.
        logger.exception("Security-Event konnte nicht gespeichert werden (type=%s)", event_type)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


def note_login_success(db: Session, user_external_id: str, request: Request | None) -> None:
    """Persistiert Login-Metadaten am Benutzer (letzter Login, IP, Browser)."""
    try:
        user = db.scalar(select(UserRecord).where(UserRecord.external_id == user_external_id))
        if user is None:
            return
        now = datetime.now(UTC)
        user.last_login_at = now
        user.last_login_attempt_at = now
        user.failed_login_count = 0
        user.locked_until = None
        if request is not None:
            user.last_login_ip = _clip(client_ip(request), 64)
            user.last_login_user_agent = _clip(request.headers.get("user-agent"), 255)
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Login-Metadaten konnten nicht gespeichert werden")
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


# --- Registrierungs-Schalter (system_settings) --------------------------------

def registration_enabled(db: Session) -> bool:
    record = db.scalar(
        select(SystemSettingRecord).where(SystemSettingRecord.key == REGISTRATION_ENABLED_KEY)
    )
    if record is None:
        # Fehlender Key = AUS: Nach dem Vorfall ist „zu" der sichere Default;
        # Altinstallationen/Backups ohne den Key sind damit automatisch dicht.
        return False
    return record.value.strip().lower() in {"1", "true", "yes", "on"}


def set_registration_enabled(db: Session, enabled: bool) -> bool:
    record = db.scalar(
        select(SystemSettingRecord).where(SystemSettingRecord.key == REGISTRATION_ENABLED_KEY)
    )
    value = "1" if enabled else "0"
    if record:
        record.value = value
    else:
        db.add(SystemSettingRecord(key=REGISTRATION_ENABLED_KEY, value=value))
    db.commit()
    return enabled


# --- Abfragen für den Admin-Bereich -------------------------------------------

def _fmt(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.strftime("%d.%m.%Y %H:%M")


def _event_to_item(record: SecurityEventRecord) -> SecurityEventItem:
    return SecurityEventItem(
        id=record.id,
        createdAt=_fmt(record.created_at) or "",
        eventType=record.event_type,
        severity=record.severity,
        success=bool(record.success),
        userId=record.user_external_id,
        enteredIdentifier=record.entered_identifier,
        actorId=record.actor_external_id,
        ip=shorten_ip(record.ip),
        userAgent=record.user_agent,
        method=record.http_method,
        path=record.path,
        reasonCode=record.reason_code,
        requestId=record.request_id,
        meta=record.meta_json,
    )


def _apply_filters(
    stmt,
    *,
    event_type: str | None,
    user: str | None,
    ip: str | None,
    severity: str | None,
    success: bool | None,
    since: datetime | None,
    until: datetime | None,
):
    if event_type:
        stmt = stmt.where(SecurityEventRecord.event_type == event_type)
    if user:
        needle = f"%{user.strip().lower()}%"
        stmt = stmt.where(
            (SecurityEventRecord.user_external_id.ilike(needle))
            | (SecurityEventRecord.entered_identifier.ilike(needle))
            | (SecurityEventRecord.actor_external_id.ilike(needle))
        )
    if ip:
        stmt = stmt.where(SecurityEventRecord.ip.ilike(f"{ip.strip()}%"))
    if severity:
        stmt = stmt.where(SecurityEventRecord.severity == severity)
    if success is not None:
        stmt = stmt.where(SecurityEventRecord.success == success)
    if since is not None:
        stmt = stmt.where(SecurityEventRecord.created_at >= since)
    if until is not None:
        stmt = stmt.where(SecurityEventRecord.created_at <= until)
    return stmt


def list_events(
    db: Session,
    *,
    event_type: str | None = None,
    user: str | None = None,
    ip: str | None = None,
    severity: str | None = None,
    success: bool | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> SecurityEventListResponse:
    limit = max(1, min(int(limit or 50), 200))
    offset = max(0, int(offset or 0))
    base = _apply_filters(
        select(SecurityEventRecord),
        event_type=event_type,
        user=user,
        ip=ip,
        severity=severity,
        success=success,
        since=since,
        until=until,
    )
    total = db.scalar(
        _apply_filters(
            select(func.count(SecurityEventRecord.id)),
            event_type=event_type,
            user=user,
            ip=ip,
            severity=severity,
            success=success,
            since=since,
            until=until,
        )
    ) or 0
    records = db.scalars(
        base.order_by(SecurityEventRecord.created_at.desc(), SecurityEventRecord.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    return SecurityEventListResponse(items=[_event_to_item(r) for r in records], total=int(total))


def summary(db: Session, *, suspicious_since: datetime | None = None) -> SecuritySummaryResponse:
    now = datetime.now(UTC)
    day_ago = now - timedelta(hours=24)
    week_ago = now - timedelta(days=7)
    failed_types = (LOGIN_FAILED, LOGIN_BLOCKED_INACTIVE, LOGIN_BLOCKED_LOCKED, LOGIN_RATE_LIMITED)

    total_24h = db.scalar(
        select(func.count(SecurityEventRecord.id)).where(SecurityEventRecord.created_at >= day_ago)
    ) or 0
    failed_24h = db.scalar(
        select(func.count(SecurityEventRecord.id)).where(
            SecurityEventRecord.created_at >= day_ago,
            SecurityEventRecord.event_type.in_(failed_types),
        )
    ) or 0
    failed_7d = db.scalar(
        select(func.count(SecurityEventRecord.id)).where(
            SecurityEventRecord.created_at >= week_ago,
            SecurityEventRecord.event_type.in_(failed_types),
        )
    ) or 0
    pending_users = db.scalar(
        select(func.count(UserRecord.id)).where(UserRecord.status == "Wartet auf Freigabe")
    ) or 0
    locked_users = db.scalar(
        select(func.count(UserRecord.id)).where(UserRecord.status == "Gesperrt")
    ) or 0
    suspicious_cutoff = suspicious_since or day_ago
    new_suspicious = db.scalar(
        select(func.count(SecurityEventRecord.id)).where(
            SecurityEventRecord.created_at >= suspicious_cutoff,
            SecurityEventRecord.severity.in_(("warning", "critical")),
        )
    ) or 0
    return SecuritySummaryResponse(
        totalEvents24h=int(total_24h),
        failedLogins24h=int(failed_24h),
        failedLogins7d=int(failed_7d),
        pendingUsers=int(pending_users),
        lockedUsers=int(locked_users),
        newSuspicious=int(new_suspicious),
    )


def export_csv(
    db: Session,
    *,
    event_type: str | None = None,
    user: str | None = None,
    ip: str | None = None,
    severity: str | None = None,
    success: bool | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> str:
    """Baut den CSV-Export (max. 5000 Zeilen, neueste zuerst). Keine Secrets."""
    stmt = _apply_filters(
        select(SecurityEventRecord),
        event_type=event_type,
        user=user,
        ip=ip,
        severity=severity,
        success=success,
        since=since,
        until=until,
    ).order_by(SecurityEventRecord.created_at.desc(), SecurityEventRecord.id.desc()).limit(5000)
    records = db.scalars(stmt).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        [
            "Zeitpunkt", "Ereignis", "Severity", "Erfolg", "Benutzer-ID", "Eingabe",
            "Actor-ID", "IP (gekürzt)", "Methode", "Pfad", "Grund", "Request-ID",
        ]
    )
    for r in records:
        writer.writerow(
            [
                _fmt(r.created_at) or "",
                r.event_type,
                r.severity,
                "ja" if r.success else "nein",
                r.user_external_id or "",
                r.entered_identifier or "",
                r.actor_external_id or "",
                shorten_ip(r.ip) or "",
                r.http_method or "",
                r.path or "",
                r.reason_code or "",
                r.request_id or "",
            ]
        )
    return buffer.getvalue()


def cleanup_old_events(db: Session, retention_days: int) -> int:
    """Löscht Events, die älter als die Aufbewahrungsfrist sind (Startup-Job)."""
    if retention_days <= 0:
        return 0
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    result = db.execute(delete(SecurityEventRecord).where(SecurityEventRecord.created_at < cutoff))
    db.commit()
    deleted = int(result.rowcount or 0)
    if deleted:
        logger.info("Security-Event-Retention: %s Einträge älter als %s Tage gelöscht", deleted, retention_days)
    return deleted
