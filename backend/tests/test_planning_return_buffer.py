"""Tests für den Rückgabe-Puffer (return_buffer_days) der Einsatzplanung.

Bewusst gegen eine ISOLIERTE In-Memory-SQLite (kein app.db), damit Bestand und
Konfliktzahlen deterministisch sind und keine produktive DB berührt wird. Die
Tests rufen die echten Repository-Funktionen auf.
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.database import models  # noqa: F401  (Tabellen registrieren)
from app.database.models import AssetRecord, PlanningDayRecord, PlanningItemRecord, PlanningRecord
from app.main import app
from app.repositories import category_repository, planning_repository as PR
from app.schemas.backup import WarehouseBackupPayload
from app.services import backup_service
from .auth_helpers import auth_headers


D0 = date(2026, 8, 3)  # fixer Montag, unabhängig von "heute"


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    category_repository.seed_standard_categories(session)
    yield session
    session.close()


def _add_laptops(db, count: int) -> None:
    for i in range(count):
        db.add(
            AssetRecord(
                external_id=f"ast-{i}",
                name=f"Laptop {i}",
                category="Laptop",
                location="Lager",
                status="Verfuegbar",
                assigned_to="-",
                next_return="-",
                tag_number=f"TAG-{i}",
                serial_number=f"SN-{i}",
                qr_code=f"QR-{i}",
            )
        )
    db.commit()


def _add_planning(
    db,
    ext_id: str,
    start: date,
    end: date,
    items: dict[str, int],
    *,
    status: str = "Geplant",
    buffer: int = 0,
    handover_to: str | None = None,
    handover_cat: str | None = None,
) -> PlanningRecord:
    planning = PlanningRecord(
        external_id=ext_id,
        customer_name="Kunde",
        project_name=ext_id,
        start_date=start,
        end_date=end,
        notes="",
        status=status,
        return_buffer_days=buffer,
    )
    db.add(planning)
    db.flush()
    day = PlanningDayRecord(planning_id=planning.id, planning_date=start, weekday="Montag")
    db.add(day)
    db.flush()
    for cat, qty in items.items():
        is_handover = handover_to is not None and cat == handover_cat
        db.add(
            PlanningItemRecord(
                planning_day_id=day.id,
                category_key=cat,
                qty=qty,
                handover_enabled=is_handover,
                linked_planning_external_id=handover_to if is_handover else None,
            )
        )
    db.commit()
    return planning


def _conflict_counts(db) -> dict[str, int]:
    summaries = PR.get_open_conflict_summaries_for_plannings(db, None)
    return {ext_id: s["count"] for ext_id, s in summaries.items()}


# --- Helfer (reine Datumsmathematik) -------------------------------------------------

def test_blocking_helpers_buffer_zero_equals_bound_dates() -> None:
    start, end = D0, D0 + timedelta(days=2)  # belegte Tage {D0, D0+1}
    assert PR._iter_blocking_dates(start, end, 0) == PR._iter_bound_dates(start, end)
    assert PR._blocking_end_exclusive(start, end, 0) == PR._period_end_exclusive(start, end)


def test_blocking_helpers_extend_by_buffer() -> None:
    start, end = D0, D0 + timedelta(days=1)  # belegt {D0}, Rückgabe D0+1
    # Puffer 1 -> blockiert {D0, D0+1}, frei ab D0+2
    assert PR._blocking_end_exclusive(start, end, 1) == D0 + timedelta(days=2)
    assert PR._iter_blocking_dates(start, end, 1) == [D0, D0 + timedelta(days=1)]
    # Single-Day (end == start): belegt {D0}, Puffer 1 -> blockiert {D0, D0+1}
    assert PR._iter_blocking_dates(D0, D0, 1) == [D0, D0 + timedelta(days=1)]


# --- Engine: Puffer 0 = unverändert --------------------------------------------------

def test_buffer_zero_no_conflict_between_adjacent_plannings(db) -> None:
    _add_laptops(db, 5)
    # A belegt {D0}, B belegt {D0+1} — ohne Puffer keine Konkurrenz.
    _add_planning(db, "pln-A", D0, D0 + timedelta(days=1), {"Laptop": 5}, buffer=0)
    _add_planning(db, "pln-B", D0 + timedelta(days=1), D0 + timedelta(days=2), {"Laptop": 5}, buffer=0)
    assert _conflict_counts(db) == {"pln-A": 0, "pln-B": 0}
    # Detailpfad identisch: B hat keinen Engpass.
    av_b = PR.get_planning_availability(db, "pln-B")
    assert all(not it.hasGlobalShortage for it in av_b.items)


# --- Engine: Puffer 1 erzeugt Folgekonflikt am Rückgabetag ---------------------------

def test_buffer_one_creates_followup_conflict(db) -> None:
    _add_laptops(db, 5)
    # A belegt {D0}, Rückgabetag D0+1; Puffer 1 -> blockiert auch D0+1.
    _add_planning(db, "pln-A", D0, D0 + timedelta(days=1), {"Laptop": 5}, buffer=1)
    # B startet am Rückgabetag D0+1 mit vollem Bedarf -> Engpass NUR durch Puffer.
    _add_planning(db, "pln-B", D0 + timedelta(days=1), D0 + timedelta(days=2), {"Laptop": 5}, buffer=0)

    counts = _conflict_counts(db)
    assert counts["pln-B"] == 1, "Folgeplanung muss am Rückgabetag einen Konflikt bekommen"
    assert counts["pln-A"] == 0, "Die puffernde Planung selbst bekommt KEINEN Konflikt"

    # Detailpfad muss identisch rechnen: B sieht A am D0+1 als Konkurrenz.
    av_b = PR.get_planning_availability(db, "pln-B")
    shortage_items = [it for it in av_b.items if it.hasGlobalShortage]
    assert len(shortage_items) == 1
    item = shortage_items[0]
    assert item.categoryKey == "Laptop"
    assert item.planningDate == D0 + timedelta(days=1)
    assert item.shortageQty == 5
    assert "pln-A" in item.affectedPlanningIds


def test_buffer_does_not_block_after_window(db) -> None:
    _add_laptops(db, 5)
    _add_planning(db, "pln-A", D0, D0 + timedelta(days=1), {"Laptop": 5}, buffer=1)
    # C startet ERST nach dem Pufferfenster (D0+2) -> kein Konflikt.
    _add_planning(db, "pln-C", D0 + timedelta(days=2), D0 + timedelta(days=3), {"Laptop": 5}, buffer=0)
    counts = _conflict_counts(db)
    assert counts["pln-C"] == 0


# --- Übergaben: Puffer liefert keine Quellkapazität ----------------------------------

def test_buffer_day_provides_no_handover_capacity(db) -> None:
    _add_laptops(db, 5)
    # Quelle S: echter Tag D0, Puffer 1 (blockiert {D0, D0+1}).
    _add_planning(db, "pln-S", D0, D0 + timedelta(days=1), {"Laptop": 5}, buffer=1)
    # X erzeugt Konkurrenz am D0+2 (außerhalb von S' Blockfenster).
    _add_planning(db, "pln-X", D0 + timedelta(days=2), D0 + timedelta(days=3), {"Laptop": 5}, buffer=0)
    # C am D0+2, Vortag D0+1 ist ein PUFFERTAG von S. C verlinkt Übergabe auf S.
    _add_planning(
        db,
        "pln-C",
        D0 + timedelta(days=2),
        D0 + timedelta(days=3),
        {"Laptop": 5},
        buffer=0,
        handover_to="pln-S",
        handover_cat="Laptop",
    )
    av_c = PR.get_planning_availability(db, "pln-C")
    laptop_items = [it for it in av_c.items if it.categoryKey == "Laptop"]
    assert laptop_items, "C muss eine Laptop-Zeile haben"
    item = laptop_items[0]
    # Der Puffertag von S darf KEINE Übergabe-Kapazität liefern.
    assert item.handoverCoveredQty == 0
    assert item.hasGlobalShortage is True


# --- Backup/Restore ------------------------------------------------------------------

def test_backup_roundtrip_preserves_buffer(db) -> None:
    _add_laptops(db, 1)
    _add_planning(db, "pln-A", D0, D0 + timedelta(days=1), {"Laptop": 1}, buffer=2)
    exported = backup_service.export_backup(db)
    planning_payload = next(p for p in exported.plannings if p.id == "pln-A")
    assert planning_payload.returnBufferDays == 2

    # Restore in eine zweite isolierte DB.
    engine2 = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine2)
    db2 = sessionmaker(bind=engine2)()
    backup_service.import_backup(db2, exported)
    restored = db2.query(PlanningRecord).filter_by(external_id="pln-A").one()
    assert restored.return_buffer_days == 2
    db2.close()


def test_old_backup_without_field_imports_as_zero(db) -> None:
    # Backup-Payload OHNE returnBufferDays (Altbackup) muss als 0 importieren.
    payload = WarehouseBackupPayload.model_validate(
        {
            "version": 1,
            "exportedAt": "2026-01-01T00:00:00Z",
            "categories": [
                {"name": "Laptop", "normalizedName": "laptop", "isStandard": True, "isActive": True}
            ],
            "users": [],
            "assets": [],
            "activities": [],
            "reservations": [],
            "maintenanceItems": [],
            "locations": [],
            "plannings": [
                {
                    "id": "pln-old",
                    "customerName": "K",
                    "projectName": "Alt",
                    "startDate": "2026-08-03",
                    "endDate": "2026-08-04",
                    "notes": "",
                    "status": "Geplant",
                    "days": [],
                }
            ],
            "updateNotes": [],
            "rolePermissions": [],
            "qrCodeGroups": [],
        }
    )
    assert payload.plannings[0].returnBufferDays == 0
    backup_service.import_backup(db, payload)
    restored = db.query(PlanningRecord).filter_by(external_id="pln-old").one()
    assert restored.return_buffer_days == 0


# --- API-Vertrag (das, worauf sich das Frontend verlässt) ----------------------------

def _api_planning_payload(suffix: str, buffer: int) -> dict:
    day = (date.today() + timedelta(days=30)).isoformat()
    return {
        "customerName": f"Kunde {suffix}",
        "projectName": f"Projekt {suffix}",
        "startDate": day,
        "endDate": day,
        "notes": "",
        "status": "Entwurf",
        "returnBufferDays": buffer,
        "days": [
            {"planningDate": day, "weekday": "Montag", "items": [{"categoryKey": "Laptop", "qty": 1}]}
        ],
    }


def test_api_create_and_read_return_buffer() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    pm = f"pm-buf-{suffix}"
    created = client.post(
        "/api/wms/planning", headers=auth_headers(client, "Projektmanager", pm),
        json=_api_planning_payload(suffix, 2),
    )
    assert created.status_code == 200
    assert created.json()["returnBufferDays"] == 2
    pid = created.json()["id"]

    got = client.get(f"/api/wms/planning/{pid}", headers=auth_headers(client, "Projektmanager", pm))
    assert got.status_code == 200
    assert got.json()["returnBufferDays"] == 2

    listing = client.get("/api/wms/planning", headers=auth_headers(client, "Projektmanager", pm))
    item = next(p for p in listing.json() if p["id"] == pid)
    assert item["returnBufferDays"] == 2


def test_api_rejects_buffer_above_three() -> None:
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    pm = f"pm-buf2-{suffix}"
    resp = client.post(
        "/api/wms/planning", headers=auth_headers(client, "Projektmanager", pm),
        json=_api_planning_payload(suffix, 5),
    )
    assert resp.status_code == 422
