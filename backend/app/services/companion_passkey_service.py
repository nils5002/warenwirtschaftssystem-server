"""Passkeys (WebAuthn) zum Entsperren gekoppelter Companion-Geraete.

Die gesamte Kryptografie (Attestation/Assertion, Signaturen, COSE-Schluessel)
uebernimmt die gepflegte Bibliothek ``webauthn`` (py_webauthn) — hier wird
nichts selbst implementiert. Dieses Modul kuemmert sich nur um:

* Challenges: zufaellig, einmalig, 5 Minuten gueltig, am Geraet gespeichert
  und VOR der Pruefung verbraucht (kein Replay, auch nicht bei Fehlschlag);
* Bindung: Ein Passkey gehoert zu genau einem Geraet; zum Entsperren werden
  nur dessen Passkeys akzeptiert;
* Origin/RP-ID: abgeleitet aus dem ``Origin`` der Anfrage, aber nur, wenn er
  zu den vertrauenswuerdigen Adressen des WWS gehoert;
* ``userVerification = required``: Ohne Face ID/Fingerabdruck/Geraete-PIN
  (je nach Geraet — die Methode bestimmt das Betriebssystem) kein Erfolg.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from urllib.parse import urlsplit

from fastapi import HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import CompanionDeviceRecord, CompanionPasskeyRecord, UserRecord

logger = logging.getLogger("cloud_web.companion.passkey")

CHALLENGE_TTL = timedelta(minutes=5)
PURPOSE_REGISTER = "register"
PURPOSE_UNLOCK = "unlock"
MAX_PASSKEYS_PER_DEVICE = 5
RP_NAME = "Warehouse Companion"


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def resolve_origin(request: Request, trusted: set[str]) -> tuple[str, str]:
    """Liefert ``(origin, rp_id)`` fuer WebAuthn oder 400.

    WebAuthn bindet Passkeys an die Domain (RP-ID). Massgeblich ist die
    Adresse, unter der die App tatsaechlich laeuft — aber nur, wenn sie zu
    den konfigurierten/eigenen Adressen gehoert.
    """
    origin = (request.headers.get("origin") or "").strip().lower().rstrip("/")
    if not origin or origin not in trusted:
        raise HTTPException(status_code=400, detail="Passkeys sind nur auf der eigenen WWS-Adresse verfuegbar.")
    parts = urlsplit(origin)
    host = parts.hostname or ""
    if parts.scheme != "https" and host not in {"localhost", "127.0.0.1"}:
        raise HTTPException(status_code=400, detail="Passkeys erfordern eine HTTPS-Verbindung.")
    return origin, host


def _store_challenge(device: CompanionDeviceRecord, challenge: bytes, purpose: str) -> None:
    from webauthn.helpers import bytes_to_base64url

    device.webauthn_challenge = bytes_to_base64url(challenge)
    device.webauthn_challenge_purpose = purpose
    device.webauthn_challenge_expires_at = _now() + CHALLENGE_TTL


def _consume_challenge(db: Session, device: CompanionDeviceRecord, purpose: str) -> bytes:
    """Holt die Challenge und verbraucht sie sofort (auch bei spaeterem Fehler)."""
    from webauthn.helpers import base64url_to_bytes

    stored = device.webauthn_challenge
    stored_purpose = device.webauthn_challenge_purpose
    expires = _aware(device.webauthn_challenge_expires_at)
    device.webauthn_challenge = None
    device.webauthn_challenge_purpose = None
    device.webauthn_challenge_expires_at = None
    db.commit()
    if not stored or stored_purpose != purpose or expires is None or _now() > expires:
        raise HTTPException(status_code=400, detail="Die Anfrage ist abgelaufen. Bitte erneut versuchen.")
    return base64url_to_bytes(stored)


def device_passkeys(db: Session, device: CompanionDeviceRecord) -> list[CompanionPasskeyRecord]:
    return list(
        db.scalars(
            select(CompanionPasskeyRecord).where(
                CompanionPasskeyRecord.device_external_id == device.external_id
            )
        ).all()
    )


def registration_options(
    db: Session, device: CompanionDeviceRecord, user: UserRecord, rp_id: str
) -> dict:
    from webauthn import generate_registration_options, options_to_json
    from webauthn.helpers import base64url_to_bytes
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        PublicKeyCredentialDescriptor,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    )
    import json

    existing = device_passkeys(db, device)
    if len(existing) >= MAX_PASSKEYS_PER_DEVICE:
        raise HTTPException(status_code=409, detail="Fuer dieses Geraet sind bereits genug Passkeys eingerichtet.")
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=RP_NAME,
        user_id=user.external_id.encode("utf-8"),
        user_name=user.email,
        user_display_name=user.name,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(item.credential_id)) for item in existing
        ],
    )
    _store_challenge(device, options.challenge, PURPOSE_REGISTER)
    db.commit()
    return json.loads(options_to_json(options))


def verify_registration(
    db: Session,
    device: CompanionDeviceRecord,
    user: UserRecord,
    credential: dict,
    *,
    origin: str,
    rp_id: str,
) -> CompanionPasskeyRecord:
    from webauthn import verify_registration_response
    from webauthn.helpers import bytes_to_base64url

    challenge = _consume_challenge(db, device, PURPOSE_REGISTER)
    try:
        verified = verify_registration_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            require_user_verification=True,
        )
    except Exception as exc:  # noqa: BLE001 — jede Pruefungsabweichung = abgelehnt
        logger.warning("Passkey-Registrierung abgelehnt (%s)", type(exc).__name__)
        raise HTTPException(status_code=400, detail="Der Passkey konnte nicht bestaetigt werden.") from exc

    credential_id = bytes_to_base64url(verified.credential_id)
    if db.scalar(select(CompanionPasskeyRecord.id).where(CompanionPasskeyRecord.credential_id == credential_id)):
        raise HTTPException(status_code=409, detail="Dieser Passkey ist bereits eingerichtet.")
    transports = credential.get("response", {}).get("transports") if isinstance(credential, dict) else None
    record = CompanionPasskeyRecord(
        user_external_id=user.external_id,
        device_external_id=device.external_id,
        credential_id=credential_id,
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=int(verified.sign_count or 0),
        transports=",".join(transports)[:120] if isinstance(transports, list) else None,
    )
    db.add(record)
    db.commit()
    return record


def unlock_options(db: Session, device: CompanionDeviceRecord, rp_id: str) -> dict:
    from webauthn import generate_authentication_options, options_to_json
    from webauthn.helpers import base64url_to_bytes
    from webauthn.helpers.structs import PublicKeyCredentialDescriptor, UserVerificationRequirement
    import json

    passkeys = device_passkeys(db, device)
    if not passkeys:
        raise HTTPException(status_code=409, detail="Fuer dieses Geraet ist kein Passkey eingerichtet.")
    options = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(item.credential_id)) for item in passkeys
        ],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    _store_challenge(device, options.challenge, PURPOSE_UNLOCK)
    db.commit()
    return json.loads(options_to_json(options))


def verify_unlock(
    db: Session,
    device: CompanionDeviceRecord,
    credential: dict,
    *,
    origin: str,
    rp_id: str,
) -> CompanionPasskeyRecord:
    from webauthn import verify_authentication_response
    from webauthn.helpers import base64url_to_bytes

    challenge = _consume_challenge(db, device, PURPOSE_UNLOCK)
    credential_id = str(credential.get("id") or credential.get("rawId") or "") if isinstance(credential, dict) else ""
    passkey = db.scalar(
        select(CompanionPasskeyRecord).where(
            CompanionPasskeyRecord.credential_id == credential_id,
            # Nur Passkeys GENAU dieses Geraets entsperren es.
            CompanionPasskeyRecord.device_external_id == device.external_id,
        )
    )
    if passkey is None:
        raise HTTPException(status_code=400, detail="Dieser Passkey gehoert nicht zu diesem Geraet.")
    try:
        verified = verify_authentication_response(
            credential=credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origin,
            credential_public_key=base64url_to_bytes(passkey.public_key),
            credential_current_sign_count=int(passkey.sign_count or 0),
            require_user_verification=True,
        )
    except Exception as exc:  # noqa: BLE001 — Signatur, Origin, Zaehler, UV ...
        logger.warning("Passkey-Entsperrung abgelehnt (%s)", type(exc).__name__)
        raise HTTPException(status_code=400, detail="Die Entsperrung konnte nicht bestaetigt werden.") from exc
    passkey.sign_count = int(verified.new_sign_count or 0)
    passkey.last_used_at = _now()
    db.commit()
    return passkey
