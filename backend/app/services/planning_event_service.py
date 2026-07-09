"""Fachliches Audit-Log je Planung (Historie-Tab der Planungs-Detailseite).

Regeln (identisch zu ``security_event_service``):
- Logging ist best-effort und darf den Fachfluss NIE brechen.
- Event-Typen sind snake_case-Konstanten (Katalog unten).
- Payload wird als JSON-String gespeichert und enthält nur unkritische
  Fachdaten (alt/neu-Werte, Kategorie, Inventarnummer, Notiztext).

Schreib-Varianten:
- ``add_event(..., commit=False)`` reiht das Event in die laufende Transaktion
  ein (z. B. innerhalb von ``wms_repository.upsert_asset`` vor dessen Commit).
- ``record_event(...)``/``record_events(...)`` committen selbst — für Routen,
  bei denen der Fach-Commit bereits im Repository passiert ist.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..database.models import PlanningEventRecord, UserRecord
from ..schemas.planning import PlanningEventItem, PlanningResponse

logger = logging.getLogger("cloud_web.planning_events")

# --- Event-Typ-Katalog ---------------------------------------------------------
EVENT_PLANNING_CREATED = "planning_created"
EVENT_STATUS_CHANGED = "status_changed"
EVENT_TIMEFRAME_CHANGED = "timeframe_changed"
EVENT_POSITION_ADDED = "position_added"
EVENT_POSITION_REMOVED = "position_removed"
EVENT_QUANTITY_CHANGED = "quantity_changed"
EVENT_NOTE_ADDED = "note_added"
EVENT_ISSUE_RECORDED = "issue_recorded"
EVENT_RETURN_RECORDED = "return_recorded"


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    return trimmed[:limit]


def add_event(
    db: Session,
    planning_id: str,
    event_type: str,
    *,
    actor_id: str | None = None,
    payload: dict | None = None,
    commit: bool = False,
) -> None:
    """Schreibt ein Planungs-Event (best-effort, bricht den Aufrufer nie)."""
    try:
        payload_json = None
        if payload:
            try:
                payload_json = json.dumps(payload, ensure_ascii=False, default=str)[:2000]
            except (TypeError, ValueError):
                payload_json = None
        db.add(
            PlanningEventRecord(
                planning_external_id=_clip(planning_id, 64) or "",
                event_type=_clip(event_type, 64) or "unknown",
                actor_external_id=_clip(actor_id, 64),
                payload_json=payload_json,
            )
        )
        if commit:
            db.commit()
    except Exception:  # noqa: BLE001 — Logging darf den Fachfluss nie brechen.
        logger.exception("Planungs-Event konnte nicht gespeichert werden (type=%s)", event_type)
        if commit:
            try:
                db.rollback()
            except Exception:  # noqa: BLE001
                pass


def record_event(
    db: Session,
    planning_id: str,
    event_type: str,
    *,
    actor_id: str | None = None,
    payload: dict | None = None,
) -> None:
    add_event(db, planning_id, event_type, actor_id=actor_id, payload=payload, commit=True)


def record_events(
    db: Session,
    planning_id: str,
    events: list[tuple[str, dict | None]],
    *,
    actor_id: str | None = None,
) -> None:
    """Mehrere Events aus einem Vorgang (z. B. Planungs-Update) in einem Commit."""
    if not events:
        return
    try:
        for event_type, payload in events:
            add_event(db, planning_id, event_type, actor_id=actor_id, payload=payload, commit=False)
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Planungs-Events konnten nicht gespeichert werden (planning=%s)", planning_id)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass


# --- Diff eines Planungs-Updates -> Events -------------------------------------

def _qty_by_category(planning: PlanningResponse) -> dict[str, int]:
    totals: dict[str, int] = {}
    for day in planning.days:
        for item in day.items:
            key = (item.categoryKey or "").strip()
            if not key:
                continue
            totals[key] = totals.get(key, 0) + max(0, int(item.qty or 0))
    return totals


def diff_planning_update(
    old: PlanningResponse, new: PlanningResponse
) -> list[tuple[str, dict | None]]:
    """Vergleicht den alten und neuen Stand eines Updates und liefert die
    fachlichen Ereignisse: Zeitraum geändert, Position hinzugefügt/entfernt,
    Menge geändert. (Status läuft über die eigene Status-Route.)"""
    events: list[tuple[str, dict | None]] = []

    old_buffer = int(old.returnBufferDays or 0)
    new_buffer = int(new.returnBufferDays or 0)
    if (
        str(old.startDate) != str(new.startDate)
        or str(old.endDate) != str(new.endDate)
        or old_buffer != new_buffer
    ):
        events.append(
            (
                EVENT_TIMEFRAME_CHANGED,
                {
                    "oldStart": str(old.startDate),
                    "newStart": str(new.startDate),
                    "oldEnd": str(old.endDate),
                    "newEnd": str(new.endDate),
                    "oldBuffer": old_buffer,
                    "newBuffer": new_buffer,
                },
            )
        )

    old_qty = _qty_by_category(old)
    new_qty = _qty_by_category(new)
    for category in sorted(set(old_qty) | set(new_qty), key=str.lower):
        before = old_qty.get(category)
        after = new_qty.get(category)
        if before is None and after is not None:
            events.append((EVENT_POSITION_ADDED, {"categoryKey": category, "qty": after}))
        elif before is not None and after is None:
            events.append((EVENT_POSITION_REMOVED, {"categoryKey": category, "qty": before}))
        elif before != after:
            events.append(
                (EVENT_QUANTITY_CHANGED, {"categoryKey": category, "oldQty": before, "newQty": after})
            )
    return events


# --- Lesen ----------------------------------------------------------------------

def _created_at_iso(record: PlanningEventRecord) -> str:
    # created_at ist naive UTC (SQLite CURRENT_TIMESTAMP) — als ISO mit "Z"
    # ausliefern, damit der Client korrekt in Lokalzeit formatieren kann.
    if record.created_at is None:
        return ""
    return record.created_at.isoformat(timespec="seconds") + "Z"


def list_events(db: Session, planning_id: str, *, limit: int = 300) -> list[PlanningEventItem]:
    limit = max(1, min(int(limit or 300), 1000))
    records = db.scalars(
        select(PlanningEventRecord)
        .where(PlanningEventRecord.planning_external_id == planning_id)
        .order_by(PlanningEventRecord.created_at.desc(), PlanningEventRecord.id.desc())
        .limit(limit)
    ).all()

    # Actor-Namen zum Lesezeitpunkt auflösen (eine Query für alle Events).
    actor_ids = {r.actor_external_id for r in records if r.actor_external_id}
    names: dict[str, str] = {}
    if actor_ids:
        users = db.scalars(select(UserRecord).where(UserRecord.external_id.in_(actor_ids))).all()
        names = {u.external_id: (u.name or "").strip() or u.email for u in users}

    items: list[PlanningEventItem] = []
    for record in records:
        payload = None
        if record.payload_json:
            try:
                payload = json.loads(record.payload_json)
            except (TypeError, ValueError):
                payload = None
        items.append(
            PlanningEventItem(
                id=record.id,
                eventType=record.event_type,
                actorId=record.actor_external_id,
                actorName=names.get(record.actor_external_id or ""),
                createdAt=_created_at_iso(record),
                payload=payload,
            )
        )
    return items


def delete_events(db: Session, planning_id: str) -> None:
    """Räumt die Historie einer gelöschten Planung mit ab (best-effort)."""
    try:
        db.execute(
            delete(PlanningEventRecord).where(
                PlanningEventRecord.planning_external_id == planning_id
            )
        )
        db.commit()
    except Exception:  # noqa: BLE001
        logger.exception("Planungs-Events konnten nicht gelöscht werden (planning=%s)", planning_id)
        try:
            db.rollback()
        except Exception:  # noqa: BLE001
            pass
