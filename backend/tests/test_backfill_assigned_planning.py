"""Schritt D: geführtes Backfill-Skript für assigned_planning_id.

Prüft, dass die Korrektur eng begrenzt, idempotent und Dry-Run-sicher ist.

Hinweis: Die Tests teilen sich (wie die übrige Suite) eine DB. Da das Skript
bewusst ALLE passenden Verliehen-Assets verknüpft, nutzt jeder Test einen
eindeutigen Marker-Token, damit Datensätze anderer Tests nicht kollidieren.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from sqlalchemy import select

from app.database.models import AssetRecord, PlanningRecord
from app.database.session import SessionLocal
from scripts.backfill_assigned_planning import run_backfill


def _planning(db, suffix: str, customer: str) -> str:
    ext = f"pln-testD-{suffix}"
    db.add(PlanningRecord(
        external_id=ext, customer_name=customer, project_name="Vertreterversammlung",
        start_date=date(2026, 5, 28), end_date=date(2026, 5, 28), status="Geplant",
    ))
    db.commit()
    return ext


def _asset(db, suffix: str, key: str, *, category="Switch", status="Verliehen",
           assigned_to="-", notes="", assigned_planning_id=None) -> str:
    ext = f"asset-testD-{suffix}-{key}"
    db.add(AssetRecord(
        external_id=ext, name=f"DEV-{suffix}-{key}", category=category, location="Lager",
        status=status, assigned_to=assigned_to, notes=notes,
        tag_number=f"TAG-D-{suffix}-{key}", serial_number=f"SN-D-{suffix}-{key}",
        assigned_planning_id=assigned_planning_id,
    ))
    db.commit()
    return ext


def _pid(db, ext: str) -> str | None:
    return db.scalar(select(AssetRecord.assigned_planning_id).where(AssetRecord.external_id == ext))


def test_dry_run_changes_nothing_but_reports_matches() -> None:
    suffix = uuid4().hex[:8]
    marker = f"VBRM-{suffix}"
    tokens = [marker, "Vertreterversammlung"]
    both = f"- · {marker} · Vertreterversammlung"
    with SessionLocal() as db:
        pln = _planning(db, suffix, customer=marker)
        a1 = _asset(db, suffix, "1", category="Kartendrucker", assigned_to=both)
        a2 = _asset(db, suffix, "2", category="Switch", assigned_to="-",
                    notes=f"Projekt: {marker} · Vertreterversammlung")

        res = run_backfill(db, pln, tokens, apply=False)
        assert res.ok and res.applied is False
        assert {m.externalId for m in res.matched} == {a1, a2}
        assert res.byCategory == {"Kartendrucker": 1, "Switch": 1}
        assert res.updated == 0
        assert _pid(db, a1) is None and _pid(db, a2) is None


def test_apply_links_only_matching_verliehen_null_assets() -> None:
    suffix = uuid4().hex[:8]
    marker = f"VBRM-{suffix}"
    tokens = [marker, "Vertreterversammlung"]
    both = f"- · {marker} · Vertreterversammlung"
    with SessionLocal() as db:
        pln = _planning(db, suffix, customer=marker)
        a_match1 = _asset(db, suffix, "m1", category="Kartendrucker", assigned_to=both)
        a_match2 = _asset(db, suffix, "m2", category="Laptop",
                          notes=f"… Projekt: {marker} · Vertreterversammlung …")
        a_one_token = _asset(db, suffix, "one", assigned_to=f"- · {marker}")  # nur 1 Token
        a_available = _asset(db, suffix, "av", status="Verfuegbar", assigned_to=both)
        a_other = _asset(db, suffix, "ot", assigned_to=both, assigned_planning_id="pln-other")

        res = run_backfill(db, pln, tokens, apply=True)
        assert res.ok and res.applied is True
        assert res.updated == 2
        assert {m.externalId for m in res.matched} == {a_match1, a_match2}

    with SessionLocal() as db:
        assert _pid(db, a_match1) == pln
        assert _pid(db, a_match2) == pln
        assert _pid(db, a_one_token) is None      # fehlendes Token
        assert _pid(db, a_available) is None       # Status Verfuegbar
        assert _pid(db, a_other) == "pln-other"    # bestehende Zuordnung NICHT überschrieben


def test_unknown_planning_aborts_without_change() -> None:
    suffix = uuid4().hex[:8]
    marker = f"VBRM-{suffix}"
    with SessionLocal() as db:
        a1 = _asset(db, suffix, "1", assigned_to=f"- · {marker} · Vertreterversammlung")
        res = run_backfill(db, f"pln-does-not-exist-{suffix}", [marker, "Vertreterversammlung"], apply=True)
        assert res.planningFound is False
        assert res.ok is False
        assert res.updated == 0
        assert _pid(db, a1) is None


def test_name_guard_aborts_on_mismatching_tokens() -> None:
    suffix = uuid4().hex[:8]
    marker = f"VBRM-{suffix}"
    with SessionLocal() as db:
        pln = _planning(db, suffix, customer=marker)  # Name enthält marker
        a1 = _asset(db, suffix, "1", assigned_to=f"- · Anderes-{suffix}")
        # Tokens passen NICHT zum Planungsnamen → Abbruch (Schutz vor falscher planning-id).
        res = run_backfill(db, pln, [f"Anderes-{suffix}"], apply=True)
        assert res.ok is False
        assert "Planungsnamen" in (res.abortedReason or "")
        assert res.updated == 0
        assert _pid(db, a1) is None
