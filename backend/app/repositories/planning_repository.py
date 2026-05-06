from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..database.models import AssetRecord, PlanningDayRecord, PlanningItemRecord, PlanningRecord
from ..domain.categories import normalize_category_or_self
from . import category_repository
from ..schemas.planning import (
    PlanningAvailabilityCategorySummary,
    PlanningAvailabilityItem,
    PlanningAvailabilityResponse,
    PlanningDayResponse,
    PlanningItemResponse,
    PlanningListHandoverSummary,
    PlanningListItem,
    PlanningResponse,
    PlanningStatus,
    PlanningUpsertPayload,
)

# Include "Entwurf" so planning conflicts are visible early during project preparation.
ACTIVE_PLANNING_STATUSES = {"Entwurf", "Geplant", "Bestaetigt"}


def _normalize_status(value: str | PlanningStatus) -> PlanningStatus:
    normalized = str(value).strip().lower()
    if normalized in {"entwurf", "draft"}:
        return "Entwurf"
    if normalized in {"geplant", "planned"}:
        return "Geplant"
    if normalized in {"bestaetigt", "bestätigt", "confirmed"}:
        return "Bestaetigt"
    if normalized in {"abgeschlossen", "closed", "done"}:
        return "Abgeschlossen"
    if normalized in {"storniert", "cancelled", "canceled"}:
        return "Storniert"
    return "Entwurf"


def _normalize_weekday(value: str | None, day_date: date) -> str:
    if value and value.strip():
        return value.strip()
    weekdays = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
    return weekdays[day_date.weekday()]


def _generate_external_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def _build_planning_short_label(record: PlanningRecord) -> str:
    event_name = str(record.event_name or "").strip()
    if event_name:
        return f"{record.project_name} ({event_name})"
    return record.project_name


def _planning_to_list_item(
    record: PlanningRecord,
    handover_summary: PlanningListHandoverSummary | None = None,
) -> PlanningListItem:
    return PlanningListItem(
        id=record.external_id,
        customerName=record.customer_name,
        projectName=record.project_name,
        eventName=record.event_name,
        projectManagerUserId=record.project_manager_user_id,
        calendarWeek=record.calendar_week,
        startDate=record.start_date,
        endDate=record.end_date,
        status=_normalize_status(record.status),
        updatedAt=record.updated_at,
        handoverSummary=handover_summary,
    )


