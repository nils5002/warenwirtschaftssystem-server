"""F1-Nachpflege: Backfill-Skript für alte Auto-Default-Rückgabedaten.

Prüft, dass die Korrektur eng begrenzt, Dry-Run-sicher und idempotent ist:
Dry-Run ändert NIE etwas; --apply korrigiert NUR eindeutige Auto-Default-Fälle
(lastCheckout+2) verliehener Eigengeräte mit aktiver Planungs-Zuordnung.

Hinweis: Die Tests teilen sich (wie die übrige Suite) eine DB. Das Skript
scannt bewusst ALLE verliehenen Assets — Assertions filtern daher immer auf
die eigenen, per Suffix eindeutigen Datensätze.
"""

from __future__ import annotations

from datetime import date
from uuid import uuid4

from sqlalchemy import select

from app.database.models import AssetRecord, PlanningRecord
from app.database.session import SessionLocal
from scripts.backfill_expected_return_date import run_backfill

# Mehrtagesplanung 10.–14.08.: Belegung 10.–13. (Enddatum exklusiv)
# ⇒ korrektes expected_return_date = 13.08., Anzeige next_return = 14.08.
PLAN_START = date(2026, 8, 10)
PLAN_END = date(2026, 8, 14)
CORRECT_EXPECTED = date(2026, 8, 13)
CORRECT_DISPLAY = "2026-08-14"

# Alter Auto-Default: Ausgabe 08.08. ⇒ Rückgabe 10.08. (lastCheckout+2).
LAST_CHECKOUT = "08.08.2026"
AUTO_DEFAULT_DATE = date(2026, 8, 10)


def _planning(db, suffix: str, *, status: str = "Geplant") -> str:
    ext = f"pln-testF1-{suffix}"
    db.add(PlanningRecord(
        external_id=ext, customer_name=f"Kunde {suffix}", project_name="F1-Backfill",
        start_date=PLAN_START, end_date=PLAN_END, status=status,
    ))
    db.commit()
    return ext


def _asset(
    db, suffix: str, key: str, *,
    status: str = "Verliehen",
    assigned_planning_id: str | None = None,
    expected_return_date: date | None = None,
    next_return: str = "-",
    last_checkout: str = LAST_CHECKOUT,
    ownership_type: str = "owned",
) -> str:
    ext = f"asset-testF1-{suffix}-{key}"
    db.add(AssetRecord(
        external_id=ext, name=f"DEV-F1-{suffix}-{key}", category="Switch",
        location="Lager", status=status, assigned_to="- · F1-Backfill",
        tag_number=f"TAG-F1-{suffix}-{key}", serial_number=f"SN-F1-{suffix}-{key}",
        assigned_planning_id=assigned_planning_id,
        expected_return_date=expected_return_date,
        next_return=next_return, last_checkout=last_checkout,
        ownership_type=ownership_type,
    ))
    db.commit()
    return ext


def _read(db, ext: str) -> tuple[date | None, str | None]:
    row = db.scalar(select(AssetRecord).where(AssetRecord.external_id == ext))
    assert row is not None
    return row.expected_return_date, row.next_return


def _candidate_ids(result, suffix: str) -> set[str]:
    return {c.externalId for c in result.candidates if f"-{suffix}-" in c.externalId}


def _skip_reasons_for(result, ext: str) -> list[str]:
    return [s.reason for s in result.skipped if s.externalId == ext]


# 1. Dry-Run verändert keine Daten (meldet den Kandidaten aber).
def test_dry_run_changes_nothing() -> None:
    suffix = uuid4().hex[:8]
    with SessionLocal() as db:
        pln = _planning(db, suffix)
        auto = _asset(db, suffix, "auto", assigned_planning_id=pln,
                      expected_return_date=AUTO_DEFAULT_DATE,
                      next_return=AUTO_DEFAULT_DATE.isoformat())

        res = run_backfill(db, apply=False)
        assert res.applied is False
        assert res.updated == 0
        assert _candidate_ids(res, suffix) == {auto}
        row = next(c for c in res.candidates if c.externalId == auto)
        assert row.newExpectedReturn == CORRECT_EXPECTED.isoformat()
        assert row.newNextReturn == CORRECT_DISPLAY
        assert "Auto-Default" in row.detectionReason

    with SessionLocal() as db:
        assert _read(db, auto) == (AUTO_DEFAULT_DATE, AUTO_DEFAULT_DATE.isoformat())


