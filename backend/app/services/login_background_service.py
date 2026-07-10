"""Login-Hintergrundbilder: Datei-Storage im persistenten Volume + DB-Metadaten.

Storage-Muster analog zu ``product_image_service`` (Dateien unter
``app/data/login_backgrounds/`` — ``parents[2]`` trifft die Backend-Wurzel,
sodass der Ordner im persistenten Docker-Volume liegt und Redeploys die Bilder
nicht verlieren). Uploads werden validiert und einheitlich als WEBP re-kodiert;
die längste Kante wird gedeckelt, damit Login-Hintergründe nicht unnötig groß
werden. Genau ein Datensatz ist ``is_active``.
"""

from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database.models import LoginBackgroundRecord
from ..schemas.login_background import LoginBackgroundResponse

_ALLOWED_INPUT_FORMATS = {"JPEG", "PNG", "WEBP"}
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_MAX_DIMENSION = (2560, 2560)
_WEBP_QUALITY = 85
_STORED_MIME = "image/webp"
_FILE_NAME_PATTERN = re.compile(r"^[0-9a-f]{32}\.webp$")


# --- Datei-Storage -----------------------------------------------------------


def _storage_dir() -> Path:
    # parents[2] = backend-Wurzel (Datei liegt unter app/services/). Der Ordner
    # muss neben product_images unter app/data/ landen (persistentes Volume),
    # nicht unter app/app/... — sonst verliert jeder Redeploy die Bilder.
    base_dir = Path(__file__).resolve().parents[2]
    target = base_dir / "app" / "data" / "login_backgrounds"
    target.mkdir(parents=True, exist_ok=True)
    return target


def _optimize_image(image_bytes: bytes) -> tuple[bytes, int, int]:
    """Validiert den Upload und re-kodiert ihn als WEBP (Größe gedeckelt).
    Liefert (bytes, width, height)."""
    if len(image_bytes) > _MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Bild ist zu groß. Maximal 10 MB erlaubt.")
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()
            if image.format not in _ALLOWED_INPUT_FORMATS:
                raise HTTPException(
                    status_code=400,
                    detail="Nur JPG, PNG oder WEBP sind als Login-Hintergrund erlaubt.",
                )
            prepared = image.convert("RGB")
            prepared.thumbnail(_MAX_DIMENSION, Image.Resampling.LANCZOS)
            target = BytesIO()
            prepared.save(target, format="WEBP", quality=_WEBP_QUALITY, method=6)
            return target.getvalue(), prepared.width, prepared.height
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Die Datei ist kein gültiges Bild.") from exc


def build_public_url(file_name: str | None) -> str | None:
    value = (file_name or "").strip()
    if not value:
        return None
    # Öffentlich (kein Auth) über dieselbe /api-Proxy-Kette wie alle Requests.
    return f"/api/wms/login-backgrounds/file/{value}"


def resolve_stored_file_path(file_name: str) -> Path:
    """Path-Traversal-sichere Auflösung eines gespeicherten Dateinamens."""
    if not _FILE_NAME_PATTERN.match(file_name or ""):
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    base = _storage_dir().resolve()
    target = (base / file_name).resolve()
    if base not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    return target


def _delete_stored_file(file_name: str | None) -> None:
    value = (file_name or "").strip()
    if not value or not _FILE_NAME_PATTERN.match(value):
        return
    try:
        path = _storage_dir() / value
        path.unlink(missing_ok=True)
    except OSError:
        # Ein fehlgeschlagenes Datei-Löschen darf den DB-Delete nicht blockieren.
        pass


# --- Response-Mapping --------------------------------------------------------


def to_response(record: LoginBackgroundRecord) -> LoginBackgroundResponse:
    return LoginBackgroundResponse(
        id=record.external_id,
        url=build_public_url(record.file_name) or "",
        originalName=record.original_name or "",
        mimeType=record.mime_type or _STORED_MIME,
        sizeBytes=int(record.size_bytes or 0),
        width=int(record.width or 0),
        height=int(record.height or 0),
        uploadedByName=record.uploaded_by_name,
        isActive=bool(record.is_active),
        createdAt=record.created_at,
    )


# --- DB-Operationen ----------------------------------------------------------


def list_backgrounds(db: Session) -> list[LoginBackgroundResponse]:
    records = db.scalars(
        select(LoginBackgroundRecord).order_by(LoginBackgroundRecord.created_at.desc())
    ).all()
    return [to_response(record) for record in records]


def get_active(db: Session) -> LoginBackgroundRecord | None:
    return db.scalar(
        select(LoginBackgroundRecord)
        .where(LoginBackgroundRecord.is_active.is_(True))
        .order_by(LoginBackgroundRecord.updated_at.desc())
    )


def get_active_public_url(db: Session) -> str | None:
    """Öffentliche Sicht: URL des aktiven Bilds, aber nur wenn die Datei im
    Volume tatsächlich existiert (nach Restore auf ein frisches Volume kann die
    Datei fehlen — dann sauberer Fallback auf ``None`` statt kaputtem Bild)."""
    active = get_active(db)
    if active is None:
        return None
    file_name = (active.file_name or "").strip()
    if not file_name or not (_storage_dir() / file_name).is_file():
        return None
    return build_public_url(file_name)


def create_from_upload(
    db: Session,
    *,
    file_bytes: bytes,
    original_name: str,
    uploaded_by_user_id: str | None,
    uploaded_by_name: str | None,
    activate: bool = True,
) -> LoginBackgroundResponse:
    optimized, width, height = _optimize_image(file_bytes)
    file_name = f"{uuid4().hex}.webp"
    (_storage_dir() / file_name).write_bytes(optimized)

    if activate:
        _deactivate_all_rows(db)

    record = LoginBackgroundRecord(
        external_id=f"lbg-{uuid4().hex[:12]}",
        file_name=file_name,
        original_name=(original_name or "").strip()[:255] or "hintergrund.webp",
        mime_type=_STORED_MIME,
        size_bytes=len(optimized),
        width=width,
        height=height,
        uploaded_by_user_id=(uploaded_by_user_id or None),
        uploaded_by_name=(uploaded_by_name or None),
        is_active=activate,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return to_response(record)


def activate(db: Session, external_id: str) -> LoginBackgroundResponse:
    record = db.scalar(
        select(LoginBackgroundRecord).where(LoginBackgroundRecord.external_id == external_id)
    )
    if record is None:
        raise HTTPException(status_code=404, detail="Login-Hintergrund nicht gefunden.")
    _deactivate_all_rows(db)
    record.is_active = True
    db.commit()
    db.refresh(record)
    return to_response(record)


def deactivate_all(db: Session) -> None:
    _deactivate_all_rows(db)
    db.commit()


def _deactivate_all_rows(db: Session) -> None:
    for record in db.scalars(
        select(LoginBackgroundRecord).where(LoginBackgroundRecord.is_active.is_(True))
    ).all():
        record.is_active = False


def delete_background(db: Session, external_id: str) -> bool:
    record = db.scalar(
        select(LoginBackgroundRecord).where(LoginBackgroundRecord.external_id == external_id)
    )
    if record is None:
        return False
    _delete_stored_file(record.file_name)
    db.delete(record)
    db.commit()
    return True