def _build_handover_list_summary_map(
    db: Session,
    records: list[PlanningRecord],
) -> dict[str, PlanningListHandoverSummary]:
    planning_ids = tuple(record.external_id for record in records if record.external_id)
    if not planning_ids:
        return {}

    summary_state: dict[str, dict[str, set[str]]] = {
        record.external_id: {"directions": set(), "partner_ids": set(), "category_keys": set()}
        for record in records
        if record.external_id
    }

    outgoing_rows = db.execute(
        select(
            PlanningRecord.external_id,
            PlanningItemRecord.linked_planning_external_id,
            PlanningItemRecord.category_key,
        )
        .join(PlanningDayRecord, PlanningDayRecord.planning_id == PlanningRecord.id)
        .join(PlanningItemRecord, PlanningItemRecord.planning_day_id == PlanningDayRecord.id)
        .where(PlanningRecord.external_id.in_(planning_ids))
        .where(PlanningItemRecord.handover_enabled.is_(True))
        .where(PlanningItemRecord.linked_planning_external_id.is_not(None))
    ).all()

    incoming_rows = db.execute(
        select(
            PlanningItemRecord.linked_planning_external_id,
            PlanningRecord.external_id,
            PlanningItemRecord.category_key,
        )
        .join(PlanningDayRecord, PlanningDayRecord.id == PlanningItemRecord.planning_day_id)
        .join(PlanningRecord, PlanningRecord.id == PlanningDayRecord.planning_id)
        .where(PlanningItemRecord.handover_enabled.is_(True))
        .where(PlanningItemRecord.linked_planning_external_id.in_(planning_ids))
    ).all()

    partner_ids: set[str] = set()

    for planning_id, linked_planning_id, category_key in outgoing_rows:
        owner_id = str(planning_id or "").strip()
        partner_id = str(linked_planning_id or "").strip()
        if not owner_id or not partner_id:
            continue
        state = summary_state.get(owner_id)
        if state is None:
            continue
        state["directions"].add("outgoing")
        state["partner_ids"].add(partner_id)
        state["category_keys"].add(normalize_category_or_self(category_key))
        partner_ids.add(partner_id)

    for linked_planning_id, source_planning_id, category_key in incoming_rows:
        target_id = str(linked_planning_id or "").strip()
        partner_id = str(source_planning_id or "").strip()
        if not target_id or not partner_id or target_id == partner_id:
            continue
        state = summary_state.get(target_id)
        if state is None:
            continue
        state["directions"].add("incoming")
        state["partner_ids"].add(partner_id)
        state["category_keys"].add(normalize_category_or_self(category_key))
        partner_ids.add(partner_id)

    partner_labels: dict[str, str] = {}
    if partner_ids:
        partner_rows = db.scalars(select(PlanningRecord).where(PlanningRecord.external_id.in_(tuple(partner_ids)))).all()
        partner_labels = {row.external_id: _build_planning_short_label(row) for row in partner_rows}

    summary_map: dict[str, PlanningListHandoverSummary] = {}
    for planning_id, state in summary_state.items():
        directions = state["directions"]
        partner_id_values = sorted(
            state["partner_ids"],
            key=lambda value: (partner_labels.get(value) or value).lower(),
        )
        category_keys = sorted(state["category_keys"], key=str.lower)
        if not directions or not partner_id_values or not category_keys:
            continue
        if directions == {"outgoing"}:
            direction = "outgoing"
        elif directions == {"incoming"}:
            direction = "incoming"
        else:
            direction = "mixed"
        primary_partner_id = partner_id_values[0]
        summary_map[planning_id] = PlanningListHandoverSummary(
            direction=direction,
            partnerPlanningId=primary_partner_id,
            partnerPlanningLabel=partner_labels.get(primary_partner_id),
            partnerPlanningCount=len(partner_id_values),
            categoryKeys=category_keys,
        )
    return summary_map


def _planning_to_response(
    db: Session,
    record: PlanningRecord,
    day_map: dict[int, list[PlanningItemRecord]],
    days: list[PlanningDayRecord],
) -> PlanningResponse:
    linked_ids = {
        str(item.linked_planning_external_id).strip()
        for entries in day_map.values()
        for item in entries
        if item.linked_planning_external_id
    }
    linked_labels: dict[str, str] = {}
    if linked_ids:
        linked_rows = db.scalars(select(PlanningRecord).where(PlanningRecord.external_id.in_(tuple(linked_ids)))).all()
        linked_labels = {row.external_id: row.project_name for row in linked_rows}
    day_responses: list[PlanningDayResponse] = []
    for day in sorted(days, key=lambda item: item.planning_date):
        grouped_items: dict[str, dict[str, object]] = {}
        for item in day_map.get(day.id, []):
            category = normalize_category_or_self(item.category_key)
            current = grouped_items.setdefault(
                category,
                {
                    "qty": 0,
                    "notes": [],
                    "id": item.id,
                    "handover_enabled": False,
                    "linked_planning_id": None,
                    "handover_note": None,
                },
            )
            current["qty"] = int(current["qty"]) + item.qty
            if item.notes:
                notes = current["notes"]
                if isinstance(notes, list):
                    notes.append(item.notes)
            if bool(item.handover_enabled):
                current["handover_enabled"] = True
            linked_planning_id = str(item.linked_planning_external_id or "").strip()
            if linked_planning_id:
                current["linked_planning_id"] = linked_planning_id
            handover_note = str(item.handover_note or "").strip()
            if handover_note:
                current["handover_note"] = handover_note
        day_responses.append(
            PlanningDayResponse(
                id=day.id,
                planningDate=day.planning_date,
                weekday=day.weekday,
                items=[
                    PlanningItemResponse(
                        id=int(values["id"]),
                        categoryKey=category,
                        qty=int(values["qty"]),
                        notes="; ".join(values["notes"]) if isinstance(values["notes"], list) else None,
                        handoverEnabled=bool(values["handover_enabled"]),
                        linkedPlanningId=str(values["linked_planning_id"] or "") or None,
                        linkedPlanningLabel=linked_labels.get(str(values["linked_planning_id"] or "")),
                        handoverNote=str(values["handover_note"] or "") or None,
                    )
                    for category, values in sorted(grouped_items.items(), key=lambda row: row[0].lower())
                ],
            )
        )
    return PlanningResponse(
        id=record.external_id,
        customerName=record.customer_name,
        projectName=record.project_name,
        eventName=record.event_name,
        projectManagerUserId=record.project_manager_user_id,
        calendarWeek=record.calendar_week,
        startDate=record.start_date,
        endDate=record.end_date,
        notes=record.notes,
        status=_normalize_status(record.status),
        templateSourcePlanningId=record.template_source_planning_id,
        createdAt=record.created_at,
        updatedAt=record.updated_at,
        days=day_responses,
    )
