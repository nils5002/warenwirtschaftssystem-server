"""Automatische Projektübergabe (Asset-Handover A→B): Ausführung, Scheduler-Kern, Undo.

Die Ausführung passiert ausschließlich hier (Service-/Background-Schicht), NIE in
einem GET-/Read-Pfad. ``run_due_handovers`` ist die gemeinsame Kernroutine für den
automatischen Scheduler und den manuellen Fallback und ist **idempotent**:
- Asset-Guard: nur Geräte, die aktuell noch für A ausgegeben sind.
- DB-Schutz: partieller Unique-Index (max. eine aktive Übergabe je Asset) — ein
  konkurrierender Zweit-Insert (Race/Mehrworker) wird per Savepoint abgefangen.
"""
from __future__ import annotations

import logging
import secrets
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database.models import (
    ActivityRecord,
    AssetRecord,
    HandoverExecutionRecord,
    PlanningDayRecord,
    PlanningItemRecord,
    PlanningRecord,
)
from ..repositories import handover_repository
from ..repositories import planning_repository as PR
from ..repositories.qr_group_repository import _format_checkout_assigned_to
from ..repositories.wms_repository import _extract_checkout_assignee_and_project
from ..schemas.handover import HandoverRunResponse, HandoverTransferredAsset, HandoverUndoResponse

logger = logging.getLogger(__name__)


def _now_text() -> str:
    return datetime.now(UTC).strftime("%d.%m.%Y %H:%M")


def _source_planning_ids_with_handover(db: Session) -> list[str]:
    rows = db.execute(
        select(PlanningRecord.external_id)
        .join(PlanningDayRecord, PlanningDayRecord.planning_id == PlanningRecord.id)
        .join(PlanningItemRecord, PlanningItemRecord.planning_day_id == PlanningDayRecord.id)
        .where(PlanningRecord.status.in_(tuple(PR.ACTIVE_PLANNING_STATUSES)))
        .where(PlanningItemRecord.handover_enabled.is_(True))
        .where(PlanningItemRecord.linked_planning_external_id.is_not(None))
        .distinct()
    ).all()
    return [str(r[0]) for r in rows if r[0]]


def _transfer_one(
    db: Session,
    asset: AssetRecord,
    *,
    source_id: str,
    source_label: str,
    target: PlanningRecord,
    category: str,
    batch_id: str,
    actor_user_id: str | None,
) -> bool:
    """Überträgt EIN Asset A→B in einem Savepoint. Liefert True bei Erfolg.

    Reihenfolge: zuerst die Audit-Zeile (triggert den partiellen Unique-Index) —
    schlägt das fehl (bereits aktive Übergabe), wird der Savepoint zurückgerollt
    und das Asset bleibt unverändert.
    """
    if str(getattr(asset, "assigned_planning_id", None) or "").strip() != source_id:
        return False
    if str(asset.status).strip().lower() != "verliehen":
        return False

    block_end = PR._blocking_end_exclusive(
        target.start_date, target.end_date, getattr(target, "return_buffer_days", 0)
    )
    expected_return = block_end - timedelta(days=1)

    savepoint = db.begin_nested()
    try:
        db.add(
            HandoverExecutionRecord(
                external_id=f"hx-{secrets.token_hex(8)}",
                batch_id=batch_id,
                asset_external_id=asset.external_id,
                category=category,
                source_planning_id=source_id,
                target_planning_id=target.external_id,
                prev_assigned_planning_id=asset.assigned_planning_id,
                prev_expected_return_date=asset.expected_return_date,
                prev_assigned_to=asset.assigned_to,
                prev_next_return=asset.next_return,
                executed_by_user_id=actor_user_id,
                status="active",
            )
        )
        db.flush()  # erzwingt die Prüfung des partiellen Unique-Index
        # Asset NICHT zurückgeben — direkt an B übergeben:
        assignee, _project = _extract_checkout_assignee_and_project(asset.assigned_to)
        asset.assigned_planning_id = target.external_id
        asset.expected_return_date = expected_return
        asset.assigned_to = _format_checkout_assigned_to(assignee or "-", target.project_name)
        asset.next_return = block_end.strftime("%d.%m.%Y")
        actor_text = "automatisch (System)" if not actor_user_id else f"ausgelöst durch {actor_user_id}"
        db.add(
            ActivityRecord(
                external_id=f"act-srv-{secrets.token_hex(8)}",
                title="Automatische Übergabe",
                detail=(
                    f"{asset.name} wurde direkt von Projekt {source_label} an Projekt "
                    f"{target.project_name} übergeben (ohne Rücklauf ins Lager). {actor_text}."
                ),
                timestamp_text=_now_text(),
                asset_external_id=asset.external_id,
            )
        )
        db.flush()
        savepoint.commit()
        return True
    except IntegrityError:
        savepoint.rollback()
        return False


