"""Verschluesselte Ablage einzelner Secrets (derzeit: das SMTP-Passwort).

Verfahren: **Fernet** (AES-128-CBC + HMAC-SHA256, authentifiziert) aus der
``cryptography``-Bibliothek. Authentifiziert heisst: eine manipulierte
Datenbankzeile laesst sich nicht entschluesseln, sondern faellt als
``InvalidToken`` auf.

## Woher kommt der Schluessel?

1. **``MAIL_CONFIG_ENCRYPTION_KEY``** — expliziter Fernet-Key, falls gesetzt.
   Hat Vorrang, damit bestehende Installationen mit eigenem Key unveraendert
   weiterlaufen.
2. **Abgeleitet aus ``AUTH_TOKEN_SECRET``** — per HKDF-SHA256 mit eigenem
   Salt und Kontext-String (Domain-Separation). Das Auth-Secret wird dabei
   nie direkt als Key benutzt; der abgeleitete Key taugt ausschliesslich fuer
   diesen einen Zweck. Damit braucht eine korrekt abgesicherte Installation
   KEINEN zusaetzlichen ENV-Eintrag, um ein SMTP-Passwort zu speichern.

Der Platzhalter-Default von ``AUTH_TOKEN_SECRET`` (oder ein zu kurzer Wert)
wird ausserhalb der Entwicklung NICHT als Ableitungsbasis akzeptiert — ein
oeffentlich bekanntes Secret wuerde nichts schuetzen.

Entschluesselt wird mit allen verfuegbaren Keys (expliziter zuerst). Es wird
bewusst NICHT automatisch umverschluesselt: ein vorhandener Chiffretext bleibt
mit genau dem Key lesbar, mit dem er erstellt wurde.

## Eiserne Regeln
* Kein Schluessel wird in der Datenbank abgelegt; dort steht nur Chiffretext.
* Weder Klartext noch Schluessel tauchen in Logs oder API-Antworten auf.
* Fehlt jeder brauchbare Schluessel, bleibt die App voll funktionsfaehig —
  nur das Speichern eines neuen Secrets ist gesperrt (``SecretKeyMissingError``).

## Rotation / Verlust
Wird ``AUTH_TOKEN_SECRET`` geaendert (oder ein expliziter Key entfernt), ist
ein damit verschluesseltes SMTP-Passwort nicht mehr lesbar. Das wird als
``SecretDecryptionError`` sichtbar — es wird NIE stillschweigend ein leeres
Passwort verwendet. Neuvergabe: das SMTP-Passwort in der Administration
einmal neu eingeben; es wird dann mit dem aktuellen Schluessel abgelegt.
"""
from __future__ import annotations

import base64
import logging
from dataclasses import dataclass

from ..config.settings import Settings, get_settings

logger = logging.getLogger("cloud_web.secrets")

# Herkunft des Schluessels, mit dem NEU verschluesselt wird.
KEY_SOURCE_EXPLICIT = "explicit"
KEY_SOURCE_DERIVED = "derived"

# Domain-Separation fuer die HKDF-Ableitung. Diese Werte sind KEINE Secrets,
# muessen aber stabil bleiben — eine Aenderung macht gespeicherte Passwoerter
# unlesbar (dann: Kontext-Version hochzaehlen und Neuvergabe dokumentieren).
_HKDF_SALT = b"warehouse-system/secret-store/v1"
_HKDF_INFO = b"smtp-password-encryption/fernet"

# Bekannte Platzhalter (settings-Default, .env.example) — nie als Basis nutzen.
_PLACEHOLDER_SECRETS = {
    "change-me-in-production",
    "change-me-generate-a-long-random-secret",
    "change-me",
}
# Das Auth-Secret signiert bereits alle Login-Tokens; eine hoehere Huerde als
# dort waere ohne Sicherheitsgewinn, wuerde aber bestehende Installationen
# unnoetig zu einem neuen ENV-Eintrag zwingen.
_MIN_SECRET_LENGTH = 16
_DEV_ENVIRONMENTS = {"development", "dev", "local", "test", "testing"}


class SecretStoreError(RuntimeError):
    """Basisfehler der Secret-Ablage (traegt nie Klartext oder Key)."""


class SecretKeyMissingError(SecretStoreError):
    """Es steht kein brauchbarer Schluessel zur Verfuegung."""


class SecretDecryptionError(SecretStoreError):
    """Chiffretext passt zu keinem der aktuellen Schluessel."""


@dataclass(frozen=True)
class _Key:
    source: str
    fernet: object


def _is_dev(settings: Settings) -> bool:
    return (settings.app_env or "").strip().lower() in _DEV_ENVIRONMENTS


def _fernet_class():
    try:
        from cryptography.fernet import Fernet
    except ImportError as exc:  # pragma: no cover - Dependency ist Pflicht
        raise SecretKeyMissingError(
            "Die Verschluesselungsbibliothek steht nicht zur Verfuegung."
        ) from exc
    return Fernet