def list_plannings(
    db: Session,
    status: str | None = None,
    from_date: date | None = None,
    to_date: date | None = None,
) -> list[PlanningListItem]:
    stmt = select(PlanningRecord).order_by(PlanningRecord.updated_at.desc())
    if status:
        stmt = stmt.where(PlanningRecord.status == _normalize_status(status))
    if from_date:
        stmt = stmt.where(PlanningRecord.end_date >= from_date)
    if to_date:
        stmt = stmt.where(PlanningRecord.start_date <= to_date)
    records = db.scalars(stmt).all()
    handover_summary_map = _build_handover_list_summary_map(db, records)
    return [_planning_to_list_item(item, handover_summary_map.get(item.external_id)) for item in records]


def get_planning(db: Session, planning_id: str) -> PlanningResponse | None:
    planning = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == planning_id))
    if not planning:
        return None

    days = db.scalars(
        select(PlanningDayRecord).where(PlanningDayRecord.planning_id == planning.id)
    ).all()
    day_ids = [day.id for day in days]
    items = (
        db.scalars(select(PlanningItemRecord).where(PlanningItemRecord.planning_day_id.in_(day_ids))).all()
        if day_ids
        else []
    )
    day_map: dict[int, list[PlanningItemRecord]] = defaultdict(list)
    for item in items:
        day_map[item.planning_day_id].append(item)

    return _planning_to_response(db, planning, day_map, days)


