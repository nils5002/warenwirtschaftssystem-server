"""Automatische Projektübergabe (Asset-Handover A→B): Erkennung/Status.

Reine Erkennung (lesend). Die tatsächliche Ausführung/der Undo liegt im
``services/handover_service.py``. Quelle der Wahrheit ist die bestehende
planungs-seitige Handover-Konfiguration (``PlanningItemRecord.handover_enabled`` +
``linked_planning_external_id``); die Übergabemenge je Kategorie ist die geplante
Item-Menge, begrenzt durch ``min(tatsächlich ausgegeben für A, Bedarf von B)``.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import (
    AssetRecord,
    HandoverExecutionRecord,
    PlanningDayRecord,
    PlanningItemRecord,
    PlanningRecord,
)
from . import category_repository
from . import planning_repository as PR
from ..schemas.handover import (
    HandoverCategoryStatus,
    HandoverStatusResponse,
)


def _is_asset_loaned_for(asset: AssetRecord, planning_id: str) -> bool:
    return (
        str(getattr(asset, "assigned_planning_id", None) or "").strip() == planning_id
        and str(asset.status).strip().lower() == "verliehen"
    )


@dataclass
class CategoryHandover:
    """Geplante Übergabe einer Kategorie von A an deren verknüpfte Planung B."""

    category: str
    target_id: str | None
    target_label: str | None
    target_record: PlanningRecord | None
    configured_qty: int
    target_demand: int
    issued_assets: list[AssetRecord]  # aktuell für A ausgegeben (Status Verliehen), sortiert
    already_transferred: int
    structurally_eligible: bool

    @property
    def planned_total(self) -> int:
        return max(0, min(self.configured_qty, self.target_demand))

    @property
    def transfer_now(self) -> list[AssetRecord]:
        """Konkrete Assets, die JETZT zu übertragen sind (offener Anteil)."""
        if not self.structurally_eligible:
            return []
        open_count = max(0, self.planned_total - self.already_transferred)
        return self.issued_assets[:open_count]


@dataclass
class HandoverPlan:
    source_id: str
    source_return_day: date
    categories: list[CategoryHandover] = field(default_factory=list)


def compute_handover_plan(db: Session, source_id: str) -> HandoverPlan | None:
    """Ermittelt je Kategorie die geplante/fällige Übergabe von A an B.

    Strukturelle Gültigkeit einer Kategorie: B existiert, ist aktiv und
    ``B.start_date >= A_end_exclusive`` (B beginnt frühestens am Rückgabetag von A
    — überlappende/zu frühe Folgeprojekte sind KEINE gültige Übergabe).
    """
    source = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == source_id))
    if source is None:
        return None

    source_return_day = PR._period_end_exclusive(source.start_date, source.end_date)
    active_names = category_repository.active_category_names(db)

    # 1) Handover-Konfig aus A je Kategorie: Ziel (linked) + konfigurierte Menge
    #    (max Tagesmenge der handover-aktiven Items, konsistent zu plannedQty).
    day_rows = db.scalars(
        select(PlanningDayRecord).where(PlanningDayRecord.planning_id == source.id)
    ).all()
    day_ids = [d.id for d in day_rows]
    items = (
        db.scalars(select(PlanningItemRecord).where(PlanningItemRecord.planning_day_id.in_(tuple(day_ids)))).all()
        if day_ids
        else []
    )
    per_day_qty: dict[tuple[str, int], int] = defaultdict(int)  # (cat, day_id) -> qty
    target_by_cat: dict[str, str] = {}
    for item in items:
        if not bool(item.handover_enabled):
            continue
        linked = str(item.linked_planning_external_id or "").strip()
        if not linked:
            continue
        cat = category_repository.normalize_category_value(item.category_key, active_names)
        per_day_qty[(cat, item.planning_day_id)] += int(item.qty or 0)
        target_by_cat.setdefault(cat, linked)
    configured_by_cat: dict[str, int] = defaultdict(int)
    for (cat, _day_id), qty in per_day_qty.items():
        configured_by_cat[cat] = max(configured_by_cat[cat], qty)

    if not target_by_cat:
        return HandoverPlan(source_id=source.external_id, source_return_day=source_return_day, categories=[])

    # 2) Aktuell für A ausgegebene Geräte je Kategorie (Status Verliehen),
    #    deterministisch sortiert (Seriennummer, dann external_id).
    issued = db.scalars(
        select(AssetRecord).where(AssetRecord.assigned_planning_id == source.external_id)
    ).all()
    issued_by_cat: dict[str, list[AssetRecord]] = defaultdict(list)
    for asset in issued:
        if str(asset.status).strip().lower() != "verliehen":
            continue
        cat = category_repository.normalize_category_value(asset.category, active_names)
        issued_by_cat[cat].append(asset)
    for cat in issued_by_cat:
        issued_by_cat[cat].sort(key=lambda a: (str(a.serial_number or ""), str(a.external_id or "")))

    # 3) Bereits aktiv übertragene Assets je (Quelle, Kategorie).
    active_rows = db.scalars(
        select(HandoverExecutionRecord).where(
            HandoverExecutionRecord.source_planning_id == source.external_id,
            HandoverExecutionRecord.status == "active",
        )
    ).all()
    already_by_cat: dict[str, int] = defaultdict(int)
    for row in active_rows:
        already_by_cat[str(row.category)] += 1

    # 4) Ziel-Bedarf je B (Tages-Spitze) — pro Zielplanung einmal laden.
    demand_cache: dict[str, dict[str, int]] = {}

    def _target_demand(target_id: str, category: str) -> tuple[int, PlanningRecord | None, str | None, bool]:
        target = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == target_id))
        if target is None:
            return 0, None, None, False
        structurally_eligible = (
            PR._normalize_status(target.status) in PR.ACTIVE_PLANNING_STATUSES
            and target.start_date >= source_return_day
        )
        if target_id not in demand_cache:
            assigned = PR.get_planning_assigned_assets(db, target_id)
            demand_cache[target_id] = (
                {c.categoryKey: int(c.plannedQty) for c in assigned.categories} if assigned else {}
            )
        demand = int(demand_cache[target_id].get(category, 0))
        return demand, target, PR._build_planning_short_label(target), structurally_eligible

    categories: list[CategoryHandover] = []
    for cat, target_id in sorted(target_by_cat.items()):
        demand, target_record, target_label, eligible = _target_demand(target_id, cat)
        categories.append(
            CategoryHandover(
                category=cat,
                target_id=target_id,
                target_label=target_label,
                target_record=target_record,
                configured_qty=int(configured_by_cat.get(cat, 0)),
                target_demand=demand,
                issued_assets=list(issued_by_cat.get(cat, [])),
                already_transferred=int(already_by_cat.get(cat, 0)),
                structurally_eligible=bool(eligible),
            )
        )

    return HandoverPlan(
        source_id=source.external_id,
        source_return_day=source_return_day,
        categories=categories,
    )


def _category_state(cat: CategoryHandover, due_now: bool) -> str:
    if not cat.structurally_eligible or cat.planned_total <= 0:
        return "not_applicable"
    if cat.already_transferred >= cat.planned_total:
        return "executed"
    if cat.already_transferred > 0:
        return "partially_executed"
    return "due" if due_now else "planned"


def build_status_response(plan: HandoverPlan, *, today: date) -> HandoverStatusResponse:
    due_now = today >= plan.source_return_day
    rows: list[HandoverCategoryStatus] = []
    total_transferable = 0
    total_already = 0
    any_eligible = False
    for cat in plan.categories:
        state = _category_state(cat, due_now)
        transfer_now = cat.transfer_now if due_now else []
        transferable_qty = len(transfer_now)
        total_transferable += transferable_qty
        total_already += cat.already_transferred
        if cat.structurally_eligible and cat.planned_total > 0:
            any_eligible = True
        rows.append(
            HandoverCategoryStatus(
                categoryKey=cat.category,
                targetPlanningId=cat.target_id,
                targetPlanningLabel=cat.target_label,
                issuedQty=len(cat.issued_assets),
                configuredQty=cat.configured_qty,
                targetDemand=cat.target_demand,
                plannedTotal=cat.planned_total,
                alreadyTransferredQty=cat.already_transferred,
                transferableQty=transferable_qty,
                state=state,  # type: ignore[arg-type]
                transferAssetIds=[a.external_id for a in transfer_now],
            )
        )
    return HandoverStatusResponse(
        planningId=plan.source_id,
        sourceReturnDay=plan.source_return_day,
        dueNow=due_now,
        autoEligible=any_eligible,
        totalTransferable=total_transferable,
        totalAlreadyTransferred=total_already,
        categories=rows,
    )
