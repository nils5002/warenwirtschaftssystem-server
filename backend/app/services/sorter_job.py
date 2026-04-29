from __future__ import annotations

import importlib
import os
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from ..schemas.job import JobStatus, SortConfig


class SorterJob:
    """Kapselt einen Sortierlauf inklusive Log-Streaming und 2FA-Steuerung."""

    MAX_LOG_LINES = 1500
    TWO_FACTOR_TIMEOUT = 300  # Sekunden

    def __init__(self, config: SortConfig):
        self.id = str(uuid.uuid4())
        self.config = config
        self.status: str = "pending"
        self.logs: list[str] = []
        self.processed_files = 0
        self.seen_items = 0
        self.error: Optional[str] = None
        self.awaiting_two_factor = False
        self.created_at = datetime.utcnow()
        self.updated_at = self.created_at

        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._twofa_event = threading.Event()
        self._twofa_code: Optional[str] = None
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------
    # Oeffentliche Aktionen
    # ------------------------------------------------------------------
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()

    def provide_two_factor(self, code: str) -> None:
        with self._lock:
            self._twofa_code = (code or "").strip()
            self.awaiting_two_factor = False
            self.status = "running"
            self.updated_at = datetime.utcnow()
        self._twofa_event.set()
        self.log("2FA-Code wurde uebermittelt, fahre fort...")

    def snapshot(self) -> JobStatus:
        with self._lock:
            logs = list(self.logs)
            status = self.status
            error = self.error
            processed = self.processed_files
            seen = self.seen_items
            awaiting = self.awaiting_two_factor
            created = self.created_at
            updated = self.updated_at
        return JobStatus(
            job_id=self.id,
            status=status,
            logs=logs,
            processed_files=processed,
            seen_items=seen,
            awaiting_two_factor=awaiting,
            created_at=created,
            updated_at=updated,
            error=error,
        )

    # ------------------------------------------------------------------
    # Interne Helfer
    # ------------------------------------------------------------------
    def log(self, message: str) -> None:
        timestamp = datetime.utcnow().strftime("%H:%M:%S")
        line = f"[{timestamp}] {message}"
        with self._lock:
            self.logs.append(line)
            if len(self.logs) > self.MAX_LOG_LINES:
                overflow = len(self.logs) - self.MAX_LOG_LINES
                del self.logs[0:overflow]
            self.updated_at = datetime.utcnow()

    def _set_status(self, value: str) -> None:
        with self._lock:
            self.status = value
            self.updated_at = datetime.utcnow()

    def _await_two_factor(self, prompt: Optional[str] = None) -> str:
        message = prompt or "Zwei-Faktor-Code erforderlich."
        self.log(message)
        with self._lock:
            self.awaiting_two_factor = True
            self.status = "awaiting_2fa"
            self.updated_at = datetime.utcnow()
        self._twofa_event.clear()
        if not self._twofa_event.wait(timeout=self.TWO_FACTOR_TIMEOUT):
            raise RuntimeError("Kein 2FA-Code innerhalb des Zeitlimits erhalten")
        with self._lock:
            code = self._twofa_code or ""
            self._twofa_code = None
            self.awaiting_two_factor = False
            self.status = "running"
            self.updated_at = datetime.utcnow()
        return code

    def _run(self) -> None:
        self._set_status("running")
        self.log("Job gestartet")
        try:
            sorter = importlib.import_module("cloud.cloud")
        except ImportError as exc:
            self.error = f"cloud.cloud konnte nicht importiert werden: {exc}".strip()
            self._set_status("failed")
            self.log(self.error)
            return

        config = self.config
        api_key = (
            config.llm_api_key.get_secret_value()
            if config.llm_api_key is not None
            else None
        )
        apple_pw = config.apple_password.get_secret_value()

        # Konfiguration ins cloud-Modul schreiben
        try:
            if hasattr(sorter, "configure_llm"):
                sorter.configure_llm(
                    api_base=config.llm_api_base or None,
                    api_key=api_key or None,
                    request_timeout=config.request_timeout,
                )
            else:
                if config.llm_api_base:
                    setattr(sorter, "LLM_API_BASE", config.llm_api_base)
                if api_key:
                    setattr(sorter, "LLM_API_KEY", api_key)
                sorter.LLM_REQUEST_TIMEOUT = config.request_timeout
            sorter.DRY_RUN = config.dry_run
            sorter.TARGET_ROOT = config.target_root or "AutoSorted"
            sorter.MAX_PDF_PAGES = config.max_pdf_pages
            sorter.MAX_BYTES_TO_READ = config.max_bytes_to_read
            sorter.LLM_MODEL = config.model
            if hasattr(sorter, "set_allowed_extensions"):
                sorter.set_allowed_extensions(config.file_types)
            else:
                setattr(sorter, "ALLOWED_EXTENSIONS", set(config.file_types))
            if hasattr(sorter, "set_ocr_enabled"):
                sorter.set_ocr_enabled(config.use_ocr)
            else:
                setattr(sorter, "ENABLE_OCR", config.use_ocr)
            if hasattr(sorter, "set_deep_analysis"):
                sorter.set_deep_analysis(config.deep_analysis)
            else:
                setattr(sorter, "DEEP_ANALYSIS", config.deep_analysis)
            if config.ocr_engine:
                try:
                    if hasattr(sorter, "set_ocr_engine"):
                        sorter.set_ocr_engine(config.ocr_engine)
                    else:
                        setattr(sorter, "SELECTED_OCR_ENGINE", config.ocr_engine)
                except Exception as exc:
                    self.log(
                        f"Gewaehlte OCR-Engine '{config.ocr_engine}' konnte nicht aktiviert werden: {exc}"
                    )
        except Exception as exc:
            self.error = f"Fehler bei der Konfiguration: {exc}"
            self._set_status("failed")
            self.log(self.error)
            return

        original_input = getattr(sorter, "input", input)
        sorter.input = self._await_two_factor

        try:
            self.log("Verbinde mit iCloud...")
            api = sorter.connect_icloud(config.apple_id, apple_pw)
            self.log("iCloud-Verbindung steht.")

            # Requests-Timeout setzen, damit der Prozess nicht haengen bleibt
            try:
                original_request = api.session.request

                def _request(method, url, **kwargs):
                    if kwargs.get("timeout") is None:
                        kwargs["timeout"] = config.request_timeout
                    return original_request(method, url, **kwargs)

                api.session.request = _request
            except Exception:
                pass

            # Kleiner Health-Check
            try:
                root = api.drive.root
                children = root.get_children()
                self.log(f"Root enthaelt {len(children)} Eintraege")
            except Exception as exc:
                self.log(f"Hinweis: Drive-Root konnte nicht gelesen werden ({exc})")

            allowed_types = set(config.file_types)
            provider_name = self._describe_llm_provider(config.llm_api_base)

            for item in sorter.list_drive_files(api):
                if self._stop_event.is_set():
                    self.log("Stop angefordert - breche ab.")
                    self._set_status("stopped")
                    return

                self.seen_items += 1
                name = getattr(item, "name", "unbekannt")
                self.log(f"Bearbeite {name}")
                ext = Path(name).suffix.lower()
                if allowed_types and (not ext or ext not in allowed_types):
                    self.log(
                        f"[SKIP] {name} - Dateityp {ext or 'ohne Endung'} nicht erlaubt"
                    )
                    continue

                try:
                    with tempfile.TemporaryDirectory() as tmpd:
                        local_path = os.path.join(tmpd, name)
                        try:
                            sorter.download_file_item(item, local_path)
                        except Exception as exc:
                            self.log(f"Download fehlgeschlagen: {name} ({exc})")
                            continue

                        snippet = sorter.extract_text_from_file(local_path) or name
                        self.log(
                            f"[{provider_name}] Anfrage an Modell '{config.model}' fuer {name}"
                        )
                        category = sorter.classify_with_llm(name, snippet)
                        category = category if isinstance(category, str) else str(category)
                        safe_category = self._sanitize_category(category)
                        target_path = f"{sorter.TARGET_ROOT}/{safe_category}"
                        self.log(
                            f"[{provider_name}] Antwort: {category or 'Keine Kategorie'}"
                        )
                        if sorter.DRY_RUN:
                            self.log(f"[DRY] {name} ? {target_path}")
                        else:
                            try:
                                ok = sorter.ensure_folder_and_move(api, item, target_path)
                                self.log(
                                    f"Verschoben: {name} ? {target_path} (ok={ok})"
                                )
                            except Exception as exc:
                                self.log(
                                    f"Fehler beim Verschieben nach {target_path}: {exc}"
                                )
                        self.processed_files += 1
                except Exception as exc:
                    self.log(f"Fehler bei {name}: {exc}")

            self._set_status("completed")
            self.log(
                f"Fertig. Verarbeitete Dateien: {self.processed_files} (gesichtet: {self.seen_items})"
            )
        except Exception as exc:
            self.error = str(exc)
            self._set_status("failed")
            self.log(f"Job abgebrochen: {exc}")
        finally:
            sorter.input = original_input

    @staticmethod
    def _sanitize_category(value: str) -> str:
        clean = "".join(c for c in (value or "") if c.isalnum() or c in " _-").strip()
        clean = " ".join(clean.split())
        return clean or "Sonstiges"

    @staticmethod
    def _describe_llm_provider(base_url: Optional[str]) -> str:
        if not base_url:
            return "LLM"
        try:
            url = base_url if "://" in base_url else f"http://{base_url}"
            parts = urlsplit(url)
            host = (parts.hostname or "").lower()
            port = parts.port or 0
            if host in {"localhost", "127.0.0.1"} and (port == 11434 or "ollama" in url.lower()):
                return "Ollama"
            return parts.hostname or base_url
        except Exception:
            return base_url

