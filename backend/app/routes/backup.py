from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..schemas.backup import BackupClearDataResponse, BackupImportResponse, WarehouseBackupPayload
from ..services import backup_service

router = APIRouter(prefix="/api/wms/backup", tags=["WMS Backup"])


@router.get("/export", response_model=WarehouseBackupPayload)
def export_backup(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> JSONResponse:
    require_roles(context, "admin")
    payload = backup_service.export_backup(db)
    timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M")
    filename = f"warehouse-backup-{timestamp}.json"
    content = payload.model_dump(mode="json")
    body = json.dumps(content, ensure_ascii=False, indent=2)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return JSONResponse(content=json.loads(body), headers=headers)


@router.post("/import", response_model=BackupImportResponse)
async def import_backup(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> BackupImportResponse:
    require_roles(context, "admin")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Backup-Datei fehlt.")
    if not file.filename.lower().endswith(".json"):
        raise HTTPException(status_code=400, detail="Nur JSON-Backups sind erlaubt.")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Backup-Datei ist leer.")

    try:
        payload_data = json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Ungültige JSON-Datei.") from exc

    try:
        payload = WarehouseBackupPayload.model_validate(payload_data)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Backup-Datei hat ein ungültiges Format.") from exc

    return backup_service.import_backup(db, payload)


@router.post("/reset-for-import", response_model=BackupClearDataResponse)
def reset_for_import(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> BackupClearDataResponse:
    require_roles(context, "admin")
    return backup_service.clear_data_for_import(db, keep_user_id=context.user_id)
