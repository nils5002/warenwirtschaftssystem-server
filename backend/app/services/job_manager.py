from __future__ import annotations

import threading
from typing import Dict, Optional

from ..schemas.job import SortConfig
from .sorter_job import SorterJob


class JobManager:
    """Verwaltet SorterJobs und stellt thread-sicheren Zugriff bereit."""

    def __init__(self) -> None:
        self._jobs: Dict[str, SorterJob] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    def create_job(self, config: SortConfig) -> SorterJob:
        with self._lock:
            for job in self._jobs.values():
                if job.status in {"pending", "running", "awaiting_2fa"}:
                    raise RuntimeError("Es luft bereits ein Sortierlauf. Bitte zuerst stoppen oder warten.")
            job = SorterJob(config)
            self._jobs[job.id] = job
        job.start()
        return job

    # ------------------------------------------------------------------
    def get_job(self, job_id: str) -> Optional[SorterJob]:
        with self._lock:
            return self._jobs.get(job_id)

    # ------------------------------------------------------------------
    def require_job(self, job_id: str) -> SorterJob:
        job = self.get_job(job_id)
        if not job:
            raise KeyError(f"Kein Job mit ID {job_id} gefunden")
        return job

    # ------------------------------------------------------------------
    def stop_job(self, job_id: str) -> SorterJob:
        job = self.require_job(job_id)
        job.stop()
        return job

    # ------------------------------------------------------------------
    def provide_two_factor(self, job_id: str, code: str) -> SorterJob:
        job = self.require_job(job_id)
        job.provide_two_factor(code)
        return job
