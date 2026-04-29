from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from ..repositories import planning_repository
from ..schemas.planning import (
    PlanningAvailabilityResponse,
    PlanningListItem,
    PlanningResponse,
    PlanningStatus,
    PlanningUpsertPayload,
)


class PlanningService:
    @staticmethod
    def list_plannings(
        db: Session,
        status: str | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> list[PlanningListItem]:
        return planning_repository.list_plannings(db, status=status, from_date=from_date, to_date=to_date)

    @staticmethod
    def get_planning(db: Session, planning_id: str) -> PlanningResponse | None:
        return planning_repository.get_planning(db, planning_id)

    @staticmethod
    def create_planning(db: Session, payload: PlanningUpsertPayload) -> PlanningResponse:
        return planning_repository.upsert_planning(db, payload)

    @staticmethod
    def update_planning(db: Session, planning_id: str, payload: PlanningUpsertPayload) -> PlanningResponse:
        return planning_repository.upsert_planning(db, payload, planning_id=planning_id)

    @staticmethod
    def duplicate_planning(db: Session, planning_id: str) -> PlanningResponse | None:
        return planning_repository.duplicate_planning(db, planning_id)

    @staticmethod
    def update_status(db: Session, planning_id: str, status: PlanningStatus) -> PlanningResponse | None:
        return planning_repository.update_status(db, planning_id, status)

    @staticmethod
    def get_availability(db: Session, planning_id: str) -> PlanningAvailabilityResponse | None:
        return planning_repository.get_planning_availability(db, planning_id)

    @staticmethod
    def delete_planning(db: Session, planning_id: str) -> bool:
        return planning_repository.delete_planning(db, planning_id)

