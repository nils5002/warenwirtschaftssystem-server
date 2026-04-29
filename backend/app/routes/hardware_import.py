from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..config.settings import get_settings
from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..schemas.hardware_import import HardwareImportRunResponse
from ..services.excel_import_service import ExcelImportService

router = APIRouter(prefix="/api/import", tags=["Import"])


@router.post("/hardware", response_model=HardwareImportRunResponse)
def run_hardware_import(
    dry_run: bool = Query(default=False, description="Validate and simulate import without DB writes."),
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> HardwareImportRunResponse:
    require_roles(context, "admin")
    settings = get_settings()
    base_dir = Path(__file__).resolve().parents[2]
    import_path = settings.resolve_hardware_import_path(base_dir)
    try:
        return ExcelImportService.run_hardware_import(db, import_path, dry_run=dry_run)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/hardware/{run_id}", response_model=HardwareImportRunResponse)
def get_hardware_import_status(
    run_id: int,
    error_limit: int = Query(default=200, ge=1, le=1000),
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> HardwareImportRunResponse:
    require_roles(context, "admin")
    status = ExcelImportService.get_run_status(db, run_id, error_limit=error_limit)
    if status is None:
        raise HTTPException(status_code=404, detail=f"Import run {run_id} not found")
    return status
