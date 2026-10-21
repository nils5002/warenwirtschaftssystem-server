"""Companion App: gekoppelte Smartphone-Sitzungen und QR-Kopplung.

## Sicherheitsmodell

**Geraetesitzung.** Ein gekoppeltes Smartphone erhaelt
* ein langlebiges, zufaelliges Geraete-Secret (256 Bit) im HttpOnly-Cookie
  ``wms_device`` — gueltig nur fuer ``/api/companion``, ``SameSite=Strict``;
* kurzlebige Access-Tokens (``wms_auth``) mit dem Claim ``sid``.

In der DB steht nur der SHA-256-Hash des Secrets. Jede Erneuerung rotiert das
Secret. Wird ein abgeloestes Secret nach der Kulanzzeit erneut vorgelegt
(typisches Zeichen fuer ein kopiertes Cookie), wird das Geraet sofort
widerrufen. Jede API-Anfrage mit ``sid`` prueft die Geraetezeile — ein
Widerruf wirkt damit unmittelbar, ohne auf den Token-Ablauf zu warten.

**Trennung von Desktop und Handy.** Ein Desktop-Logout widerruft keine
Geraete und umgekehrt. Sicherheitsrelevante Ereignisse (Passwort-Reset,
Rollenwechsel, Deaktivierung/Sperre, "Sitzungen widerrufen" durch einen
Admin, Companion abschalten) widerrufen dagegen ALLE Geraete des Kontos.

**Kopplung.** Der QR-Code traegt nur einen kurzlebigen (120 s), einmaligen
Kopplungsnachweis — nie ein Login-Token. Das Handy "beansprucht" die Anfrage
(atomar, genau einmal) und erhaelt dafuer einen eigenen Nachweis; eine
Sitzung entsteht erst, nachdem der angemeldete PC-Benutzer die Anfrage
ausdruecklich bestaetigt hat. Ein weitergeleiteter QR-Code allein reicht nie.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..database.models import (
    CompanionDeviceRecord,
    CompanionPairingRecord,
    CompanionPasskeyRecord,
    UserRecord,
)

logger = logging.getLogger("cloud_web.companion")

DEVICE_COOKIE_NAME = "wms_device"
PAIRING_COOKIE_NAME = "wms_pairing"
COMPANION_COOKIE_PATH = "/api/companion"

# Kurzlebige Access-Tokens fuer Geraete: Widerruf wirkt ohnehin sofort (DB-
# Pruefung je Anfrage); die kurze Laufzeit begrenzt zusaetzlich die Wirkung
# eines abgegriffenen Tokens und taktet die Sperrlogik (Passkey-Entsperrung).
DEVICE_ACCESS_TOKEN_SECONDS = 15 * 60
# Geraete, die so lange nicht genutzt wurden, gelten als verwaist.
DEVICE_IDLE_EXPIRY = timedelta(days=90)
DEVICE_COOKIE_MAX_AGE = int(DEVICE_IDLE_EXPIRY.total_seconds())
# Kulanz fuer parallele Erneuerungen (mehrere Tabs/Requests gleichzeitig).
SECRET_REUSE_GRACE = timedelta(seconds=60)
# last_seen_at nicht bei jeder Anfrage schreiben.
LAST_SEEN_RESOLUTION = timedelta(minutes=5)

PAIRING_TTL = timedelta(seconds=120)
# Nach dem Einlesen bleibt Zeit fuer die Bestaetigung am PC + Abschluss.
PAIRING_DECISION_TTL = timedelta(minutes=5)
MAX_DEVICES_PER_USER = 10

STATUS_PENDING = "pending"
STATUS_CLAIMED = "claimed"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"
STATUS_CONSUMED = "consumed"
STATUS_CANCELLED = "cancelled"
STATUS_EXPIRED = "expired"

REASON_USER = "user_removed"
REASON_ALL = "user_removed_all"
REASON_DISABLED = "companion_disabled"
REASON_LOGOUT = "device_logout"
REASON_SECURITY = "security_event"
REASON_REUSE = "secret_reuse"
REASON_IDLE = "idle_expired"


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    """SQLite liefert DateTime naiv zurueck — fuer Vergleiche anheben."""
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def hash_secret(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _new_secret() -> str:
    return secrets.token_urlsafe(32)


def _unauthorized(detail: str = "Geraetesitzung ist nicht mehr gueltig. Bitte erneut verbinden.") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


# --- Plattform-Beschreibung ---------------------------------------------------


def describe_user_agent(user_agent: str | None) -> tuple[str, str | None]:
    """Grobe, ehrliche Geraetebeschreibung aus dem User-Agent.

    Bewusst keine exakten Hardwaremodelle — der User-Agent gibt sie nicht
    verlaesslich her. Liefert ``(Anzeigename, Plattform)``.
    """
    ua = (user_agent or "").lower()
    if "iphone" in ua:
        system = "iPhone"
    elif "ipad" in ua or ("macintosh" in ua and "mobile" in ua):
        system = "iPad"
    elif "android" in ua:
        system = "Android"
    elif "windows" in ua:
        system = "Windows"
    elif "mac os" in ua or "macintosh" in ua:
        system = "Mac"
    elif "linux" in ua:
        system = "Linux"
    else:
        system = None

    if "edg/" in ua or "edga/" in ua or "edgios/" in ua:
        browser = "Edge"
    elif "samsungbrowser" in ua:
        browser = "Samsung Internet"
    elif "firefox" in ua or "fxios" in ua:
        browser = "Firefox"
    elif "crios" in ua or ("chrome" in ua and "chromium" not in ua):
        browser = "Chrome"
    elif "safari" in ua:
        browser = "Safari"
    else:
        browser = None

    platform = " · ".join(part for part in (system, browser) if part) or None
    name = system or "Smartphone"
    return name, platform


# --- Companion an/aus ---------------------------------------------------------


def is_enabled(user: UserRecord) -> bool:
    return bool(getattr(user, "companion_enabled", False))


def set_enabled(db: Session, user: UserRecord, enabled: bool) -> int:
    """Schaltet Companion fuer das eigene Konto um.

    Abschalten widerruft alle Geraete und offene Kopplungen sofort. Liefert
    die Zahl der widerrufenen Geraete.
    """
    revoked = 0
    user.companion_enabled = bool(enabled)
    if not enabled:
        revoked = revoke_all_devices(db, user.external_id, REASON_DISABLED, commit=False)
        _cancel_open_pairings(db, user.external_id)
    db.commit()
    return revoked


# --- Geraete ------------------------------------------------------------------


@dataclass(frozen=True)
class DeviceCredential:
    """Ergebnis von Anlage/Erneuerung: Geraet + ggf. neues Cookie-Secret."""

    device: CompanionDeviceRecord
    user: UserRecord
    # None = Secret wurde nicht rotiert (Kulanzfall) -> Cookie nicht neu setzen.
    cookie_value: str | None


def cookie_value_for(device: CompanionDeviceRecord, secret: str) -> str:
    return f"{device.external_id}.{secret}"


def _split_cookie(value: str | None) -> tuple[str, str] | None:
    raw = (value or "").strip()
    if "." not in raw:
        return None
    device_id, secret = raw.split(".", 1)
    if not device_id or len(secret) < 20:
        return None
    return device_id, secret


def active_devices(db: Session, user_external_id: str) -> list[CompanionDeviceRecord]:
    return list(
        db.scalars(
            select(CompanionDeviceRecord)
            .where(
                CompanionDeviceRecord.user_external_id == user_external_id,
                CompanionDeviceRecord.revoked_at.is_(None),
            )
            .order_by(CompanionDeviceRecord.created_at.desc())
        ).all()
    )


def create_device(
    db: Session, user: UserRecord, *, name: str, platform: str | None
) -> DeviceCredential:
    """Legt eine neue Geraetesitzung an (nur nach bestaetigter Kopplung)."""
    if len(active_devices(db, user.external_id)) >= MAX_DEVICES_PER_USER:
        raise HTTPException(
            status_code=409,
            detail=f"Es sind bereits {MAX_DEVICES_PER_USER} Geraete verbunden. Bitte zuerst ein Geraet entfernen.",
        )
    secret = _new_secret()
    now = _now()
    device = CompanionDeviceRecord(
        external_id=f"dev-{secrets.token_hex(8)}",
        user_external_id=user.external_id,
        name=(name or "Smartphone")[:120],
        platform=(platform or None) and platform[:120],
        secret_hash=hash_secret(secret),
        secret_rotated_at=now,
        last_seen_at=now,
    )
    db.add(device)
    db.flush()
    return DeviceCredential(device=device, user=user, cookie_value=cookie_value_for(device, secret))


def _device_user(db: Session, device: CompanionDeviceRecord) -> UserRecord:
    user = db.scalar(select(UserRecord).where(UserRecord.external_id == device.user_external_id))
    if user is None or not user.is_active or not is_enabled(user):
        raise _unauthorized()
    return user


def _is_idle_expired(device: CompanionDeviceRecord, now: datetime) -> bool:
    last_seen = _aware(device.last_seen_at) or _aware(device.created_at) or now
    return now - last_seen > DEVICE_IDLE_EXPIRY


def refresh_device(db: Session, cookie_value: str | None) -> DeviceCredential:
    """Prueft das Geraete-Cookie und rotiert das Secret.

    * aktuelles Secret -> neues Secret, ``cookie_value`` gesetzt;
    * gerade abgeloestes Secret innerhalb der Kulanzzeit -> gueltig, aber
      keine erneute Rotation (paralleler Request desselben Geraets);
    * abgeloestes Secret ausserhalb der Kulanzzeit -> Wiederverwendung,
      Geraet wird widerrufen;
    * alles andere -> 401.
    """
    parts = _split_cookie(cookie_value)
    if parts is None:
        raise _unauthorized()
    device_id, secret = parts
    device = db.scalar(
        select(CompanionDeviceRecord).where(CompanionDeviceRecord.external_id == device_id)
    )
    if device is None or device.revoked_at is not None:
        raise _unauthorized()

    now = _now()
    presented = hash_secret(secret)
    if device.secret_hash and secrets.compare_digest(presented, device.secret_hash):
        pass
    elif device.previous_secret_hash and secrets.compare_digest(presented, device.previous_secret_hash):
        rotated_at = _aware(device.secret_rotated_at) or now
        if now - rotated_at <= SECRET_REUSE_GRACE:
            user = _device_user(db, device)
            device.last_seen_at = now
            db.commit()
            return DeviceCredential(device=device, user=user, cookie_value=None)
        revoke_device(db, device, REASON_REUSE)
        logger.warning(
            "Companion: abgeloestes Geraete-Secret erneut verwendet — Geraet %s widerrufen",
            device.external_id,
        )
        raise _unauthorized("Diese Geraetesitzung wurde aus Sicherheitsgruenden beendet. Bitte erneut verbinden.")
    else:
        raise _unauthorized()

    if _is_idle_expired(device, now):
        revoke_device(db, device, REASON_IDLE)
        raise _unauthorized("Die Geraetesitzung ist nach langer Inaktivitaet abgelaufen. Bitte erneut verbinden.")

    user = _device_user(db, device)
    new_secret = _new_secret()
    device.previous_secret_hash = device.secret_hash
    device.secret_hash = hash_secret(new_secret)
    device.secret_rotated_at = now
    device.last_seen_at = now
    db.commit()
    return DeviceCredential(device=device, user=user, cookie_value=cookie_value_for(device, new_secret))


def device_from_cookie(db: Session, cookie_value: str | None) -> CompanionDeviceRecord | None:
    """Liefert das (nicht widerrufene) Geraet zum Cookie, OHNE zu rotieren."""
    parts = _split_cookie(cookie_value)
    if parts is None:
        return None
    device_id, secret = parts
    device = db.scalar(
        select(CompanionDeviceRecord).where(CompanionDeviceRecord.external_id == device_id)
    )
    if device is None or device.revoked_at is not None:
        return None
    presented = hash_secret(secret)
    for known in (device.secret_hash, device.previous_secret_hash):
        if known and secrets.compare_digest(presented, known):
            return device
    return None


def check_device_session(db: Session, user: UserRecord, device_id: str) -> CompanionDeviceRecord:
    """Pruefung je API-Anfrage mit ``sid``: Geraet gueltig und Companion aktiv."""
    device = db.scalar(
        select(CompanionDeviceRecord).where(CompanionDeviceRecord.external_id == device_id)
    )
    if (
        device is None
        or device.revoked_at is not None
        or device.user_external_id != user.external_id
        or not is_enabled(user)
    ):
        raise _unauthorized()
    now = _now()
    last_seen = _aware(device.last_seen_at)
    if last_seen is None or now - last_seen > LAST_SEEN_RESOLUTION:
        device.last_seen_at = now
        db.commit()
    return device


def revoke_device(
    db: Session, device: CompanionDeviceRecord, reason: str, *, commit: bool = True
) -> None:
    if device.revoked_at is None:
        device.revoked_at = _now()
        device.revoke_reason = reason[:40]
        device.secret_hash = None
        device.previous_secret_hash = None
        device.unlocked_until = None
        device.webauthn_challenge = None
    if commit:
        db.commit()


def revoke_all_devices(
    db: Session, user_external_id: str, reason: str, *, commit: bool = True
) -> int:
    """Widerruft alle Geraete eines Kontos. Liefert die Anzahl."""
    devices = active_devices(db, user_external_id)
    for device in devices:
        revoke_device(db, device, reason, commit=False)
    if commit:
        db.commit()
    return len(devices)


def own_device_or_404(db: Session, user_external_id: str, device_id: str) -> CompanionDeviceRecord:
    device = db.scalar(
        select(CompanionDeviceRecord).where(
            CompanionDeviceRecord.external_id == device_id,
            CompanionDeviceRecord.user_external_id == user_external_id,
        )
    )
    # Fremde Geraete sind fuer den Aufrufer schlicht "nicht vorhanden".
    if device is None:
        raise HTTPException(status_code=404, detail="Geraet nicht gefunden.")
    return device


def has_passkey(db: Session, device: CompanionDeviceRecord) -> bool:
    return (
        db.scalar(
            select(CompanionPasskeyRecord.id).where(
                CompanionPasskeyRecord.device_external_id == device.external_id
            )
        )
        is not None
    )


# --- Kopplung -------------------------------------------------------------------


def _cancel_open_pairings(db: Session, user_external_id: str) -> None:
    db.execute(
        update(CompanionPairingRecord)
        .where(
            CompanionPairingRecord.user_external_id == user_external_id,
            CompanionPairingRecord.status.in_([STATUS_PENDING, STATUS_CLAIMED, STATUS_APPROVED]),
        )
        .values(status=STATUS_CANCELLED, decided_at=_now())
    )


@dataclass(frozen=True)
class PairingStart:
    pairing: CompanionPairingRecord
    # Klartext-Code fuer den QR-Link — verlaesst den Server genau einmal.
    code: str


def start_pairing(db: Session, user: UserRecord) -> PairingStart:
    """Erzeugt eine neue Kopplungsanfrage; aeltere offene werden verworfen."""
    if not is_enabled(user):
        raise HTTPException(status_code=409, detail="Bitte zuerst die Companion App aktivieren.")
    _cancel_open_pairings(db, user.external_id)
    code = secrets.token_urlsafe(32)
    pairing = CompanionPairingRecord(
        external_id=f"pair-{secrets.token_hex(8)}",
        user_external_id=user.external_id,
        code_hash=hash_secret(code),
        status=STATUS_PENDING,
        expires_at=_now() + PAIRING_TTL,
    )
    db.add(pairing)
    db.commit()
    db.refresh(pairing)
    return PairingStart(pairing=pairing, code=code)


def _expire_if_needed(db: Session, pairing: CompanionPairingRecord) -> None:
    if pairing.status in (STATUS_PENDING, STATUS_CLAIMED, STATUS_APPROVED):
        expires = _aware(pairing.expires_at)
        if expires is not None and _now() > expires:
            pairing.status = STATUS_EXPIRED
            db.commit()


def own_pairing_or_404(db: Session, user_external_id: str, pairing_id: str) -> CompanionPairingRecord:
    pairing = db.scalar(
        select(CompanionPairingRecord).where(
            CompanionPairingRecord.external_id == pairing_id,
            CompanionPairingRecord.user_external_id == user_external_id,
        )
    )
    if pairing is None:
        raise HTTPException(status_code=404, detail="Kopplungsanfrage nicht gefunden.")
    _expire_if_needed(db, pairing)
    return pairing


@dataclass(frozen=True)
class PairingClaim:
    pairing: CompanionPairingRecord
    user: UserRecord
    # Klartext-Nachweis des Handys (wird als HttpOnly-Cookie gesetzt).
    claim_secret: str


def claim_pairing(db: Session, code: str, *, user_agent: str | None) -> PairingClaim:
    """Handy liest den QR-Code ein: Anfrage genau einmal beanspruchen.

    Atomar per bedingtem UPDATE (``status = pending``) — von zwei parallelen
    Einloesungen gewinnt genau eine. Unbekannte, abgelaufene und bereits
    eingeloeste Codes liefern dieselbe Antwort (keine Rueckschluesse).
    """
    invalid = HTTPException(
        status_code=410,
        detail="Dieser QR-Code ist abgelaufen oder wurde bereits verwendet. Bitte am PC einen neuen Code erzeugen.",
    )
    raw = (code or "").strip()
    if len(raw) < 20:
        raise invalid
    code_hash = hash_secret(raw)
    claim_secret = secrets.token_urlsafe(32)
    name, platform = describe_user_agent(user_agent)
    now = _now()
    result = db.execute(
        update(CompanionPairingRecord)
        .where(
            CompanionPairingRecord.code_hash == code_hash,
            CompanionPairingRecord.status == STATUS_PENDING,
            CompanionPairingRecord.expires_at > now,
        )
        .values(
            status=STATUS_CLAIMED,
            claimed_at=now,
            claim_hash=hash_secret(claim_secret),
            match_code=f"{secrets.randbelow(1_000_000):06d}",
            device_name=name,
            device_platform=platform,
            # Ab jetzt zaehlt das Entscheidungsfenster.
            expires_at=now + PAIRING_DECISION_TTL,
        )
    )
    db.commit()
    if result.rowcount != 1:
        raise invalid
    pairing = db.scalar(select(CompanionPairingRecord).where(CompanionPairingRecord.code_hash == code_hash))
    user = db.scalar(select(UserRecord).where(UserRecord.external_id == pairing.user_external_id))
    if user is None or not user.is_active or not is_enabled(user):
        pairing.status = STATUS_CANCELLED
        db.commit()
        raise invalid
    return PairingClaim(pairing=pairing, user=user, claim_secret=claim_secret)


def pairing_from_claim(db: Session, claim_secret: str | None) -> CompanionPairingRecord:
    raw = (claim_secret or "").strip()
    if len(raw) < 20:
        raise HTTPException(status_code=404, detail="Keine laufende Kopplung auf diesem Geraet.")
    pairing = db.scalar(
        select(CompanionPairingRecord).where(CompanionPairingRecord.claim_hash == hash_secret(raw))
    )
    if pairing is None:
        raise HTTPException(status_code=404, detail="Keine laufende Kopplung auf diesem Geraet.")
    _expire_if_needed(db, pairing)
    return pairing


def decide_pairing(db: Session, pairing: CompanionPairingRecord, *, approve: bool) -> CompanionPairingRecord:
    """Entscheidung am PC. Nur eine beanspruchte, nicht abgelaufene Anfrage."""
    if pairing.status != STATUS_CLAIMED:
        raise HTTPException(
            status_code=409,
            detail="Diese Anfrage kann nicht mehr bestaetigt werden (abgelaufen, abgebrochen oder bereits entschieden).",
        )
    result = db.execute(
        update(CompanionPairingRecord)
        .where(
            CompanionPairingRecord.id == pairing.id,
            CompanionPairingRecord.status == STATUS_CLAIMED,
        )
        .values(status=STATUS_APPROVED if approve else STATUS_REJECTED, decided_at=_now())
    )
    db.commit()
    if result.rowcount != 1:
        raise HTTPException(status_code=409, detail="Diese Anfrage wurde bereits entschieden.")
    db.refresh(pairing)
    return pairing


def complete_pairing(db: Session, pairing: CompanionPairingRecord) -> DeviceCredential:
    """Handy holt nach PC-Bestaetigung seine Geraetesitzung ab (genau einmal)."""
    if pairing.status != STATUS_APPROVED:
        raise HTTPException(status_code=409, detail="Die Kopplung wurde am PC (noch) nicht bestaetigt.")
    result = db.execute(
        update(CompanionPairingRecord)
        .where(
            CompanionPairingRecord.id == pairing.id,
            CompanionPairingRecord.status == STATUS_APPROVED,
        )
        .values(status=STATUS_CONSUMED, consumed_at=_now(), claim_hash=None)
    )
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(status_code=409, detail="Diese Kopplung wurde bereits abgeschlossen.")
    user = db.scalar(select(UserRecord).where(UserRecord.external_id == pairing.user_external_id))
    if user is None or not user.is_active or not is_enabled(user):
        db.rollback()
        raise HTTPException(status_code=409, detail="Das Konto kann derzeit keine Geraete verbinden.")
    credential = create_device(
        db, user, name=pairing.device_name or "Smartphone", platform=pairing.device_platform
    )
    pairing.device_external_id = credential.device.external_id
    db.commit()
    return credential


# --- Aufraeumen ---------------------------------------------------------------


def cleanup(db: Session) -> None:
    """Verwirft abgelaufene Kopplungen und verwaiste Geraete (Startup)."""
    now = _now()
    db.execute(
        update(CompanionPairingRecord)
        .where(
            CompanionPairingRecord.status.in_([STATUS_PENDING, STATUS_CLAIMED, STATUS_APPROVED]),
            CompanionPairingRecord.expires_at < now,
        )
        .values(status=STATUS_EXPIRED, claim_hash=None)
    )
    stale_before = now - DEVICE_IDLE_EXPIRY
    for device in db.scalars(
        select(CompanionDeviceRecord).where(
            CompanionDeviceRecord.revoked_at.is_(None),
            CompanionDeviceRecord.last_seen_at < stale_before,
        )
    ).all():
        revoke_device(db, device, REASON_IDLE, commit=False)
    db.commit()