# 2.+3. --apply ändert NUR erkannte Auto-Default-Fälle; manuelle Daten bleiben.
def test_apply_fixes_only_auto_default_and_keeps_manual() -> None:
    suffix = uuid4().hex[:8]
    manual_date = date(2026, 8, 11)  # ≠ lastCheckout+2 ⇒ vermutlich manuell
    with SessionLocal() as db:
        pln = _planning(db, suffix)
        auto = _asset(db, suffix, "auto", assigned_planning_id=pln,
                      expected_return_date=AUTO_DEFAULT_DATE,
                      next_return=AUTO_DEFAULT_DATE.isoformat())
        manual = _asset(db, suffix, "manual", assigned_planning_id=pln,
                        expected_return_date=manual_date,
                        next_return=manual_date.isoformat())

        res = run_backfill(db, apply=True)
        assert res.applied is True
        assert _candidate_ids(res, suffix) == {auto}
        assert any("vermutlich manuell" in r for r in _skip_reasons_for(res, manual))

    with SessionLocal() as db:
        assert _read(db, auto) == (CORRECT_EXPECTED, CORRECT_DISPLAY)
        assert _read(db, manual) == (manual_date, manual_date.isoformat())


# 4. Assets ohne aktive Planung bleiben unverändert.
def test_inactive_planning_is_skipped() -> None:
    suffix = uuid4().hex[:8]
    with SessionLocal() as db:
        pln_done = _planning(db, suffix, status="Abgeschlossen")
        done = _asset(db, suffix, "done", assigned_planning_id=pln_done,
                      expected_return_date=AUTO_DEFAULT_DATE,
                      next_return=AUTO_DEFAULT_DATE.isoformat())

        res = run_backfill(db, apply=True)
        assert _candidate_ids(res, suffix) == set()
        assert any("nicht aktiv" in r for r in _skip_reasons_for(res, done))

    with SessionLocal() as db:
        assert _read(db, done) == (AUTO_DEFAULT_DATE, AUTO_DEFAULT_DATE.isoformat())


# 5. Assets ohne assigned_planning_id bleiben unverändert.
def test_asset_without_planning_link_is_skipped() -> None:
    suffix = uuid4().hex[:8]
    with SessionLocal() as db:
        unlinked = _asset(db, suffix, "nolink", assigned_planning_id=None,
                          expected_return_date=AUTO_DEFAULT_DATE,
                          next_return=AUTO_DEFAULT_DATE.isoformat())

        res = run_backfill(db, apply=True)
        assert _candidate_ids(res, suffix) == set()
        assert any("ohne Planungs-Zuordnung" in r for r in _skip_reasons_for(res, unlinked))

    with SessionLocal() as db:
        assert _read(db, unlinked) == (AUTO_DEFAULT_DATE, AUTO_DEFAULT_DATE.isoformat())


# 6. Bereits korrekte Werte bleiben unverändert (auch mit --apply).
def test_already_correct_value_is_skipped() -> None:
    suffix = uuid4().hex[:8]
    with SessionLocal() as db:
        pln = _planning(db, suffix)
        ok = _asset(db, suffix, "ok", assigned_planning_id=pln,
                    expected_return_date=CORRECT_EXPECTED,
                    next_return=CORRECT_DISPLAY)

        res = run_backfill(db, apply=True)
        assert _candidate_ids(res, suffix) == set()
        assert "bereits korrekt" in _skip_reasons_for(res, ok)

    with SessionLocal() as db:
        assert _read(db, ok) == (CORRECT_EXPECTED, CORRECT_DISPLAY)


# Zusatz: Altbestand ganz OHNE verwertbares Datum (dauerblockiert) wird
# korrigiert — dabei wird nichts Manuelles überschrieben.
def test_missing_date_legacy_asset_is_fixed() -> None:
    suffix = uuid4().hex[:8]
    with SessionLocal() as db:
        pln = _planning(db, suffix)
        legacy = _asset(db, suffix, "legacy", assigned_planning_id=pln,
                        expected_return_date=None, next_return="-",
                        last_checkout="-")

        res = run_backfill(db, apply=True)
        assert _candidate_ids(res, suffix) == {legacy}

    with SessionLocal() as db:
        assert _read(db, legacy) == (CORRECT_EXPECTED, CORRECT_DISPLAY)


# Zusatz: Fremdbestand nutzt expected_return_date nicht → nie anfassen.
def test_foreign_stock_is_skipped() -> None:
    suffix = uuid4().hex[:8]
    with SessionLocal() as db:
        pln = _planning(db, suffix)
        rented = _asset(db, suffix, "rent", assigned_planning_id=pln,
                        expected_return_date=AUTO_DEFAULT_DATE,
                        next_return=AUTO_DEFAULT_DATE.isoformat(),
                        ownership_type="rented")

        res = run_backfill(db, apply=True)
        assert _candidate_ids(res, suffix) == set()
        assert any("kein Eigenbestand" in r for r in _skip_reasons_for(res, rented))

    with SessionLocal() as db:
        assert _read(db, rented) == (AUTO_DEFAULT_DATE, AUTO_DEFAULT_DATE.isoformat())
