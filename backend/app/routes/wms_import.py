from __future__ import annotations

from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..schemas.hardware_import import (
    HardwareImportConfirmRequest,
    HardwareImportConfirmResponse,
    HardwareImportPreviewResponse,
)
from ..services.upload_import_service import UploadImportService

router = APIRouter(prefix="/api/wms/import", tags=["WMS Import"])


@router.post("/preview", response_model=HardwareImportPreviewResponse)
async def preview_import_upload(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> HardwareImportPreviewResponse:
    require_roles(context, "admin")
    try:
        form = await request.form()
    except RuntimeError as exc:
        if "python-multipart" in str(exc):
            raise HTTPException(
                status_code=503,
                detail='Upload-Feature nicht verfügbar: python-multipart fehlt auf dem Server.',
            ) from exc
        raise
    file = form.get("file")
    if file is None:
        raise HTTPException(status_code=400, detail="Datei fehlt.")
    if not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="Ungültige Upload-Daten.")
    filename = getattr(file, "filename", None)
    if not filename:
        raise HTTPException(status_code=400, detail="Dateiname fehlt.")
    try:
        file_bytes = await file.read()
        return UploadImportService.preview_upload(db, file_name=filename, file_bytes=file_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/confirm", response_model=HardwareImportConfirmResponse)
def confirm_import_upload(
    payload: HardwareImportConfirmRequest,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> HardwareImportConfirmResponse:
    require_roles(context, "admin")
    try:
        return UploadImportService.confirm_preview(db, payload.preview_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/template")
def download_import_template(
    context: AccessContext = Depends(get_access_context),
) -> StreamingResponse:
    require_roles(context, "admin")
    content = UploadImportService.build_template_workbook()
    stream = BytesIO(content)
    headers = {"Content-Disposition": 'attachment; filename="hardware_import_vorlage.xlsx"'}
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )
