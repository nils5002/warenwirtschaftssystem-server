from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..repositories import handover_repository
from ..schemas.handover import (
    HandoverRunResponse,
    HandoverStatusResponse,
    HandoverUndoResponse,
)
from ..schemas.planning import (
    PlanningAssignedAssetsResponse,
    PlanningAvailabilityResponse,
    PlanningEventListResponse,
    PlanningEventItem,
    PlanningListItem,
    PlanningNotePayload,
    PlanningResponse,
    PlanningStatusUpdatePayload,
    PlanningUpsertPayload,
)
from ..services import handover_service, planning_event_service
from ..services.planning_service import PlanningService

router = APIRouter(prefix="/api/wms/planning", tags=["Planning"])
logger = logging.getLogger("cloud_web.planning")


def _matches_planning_write_scope(context: AccessContext, planning: PlanningListItem | PlanningResponse) -> bool:
    # Schreibrechte sind ROLLENbasiert, nicht eigentümerbasiert.
    # Admin/Techniker und JEDER Projektmanager dürfen jede Planung
    # bearbeiten — die frühere Einschränkung auf
    # planning.projectManagerUserId == context.user_id wurde entfernt,
    # weil Akkreditierungsprojekte als Team-Workflow geplant werden und
    # mehrere Projektmanager dieselbe Planung pflegen können müssen.
    if context.role == "admin":
        return True
    if context.role == "projektmanager":
        return True
    # Fallback für andere Rollen (z. B. Mitarbeiter mit explizitem
    # Project-Context-Scope) bleibt erhalten — wird durch die
    # require_roles()-Aufrufe in den Routes ohnehin nur greifen, wenn
    # die Rolle vorher zugelassen wurde.
    if not context.project_contexts:
        return False
    haystack = f"{planning.customerName} {planning.projectName} {planning.eventName or ''}".lower()
    return any(scope.lower() in haystack for scope in context.project_contexts)


def _ensure_planning_read_access(context: AccessContext) -> None:
    require_roles(context, "admin", "projektmanager", "mitarbeiter")


def _ensure_planning_write_access(context: AccessContext, planning: PlanningResponse) -> None:
    if _matches_planning_write_scope(context, planning):
        return
    raise HTTPException(status_code=403, detail="Keine Berechtigung für diese Planung.")


