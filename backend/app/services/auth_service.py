from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import importlib
import json
import logging
import secrets
from datetime import UTC, datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config.settings import Settings, get_settings
from ..database.models import UserRecord
from ..schemas.auth import AuthUserInfo
from ..schemas.job import LoginRequest, LoginResponse

logger = logging.getLogger("cloud_web.auth")
# Token-Lebensdauer (Security-Audit Paket A): von 12 h auf 2 h reduziert.
# Kürzere Gültigkeit begrenzt das Zeitfenster eines abgegriffenen Tokens,
# ohne dass dafür eine Refresh-Token-Architektur nötig wäre.
AUTH_TOKEN_EXPIRY_SECONDS = 60 * 60 * 2
pwd_context = CryptContext(schemes=["pbkdf2_sha256", "bcrypt"], deprecated="auto")

ROLE_ADMIN = "admin"
ROLE_PROJECT_MANAGER = "project_manager"
ROLE_EMPLOYEE = "employee"

# Unsicherer Default des Auth-Secrets (siehe config/settings.py).
DEFAULT_AUTH_SECRET = "change-me-in-production"
# Umgebungen, in denen ein fehlendes Secret nur eine Warnung auslöst.
_DEV_ENVIRONMENTS = {"development", "dev", "local", "test", "testing"}


def verify_auth_secret(settings: Settings) -> None:
    """Schützt vor einem produktiven Start mit unsicherem Auth-Secret.

    Läuft die App außerhalb einer Dev-Umgebung noch mit dem Default-Secret
    (oder leer), könnte jeder gültige Tokens — inklusive Admin-Rolle —
    selbst signieren. In dem Fall wird der Start hart abgebrochen, statt
    unsicher online zu gehen. In Dev-Umgebungen genügt eine Warnung.

    Es wird bewusst KEIN Secret-Wert geloggt — nur die Tatsache.
    """
    env = (settings.app_env or "").strip().lower()
    secret = (settings.auth_token_secret or "").strip()
    secret_is_insecure = secret in {"", DEFAULT_AUTH_SECRET}
    if not secret_is_insecure:
        return
    if env in _DEV_ENVIRONMENTS:
        logger.warning(
            "AUTH_TOKEN_SECRET ist nicht sicher gesetzt (Umgebung '%s'). "
            "Für den Produktivbetrieb zwingend ein eigenes Secret per ENV setzen.",
            env or "?",
        )
        return
    logger.error(
        "AUTH_TOKEN_SECRET ist in Umgebung '%s' nicht sicher gesetzt — App-Start abgebrochen.",
        env,
    )
    raise RuntimeError(
        "AUTH_TOKEN_SECRET muss außerhalb der Entwicklung auf einen geheimen "
        "Wert gesetzt werden (ENV). Start mit Default-Secret abgebrochen."
    )


def test_login(payload: LoginRequest) -> LoginResponse:
    sorter = importlib.import_module("cloud.cloud")
    password = payload.apple_password.get_secret_value()
    two_factor_code = (payload.two_factor_code or "").strip()

    class _TwoFactorRequired(Exception):
        pass

    pending_prompt: dict[str, Optional[str]] = {"text": None}
    original_input = getattr(sorter, "input", input)

    def _input(prompt: Optional[str] = None) -> str:
        if prompt:
            pending_prompt["text"] = prompt
        if two_factor_code:
            return two_factor_code
        raise _TwoFactorRequired()

    try:
        sorter.input = _input
        api = sorter.connect_icloud(payload.apple_id, password)
        trusted = bool(getattr(api, "is_trusted_session", False))
        return LoginResponse(
            success=True,
            two_factor_required=False,
            trusted_session=trusted,
            message="Anmeldung erfolgreich.",
        )
    except _TwoFactorRequired:
        message = (pending_prompt.get("text") or "Zwei-Faktor-Code erforderlich.").strip()
        return LoginResponse(
            success=False,
            two_factor_required=True,
            trusted_session=False,
            message=message or "Zwei-Faktor-Code erforderlich.",
        )
    except RuntimeError as exc:
        message = str(exc).strip() or "Apple-Login fehlgeschlagen."
        return LoginResponse(
            success=False,
            two_factor_required=False,
            trusted_session=False,
            message=message,
        )
    except Exception as exc:  # noqa: BLE001
        # Technische Fehlerdetails nur ins Server-Log, nie roh an den Client.
        logger.exception("Login fehlgeschlagen")
        raise HTTPException(
            status_code=502,
            detail="Login fehlgeschlagen. Bitte später erneut versuchen.",
        ) from exc
    finally:
        sorter.input = original_input


