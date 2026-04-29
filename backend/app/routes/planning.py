from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_project_scope, require_roles
from ..schemas.planning import (
    PlanningAvailabilityResponse,
    PlanningListItem,
    PlanningResponse,
    PlanningStatusUpdatePayload,
    PlanningUpsertPayload,
)
from ..services.planning_service import PlanningService

router = APIRouter(prefix="/api/wms/planning", tags=["Planning"])


def _matches_project_scope(context: AccessContext, planning: PlanningListItem | PlanningResponse) -> bool:
    if context.role == "admin":
        return True
    if context.role == "projektmanager":
        if context.user_id and planning.projectManagerUserId and planning.projectManagerUserId == context.user_id:
            return True
    if not context.project_contexts:
        return False
    haystack = f"{planning.customerName} {planning.projectName} {planning.eventName or ''}".lower()
    return any(scope.lower() in haystack for scope in context.project_contexts)


def _ensure_planning_access(context: AccessContext, planning: PlanningResponse) -> None:
    if _matches_project_scope(context, planning):
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
    items = PlanningService.list_plannings(db, status=status, from_date=from_date, to_date=to_date)
    if context.role == "admin":
        return items
    require_project_scope(context)
    return [item for item in items if _matches_project_scope(context, item)]


@router.post("", response_model=PlanningResponse)
def create_planning(
    payload: PlanningUpsertPayload,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningResponse:
    require_roles(context, "admin", "projektmanager")
    if context.role == "projektmanager" and context.user_id:
        payload.projectManagerUserId = context.user_id
    return PlanningService.create_planning(db, payload)


@router.get("/{planning_id}", response_model=PlanningResponse)
def get_planning(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningResponse:
    item = PlanningService.get_planning(db, planning_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_access(context, item)
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
    _ensure_planning_access(context, existing)
    if context.role == "projektmanager" and context.user_id:
        payload.projectManagerUserId = context.user_id
    return PlanningService.update_planning(db, planning_id, payload)


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
    _ensure_planning_access(context, existing)
    if context.role == "projektmanager" and context.user_id:
        payload.projectManagerUserId = context.user_id
    return PlanningService.update_planning(db, planning_id, payload)


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
    _ensure_planning_access(context, existing)
    duplicated = PlanningService.duplicate_planning(db, planning_id)
    if duplicated is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
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
                        {"categoryKey": item.categoryKey, "qty": item.qty, "notes": item.notes}
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
    _ensure_planning_access(context, existing)
    updated = PlanningService.update_status(db, planning_id, payload.status)
    if updated is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    return updated


@router.get("/{planning_id}/availability", response_model=PlanningAvailabilityResponse)
def get_planning_availability(
    planning_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> PlanningAvailabilityResponse:
    existing = PlanningService.get_planning(db, planning_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    _ensure_planning_access(context, existing)
    response = PlanningService.get_availability(db, planning_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    return response


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
    _ensure_planning_access(context, existing)
    deleted = PlanningService.delete_planning(db, planning_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Planung nicht gefunden")
    return {"deleted": True}
