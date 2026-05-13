"""Zentrales Logging für die FastAPI-App.

Schreibt rotierende, persistente Logs nach ``app/data/logs/wms-app.log``
und exportiert Hilfsfunktionen, mit denen Routes/Services strukturierte
Ereignisse mit Request-Kontext loggen können.

Bewusst werden keine Authorization-Header, Passwörter, Tokens oder
Request-Bodies geloggt. Das Logformat ist:

    timestamp | level | request_id | user | role | method | path | status | message
"""
from __future__ import annotations

import logging
import logging.handlers
import threading
from contextvars import ContextVar
from pathlib import Path
from typing import Optional

LOG_FILE_NAME = "wms-app.log"
LOG_MAX_BYTES = 5 * 1024 * 1024
LOG_BACKUP_COUNT = 5

_request_id_var: ContextVar[Optional[str]] = ContextVar("wms_request_id", default=None)
_user_id_var: ContextVar[Optional[str]] = ContextVar("wms_user_id", default=None)
_user_role_var: ContextVar[Optional[str]] = ContextVar("wms_user_role", default=None)
_method_var: ContextVar[Optional[str]] = ContextVar("wms_method", default=None)
_path_var: ContextVar[Optional[str]] = ContextVar("wms_path", default=None)
_status_var: ContextVar[Optional[int]] = ContextVar("wms_status", default=None)

_setup_lock = threading.Lock()
_setup_done = False
_log_dir_cache: Optional[Path] = None


class _RequestContextFilter(logging.Filter):
    """Reichert jedes LogRecord um den aktuellen Request-Kontext an."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D401
        record.request_id = _request_id_var.get() or "-"
        record.user_id = _user_id_var.get() or "-"
        record.user_role = _user_role_var.get() or "-"
        record.http_method = _method_var.get() or "-"
        record.http_path = _path_var.get() or "-"
        status = _status_var.get()
        record.http_status = str(status) if status is not None else "-"
        return True


_LOG_FORMAT = (
    "%(asctime)s | %(levelname)s | %(request_id)s | %(user_id)s/%(user_role)s "
    "| %(http_method)s | %(http_path)s | %(http_status)s | %(name)s | %(message)s"
)


def _resolve_log_dir() -> Path:
    backend_root = Path(__file__).resolve().parents[1]
    return backend_root / "app" / "data" / "logs"


def get_log_dir() -> Path:
    """Verzeichnis, in dem die App-Logs liegen.

    Wird beim ersten Aufruf angelegt. Dieser Pfad ist die einzige Quelle
    für den Download-Endpoint — Host-/Docker-/Systemlogs werden NICHT
    angefasst.
    """
    global _log_dir_cache
    if _log_dir_cache is not None:
        return _log_dir_cache
    target = _resolve_log_dir()
    target.mkdir(parents=True, exist_ok=True)
    _log_dir_cache = target
    return target


def get_log_file_path() -> Path:
    return get_log_dir() / LOG_FILE_NAME


def setup_logging() -> None:
    """Idempotent: konfiguriert RootLogger + RotatingFileHandler.

    Mehrfacher Aufruf (z. B. durch uvicorn-Reload) führt nicht zu
    doppelten Handlern.
    """
    global _setup_done
    with _setup_lock:
        if _setup_done:
            return

        log_path = get_log_file_path()
        root = logging.getLogger()
        # Nicht überschreiben, falls der Operator das Level via uvicorn/env
        # bereits expliziter gesetzt hat.
        if root.level == logging.NOTSET or root.level > logging.INFO:
            root.setLevel(logging.INFO)

        context_filter = _RequestContextFilter()
        formatter = logging.Formatter(_LOG_FORMAT)

        file_handler = logging.handlers.RotatingFileHandler(
            log_path,
            maxBytes=LOG_MAX_BYTES,
            backupCount=LOG_BACKUP_COUNT,
            encoding="utf-8",
        )
        file_handler.setLevel(logging.INFO)
        file_handler.setFormatter(formatter)
        file_handler.addFilter(context_filter)

        # Doppelte Handler vermeiden (z. B. bei Reload).
        if not any(
            isinstance(h, logging.handlers.RotatingFileHandler)
            and getattr(h, "baseFilename", "") == str(log_path)
            for h in root.handlers
        ):
            root.addHandler(file_handler)

        # Konsolen-Handler bekommt denselben Filter, damit die Vars
        # auch dort verfügbar sind und das Format konsistent bleibt.
        for handler in root.handlers:
            if handler is file_handler:
                continue
            handler.addFilter(context_filter)

        # uvicorn-Logger an den Root weiterleiten, damit Access-/Error-Logs
        # in derselben Datei landen. Eigene Handler aus uvicorn nicht
        # entfernen — Operator sieht dort weiterhin den Standard-Output.
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            logger = logging.getLogger(name)
            logger.propagate = True

        _setup_done = True


def bind_request_context(
    *,
    request_id: Optional[str] = None,
    user_id: Optional[str] = None,
    role: Optional[str] = None,
    method: Optional[str] = None,
    path: Optional[str] = None,
) -> None:
    if request_id is not None:
        _request_id_var.set(request_id)
    if user_id is not None:
        _user_id_var.set(user_id)
    if role is not None:
        _user_role_var.set(role)
    if method is not None:
        _method_var.set(method)
    if path is not None:
        _path_var.set(path)


def set_response_status(status: int) -> None:
    _status_var.set(status)


def clear_request_context() -> None:
    _request_id_var.set(None)
    _user_id_var.set(None)
    _user_role_var.set(None)
    _method_var.set(None)
    _path_var.set(None)
    _status_var.set(None)


def current_request_id() -> Optional[str]:
    return _request_id_var.get()