def _upsert_days_and_items(db: Session, planning_pk: int, payload: PlanningUpsertPayload) -> None:
    existing_day_ids = db.scalars(
        select(PlanningDayRecord.id).where(PlanningDayRecord.planning_id == planning_pk)
    ).all()
    if existing_day_ids:
        db.execute(delete(PlanningItemRecord).where(PlanningItemRecord.planning_day_id.in_(existing_day_ids)))
        db.execute(delete(PlanningDayRecord).where(PlanningDayRecord.id.in_(existing_day_ids)))

    for day in sorted(payload.days, key=lambda item: item.planningDate):
        day_record = PlanningDayRecord(
            planning_id=planning_pk,
            planning_date=day.planningDate,
            weekday=_normalize_weekday(day.weekday, day.planningDate),
        )
        db.add(day_record)
        db.flush()
        grouped_items: dict[str, dict[str, object]] = {}
        for item in day.items:
            category = category_repository.normalize_category_for_db(db, item.categoryKey)
            current = grouped_items.setdefault(
                category,
                {
                    "qty": 0,
                    "notes": [],
                    "handover_enabled": False,
                    "linked_planning_external_id": None,
                    "handover_notes": [],
                },
            )
            current["qty"] = int(current["qty"]) + item.qty
            if item.notes:
                notes = current["notes"]
                if isinstance(notes, list):
                    notes.append(item.notes)
            if item.handoverEnabled:
                current["handover_enabled"] = True
            linked_planning_id = str(item.linkedPlanningId or "").strip()
            if linked_planning_id:
                current["linked_planning_external_id"] = linked_planning_id
            handover_note = str(item.handoverNote or "").strip()
            if handover_note:
                handover_notes = current["handover_notes"]
                if isinstance(handover_notes, list):
                    handover_notes.append(handover_note)
        for category, values in grouped_items.items():
            notes = values["notes"]
            handover_notes = values["handover_notes"]
            db.add(
                PlanningItemRecord(
                    planning_day_id=day_record.id,
                    category_key=category,
                    qty=int(values["qty"]),
                    notes="; ".join(notes) if isinstance(notes, list) and notes else None,
                    handover_enabled=bool(values["handover_enabled"]),
                    linked_planning_external_id=str(values["linked_planning_external_id"] or "") or None,
                    handover_note="; ".join(handover_notes) if isinstance(handover_notes, list) and handover_notes else None,
                )
            )


def upsert_planning(db: Session, payload: PlanningUpsertPayload, planning_id: str | None = None) -> PlanningResponse:
    resolved_id = planning_id or payload.id
    if resolved_id:
        planning = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == resolved_id))
    else:
        planning = None

    if planning is None:
        planning = PlanningRecord(
            external_id=resolved_id or _generate_external_id("pln"),
            customer_name=payload.customerName.strip(),
            project_name=payload.projectName.strip(),
            event_name=payload.eventName.strip() if payload.eventName else None,
            project_manager_user_id=payload.projectManagerUserId.strip() if payload.projectManagerUserId else None,
            calendar_week=payload.calendarWeek,
            start_date=payload.startDate,
            end_date=payload.endDate,
            notes=payload.notes.strip(),
            status=_normalize_status(payload.status),
        )
        db.add(planning)
        db.flush()
    else:
        planning.customer_name = payload.customerName.strip()
        planning.project_name = payload.projectName.strip()
        planning.event_name = payload.eventName.strip() if payload.eventName else None
        planning.project_manager_user_id = (
            payload.projectManagerUserId.strip() if payload.projectManagerUserId else None
        )
        planning.calendar_week = payload.calendarWeek
        planning.start_date = payload.startDate
        planning.end_date = payload.endDate
        planning.notes = payload.notes.strip()
        planning.status = _normalize_status(payload.status)

    _upsert_days_and_items(db, planning.id, payload)
    db.commit()
    return get_planning(db, planning.external_id)  # type: ignore[return-value]


def update_status(db: Session, planning_id: str, status: PlanningStatus) -> PlanningResponse | None:
    planning = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == planning_id))
    if not planning:
        return None
    planning.status = _normalize_status(status)
    db.commit()
    return get_planning(db, planning_id)


def duplicate_planning(db: Session, planning_id: str) -> PlanningResponse | None:
    source = get_planning(db, planning_id)
    if not source:
        return None

    payload = PlanningUpsertPayload(
        customerName=source.customerName,
        projectName=source.projectName,
        eventName=source.eventName,
        projectManagerUserId=source.projectManagerUserId,
        calendarWeek=source.calendarWeek,
        startDate=source.startDate,
        endDate=source.endDate,
        notes=source.notes,
        status="Entwurf",
        days=[
            {
                "planningDate": day.planningDate,
                "weekday": day.weekday,
                "items": [
                    {
                        "categoryKey": item.categoryKey,
                        "qty": item.qty,
                        "notes": item.notes,
                        "handoverEnabled": item.handoverEnabled,
                        "linkedPlanningId": item.linkedPlanningId,
                        "handoverNote": item.handoverNote,
                    }
                    for item in day.items
                ],
            }
            for day in source.days
        ],
    )

    duplicated = upsert_planning(db, payload)
    record = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == duplicated.id))
    if record:
        record.template_source_planning_id = planning_id
        db.commit()
    return get_planning(db, duplicated.id)