@router.get("", response_model=list[PlanningListItem])
def list_plannings(
    status: str | None = Query(default=None),
    from_date: date | None = Query(default=None, alias="fromDate"),
    to_date: date | None = Query(default=None, alias="toDate"),
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[PlanningListItem]:
    _ensure_planning_read_access(context)
    items = PlanningService.list_plannings(db, status=status, from_date=from_date, to_date=to_date)
    return items


@router.post("", response_model=PlanningResponse)
def create_planning(
    payload: PlanningUpsertPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningResponse:
    require_roles(context, "admin", "projektmanager")
    if context.role == "projektmanager" and context.user_id:
        payload.projectManagerUserId = context.user_id
    result = PlanningService.create_planning(db, payload)
    planning_event_service.record_event(
        db,
        result.id,
        planning_event_service.EVENT_PLANNING_CREATED,
        actor_id=context.user_id,
        payload={"status": result.status, "startDate": str(result.startDate), "endDate": str(result.endDate)},
    )
    logger.info("Planung gespeichert (neu, planning_id=%s, user_id=%s)", result.id, context.user_id)
    return result


@router.get("/{planning_id}", response_model=PlanningResponse)
def get_planning(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningResponse:
    _ensure_planning_read_access(context)
    item = PlanningService.get_planning(db, planning_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    return item


@router.put("/{planning_id}", response_model=PlanningResponse)
def update_planning(
    planning_id: str,
    payload: PlanningUpsertPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningResponse:
    require_roles(context, "admin", "projektmanager")
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_write_access(context, existing)
    # Beim Update wird projectManagerUserId NICHT mehr automatisch auf den
    # editierenden User umgeschrieben. Sonst würde ein zweiter Projektmanager,
    # der eine Planung pflegt, die ursprüngliche PM-Zuordnung still
    # überschreiben (Owner-Verhalten). Das Feld bleibt das, was der Client
    # explizit sendet — bei Bedarf kann es über das Formular gewechselt
    # werden, aber Speichern alleine löst keinen Eigentümerwechsel aus.
    result = PlanningService.update_planning(db, planning_id, payload)
    planning_event_service.record_events(
        db,
        planning_id,
        planning_event_service.diff_planning_update(existing, result),
        actor_id=context.user_id,
    )
    logger.info("Planung gespeichert (update, planning_id=%s, user_id=%s)", planning_id, context.user_id)
    return result


@router.post("/{planning_id}", response_model=PlanningResponse)
def update_planning_post(
    planning_id: str,
    payload: PlanningUpsertPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningResponse:
    require_roles(context, "admin", "projektmanager")
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_write_access(context, existing)
    # Wie bei PUT: kein implizites Überschreiben des projectManagerUserId.
    result = PlanningService.update_planning(db, planning_id, payload)
    planning_event_service.record_events(
        db,
        planning_id,
        planning_event_service.diff_planning_update(existing, result),
        actor_id=context.user_id,
    )
    return result


@router.post("/{planning_id}/duplicate", response_model=PlanningResponse)
def duplicate_planning(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningResponse:
    require_roles(context, "admin", "projektmanager")
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_write_access(context, existing)
    duplicated = PlanningService.duplicate_planning(db, planning_id)
    if duplicated is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    planning_event_service.record_event(
        db,
        duplicated.id,
        planning_event_service.EVENT_PLANNING_CREATED,
        actor_id=context.user_id,
        payload={
            "status": duplicated.status,
            "startDate": str(duplicated.startDate),
            "endDate": str(duplicated.endDate),
            "duplicatedFrom": planning_id,
        },
    )
    if context.role == "projektmanager" and context.user_id:
        update_payload = PlanningUpsertPayload(
            id=duplicated.id,
            customerName=duplicated.customerName,
            projectName=duplicated.projectName,
            eventName=duplicated.eventName,
            projectManagerUserId=context.user_id,
            calendarWeek=duplicated.calendarWeek,
            startDate=duplicated.startDate,
            endDate=duplicated.endDate,
            notes=duplicated.notes,
            status=duplicated.status,
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
                for day in duplicated.days
            ],
        )
        duplicated = PlanningService.update_planning(
            db,
            duplicated.id,
            update_payload,
        )
    return duplicated


@router.post("/{planning_id}/status", response_model=PlanningResponse)
def update_planning_status(
    planning_id: str,
    payload: PlanningStatusUpdatePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningResponse:
    require_roles(context, "admin", "projektmanager")
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_write_access(context, existing)
    updated = PlanningService.update_status(db, planning_id, payload.status)
    if updated is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    if str(existing.status) != str(updated.status):
        planning_event_service.record_event(
            db,
            planning_id,
            planning_event_service.EVENT_STATUS_CHANGED,
            actor_id=context.user_id,
            payload={"old": existing.status, "new": updated.status},
        )
    return updated


@router.get("/{planning_id}/availability", response_model=PlanningAvailabilityResponse)
def get_planning_availability(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningAvailabilityResponse:
    _ensure_planning_read_access(context)
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    response = PlanningService.get_availability(db, planning_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    return response


@router.get("/{planning_id}/assigned-assets", response_model=PlanningAssignedAssetsResponse)
def get_planning_assigned_assets(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningAssignedAssetsResponse:
    # Schritt C: rein lesende Anzeige der einer Planung zugeordneten Geräte
    # (geplant vs. ausgegeben). Verändert keine Availability-/Konfliktlogik.
    _ensure_planning_read_access(context)
    response = PlanningService.get_assigned_assets(db, planning_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    return response


@router.get("/{planning_id}/handover/status", response_model=HandoverStatusResponse)
def get_handover_status(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> HandoverStatusResponse:
    # Rein lesend: Erkennung + Zustände der automatischen Übergabe (geplant /
    # fällig / automatisch übergeben). Mutiert NICHTS.
    _ensure_planning_read_access(context)
    plan = handover_repository.compute_handover_plan(db, planning_id)
    if plan is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    return handover_repository.build_status_response(plan, today=date.today())


@router.post("/{planning_id}/handover/run", response_model=HandoverRunResponse)
def run_handover(
    planning_id: str,
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> HandoverRunResponse:
    # Fallback/Notfall: stößt die (sonst automatische) Übergabe für DIESE Planung
    # manuell an. ``force`` überspringt nur die Timing-Schranke, nie die
    # strukturelle Gültigkeit (B aktiv, B.start >= A_Rückgabetag).
    require_roles(context, "admin", "projektmanager")
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_write_access(context, existing)
    return handover_service.run_due_handovers(
        db, source_id=planning_id, force=force, actor_user_id=context.user_id
    )


@router.post("/{planning_id}/handover/undo", response_model=HandoverUndoResponse)
def undo_handover(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> HandoverUndoResponse:
    require_roles(context, "admin", "projektmanager")
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_write_access(context, existing)
    return handover_service.undo_handover(db, planning_id, actor_user_id=context.user_id)


@router.delete("/{planning_id}")
def delete_planning(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin", "projektmanager")
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_write_access(context, existing)
    deleted = PlanningService.delete_planning(db, planning_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    # Historie der gelöschten Planung mit abräumen (kein verwaistes Log).
    planning_event_service.delete_events(db, planning_id)
    return {"deleted": True}


@router.get("/{planning_id}/events", response_model=PlanningEventListResponse)
def list_planning_events(
    planning_id: str,
    limit: int = Query(default=300, ge=1, le=1000),
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningEventListResponse:
    _ensure_planning_read_access(context)
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    return PlanningEventListResponse(
        events=planning_event_service.list_events(db, planning_id, limit=limit)
    )


@router.post("/{planning_id}/events/note", response_model=PlanningEventItem)
def add_planning_note(
    planning_id: str,
    payload: PlanningNotePayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningEventItem:
    require_roles(context, "admin", "projektmanager")
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_write_access(context, existing)
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Notiz darf nicht leer sein.")
    planning_event_service.record_event(
        db,
        planning_id,
        planning_event_service.EVENT_NOTE_ADDED,
        actor_id=context.user_id,
        payload={"text": text[:1000]},
    )
    events = planning_event_service.list_events(db, planning_id, limit=1)
    if not events:
        raise HTTPException(status_code=500, detail="Notiz konnte nicht gespeichert werden.")
    return events[0]
