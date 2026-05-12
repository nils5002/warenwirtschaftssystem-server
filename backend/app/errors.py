from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError

logger = logging.getLogger("cloud_web.errors")


def _request_context(request: Request) -> dict[str, str]:
    """Stabiler, log-tauglicher Kontext zu einer eingehenden Anfrage.

    Bewusst sparsam: nur Method, Pfad und (gekürzter) Client. Header, Body
    und Query-String werden NICHT geloggt, weil dort Tokens, Passworter oder
    Personendaten enthalten sein können.
    """
    client_host = request.client.host if request.client else "?"
    return {
        "method": request.method,
        "path": request.url.path,
        "client": client_host,
    }


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(IntegrityError)
    async def handle_integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
        context = _request_context(request)
        logger.warning(
            "DB integrity error at %s %s (client=%s): %s",
            context["method"],
            context["path"],
            context["client"],
            exc.orig if exc.orig else exc,
        )
        return JSONResponse(
            status_code=409,
            content={"detail": f"Database integrity error: {str(exc.orig) if exc.orig else str(exc)}"},
        )

    @app.exception_handler(OperationalError)
    async def handle_operational_error(request: Request, exc: OperationalError) -> JSONResponse:
        """SQLite-Locks, kurzzeitige DB-Aussetzer etc.

        Der Client erhält eine kontrollierte 503-Antwort statt eines stillen
        500/502. Das hilft, im Frontend einen sinnvollen Hinweis anzuzeigen,
        ohne dass die App in einen kaputten Zustand fällt.
        """
        context = _request_context(request)
        logger.error(
            "DB operational error at %s %s (client=%s): %s",
            context["method"],
            context["path"],
            context["client"],
            exc.orig if exc.orig else exc,
            exc_info=exc,
        )
        return JSONResponse(
            status_code=503,
            content={"detail": "Datenbank kurzzeitig nicht erreichbar. Bitte erneut versuchen."},
        )

    @app.exception_handler(SQLAlchemyError)
    async def handle_sqlalchemy_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        context = _request_context(request)
        logger.exception(
            "SQLAlchemy error at %s %s (client=%s): %s",
            context["method"],
            context["path"],
            context["client"],
            exc.__class__.__name__,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Interner Datenbankfehler. Bitte später erneut versuchen."},
        )

    @app.exception_handler(Exception)
    async def handle_unexpected_exception(request: Request, exc: Exception) -> JSONResponse:
        context = _request_context(request)
        # exc_info=exc liefert den Stacktrace ins Server-Log; das ist die
        # eigentliche Diagnose-Quelle. Der Client bekommt absichtlich nur
        # eine generische 500 zurück — keine Stacktraces, keine internen
        # Details, kein Datenleak.
        logger.exception(
            "Unhandled server error at %s %s (client=%s): %s",
            context["method"],
            context["path"],
            context["client"],
            exc.__class__.__name__,
            exc_info=exc,
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

