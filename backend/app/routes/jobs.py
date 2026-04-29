from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..schemas.job import JobStartResponse, JobStatus, SortConfig, TwoFactorPayload
from ..services.job_manager import JobManager
from .dependencies import get_job_manager

router = APIRouter(prefix="/api/jobs", tags=["Jobs"])


@router.post("", response_model=JobStartResponse)
def start_job(
    config: SortConfig,
    job_manager: JobManager = Depends(get_job_manager),
) -> JobStartResponse:
    try:
        job = job_manager.create_job(config)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return JobStartResponse(job_id=job.id, status=job.status)


@router.get("/{job_id}", response_model=JobStatus)
def get_job_status(
    job_id: str,
    job_manager: JobManager = Depends(get_job_manager),
) -> JobStatus:
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job nicht gefunden")
    return job.snapshot()


@router.post("/{job_id}/stop", response_model=JobStatus)
def stop_job(
    job_id: str,
    job_manager: JobManager = Depends(get_job_manager),
) -> JobStatus:
    try:
        job = job_manager.stop_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return job.snapshot()


@router.post("/{job_id}/2fa", response_model=JobStatus)
def provide_two_factor(
    job_id: str,
    payload: TwoFactorPayload,
    job_manager: JobManager = Depends(get_job_manager),
) -> JobStatus:
    if not payload.code:
        raise HTTPException(status_code=400, detail="2FA-Code fehlt")
    try:
        job = job_manager.provide_two_factor(job_id, payload.code)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return job.snapshot()