def delete_planning(db: Session, planning_id: str) -> bool:
    planning = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == planning_id))
    if not planning:
        return False
    day_ids = db.scalars(select(PlanningDayRecord.id).where(PlanningDayRecord.planning_id == planning.id)).all()
    if day_ids:
        db.execute(delete(PlanningItemRecord).where(PlanningItemRecord.planning_day_id.in_(day_ids)))
        db.execute(delete(PlanningDayRecord).where(PlanningDayRecord.planning_id == planning.id))
    db.delete(planning)
    db.commit()
    return True


def _period_end_exclusive(start_date: date, end_date: date) -> date:
    if end_date > start_date:
        return end_date
    return start_date + timedelta(days=1)


def _iter_bound_dates(start_date: date, end_date: date) -> list[date]:
    dates: list[date] = []
    cursor = start_date
    end_exclusive = _period_end_exclusive(start_date, end_date)
    while cursor < end_exclusive:
        dates.append(cursor)
        cursor += timedelta(days=1)
    return dates


def _date_in_bound_window(target: date, start_date: date, end_date: date) -> bool:
    return start_date <= target < _period_end_exclusive(start_date, end_date)


def _availability_state(requested_qty: int, remaining_qty: int) -> str:
    after_request = remaining_qty - requested_qty
    if after_request < 0:
        return "red"
    if after_request <= 2:
        return "yellow"
    return "green"


def _availability_state_with_handover(remaining_after_all: int, handover_covered_qty: int) -> str:
    if remaining_after_all < 0:
        return "red"
    if handover_covered_qty > 0:
        return "yellow"
    if remaining_after_all <= 2:
        return "yellow"
    return "green"