def run_due_handovers(
    db: Session,
    *,
    today: date | None = None,
    source_id: str | None = None,
    force: bool = False,
    actor_user_id: str | None = None,
) -> HandoverRunResponse:
    """Führt fällige Übergaben aus. Idempotent; commit am Ende.

    - ``source_id=None``: alle aktiven Planungen mit Handover-Konfig (Scheduler).
    - ``force=True``: überspringt NUR die Timing-Schranke (``today >= Rückgabetag``),
      nie die strukturelle Gültigkeit (B aktiv, ``B.start >= A_Rückgabetag``).
    """
    today = today or date.today()
    batch_id = f"hbatch-{secrets.token_hex(8)}"
    source_ids = [source_id] if source_id else _source_planning_ids_with_handover(db)

    transferred: list[HandoverTransferredAsset] = []
    skipped = 0
    for sid in source_ids:
        plan = handover_repository.compute_handover_plan(db, sid)
        if plan is None or not plan.categories:
            continue
        if not force and today < plan.source_return_day:
            continue
        source_record = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == sid))
        source_label = PR._build_planning_short_label(source_record) if source_record else sid
        for cat in plan.categories:
            if not cat.structurally_eligible or cat.target_record is None:
                continue
            for asset in cat.transfer_now:
                ok = _transfer_one(
                    db,
                    asset,
                    source_id=sid,
                    source_label=source_label,
                    target=cat.target_record,
                    category=cat.category,
                    batch_id=batch_id,
                    actor_user_id=actor_user_id,
                )
                if ok:
                    transferred.append(
                        HandoverTransferredAsset(
                            assetId=asset.external_id,
                            name=asset.name,
                            category=cat.category,
                            targetPlanningId=cat.target_record.external_id,
                        )
                    )
                else:
                    skipped += 1

    db.commit()
    return HandoverRunResponse(
        planningId=source_id or "*",
        batchId=batch_id if transferred else None,
        transferredCount=len(transferred),
        transferred=transferred,
        skippedCount=skipped,
    )


def undo_handover(
    db: Session, source_id: str, *, actor_user_id: str | None = None
) -> HandoverUndoResponse:
    """Macht aktive Übergaben einer Quellplanung rückgängig (exakte Wiederherstellung).

    Defensiv: ist ein Asset zwischenzeitlich nicht mehr auf B (z. B. zurückgegeben
    oder weitergegeben), wird das Asset NICHT verändert — die Audit-Zeile wird als
    ``undone`` markiert (void) und als ``skipped`` gezählt.
    """
    rows = db.scalars(
        select(HandoverExecutionRecord).where(
            HandoverExecutionRecord.source_planning_id == source_id,
            HandoverExecutionRecord.status == "active",
        )
    ).all()
    reverted = 0
    skipped = 0
    now = datetime.now(UTC)
    for row in rows:
        asset = db.scalar(select(AssetRecord).where(AssetRecord.external_id == row.asset_external_id))
        on_target = asset is not None and str(asset.assigned_planning_id or "").strip() == row.target_planning_id
        if asset is not None and on_target:
            asset.assigned_planning_id = row.prev_assigned_planning_id
            asset.expected_return_date = row.prev_expected_return_date
            asset.assigned_to = row.prev_assigned_to
            asset.next_return = row.prev_next_return
            db.add(
                ActivityRecord(
                    external_id=f"act-srv-{secrets.token_hex(8)}",
                    title="Übergabe rückgängig",
                    detail=(
                        f"{asset.name}: automatische Übergabe an Projekt {row.target_planning_id} "
                        f"wurde rückgängig gemacht."
                    ),
                    timestamp_text=_now_text(),
                    asset_external_id=asset.external_id,
                )
            )
            reverted += 1
        else:
            skipped += 1
        row.status = "undone"
        row.undone_at = now
        row.undone_by_user_id = actor_user_id
    db.commit()
    return HandoverUndoResponse(planningId=source_id, revertedCount=reverted, skippedCount=skipped)
