"""Schritt D – einmaliges, eng begrenztes Backfill der Planungs-Zuordnung.

Verknüpft Altausgaben (vor Schritt B), die nur über Freitext einer Planung
zugeordnet sind, sicher mit ``assigned_planning_id`` — OHNE generellen
Freitext-Backfill. Standard ist DRY-RUN (zeigt nur an); geschrieben wird erst
mit ``--apply``.

Auswahlregeln (alle UND-verknüpft):
  1. Planung muss existieren (PlanningRecord.external_id == planning_id).
     Zusätzlich muss (sofern Name-Guard aktiv) mindestens ein Token im
     Planungsnamen vorkommen — verhindert eine falsche planning-id.
  2. Nur Assets mit Status ``Verliehen``.
  3. Nur Assets mit ``assigned_planning_id IS NULL`` (idempotent, überschreibt nie).
  4. Nur Assets, deren ``assigned_to`` ODER ``notes`` ALLE ``--contains``-Tokens
     enthält (case-insensitive).

Aufruf (aus ``backend/``; DATABASE_URL zeigt auf die Ziel-DB):
    python -m scripts.backfill_assigned_planning --planning-id pln-ce1fc1832845 \
        --contains "VB Ruhr Mitte" --contains "Vertreterversammlung"          # Dry-Run
    python -m scripts.backfill_assigned_planning --planning-id pln-ce1fc1832845 \
        --contains "VB Ruhr Mitte" --contains "Vertreterversammlung" --apply   # anwenden
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import AssetRecord, PlanningRecord


@dataclass
class MatchedAsset:
    externalId: str
    name: str
    category: str
    status: str
    previousPlanningId: str | None
    assignedTo: str
    notesExcerpt: str


@dataclass
class BackfillResult:
    planningId: str
    planningFound: bool
    applied: bool
    abortedReason: str | None = None
    matched: list[MatchedAsset] = field(default_factory=list)
    byCategory: dict[str, int] = field(default_factory=dict)
    updated: int = 0

    @property
    def ok(self) -> bool:
        return self.planningFound and self.abortedReason is None


def run_backfill(
    db: Session,
    planning_id: str,
    contains: list[str],
    *,
    apply: bool = False,
    enforce_name_guard: bool = True,
) -> BackfillResult:
    """Kernlogik (testbar). Schreibt nur, wenn ``apply=True`` und keine Abbruchgründe."""
    tokens = [t.strip().lower() for t in (contains or []) if t and t.strip()]
    if not tokens:
        return BackfillResult(planning_id, planningFound=False, applied=False,
                              abortedReason="Keine --contains Tokens angegeben")

    planning = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == planning_id))
    if planning is None:
        return BackfillResult(planning_id, planningFound=False, applied=False,
                              abortedReason="Planung nicht gefunden")

    if enforce_name_guard:
        planning_name = (
            f"{planning.customer_name or ''} {planning.project_name or ''} "
            f"{planning.event_name or ''}"
        ).lower()
        if not any(tok in planning_name for tok in tokens):
            return BackfillResult(
                planning_id, planningFound=True, applied=False,
                abortedReason=(
                    "Tokens passen nicht zum Planungsnamen "
                    f"({planning.customer_name!r} / {planning.project_name!r}) — "
                    "Abbruch (falsche planning-id?). Mit --no-name-guard überstimmbar."
                ),
            )

    candidates = db.scalars(
        select(AssetRecord).where(
            AssetRecord.status == "Verliehen",
            AssetRecord.assigned_planning_id.is_(None),
        )
    ).all()

    matched_records: list[AssetRecord] = []
    matched: list[MatchedAsset] = []
    for asset in candidates:
        blob = f"{asset.assigned_to or ''} {asset.notes or ''}".lower()
        if all(tok in blob for tok in tokens):
            matched_records.append(asset)
            matched.append(
                MatchedAsset(
                    externalId=asset.external_id,
                    name=asset.name,
                    category=asset.category,
                    status=asset.status,
                    previousPlanningId=asset.assigned_planning_id,
                    assignedTo=asset.assigned_to or "",
                    notesExcerpt=(asset.notes or "").replace("\n", " / ")[:90],
                )
            )

    by_category = dict(Counter(m.category for m in matched))

    updated = 0
    if apply and matched_records:
        for asset in matched_records:
            asset.assigned_planning_id = planning_id
            updated += 1
        db.commit()

    return BackfillResult(
        planningId=planning_id,
        planningFound=True,
        applied=apply,
        matched=matched,
        byCategory=by_category,
        updated=updated,
    )


def _print_report(result: BackfillResult, *, apply: bool) -> None:
    if not result.planningFound or result.abortedReason:
        print(f"ABBRUCH: {result.abortedReason}")
        return
    print(f"Planung: {result.planningId}")
    print(f"Treffer (Verliehen, ohne Zuordnung, alle Tokens): {len(result.matched)}")
    if result.byCategory:
        print("Je Kategorie:")
        for cat, count in sorted(result.byCategory.items()):
            print(f"  {cat:18s} {count}")
    print("\nBetroffene Assets:")
    print("  external_id | name | kategorie | status | bisher | assigned_to | notes")
    for m in result.matched:
        print(
            f"  {m.externalId} | {m.name} | {m.category} | {m.status} | "
            f"{m.previousPlanningId} | {m.assignedTo} | {m.notesExcerpt}"
        )
    if apply:
        print(f"\nANGEWENDET: assigned_planning_id gesetzt für {result.updated} Asset(s).")
    else:
        print("\nDRY-RUN: keine Änderung. Zum Anwenden erneut mit --apply ausführen.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Eng begrenztes Backfill von assigned_planning_id (Dry-Run-Standard).",
    )
    parser.add_argument("--planning-id", required=True, help="external_id der Zielplanung (pln-...)")
    parser.add_argument(
        "--contains", action="append", default=[], metavar="TOKEN",
        help="Pflicht-Token in assigned_to/notes (mehrfach = UND-Verknüpfung).",
    )
    parser.add_argument("--apply", action="store_true", help="Änderungen wirklich schreiben.")
    parser.add_argument(
        "--no-name-guard", action="store_true",
        help="Namensprüfung der Planung überspringen (nur bewusst nutzen).",
    )
    args = parser.parse_args(argv)

    from app.database.session import SessionLocal

    with SessionLocal() as db:
        result = run_backfill(
            db,
            args.planning_id,
            args.contains,
            apply=args.apply,
            enforce_name_guard=not args.no_name_guard,
        )
    _print_report(result, apply=args.apply)
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