def get_planning_availability(db: Session, planning_id: str) -> PlanningAvailabilityResponse | None:
    planning = db.scalar(select(PlanningRecord).where(PlanningRecord.external_id == planning_id))
    if not planning:
        return None

    day_rows = db.scalars(select(PlanningDayRecord).where(PlanningDayRecord.planning_id == planning.id)).all()
    if not day_rows:
        return PlanningAvailabilityResponse(
            planningId=planning.external_id,
            periodStart=planning.start_date,
            periodEnd=planning.end_date,
            items=[],
            categorySummary=[],
        )

    day_ids = [day.id for day in day_rows]
    item_rows = db.scalars(select(PlanningItemRecord).where(PlanningItemRecord.planning_day_id.in_(day_ids))).all()
    if not item_rows:
        return PlanningAvailabilityResponse(
            planningId=planning.external_id,
            periodStart=planning.start_date,
            periodEnd=planning.end_date,
            items=[],
            categorySummary=[],
        )

    days_by_id = {day.id: day for day in day_rows}
    bound_dates = _iter_bound_dates(planning.start_date, planning.end_date)
    bound_dates_set = set(bound_dates)
    if not bound_dates:
        return PlanningAvailabilityResponse(
            planningId=planning.external_id,
            periodStart=planning.start_date,
            periodEnd=planning.end_date,
            items=[],
            categorySummary=[],
        )
    relevant_item_rows = [item for item in item_rows if days_by_id[item.planning_day_id].planning_date in bound_dates_set]
    if not relevant_item_rows:
        return PlanningAvailabilityResponse(
            planningId=planning.external_id,
            periodStart=planning.start_date,
            periodEnd=planning.end_date,
            items=[],
            categorySummary=[],
        )
    categories = sorted({category_repository.normalize_category_for_db(db, item.category_key) for item in relevant_item_rows})

    stock_totals: dict[str, int] = defaultdict(int)
    stock_usable: dict[str, int] = defaultdict(int)
    for asset in db.scalars(select(AssetRecord)).all():
        category = category_repository.normalize_category_for_db(db, asset.category)
        if category not in categories:
            continue
        stock_totals[category] += 1
        if str(asset.status).strip().lower() in {"verfuegbar", "verfügbar"}:
            stock_usable[category] += 1
    stock_map = {category: (stock_totals[category], stock_usable[category]) for category in categories}

    explicit_requested_qty_by_day_category: dict[tuple[date, str], int] = defaultdict(int)
    max_requested_qty_by_category: dict[str, int] = defaultdict(int)
    category_meta: dict[str, dict[str, object]] = {}
    weekday_by_date: dict[date, str] = {}
    linked_ids: set[str] = set()

    for item in relevant_item_rows:
        day = days_by_id[item.planning_day_id]
        weekday_by_date[day.planning_date] = day.weekday
        category = category_repository.normalize_category_for_db(db, item.category_key)
        key = (day.planning_date, category)
        explicit_requested_qty_by_day_category[key] += int(item.qty or 0)
        max_requested_qty_by_category[category] = max(max_requested_qty_by_category[category], explicit_requested_qty_by_day_category[key])

        linked_planning_id = str(item.linked_planning_external_id or "").strip()
        handover_note = str(item.handover_note or "").strip() or None
        current_meta = category_meta.get(category)
        if current_meta is None or day.planning_date < current_meta["sourceDate"]:
            category_meta[category] = {
                "sourceDate": day.planning_date,
                "handoverEnabled": bool(item.handover_enabled),
                "linkedPlanningId": linked_planning_id or None,
                "handoverNote": handover_note,
            }
        else:
            current_meta["handoverEnabled"] = bool(current_meta["handoverEnabled"]) or bool(item.handover_enabled)
            if not current_meta.get("linkedPlanningId") and linked_planning_id:
                current_meta["linkedPlanningId"] = linked_planning_id
            if not current_meta.get("handoverNote") and handover_note:
                current_meta["handoverNote"] = handover_note
        if linked_planning_id:
            linked_ids.add(linked_planning_id)

    requested_by_day_category: dict[tuple[date, str], dict[str, object]] = {}
    for category in categories:
        default_qty = int(max_requested_qty_by_category.get(category, 0))
        if default_qty <= 0:
            continue
        meta = category_meta.get(category, {})
        for bound_date in bound_dates:
            requested_qty = int(explicit_requested_qty_by_day_category.get((bound_date, category), default_qty))
            if requested_qty <= 0:
                continue
            requested_by_day_category[(bound_date, category)] = {
                "weekday": weekday_by_date.get(bound_date) or _normalize_weekday(None, bound_date),
                "category": category,
                "qty": requested_qty,
                "handoverEnabled": bool(meta.get("handoverEnabled", False)),
                "linkedPlanningId": str(meta.get("linkedPlanningId") or "") or None,
                "handoverNote": str(meta.get("handoverNote") or "") or None,
            }

    overlap_map: dict[tuple[date, str], int] = defaultdict(int)
    overlap_planning_ids_map: dict[tuple[date, str], set[str]] = defaultdict(set)
    overlap_items = db.execute(
        select(
            PlanningRecord.external_id,
            PlanningRecord.start_date,
            PlanningRecord.end_date,
            PlanningDayRecord.planning_date,
            PlanningItemRecord.category_key,
            PlanningItemRecord.qty,
        )
        .join(PlanningItemRecord, PlanningItemRecord.planning_day_id == PlanningDayRecord.id)
        .join(PlanningRecord, PlanningRecord.id == PlanningDayRecord.planning_id)
        .where(PlanningRecord.external_id != planning_id)
        .where(PlanningRecord.status.in_(tuple(ACTIVE_PLANNING_STATUSES)))
        .where(PlanningRecord.start_date < _period_end_exclusive(planning.start_date, planning.end_date))
        .where(PlanningRecord.end_date > planning.start_date)
    ).all()
    overlap_explicit_qty_map: dict[tuple[str, date, str], int] = defaultdict(int)
    overlap_default_qty_map: dict[tuple[str, str], int] = defaultdict(int)
    overlap_period_map: dict[str, tuple[date, date]] = {}
    for row in overlap_items:
        other_id = str(row.external_id or "").strip()
        if not other_id:
            continue
        overlap_period_map[other_id] = (row.start_date, row.end_date)
        category = category_repository.normalize_category_for_db(db, str(row.category_key))
        if category not in categories:
            continue
        qty_key = (other_id, row.planning_date, category)
        overlap_explicit_qty_map[qty_key] += int(row.qty or 0)
        overlap_default_qty_map[(other_id, category)] = max(overlap_default_qty_map[(other_id, category)], overlap_explicit_qty_map[qty_key])

    for (other_id, category), default_qty in overlap_default_qty_map.items():
        if default_qty <= 0:
            continue
        start_end = overlap_period_map.get(other_id)
        if start_end is None:
            continue
        other_start, other_end = start_end
        for bound_date in _iter_bound_dates(other_start, other_end):
            if bound_date not in bound_dates_set:
                continue
            effective_qty = int(overlap_explicit_qty_map.get((other_id, bound_date, category), default_qty))
            if effective_qty <= 0:
                continue
            overlap_map[(bound_date, category)] += effective_qty
            overlap_planning_ids_map[(bound_date, category)].add(other_id)

    availability_items: list[PlanningAvailabilityItem] = []
    summary_requested: dict[str, int] = defaultdict(int)
    summary_max_per_day: dict[str, int] = defaultdict(int)

    linked_labels: dict[str, str] = {}
    if linked_ids:
        linked_rows = db.scalars(select(PlanningRecord).where(PlanningRecord.external_id.in_(tuple(linked_ids)))).all()
        linked_labels = {row.external_id: row.project_name for row in linked_rows}

    previous_dates = {planning_date - timedelta(days=1) for planning_date, _ in requested_by_day_category.keys()}
    handover_source_qty_map: dict[tuple[str, date, str], int] = defaultdict(int)
    if linked_ids and previous_dates:
        handover_source_rows = db.execute(
            select(
                PlanningRecord.external_id,
                PlanningRecord.start_date,
                PlanningRecord.end_date,
                PlanningDayRecord.planning_date,
                PlanningItemRecord.category_key,
                PlanningItemRecord.qty,
            )
            .join(PlanningDayRecord, PlanningDayRecord.planning_id == PlanningRecord.id)
            .join(PlanningItemRecord, PlanningItemRecord.planning_day_id == PlanningDayRecord.id)
            .where(PlanningRecord.external_id.in_(tuple(linked_ids)))
            .where(PlanningRecord.status.in_(tuple(ACTIVE_PLANNING_STATUSES)))
        ).all()
        source_explicit_qty_map: dict[tuple[str, date, str], int] = defaultdict(int)
        source_default_qty_map: dict[tuple[str, str], int] = defaultdict(int)
        source_period_map: dict[str, tuple[date, date]] = {}
        for row in handover_source_rows:
            source_id = str(row.external_id or "").strip()
            if not source_id:
                continue
            source_period_map[source_id] = (row.start_date, row.end_date)
            category = category_repository.normalize_category_for_db(db, str(row.category_key))
            key = (source_id, row.planning_date, category)
            source_explicit_qty_map[key] += int(row.qty or 0)
            source_default_qty_map[(source_id, category)] = max(source_default_qty_map[(source_id, category)], source_explicit_qty_map[key])
        for (source_id, category), default_qty in source_default_qty_map.items():
            if default_qty <= 0:
                continue
            start_end = source_period_map.get(source_id)
            if start_end is None:
                continue
            source_start, source_end = start_end
            for previous_day in previous_dates:
                if not _date_in_bound_window(previous_day, source_start, source_end):
                    continue
                handover_source_qty_map[(source_id, previous_day, category)] = int(
                    source_explicit_qty_map.get((source_id, previous_day, category), default_qty)
                )

    for (planning_date, category), requested in sorted(requested_by_day_category.items(), key=lambda row: (row[0][0], row[0][1])):
        requested_qty = int(requested["qty"])
        total_stock, usable_stock = stock_map.get(category, (0, 0))
        already_planned = overlap_map.get((planning_date, category), 0)
        remaining_qty = usable_stock - already_planned
        current_planning_qty = requested_qty
        other_planned_qty = already_planned
        total_planned_qty_for_date_category = current_planning_qty + other_planned_qty
        remaining_after_all_planning = usable_stock - total_planned_qty_for_date_category
        shortage_qty = max(0, -remaining_after_all_planning)
        handover_covered_qty = 0
        handover_enabled = bool(requested["handoverEnabled"])
        linked_planning_id = str(requested["linkedPlanningId"] or "") or None
        handover_status: "none" | "planned" | "missing_link" = "none"
        if shortage_qty > 0 and handover_enabled and linked_planning_id:
            previous_day = planning_date - timedelta(days=1)
            source_capacity = handover_source_qty_map.get((linked_planning_id, previous_day, category), 0)
            handover_covered_qty = min(shortage_qty, max(0, source_capacity))
        shortage_after_handover_qty = max(0, shortage_qty - handover_covered_qty)
        has_global_shortage = shortage_after_handover_qty > 0
        if shortage_qty > 0 and handover_enabled:
            handover_status = "planned" if linked_planning_id else "missing_link"
        availability_items.append(
            PlanningAvailabilityItem(
                planningDate=planning_date,
                weekday=str(requested["weekday"]),
                categoryKey=category,
                requestedQty=requested_qty,
                totalStock=total_stock,
                usableStock=usable_stock,
                alreadyPlanned=already_planned,
                remainingQty=remaining_qty,
                currentPlanningQty=current_planning_qty,
                otherPlannedQty=other_planned_qty,
                totalPlannedQtyForDateCategory=total_planned_qty_for_date_category,
                remainingAfterAllPlanning=remaining_after_all_planning + handover_covered_qty,
                availabilityState=_availability_state_with_handover(
                    remaining_after_all_planning + handover_covered_qty,
                    handover_covered_qty,
                ),
                shortageQty=shortage_after_handover_qty,
                hasGlobalShortage=has_global_shortage,
                affectedPlanningIds=sorted(overlap_planning_ids_map.get((planning_date, category), set())),
                handoverEnabled=handover_enabled,
                linkedPlanningId=linked_planning_id,
                linkedPlanningLabel=linked_labels.get(linked_planning_id or ""),
                handoverNote=str(requested["handoverNote"] or "") or None,
                handoverStatus=handover_status,
                handoverCoveredQty=handover_covered_qty,
                shortageAfterHandoverQty=shortage_after_handover_qty,
            )
        )
        summary_requested[category] += requested_qty
        summary_max_per_day[category] = max(summary_max_per_day[category], requested_qty)

    category_summary = [
        PlanningAvailabilityCategorySummary(
            categoryKey=category,
            requestedTotal=summary_requested[category],
            maxRequestedPerDay=summary_max_per_day[category],
            totalStock=stock_map.get(category, (0, 0))[0],
            usableStock=stock_map.get(category, (0, 0))[1],
        )
        for category in sorted(summary_requested)
    ]

    return PlanningAvailabilityResponse(
        planningId=planning.external_id,
        periodStart=planning.start_date,
        periodEnd=planning.end_date,
        items=availability_items,
        categorySummary=category_summary,
    )
