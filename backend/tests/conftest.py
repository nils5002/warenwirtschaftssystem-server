from __future__ import annotations

import os

import pytest

# Overview-Cache in Tests deaktivieren (TTL=0): Tests pruefen Datenstaende
# unmittelbar nach Mutationen — ein aktives Cache-Fenster wuerde dort zu
# scheinbar veralteten Antworten fuehren. Muss VOR dem ersten App-Import
# gesetzt werden, weil get_settings() das Ergebnis cached.
os.environ.setdefault("OVERVIEW_CACHE_TTL_SECONDS", "0")

# Bild-Selbstheilung beim Startup in Tests deaktivieren: der Background-Task
# wuerde sonst bei TestClient-Kontextmanager-Nutzung echte HTTP-Downloads
# fuer Datensaetze mit Bild-URL anstossen.
os.environ.setdefault("PRODUCT_IMAGE_RECACHE_ON_STARTUP", "0")

# X-Forwarded-For in Tests als vertrauenswuerdig behandeln: die Rate-Limit-
# Tests isolieren sich gegenseitig ueber eindeutige XFF-Werte (simulierter
# Proxy). Das Default-Verhalten (Header ignorieren) wird gezielt in
# test_security_events.py geprueft.
os.environ.setdefault("TRUST_PROXY_HEADERS", "1")

from app.database.session import SessionLocal, init_db
from app.repositories import category_repository, role_permission_repository
from app.services import security_event_service
from app.services.auth_service import ensure_initial_admin, ensure_user_passwords


@pytest.fixture(scope="session", autouse=True)
def _bootstrap_database() -> None:
    """Ensure schema and standard categories exist.

    The FastAPI startup event only fires when TestClient is used as a context
    manager. Most existing tests instantiate ``TestClient(app)`` directly, so
    we run the equivalent bootstrap here once per test session.
    """
    init_db()
    with SessionLocal() as db:
        category_repository.seed_standard_categories(db)
        # Default-Rollenrechte seeden — sonst würden die auf require_permission
        # umgestellten Endpunkte mangels Daten 403 liefern.
        role_permission_repository.seed_default_role_permissions(db)
        try:
            ensure_initial_admin(db)
            ensure_user_passwords(db)
        except Exception:
            db.rollback()
        # Registrierung ist produktiv per Default AUS (Security-Paket
        # "supman"). Die bestehenden Auth-/Rate-Limit-Tests setzen einen
        # offenen Registrierungs-Endpunkt voraus — daher hier einschalten.
        # Das Default-AUS-Verhalten prueft test_security_events.py explizit.
        security_event_service.set_registration_enabled(db, True)


@pytest.fixture(autouse=True)
def _isolated_rate_limiters():
    """Rate-Limiter-State pro Test zuruecksetzen.

    Ohne XFF-Header teilen sich alle TestClient-Requests die IP "testclient" —
    Registrierungs-/Login-Versuche verschiedener Tests wuerden sonst im selben
    Bucket landen und die Suite reihenfolgeabhaengig machen. Die Rate-Limit-
    Tests selbst arbeiten innerhalb EINES Tests und bleiben aussagekraeftig.
    """
    from app.services.rate_limiter import (
        account_login_rate_limiter,
        login_rate_limiter,
        refresh_rate_limiter,
        register_rate_limiter,
    )

    limiters = (login_rate_limiter, account_login_rate_limiter, register_rate_limiter, refresh_rate_limiter)
    for limiter in limiters:
        limiter.reset_all()
    yield
    for limiter in limiters:
        limiter.reset_all()
