from __future__ import annotations

import os

import pytest

# Overview-Cache in Tests deaktivieren (TTL=0): Tests pruefen Datenstaende
# unmittelbar nach Mutationen — ein aktives Cache-Fenster wuerde dort zu
# scheinbar veralteten Antworten fuehren. Muss VOR dem ersten App-Import
# gesetzt werden, weil get_settings() das Ergebnis cached.
os.environ.setdefault("OVERVIEW_CACHE_TTL_SECONDS", "0")

from app.database.session import SessionLocal, init_db
from app.repositories import category_repository
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
        try:
            ensure_initial_admin(db)
            ensure_user_passwords(db)
        except Exception:
            db.rollback()
