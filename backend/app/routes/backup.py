from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_permission
from ..schemas.backup import BackupClearDataResponse, BackupImportResponse, WarehouseBackupPayload
from ..services import backup_service
from ..services import security_event_service as sec

router = APIRouter(prefix="/api/wms/backup", tags=["WMS Backup"])
logger = logging.getLogger("cloud_web.backup")


@router.get("/export", response_model=WarehouseBackupPayload)
def export_backup(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> JSONResponse:
    require_permission(context, db, "backup.manage")
    payload = backup_service.export_backup(db)
    timestamp = datetime.now().strftime("%Y-%m-%d-%H-%M")
    filename = f"warehouse-backup-{timestamp}.json"
    content = payload.model_dump(mode="json")
    body = json.dumps(content, ensure_ascii=False, indent=2)
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    logger.info("Backup-Export erzeugt (user_id=%s)", context.user_id)
    # Audit: das Backup enthält u. a. Passwort-Hashes aller Benutzer — jeder
    # Export soll nachvollziehbar sein (Security-Paket „supman").
    sec.record_event(
        db, sec.BACKUP_EXPORTED, request=request, success=True,
        actor_id=context.user_id, severity="warning",
    )
    return JSONResponse(content=json.loads(body), headers=headers)


@router.post("/import", response_model=BackupImportResponse)
async def import_backup(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> BackupImportResponse:
    require_permission(context, db, "backup.manage")
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

    result = backup_service.import_backup(db, payload)
    logger.info(
        "Backup-Import abgeschlossen (user_id=%s, assets=%s, users=%s, plannings=%s)",
        context.user_id,
        result.imported.get("assets"),
        result.imported.get("users"),
        result.imported.get("plannings"),
    )
    # Audit: Import ist destruktiv (Wipe-and-Replace inkl. Benutzertabelle) —
    # kritisches Ereignis, immer nachvollziehbar halten.
    sec.record_event(
        db, sec.BACKUP_IMPORTED, request=request, success=True,
        actor_id=context.user_id, severity="critical",
        meta={"fileName": file.filename, "users": result.imported.get("users")},
    )
    return result


@router.post("/reset-for-import", response_model=BackupClearDataResponse)
def reset_for_import(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> BackupClearDataResponse:
    require_permission(context, db, "backup.manage")
    result = backup_service.clear_data_for_import(db, keep_user_id=context.user_id)
    logger.warning("Systemdaten bereinigt (user_id=%s)", context.user_id)
    return result
