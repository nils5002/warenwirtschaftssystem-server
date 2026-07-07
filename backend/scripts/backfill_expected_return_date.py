"""F1-Nachpflege – geführte Korrektur alter ``expected_return_date``-Werte.

Vor F1 setzte der Checkout das erwartete Rückgabedatum auf den Frontend-
Default "Ausgabetag + 2 Tage" statt auf den fachlichen Rückgabetag der
Planung. Dieses Skript erkennt solche Altfälle und korrigiert sie —
Standard ist DRY-RUN (nur Bericht); geschrieben wird erst mit ``--apply``.

Auswahlregeln (alle UND-verknüpft):
  1. Asset hat Status ``Verliehen`` (nur aktive Verleihungen).
  2. Asset ist Eigenbestand (``ownership_type = owned``) — nur dort steuert
     ``expected_return_date`` die Planungs-Verfügbarkeit.
  3. ``assigned_planning_id`` ist gesetzt und die Planung existiert.
  4. Die Planung ist aktiv/konfliktrelevant (Entwurf/Geplant/Bestätigt).
  5. Das aktuelle Datum weicht vom korrekten Planungswert ab
     (``planning_repository.planning_loan_return_dates`` — Handover-Parität).

Sicherheitsfilter (Schutz manueller Sonderfälle):
  Korrigiert werden NUR Datensätze, die eindeutig dem alten Auto-Default
  entsprechen:
    * ``expected_return_date == lastCheckout + 2 Tage``  (± ``--tolerance-days``,
      Default 0 = exakt), oder
    * kein strukturiertes Datum vorhanden und ``next_return`` entspricht dem
      Muster ``lastCheckout + 2 Tage``, oder
    * gar kein verwertbares Rückgabedatum vorhanden (Gerät wäre sonst
      dauerhaft blockiert — hier wird nichts Manuelles überschrieben).
  Alle anderen Abweichungen gelten als (potenziell) manuell gesetzt und
  bleiben unverändert; sie erscheinen im Bericht als übersprungen.

WICHTIG: Vor ``--apply`` ein Backup über die App exportieren
(Admin-UI → Backup bzw. ``GET /api/wms/backup/export``).

Aufruf (aus ``backend/``; DATABASE_URL zeigt auf die Ziel-DB):
    python -m scripts.backfill_expected_return_date            # Dry-Run
    python -m scripts.backfill_expected_return_date --apply    # anwenden
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import AssetRecord, PlanningRecord
from app.repositories.planning_repository import (
    ACTIVE_PLANNING_STATUSES,
    _parse_loose_date,
    planning_loan_return_dates,
)

# Alter Frontend-Default: Rückgabedatum = Ausgabetag + 2 Tage.
_AUTO_DEFAULT_OFFSET_DAYS = 2


@dataclass
class CandidateRow:
    externalId: str
    tagNumber: str
    qrCode: str
    name: str
    planningId: str
    planningLabel: str
    currentExpectedReturn: str
    currentNextReturn: str
    newExpectedReturn: str
    newNextReturn: str
    detectionReason: str
    willChangeOnApply: bool = True


@dataclass
class SkippedRow:
    externalId: str
    name: str
    reason: str


@dataclass
class BackfillResult:
    applied: bool
    checkedLoanedTotal: int = 0
    candidates: list[CandidateRow] = field(default_factory=list)
    skipped: list[SkippedRow] = field(default_factory=list)
    skipReasons: dict[str, int] = field(default_factory=dict)
    updated: int = 0


def _fmt(value: date | None) -> str:
    return value.isoformat() if value is not None else "—"


def _matches_auto_default(
    target: date | None, last_checkout: date | None, tolerance_days: int
) -> bool:
    """True, wenn ``target`` dem alten Auto-Default ``lastCheckout+2`` entspricht."""
    if target is None or last_checkout is None:
        return False
    expected_default = last_checkout + timedelta(days=_AUTO_DEFAULT_OFFSET_DAYS)
    return abs((target - expected_default).days) <= max(0, int(tolerance_days))


def _classify_auto_default(
    asset: AssetRecord, tolerance_days: int
) -> tuple[bool, str]:
    """Erkennt das alte Auto-Default-Muster. Liefert (ist_kandidat, grund)."""
    current_expected = asset.expected_return_date
    last_checkout = _parse_loose_date(asset.last_checkout)
    next_return = _parse_loose_date(asset.next_return)

    if current_expected is not None:
        if _matches_auto_default(current_expected, last_checkout, tolerance_days):
            return True, (
                f"expected_return_date = lastCheckout({_fmt(last_checkout)}) + "
                f"{_AUTO_DEFAULT_OFFSET_DAYS} Tage (alter Auto-Default)"
            )
        return False, (
            "abweichendes Datum ohne Auto-Default-Muster (vermutlich manuell) — "
            "nicht überschrieben"
        )

    # Kein strukturiertes Datum: Altbestand vor Schritt A.
    if next_return is not None:
        if _matches_auto_default(next_return, last_checkout, tolerance_days):
            return True, (
                f"kein strukturiertes Datum; next_return = lastCheckout("
                f"{_fmt(last_checkout)}) + {_AUTO_DEFAULT_OFFSET_DAYS} Tage "
                "(alter Auto-Default)"
            )
        return False, (
            "kein strukturiertes Datum, next_return ohne Auto-Default-Muster "
            "(vermutlich manuell) — nicht überschrieben"
        )

    return True, (
        "kein verwertbares Rückgabedatum vorhanden (Gerät dauerblockiert) — "
        "Korrektur überschreibt nichts Manuelles"
    )


def run_backfill(
    db: Session, *, apply: bool = False, tolerance_days: int = 0
) -> BackfillResult:
    """Kernlogik (testbar). Schreibt nur bei ``apply=True`` — ein Commit am Ende."""
    result = BackfillResult(applied=apply)
    skip_counter: Counter[str] = Counter()

    def _skip(asset: AssetRecord, reason: str) -> None:
        skip_counter[reason] += 1
        result.skipped.append(SkippedRow(asset.external_id, asset.name, reason))

    loaned = db.scalars(
        select(AssetRecord).where(AssetRecord.status == "Verliehen")
    ).all()
    result.checkedLoanedTotal = len(loaned)

    planning_cache: dict[str, PlanningRecord | None] = {}
    to_update: list[tuple[AssetRecord, date, date]] = []

    for asset in loaned:
        ownership = str(asset.ownership_type or "owned").strip().lower()
        if ownership != "owned":
            _skip(asset, f"kein Eigenbestand (ownership_type={ownership})")
            continue

        planning_id = str(asset.assigned_planning_id or "").strip()
        if not planning_id:
            _skip(asset, "ohne Planungs-Zuordnung (assigned_planning_id leer)")
            continue

        if planning_id not in planning_cache:
            planning_cache[planning_id] = db.scalar(
                select(PlanningRecord).where(PlanningRecord.external_id == planning_id)
            )
        planning = planning_cache[planning_id]
        if planning is None:
            _skip(asset, "Planung nicht gefunden")
            continue

        if planning.status not in ACTIVE_PLANNING_STATUSES:
            _skip(asset, f"Planung nicht aktiv (Status {planning.status})")
            continue

        planning_dates = planning_loan_return_dates(db, planning_id)
        if planning_dates is None:
            _skip(asset, "Planung ohne Datumswerte")
            continue
        new_expected, new_display = planning_dates

        if asset.expected_return_date == new_expected:
            _skip(asset, "bereits korrekt")
            continue

        is_candidate, reason = _classify_auto_default(asset, tolerance_days)
        if not is_candidate:
            _skip(asset, reason)
            continue

        planning_label = (
            f"{planning.customer_name or ''} / {planning.project_name or ''} "
            f"({_fmt(planning.start_date)} -> {_fmt(planning.end_date)})"
        ).strip(" /")
        result.candidates.append(
            CandidateRow(
                externalId=asset.external_id,
                tagNumber=asset.tag_number or "—",
                qrCode=asset.qr_code or "—",
                name=asset.name,
                planningId=planning_id,
                planningLabel=planning_label,
                currentExpectedReturn=_fmt(asset.expected_return_date),
                currentNextReturn=(asset.next_return or "—"),
                newExpectedReturn=_fmt(new_expected),
                newNextReturn=new_display.isoformat(),
                detectionReason=reason,
            )
        )
        to_update.append((asset, new_expected, new_display))

    result.skipReasons = dict(skip_counter)

    if apply and to_update:
        for asset, new_expected, new_display in to_update:
            asset.expected_return_date = new_expected
            asset.next_return = new_display.isoformat()
            result.updated += 1
        db.commit()

    return result


def _print_report(result: BackfillResult) -> None:
    print("=" * 100)
    print("Backfill expected_return_date (F1-Nachpflege)")
    print(f"Modus: {'APPLY — Änderungen werden geschrieben' if result.applied else 'DRY-RUN — keine Änderung'}")
    print("=" * 100)

    if result.candidates:
        print("\nKandidaten (würden bei --apply geändert):")
        header = (
            f"{'Asset-ID':30} | {'Tag/QR':28} | {'Name':28} | "
            f"{'Planung':44} | {'aktuell':10} | {'korrekt':10} | Grund"
        )
        print(header)
        print("-" * len(header))
        for row in result.candidates:
            tag_qr = f"{row.tagNumber} / {row.qrCode}"[:28]
            print(
                f"{row.externalId:30} | {tag_qr:28} | {row.name[:28]:28} | "
                f"{row.planningLabel[:44]:44} | {row.currentExpectedReturn:10} | "
                f"{row.newExpectedReturn:10} | {row.detectionReason}"
            )
            if row.currentNextReturn != row.newNextReturn:
                print(
                    f"{'':30} |   Anzeige next_return: "
                    f"{row.currentNextReturn!r} -> {row.newNextReturn!r}"
                )
    else:
        print("\nKeine Kandidaten gefunden.")

    print("\nZusammenfassung:")
    print(f"  Geprüfte verliehene Assets : {result.checkedLoanedTotal}")
    print(f"  Kandidaten (Auto-Default)  : {len(result.candidates)}")
    print(f"  Übersprungen               : {len(result.skipped)}")
    for reason, count in sorted(result.skipReasons.items(), key=lambda kv: -kv[1]):
        print(f"    - {reason}: {count}")

    if result.applied:
        print(f"\nANGEWENDET: {result.updated} Asset(s) korrigiert.")
    else:
        print(
            f"\nDRY-RUN: keine Änderung. Potenzielle Änderungen: {len(result.candidates)}.\n"
            "WICHTIG: Vor --apply ein Backup über die App exportieren\n"
            "(Admin-UI → Backup bzw. GET /api/wms/backup/export)."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Korrigiert alte Auto-Default-Rückgabedaten (heute+2) verliehener "
            "Geräte auf den Rückgabetag ihrer Planung. Dry-Run-Standard."
        ),
    )
    parser.add_argument("--apply", action="store_true", help="Änderungen wirklich schreiben.")
    parser.add_argument(
        "--tolerance-days", type=int, default=0, metavar="N",
        help=(
            "Toleranz (± Tage) für die Auto-Default-Erkennung lastCheckout+2. "
            "Default 0 = exaktes Muster."
        ),
    )
    args = parser.parse_args(argv)

    # Windows-Konsolen laufen oft mit cp1252 — Sonderzeichen in Asset-/
    # Planungsnamen dürfen den Bericht nie crashen lassen.
    try:
        sys.stdout.reconfigure(errors="replace")  # type: ignore[union-attr]
    except Exception:  # noqa: BLE001
        pass

    from app.database.session import SessionLocal

    with SessionLocal() as db:
        result = run_backfill(db, apply=args.apply, tolerance_days=args.tolerance_days)
    _print_report(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
