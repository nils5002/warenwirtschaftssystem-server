"""Tests für die automatische Projektübergabe (Asset-Handover A→B).

Engine-Tests laufen gegen eine ISOLIERTE In-Memory-SQLite (kein app.db). Die
API-/Permission-Tests nutzen den realen FastAPI-Client.
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database.base import Base
from app.database import models  # noqa: F401
from app.database.models import (
    ActivityRecord,
    AssetRecord,
    HandoverExecutionRecord,
    PlanningDayRecord,
    PlanningItemRecord,
    PlanningRecord,
)
from app.main import app
from app.repositories import category_repository, handover_repository as HR
from app.repositories import planning_repository as PR
from app.services import handover_service as HS
from .auth_helpers import auth_headers

D0 = date(2026, 8, 3)  # fixer Montag


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    category_repository.seed_standard_categories(session)
    yield session
    session.close()


def _add_laptops(db, count, *, assigned_to_planning, exp_return):
    for i in range(count):
        db.add(
            AssetRecord(
                external_id=f"ast-{i}",
                name=f"Laptop {i}",
                category="Laptop",
                location="Lager",
                status="Verliehen",
                assigned_to="Max · Projekt A",
                next_return="-",
                tag_number=f"T{i}",
                serial_number=f"S{i:03d}",
                qr_code=f"Q{i}",
                ownership_type="owned",
                assigned_planning_id=assigned_to_planning,
                expected_return_date=exp_return,
            )
        )
    db.commit()


def _add_planning(db, ext, start, end, items, *, link=None, handover=False, status="Geplant"):
    p = PlanningRecord(
        external_id=ext, customer_name="K", project_name=ext, start_date=start, end_date=end,
        notes="", status=status,
    )
    db.add(p)
    db.flush()
    day = PlanningDayRecord(planning_id=p.id, planning_date=start, weekday="Montag")
    db.add(day)
    db.flush()
    for cat, qty in items.items():
        is_ho = handover and cat == "Laptop"
        db.add(
            PlanningItemRecord(
                planning_day_id=day.id, category_key=cat, qty=qty,
                handover_enabled=is_ho, linked_planning_external_id=link if is_ho else None,
            )
        )
    db.commit()
    return p


def _scenario(db, *, b_start_offset=1, demand=5, configured=5, issued=5):
    """A: belegt {D0}, Rückgabetag D0+1. B startet D0+b_start_offset."""
    _add_laptops(db, issued, assigned_to_planning="pln-A", exp_return=D0)
    _add_planning(db, "pln-A", D0, D0 + timedelta(days=1), {"Laptop": configured}, link="pln-B", handover=True)
    bstart = D0 + timedelta(days=b_start_offset)
    _add_planning(db, "pln-B", bstart, bstart + timedelta(days=1), {"Laptop": demand})


def _usable_laptops(db, on):
    return sum(
        1 for a in db.scalars(select(AssetRecord)).all()
        if a.category == "Laptop" and PR._is_asset_usable_on_date(a, on)
    )


# --- Erkennung ---------------------------------------------------------------

def test_detection_transferable_is_min(db):
    _scenario(db, demand=3, configured=5, issued=5)  # min(5 issued, 5 conf, 3 demand) = 3
    plan = HR.compute_handover_plan(db, "pln-A")
    cat = plan.categories[0]
    assert cat.category == "Laptop"
    assert cat.planned_total == 3
    assert len(cat.transfer_now) == 3
    status = HR.build_status_response(plan, today=D0)
    assert status.categories[0].state == "planned"  # noch nicht fällig


def test_structurally_ineligible_when_b_starts_before_return_day(db):
    # B startet am SELBEN Tag wie A (Overlap) -> B.start (D0) < A_Rückgabetag (D0+1)
    _add_laptops(db, 5, assigned_to_planning="pln-A", exp_return=D0)
    _add_planning(db, "pln-A", D0, D0 + timedelta(days=1), {"Laptop": 5}, link="pln-B", handover=True)
    _add_planning(db, "pln-B", D0, D0 + timedelta(days=1), {"Laptop": 5})
    plan = HR.compute_handover_plan(db, "pln-A")
    assert plan.categories[0].structurally_eligible is False
    r = HS.run_due_handovers(db, today=D0 + timedelta(days=5), source_id="pln-A", force=True)
    assert r.transferredCount == 0  # zu früh/überlappend -> keine automatische Übergabe


# --- Ausführung + Timing -----------------------------------------------------

def test_not_due_before_return_day(db):
    _scenario(db)
    r = HS.run_due_handovers(db, today=D0, source_id="pln-A")  # today < Rückgabetag (D0+1)
    assert r.transferredCount == 0


def test_due_executes_transfer(db):
    _scenario(db)
    r = HS.run_due_handovers(db, today=D0 + timedelta(days=1), source_id="pln-A")
    assert r.transferredCount == 5 and r.skippedCount == 0
    moved = [a for a in db.scalars(select(AssetRecord)).all() if a.assigned_planning_id == "pln-B"]
    assert len(moved) == 5
    assert all(a.status == "Verliehen" for a in moved)
    # expected_return_date in B's Fenster (B: D0+1..D0+2 -> blocking_end D0+2 -1 = D0+1)
    assert all(a.expected_return_date == D0 + timedelta(days=1) for a in moved)
    # Historie + Audit
    assert db.scalar(select(func.count()).select_from(ActivityRecord).where(ActivityRecord.title == "Automatische Übergabe")) == 5
    assert db.scalar(select(func.count()).select_from(HandoverExecutionRecord).where(HandoverExecutionRecord.status == "active")) == 5


def test_idempotent_second_run(db):
    _scenario(db)
    HS.run_due_handovers(db, today=D0 + timedelta(days=1), source_id="pln-A")
    r2 = HS.run_due_handovers(db, today=D0 + timedelta(days=1), source_id="pln-A")
    assert r2.transferredCount == 0
    assert db.scalar(select(func.count()).select_from(HandoverExecutionRecord).where(HandoverExecutionRecord.status == "active")) == 5


# --- Availability/Konflikte nach Transfer ------------------------------------

def test_availability_after_transfer_no_conflict_and_continuous(db):
    _scenario(db)
    HS.run_due_handovers(db, today=D0 + timedelta(days=1), source_id="pln-A", force=True)
    av_b = PR.get_planning_availability(db, "pln-B")
    lap = [it for it in av_b.items if it.categoryKey == "Laptop"][0]
    assert lap.issuedForPlanningQty == 5
    assert lap.shortageQty == 0 and lap.hasGlobalShortage is False
    # Geräte bleiben in B's Fenster blockiert (nicht zwischenzeitlich verfügbar):
    assert _usable_laptops(db, D0 + timedelta(days=1)) == 0
    # Kein offener Konflikt für A oder B:
    summ = PR.get_open_conflict_summaries_for_plannings(db, None)
    assert summ.get("pln-A", {}).get("count", 0) == 0
    assert summ.get("pln-B", {}).get("count", 0) == 0


def test_without_transfer_devices_are_implicitly_freed(db):
    # Kontrast: OHNE Übergabe werden die für A ausgegebenen Geräte am Tag nach
    # A's Rückgabetag wieder 'usable' (impliziter Lager-Rücklauf, Schritt A).
    _scenario(db)
    assert _usable_laptops(db, D0 + timedelta(days=1)) == 5
    # MIT Übergabe bleiben sie B zugeordnet und durchgehend blockiert (kein Lager).
    HS.run_due_handovers(db, today=D0 + timedelta(days=1), source_id="pln-A", force=True)
    assert _usable_laptops(db, D0 + timedelta(days=1)) == 0
    # Und A bekommt durch die Übergabe KEINEN künstlichen Engpass:
    summ = PR.get_open_conflict_summaries_for_plannings(db, None)
    assert summ.get("pln-A", {}).get("count", 0) == 0


# --- Undo --------------------------------------------------------------------

def test_undo_restores_exactly(db):
    _scenario(db)
    HS.run_due_handovers(db, today=D0 + timedelta(days=1), source_id="pln-A", force=True)
    u = HS.undo_handover(db, "pln-A")
    assert u.revertedCount == 5 and u.skippedCount == 0
    back = [a for a in db.scalars(select(AssetRecord)).all() if a.assigned_planning_id == "pln-A"]
    assert len(back) == 5
    assert all(a.expected_return_date == D0 for a in back)  # prev value
    assert db.scalar(select(func.count()).select_from(HandoverExecutionRecord).where(HandoverExecutionRecord.status == "active")) == 0


# --- API / Permissions -------------------------------------------------------

def _seed_api_planning(client, suffix, pm):
    day = (date.today() + timedelta(days=20)).isoformat()
    payload = {
        "customerName": f"K {suffix}", "projectName": f"P {suffix}", "startDate": day, "endDate": day,
        "notes": "", "status": "Geplant",
        "days": [{"planningDate": day, "weekday": "Montag", "items": [{"categoryKey": "Laptop", "qty": 1}]}],
    }
    r = client.post("/api/wms/planning", headers=auth_headers(client, "Projektmanager", pm), json=payload)
    assert r.status_code == 200
    return r.json()["id"]


def test_api_status_readable_and_run_requires_role():
    client = TestClient(app)
    suffix = uuid4().hex[:8]
    pm = f"pm-ho-{suffix}"
    pid = _seed_api_planning(client, suffix, pm)
    # Status ist lesbar (auch ohne Handover-Konfig -> leere/triviale Antwort)
    s = client.get(f"/api/wms/planning/{pid}/handover/status", headers=auth_headers(client, "Mitarbeiter", f"mit-{suffix}"))
    assert s.status_code == 200
    assert s.json()["planningId"] == pid
    # Mitarbeiter darf NICHT ausführen
    r = client.post(f"/api/wms/planning/{pid}/handover/run", headers=auth_headers(client, "Mitarbeiter", f"mit-{suffix}"))
    assert r.status_code == 403
    u = client.post(f"/api/wms/planning/{pid}/handover/undo", headers=auth_headers(client, "Mitarbeiter", f"mit-{suffix}"))
    assert u.status_code == 403
    # PM darf (kein Handover konfiguriert -> 0 übertragen, aber 200)
    r2 = client.post(f"/api/wms/planning/{pid}/handover/run", headers=auth_headers(client, "Projektmanager", pm))
    assert r2.status_code == 200
    assert r2.json()["transferredCount"] == 0
