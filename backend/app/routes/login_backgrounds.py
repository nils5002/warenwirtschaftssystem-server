"""Login-Hintergrundbilder.

Öffentlich (kein Auth — die Login-Seite ist ohne Anmeldung erreichbar):
- GET /api/wms/login-branding              → aktive Hintergrund-URL (oder null)
- GET /api/wms/login-backgrounds/file/{name} → liefert die Bilddatei aus

Admin (serverseitig auf Rolle ``admin`` geprüft):
- GET    /api/wms/admin/login-backgrounds
- POST   /api/wms/admin/login-backgrounds            (Upload)
- PATCH  /api/wms/admin/login-backgrounds/{id}/activate
- DELETE /api/wms/admin/login-backgrounds/{id}
- POST   /api/wms/admin/login-backgrounds/deactivate
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import UserRecord
from ..database.session import get_db
from ..routes.dependencies import AccessContext, get_access_context, require_roles
from ..schemas.login_background import LoginBackgroundResponse, LoginBrandingResponse
from ..services import login_background_service

router = APIRouter(tags=["Login Backgrounds"])


# --- Öffentlich (kein Auth) --------------------------------------------------


@router.get("/api/wms/login-branding", response_model=LoginBrandingResponse)
def get_login_branding(db: Session = Depends(get_db)) -> LoginBrandingResponse:
    """Öffentlich: liefert die URL des aktiven Login-Hintergrunds (oder null).

    Bewusst OHNE ``get_access_context`` — die Login-Seite ist vor der Anmeldung
    erreichbar. Es werden ausschließlich die aktive Bild-URL zurückgegeben,
    niemals die Galerie oder Upload-Metadaten.
    """
    return LoginBrandingResponse(backgroundUrl=login_background_service.get_active_public_url(db))


@router.get("/api/wms/login-backgrounds/file/{file_name}")
def get_login_background_file(file_name: str) -> FileResponse:
    """Öffentlich: liefert eine gespeicherte Bilddatei aus.

    Kein Auth (``<img>`` kann keine Header senden); der Dateiname ist ein nicht
    erratbarer Hex-Name und ``resolve_stored_file_path`` verhindert
    Path-Traversal. Kürzere Cache-Zeit als Produktbilder, da ein Admin den
    aktiven Hintergrund jederzeit wechseln kann.
    """
    target = login_background_service.resolve_stored_file_path(file_name)
    return FileResponse(
        target,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=300"},
    )


# --- Admin (nur Rolle admin) -------------------------------------------------


@router.get("/api/wms/admin/login-backgrounds", response_model=list[LoginBackgroundResponse])
def list_login_backgrounds(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> list[LoginBackgroundResponse]:
    require_roles(context, "admin")
    return login_background_service.list_backgrounds(db)


@router.post("/api/wms/admin/login-backgrounds", response_model=LoginBackgroundResponse)
async def upload_login_background(
    request: Request,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LoginBackgroundResponse:
    require_roles(context, "admin")
    try:
        form = await request.form()
    except RuntimeError as exc:
        if "python-multipart" in str(exc):
            raise HTTPException(
                status_code=503,
                detail="Upload-Feature nicht verfügbar: python-multipart fehlt auf dem Server.",
            ) from exc
        raise
    file = form.get("file")
    if file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="Datei fehlt.")
    original_name = getattr(file, "filename", None) or "hintergrund"
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Datei ist leer.")

    uploaded_by_name = _resolve_user_name(db, context.user_id)
    return login_background_service.create_from_upload(
        db,
        file_bytes=file_bytes,
        original_name=str(original_name),
        uploaded_by_user_id=context.user_id,
        uploaded_by_name=uploaded_by_name,
        activate=True,
    )


@router.patch(
    "/api/wms/admin/login-backgrounds/{background_id}/activate",
    response_model=LoginBackgroundResponse,
)
def activate_login_background(
    background_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> LoginBackgroundResponse:
    require_roles(context, "admin")
    return login_background_service.activate(db, background_id)


@router.post("/api/wms/admin/login-backgrounds/deactivate")
def deactivate_login_background(
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin")
    login_background_service.deactivate_all(db)
    return {"deactivated": True}


@router.delete("/api/wms/admin/login-backgrounds/{background_id}")
def delete_login_background(
    background_id: str,
    db: Session = Depends(get_db),
    context: AccessContext = Depends(get_access_context),
) -> dict[str, bool]:
    require_roles(context, "admin")
    if not login_background_service.delete_background(db, background_id):
        raise HTTPException(status_code=404, detail="Login-Hintergrund nicht gefunden.")
    return {"deleted": True}


def _resolve_user_name(db: Session, user_id: str | None) -> str | None:
    resolved = (user_id or "").strip()
    if not resolved:
        return None
    user = db.scalar(select(UserRecord).where(UserRecord.external_id == resolved))
    return user.name if user else None
