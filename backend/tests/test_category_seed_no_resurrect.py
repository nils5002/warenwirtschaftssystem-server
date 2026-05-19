"""Regressionstest: Geloeschte Kategorien duerfen nach einem Server-Start
nicht wieder auftauchen.

Hintergrund: Im Kategorien-Modul geloeschte Standardkategorien (z. B.
"Router", "Smartphone", "Zubehoer", "Sonstiges") waren nach einem
Browser-Refresh wieder sichtbar. Ursachen:

1. ``delete_category`` entfernte den Datensatz HART aus der DB.
2. ``seed_standard_categories`` legte beim naechsten Start jede fehlende
   kanonische Kategorie wieder an bzw. reaktivierte inaktive.

Der Fix macht ``delete_category`` zu einem Soft-Delete (``is_active=False``)
und laesst ``seed_standard_categories`` auf einer bereits befuellten DB weder
neu anlegen noch reaktivieren. Diese Tests sichern beide Eigenschaften ab.

Die Tests laufen gegen eine isolierte In-Memory-SQLite-DB — sie beruehren
weder ``app.db`` noch den geteilten Teststand.
"""

from __future__ import annotations

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.database import models  # noqa: F401  -- registriert die ORM-Tabellen
from app.database.base import Base
from app.database.models import CategoryRecord
from app.domain.categories import CANONICAL_CATEGORIES
from app.repositories import category_repository


def _make_session() -> Session:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, future=True)()


def _active_names(db: Session) -> set[str]:
    return {item.name for item in category_repository.list_categories(db)}


def test_seed_creates_full_standard_set_on_fresh_db() -> None:
    """Frische (leere) DB: seed legt den vollstaendigen Standardsatz aktiv an."""
    db = _make_session()
    try:
        category_repository.seed_standard_categories(db)
        names = _active_names(db)
        for canonical in CANONICAL_CATEGORIES:
            assert canonical in names, f"Standardkategorie fehlt: {canonical}"
    finally:
        db.close()


def test_deleted_standard_category_is_not_resurrected_by_seed() -> None:
    """Soft-Delete + erneuter Seed-Lauf: die Kategorie bleibt deaktiviert."""
    db = _make_session()
    try:
        category_repository.seed_standard_categories(db)
        router = next(
            item for item in category_repository.list_categories(db)
            if item.name == "Router"
        )

        category_repository.delete_category(db, router.id)
        assert "Router" not in _active_names(db), "Soft-Delete: nicht mehr aktiv"
        row = db.get(CategoryRecord, router.id)
        assert row is not None, "Soft-Delete behaelt den Datensatz"
        assert row.is_active is False

        # Zweiter Seed-Lauf == Server-Neustart / uvicorn-Reload.
        category_repository.seed_standard_categories(db)
        assert "Router" not in _active_names(db), (
            "geloeschte Standardkategorie darf nach Seed nicht wieder erscheinen"
        )
        assert db.get(CategoryRecord, router.id).is_active is False
    finally:
        db.close()


def test_seed_does_not_recreate_a_missing_standard_category() -> None:
    """Auf einer befuellten DB legt seed eine fehlende kanonische Kategorie
    NICHT nach (schuetzt vor Resurrection alter Hard-Deletes)."""
    db = _make_session()
    try:
        category_repository.seed_standard_categories(db)
        row = db.scalar(select(CategoryRecord).where(CategoryRecord.name == "Router"))
        db.delete(row)  # simuliert den alten harten DELETE
        db.commit()

        category_repository.seed_standard_categories(db)
        assert "Router" not in _active_names(db)
    finally:
        db.close()


def test_recreating_deleted_category_reactivates_same_record() -> None:
    """Undelete-Pfad: dieselbe Kategorie neu anlegen reaktiviert den
    bestehenden (inaktiven) Datensatz."""
    db = _make_session()
    try:
        category_repository.seed_standard_categories(db)
        router = next(
            item for item in category_repository.list_categories(db)
            if item.name == "Router"
        )
        category_repository.delete_category(db, router.id)
        assert "Router" not in _active_names(db)

        recreated = category_repository.create_category(db, "Router")
        assert recreated.id == router.id, "derselbe Datensatz wird reaktiviert"
        assert recreated.isActive is True
        assert "Router" in _active_names(db)
    finally:
        db.close()
