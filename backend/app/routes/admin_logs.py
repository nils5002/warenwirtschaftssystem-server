"""Admin-only Endpoint zum Herunterladen der App-Logs als ZIP.

Liest ausschließlich App-eigene Logdateien aus ``app/data/logs/`` —
Host-, Docker-, Nginx- oder Systemlogs werden NICHT angefasst.
"""
from __future__ import annotations

import io
import logging
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from ..logging_setup import LOG_FILE_NAME, get_log_dir
from ..routes.dependencies import AccessContext, get_access_context, require_roles

router = APIRouter(prefix="/api/wms/admin/logs", tags=["WMS Admin Logs"])
logger = logging.getLogger("cloud_web.admin.logs")


@router.get("/download")
def download_logs(
    context: AccessContext = Depends(get_access_context),
) -> StreamingResponse:
    require_roles(context, "admin")

    log_dir = get_log_dir()
    candidates = sorted(
        path
        for path in log_dir.glob(f"{LOG_FILE_NAME}*")
        if path.is_file()
    )
    if not candidates:
        raise HTTPException(
            status_code=404,
            detail="Es sind aktuell keine App-Logs verfügbar.",
        )

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in candidates:
            try:
                archive.write(path, arcname=path.name)
            except OSError as exc:
                # Eine einzelne unlesbare Rotationsdatei darf den Download
                # nicht komplett kippen — wir notieren das Problem im Log
                # und liefern den Rest aus.
                logger.warning("Logdatei %s konnte nicht ins ZIP geschrieben werden: %s", path.name, exc)
    buffer.seek(0)

    filename = f"wms-logs-{datetime.now().strftime('%Y-%m-%d_%H-%M')}.zip"
    logger.info("Admin-Log-Download durch user_id=%s erstellt (%d Dateien)", context.user_id, len(candidates))
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