def _explicit_key(settings: Settings) -> _Key | None:
    raw = (settings.mail_config_encryption_key or "").strip()
    if not raw:
        return None
    try:
        return _Key(KEY_SOURCE_EXPLICIT, _fernet_class()(raw.encode("utf-8")))
    except (ValueError, TypeError) as exc:
        # Bewusst ohne den Wert selbst: ein falsch kopierter Key darf nicht
        # im Log landen. Kein stiller Rueckfall auf den abgeleiteten Key —
        # sonst wuerde mit einem anderen Schluessel gespeichert als gedacht.
        raise SecretKeyMissingError(
            "MAIL_CONFIG_ENCRYPTION_KEY ist gesetzt, aber kein gueltiger Fernet-Schluessel "
            "(44 Zeichen, url-safe base64). Variable korrigieren oder entfernen."
        ) from exc


def derivation_problem(settings: Settings) -> str | None:
    """Grund, warum AUTH_TOKEN_SECRET nicht als Ableitungsbasis taugt (oder None)."""
    secret = (settings.auth_token_secret or "").strip()
    if not secret:
        return "AUTH_TOKEN_SECRET ist nicht gesetzt."
    if _is_dev(settings):
        return None
    if secret in _PLACEHOLDER_SECRETS:
        return "AUTH_TOKEN_SECRET steht noch auf dem Platzhalterwert."
    if len(secret) < _MIN_SECRET_LENGTH:
        return f"AUTH_TOKEN_SECRET ist kuerzer als {_MIN_SECRET_LENGTH} Zeichen."
    return None


def _derived_key(settings: Settings) -> _Key | None:
    if derivation_problem(settings):
        return None
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    material = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_HKDF_SALT,
        info=_HKDF_INFO,
    ).derive(settings.auth_token_secret.strip().encode("utf-8"))
    return _Key(KEY_SOURCE_DERIVED, _fernet_class()(base64.urlsafe_b64encode(material)))


def _keys(settings: Settings) -> list[_Key]:
    """Alle verfuegbaren Schluessel, der fuer Neuverschluesselung zuerst."""
    keys = [key for key in (_explicit_key(settings), _derived_key(settings)) if key]
    if not keys:
        reason = derivation_problem(settings) or "Kein Schluessel verfuegbar."
        raise SecretKeyMissingError(
            "SMTP-Passwoerter koennen nicht verschluesselt gespeichert werden: "
            f"{reason} Bitte ein sicheres AUTH_TOKEN_SECRET (mind. "
            f"{_MIN_SECRET_LENGTH} Zeichen) oder MAIL_CONFIG_ENCRYPTION_KEY setzen."
        )
    return keys


def key_source(settings: Settings | None = None) -> str | None:
    """Herkunft des Schluessels fuer neue Secrets (``explicit``/``derived``) oder None."""
    try:
        return _keys(settings or get_settings())[0].source
    except SecretKeyMissingError:
        return None


def is_available(settings: Settings | None = None) -> bool:
    """True, wenn ein brauchbarer Schluessel vorliegt."""
    return key_source(settings) is not None


def availability_hint(settings: Settings | None = None) -> str | None:
    """Grund, warum keine Secrets gespeichert werden koennen (oder None)."""
    try:
        _keys(settings or get_settings())
    except SecretKeyMissingError as exc:
        return str(exc)
    return None


def encrypt(value: str, settings: Settings | None = None) -> str:
    """Verschluesselt einen Klartext mit dem primaeren Schluessel."""
    key = _keys(settings or get_settings())[0]
    return key.fernet.encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(token: str, settings: Settings | None = None) -> str:
    """Entschluesselt einen Chiffretext mit dem passenden Schluessel.

    ``SecretKeyMissingError``, wenn gar kein Key da ist;
    ``SecretDecryptionError``, wenn der Chiffretext zu keinem Key passt
    (geaendertes AUTH_TOKEN_SECRET, anderer Stack, manipulierte Zeile).
    """
    keys = _keys(settings or get_settings())
    for key in keys:
        try:
            return key.fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except Exception:  # noqa: BLE001 — InvalidToken + Formatfehler
            continue
    logger.error(
        "Gespeichertes Secret konnte mit keinem der %d verfuegbaren Schluessel "
        "entschluesselt werden.",
        len(keys),
    )
    raise SecretDecryptionError(
        "Das gespeicherte SMTP-Passwort kann mit dem aktuellen Schluessel nicht "
        "entschluesselt werden (z. B. nach einer Aenderung von AUTH_TOKEN_SECRET "
        "oder MAIL_CONFIG_ENCRYPTION_KEY). Bitte das SMTP-Passwort neu eingeben."
    )


def generate_key() -> str:
    """Erzeugt einen neuen Fernet-Key (Hilfsmittel fuer die Dokumentation)."""
    from cryptography.fernet import Fernet

    return Fernet.generate_key().decode("ascii")
