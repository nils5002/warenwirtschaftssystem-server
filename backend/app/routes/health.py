from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ..database.session import get_db

logger = logging.getLogger("cloud_web.health")

router = APIRouter(tags=["Health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Schlanker Liveness-Check ohne DB-Zugriff.

    Wird von Reverse-Proxies/Cloudflare etc. häufig getriggert und MUSS
    deshalb billig sein, damit eine kurzzeitige DB-Last den Healthcheck
    nicht auf 502/504 zieht.
    """
    return {"status": "ok"}


@router.get("/health/ready")
def health_ready(db: Session = Depends(get_db)) -> dict[str, str]:
    """Readiness-Check inklusive DB-Ping.

    Eigene Route, damit der einfache ``/health`` weiterhin ohne DB-Roundtrip
    antwortet (Liveness ≠ Readiness). Bei DB-Problemen liefert diese Route
    eine kontrollierte 503-Antwort über den globalen Exception-Handler.
    """
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logger.exception("Readiness check failed: DB unreachable")
        # Re-raise damit der zentrale Exception-Handler eine 503/500 mit
        # konsistenter Logzeile produziert.
        raise
    return {"status": "ready"}