def _urlsafe_b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _urlsafe_b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def normalize_user_role(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in {"admin", "techniker", "administrator", ROLE_ADMIN}:
        return "Admin"
    if raw in {"projektmanager", "projectmanager", "project manager", ROLE_PROJECT_MANAGER}:
        return "Projektmanager"
    return "Mitarbeiter"


def normalize_role_for_db(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if raw in {"admin", "techniker", "administrator", ROLE_ADMIN}:
        return ROLE_ADMIN
    if raw in {"projektmanager", "projectmanager", "project manager", ROLE_PROJECT_MANAGER}:
        return ROLE_PROJECT_MANAGER
    return ROLE_EMPLOYEE


def role_to_app_role(value: str | None) -> str:
    return normalize_user_role(value)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return pwd_context.verify(password, password_hash)
    except Exception:
        # Legacy hash support:
        # pbkdf2_sha256$<iterations>$<salt>$<hex_digest>
        parts = (password_hash or "").split("$")
        if len(parts) == 4 and parts[0] == "pbkdf2_sha256":
            _, iterations_raw, salt, digest_hex = parts
            try:
                iterations = int(iterations_raw)
                candidate = hashlib.pbkdf2_hmac(
                    "sha256",
                    password.encode("utf-8"),
                    salt.encode("utf-8"),
                    iterations,
                ).hex()
            except Exception:
                return False
            return hmac.compare_digest(candidate, digest_hex)
        return False


def _auth_secret() -> str:
    settings = get_settings()
    return settings.auth_token_secret


def issue_access_token(
    user: AuthUserInfo,
    *,
    token_version: int = 0,
    expires_in: int = AUTH_TOKEN_EXPIRY_SECONDS,
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": user.userId,
        "role": normalize_role_for_db(user.role),
        "name": user.name,
        "email": user.email,
        # token_version (Security-Audit Paket B2): serverseitige
        # Invalidierung. Der Token gilt nur, solange "tv" zur token_version
        # des Benutzers in der DB passt.
        "tv": int(token_version),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    payload_raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    payload_part = _urlsafe_b64encode(payload_raw)
    signature = hmac.new(_auth_secret().encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256).digest()
    signature_part = _urlsafe_b64encode(signature)
    return f"{payload_part}.{signature_part}"


def _decode_token_payload(token: str) -> dict:
    """Validiert Signatur + Ablauf und liefert die Roh-Claims zurueck.

    Stateless — kein DB-Zugriff. Wirft 401 bei kaputtem, manipuliertem oder
    abgelaufenem Token.
    """
    try:
        payload_part, signature_part = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Ungültiger Auth-Token.") from exc
    expected_signature = hmac.new(
        _auth_secret().encode("utf-8"),
        payload_part.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    try:
        actual_signature = _urlsafe_b64decode(signature_part)
        payload = json.loads(_urlsafe_b64decode(payload_part).decode("utf-8"))
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Ungültiger Auth-Token.") from exc
    if not hmac.compare_digest(expected_signature, actual_signature):
        raise HTTPException(status_code=401, detail="Ungültige Token-Signatur.")
    now_ts = int(datetime.now(UTC).timestamp())
    if int(payload.get("exp", 0)) < now_ts:
        raise HTTPException(status_code=401, detail="Session abgelaufen. Bitte erneut einloggen.")
    return payload


def _payload_to_user_info(payload: dict) -> AuthUserInfo:
    return AuthUserInfo(
        userId=str(payload.get("sub", "")).strip(),
        name=str(payload.get("name", "")).strip(),
        email=str(payload.get("email", "")).strip(),
        role=normalize_user_role(payload.get("role")),
    )


def decode_access_token(token: str) -> AuthUserInfo:
    """Stateless-Dekodierung (Signatur + Ablauf, OHNE token_version-Pruefung).

    Wird fuer das reine Request-Logging in der Middleware genutzt — dort soll
    bewusst kein DB-Zugriff erfolgen. Fuer die echte Zugriffspruefung dient
    ``authenticate_token``.
    """
    return _payload_to_user_info(_decode_token_payload(token))


def _coerce_token_version(value: object) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        # Ein Token ohne/mit kaputtem "tv"-Claim wird wie Version 0 behandelt
        # — passt zum DB-Default und haelt Alt-Tokens bis zum ersten Bump gueltig.
        return 0


def authenticate_token(db: Session, token: str) -> AuthUserInfo:
    """Vollstaendige Token-Pruefung inkl. serverseitiger token_version.

    Zusaetzlich zu Signatur/Ablauf wird geprueft, ob der Benutzer noch
    existiert, aktiv ist und ob die im Token eingebettete token_version noch
    zur DB passt. Bei Logout, Passwortwechsel, Rollenwechsel oder
    Deaktivierung wird die token_version erhoeht — alte Tokens werden damit
    sofort ungueltig.
    """
    payload = _decode_token_payload(token)
    external_id = str(payload.get("sub", "")).strip()
    user = (
        db.scalar(select(UserRecord).where(UserRecord.external_id == external_id))
        if external_id
        else None
    )
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=401,
            detail="Sitzung ist nicht mehr gültig. Bitte erneut anmelden.",
        )
    if _coerce_token_version(payload.get("tv", 0)) != int(user.token_version or 0):
        raise HTTPException(
            status_code=401,
            detail="Sitzung ist nicht mehr gültig. Bitte erneut anmelden.",
        )
    return AuthUserInfo(
        userId=user.external_id,
        name=user.name,
        email=user.email,
        role=normalize_user_role(user.role),
    )


def invalidate_sessions(db: Session, external_id: str) -> None:
    """Erhoeht die token_version eines Benutzers.

    Damit werden alle bereits ausgestellten Tokens dieses Benutzers
    ungueltig. Wird beim Logout aufgerufen; die Repository-Schicht erhoeht
    die token_version zusaetzlich direkt bei Passwort-/Rollen-/Statusaenderung.
    """
    user = db.scalar(select(UserRecord).where(UserRecord.external_id == external_id))
    if user is None:
        return
    user.token_version = int(user.token_version or 0) + 1
    db.commit()


def ensure_user_passwords(db: Session) -> None:
    """
    Backward-compatible hardening for legacy seeded users without password hash.
    No demo password is assigned.
    """
    users = db.scalars(select(UserRecord)).all()
    changed = False
    for user in users:
        if user.password_hash:
            continue
        user.password_hash = hash_password(secrets.token_urlsafe(32))
        changed = True
    if changed:
        db.commit()
        logger.info("Sichere Zufalls-Hashes für %s Legacy-Benutzer ohne Passwort gesetzt.", len(users))


def ensure_initial_admin(db: Session) -> None:
    settings = get_settings()
    admin_exists = db.scalar(select(UserRecord.id).where(UserRecord.role == ROLE_ADMIN, UserRecord.is_active == True))  # noqa: E712
    if admin_exists:
        return

    email = (settings.initial_admin_email or "").strip().lower()
    password = (settings.initial_admin_password or "").strip()
    name = (settings.initial_admin_name or "").strip() or "Initial Admin"
    if not email or not password:
        logger.warning(
            "Kein aktiver Admin vorhanden. Setze INITIAL_ADMIN_EMAIL und INITIAL_ADMIN_PASSWORD, "
            "oder registriere den ersten Benutzer manuell."
        )
        return

    existing = db.scalar(select(UserRecord).where(UserRecord.email.ilike(email)))
    if existing:
        existing.name = name
        existing.role = ROLE_ADMIN
        existing.is_active = True
        if not existing.password_hash:
            existing.password_hash = hash_password(password)
        db.commit()
        logger.info("Initialer Admin aus ENV aktualisiert: %s", email)
        return

    user = UserRecord(
        external_id=f"usr-{secrets.token_hex(6)}",
        name=name,
        email=email,
        password_hash=hash_password(password),
        role=ROLE_ADMIN,
        is_active=True,
        status="Aktiv",
        last_active="Neu",
    )
    db.add(user)
    db.commit()
    logger.info("Initialer Admin aus ENV angelegt: %s", email)


def register_user(db: Session, name: str, email: str, password: str) -> None:
    normalized_email = email.strip().lower()
    if not normalized_email:
        raise HTTPException(status_code=400, detail="E-Mail ist erforderlich.")
    if not name.strip():
        raise HTTPException(status_code=400, detail="Name ist erforderlich.")
    if not password.strip():
        raise HTTPException(status_code=400, detail="Passwort ist erforderlich.")
    existing = db.scalar(select(UserRecord).where(UserRecord.email.ilike(normalized_email)))
    if existing:
        # Account-Enumeration vermeiden: keine 409-Auskunft, dass die E-Mail
        # bereits vergeben ist. Der Aufrufer erhält dieselbe generische
        # Erfolgsmeldung wie bei einer echten Neuregistrierung — es wird
        # bewusst kein zweites Konto angelegt.
        logger.info("Registrierung ignoriert: E-Mail bereits vergeben")
        return

    user = UserRecord(
        external_id=f"usr-{secrets.token_hex(6)}",
        name=name.strip(),
        email=normalized_email,
        password_hash=hash_password(password),
        role=ROLE_EMPLOYEE,
        is_active=False,
        status="Wartet auf Freigabe",
        last_active="Neu",
    )
    db.add(user)
    db.commit()


def authenticate_user(db: Session, email: str, password: str) -> tuple[AuthUserInfo, int]:
    """Prueft Zugangsdaten und liefert (Benutzerinfo, aktuelle token_version).

    Die token_version wird vom Aufrufer in den ausgestellten Token
    eingebettet, damit serverseitige Invalidierung greift.
    """
    needle = email.strip().lower()
    if not needle:
        # Bewusst KEIN Passwort/Token im Log — nur fachliches Ereignis.
        logger.warning("Login fehlgeschlagen (leere E-Mail)")
        raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten.")
    user = db.scalar(select(UserRecord).where(UserRecord.email.ilike(needle)))
    # Account-Enumeration vermeiden: unbekannte E-Mail und falsches Passwort
    # liefern dieselbe 401-Antwort. Erst NACH erfolgreicher Passwortprüfung
    # darf sich ein abweichender Zustand (Konto nicht freigegeben) zeigen.
    if user is None or not verify_password(password, user.password_hash):
        if user is None:
            logger.warning("Login fehlgeschlagen: Benutzer unbekannt")
        else:
            logger.warning("Login fehlgeschlagen: Passwort ungueltig (user_id=%s)", user.external_id)
        raise HTTPException(status_code=401, detail="Ungültige Zugangsdaten.")
    if not user.is_active:
        logger.warning("Login abgelehnt: Konto inaktiv (user_id=%s)", user.external_id)
        raise HTTPException(status_code=403, detail="Dein Konto wurde noch nicht freigegeben.")
    user.last_active = datetime.now(UTC).strftime("%d.%m.%Y %H:%M")
    db.commit()
    logger.info("Login erfolgreich (user_id=%s, role=%s)", user.external_id, user.role)
    info = AuthUserInfo(
        userId=user.external_id,
        name=user.name,
        email=user.email,
        role=normalize_user_role(user.role),
    )
    return info, int(user.token_version or 0)


def generate_temporary_password(length: int = 14) -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))
