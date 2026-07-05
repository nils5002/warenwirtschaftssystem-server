from __future__ import annotations

import hashlib
import ipaddress
import socket
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

from ..config.settings import get_settings

_ALLOWED_SCHEMES = {"http", "https"}
_ALLOWED_MIME_TYPES = {
    "image/jpeg": "JPEG",
    "image/png": "PNG",
    "image/webp": "WEBP",
}
_PUBLIC_IMAGE_MIME = "image/webp"
_MAX_REDIRECTS = 3
_MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024
_CONNECT_TIMEOUT = 3
_READ_TIMEOUT = 10
_MAX_IMAGE_SIZE = (640, 640)
_DEFAULT_OWNER_KIND = "assets"
_VALID_OWNER_KINDS = {"assets", "categories"}


def _asset_cache_dir() -> Path:
    base_dir = Path(__file__).resolve().parents[1]
    target = get_settings().resolve_product_image_cache_path(base_dir)
    target.mkdir(parents=True, exist_ok=True)
    return target


def _normalize_owner_kind(owner_kind: str) -> str:
    normalized = (owner_kind or "").strip().lower()
    if normalized not in _VALID_OWNER_KINDS:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    return normalized


def _cache_dir(owner_kind: str = _DEFAULT_OWNER_KIND) -> Path:
    normalized = _normalize_owner_kind(owner_kind)
    asset_dir = _asset_cache_dir()
    if normalized == _DEFAULT_OWNER_KIND:
        return asset_dir
    target = asset_dir.parent / normalized
    target.mkdir(parents=True, exist_ok=True)
    return target


def _normalize_source_url(source_url: str | None) -> str | None:
    value = (source_url or "").strip()
    if not value:
        return None
    parsed = urlparse(value)
    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        raise HTTPException(status_code=400, detail="Produktbild-URL muss mit http:// oder https:// beginnen.")
    if not parsed.netloc:
        raise HTTPException(status_code=400, detail="Produktbild-URL ist ungültig.")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Produktbild-URLs mit Zugangsdaten sind nicht erlaubt.")
    return value


def _assert_public_host(hostname: str) -> None:
    try:
        answers = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Produktbild-Host konnte nicht aufgelöst werden.") from exc

    resolved = {item[4][0] for item in answers if item[4]}
    if not resolved:
        raise HTTPException(status_code=400, detail="Produktbild-Host konnte nicht aufgelöst werden.")

    for raw_ip in resolved:
        try:
            ip = ipaddress.ip_address(raw_ip)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Produktbild-Host ist ungültig.") from exc
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise HTTPException(
                status_code=400,
                detail="Produktbild-URL darf nicht auf interne oder lokale Adressen zeigen.",
            )


def _validate_url(url: str) -> str:
    normalized = _normalize_source_url(url)
    if normalized is None:
        raise HTTPException(status_code=400, detail="Produktbild-URL fehlt.")
    parsed = urlparse(normalized)
    _assert_public_host(parsed.hostname or "")
    return normalized


def _download_bytes(source_url: str) -> tuple[bytes, str]:
    session = requests.Session()
    current_url = _validate_url(source_url)

    for redirect_count in range(_MAX_REDIRECTS + 1):
        try:
            response = session.get(
                current_url,
                stream=True,
                timeout=(_CONNECT_TIMEOUT, _READ_TIMEOUT),
                allow_redirects=False,
                headers={"User-Agent": "WarehouseSystem/1.0 ProductImageFetcher"},
            )
        except requests.RequestException as exc:
            raise HTTPException(status_code=400, detail="Produktbild konnte nicht heruntergeladen werden.") from exc

        if 300 <= response.status_code < 400:
            if redirect_count >= _MAX_REDIRECTS:
                raise HTTPException(status_code=400, detail="Zu viele Weiterleitungen bei der Produktbild-URL.")
            location = response.headers.get("location", "").strip()
            if not location:
                raise HTTPException(status_code=400, detail="Ungültige Weiterleitung bei der Produktbild-URL.")
            current_url = _validate_url(urljoin(current_url, location))
            continue

        if response.status_code != 200:
            raise HTTPException(status_code=400, detail="Produktbild-URL lieferte keinen gültigen Download.")

        declared_type = (response.headers.get("content-type") or "").split(";")[0].strip().lower()
        if declared_type == "image/svg+xml":
            raise HTTPException(status_code=400, detail="SVG-Dateien sind als Produktbild nicht erlaubt.")

        data = bytearray()
        for chunk in response.iter_content(chunk_size=64 * 1024):
            if not chunk:
                continue
            data.extend(chunk)
            if len(data) > _MAX_DOWNLOAD_BYTES:
                raise HTTPException(status_code=400, detail="Produktbild ist zu groß. Maximal 5 MB erlaubt.")
        return bytes(data), declared_type

    raise HTTPException(status_code=400, detail="Produktbild konnte nicht heruntergeladen werden.")


def _optimize_image(image_bytes: bytes, declared_type: str) -> tuple[bytes, str]:
    if declared_type and declared_type not in _ALLOWED_MIME_TYPES and declared_type != "application/octet-stream":
        raise HTTPException(status_code=400, detail="Nur JPG, PNG oder WEBP sind als Produktbild erlaubt.")
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()
            if image.format == "SVG":
                raise HTTPException(status_code=400, detail="SVG-Dateien sind als Produktbild nicht erlaubt.")
            if image.format not in _ALLOWED_MIME_TYPES.values():
                raise HTTPException(status_code=400, detail="Nur JPG, PNG oder WEBP sind als Produktbild erlaubt.")
            prepared = image.convert("RGBA")
            prepared.thumbnail(_MAX_IMAGE_SIZE, Image.Resampling.LANCZOS)
            target = BytesIO()
            prepared.save(target, format="WEBP", quality=82, method=6)
            return target.getvalue(), _PUBLIC_IMAGE_MIME
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=400, detail="Die Produktbild-URL liefert kein gültiges Bild.") from exc


def _cache_key(source_url: str) -> str:
    return hashlib.sha256(source_url.encode("utf-8")).hexdigest()


def build_public_image_url(cached_path: str | None, *, owner_kind: str = _DEFAULT_OWNER_KIND) -> str | None:
    value = (cached_path or "").strip()
    if not value:
        return None
    normalized = _normalize_owner_kind(owner_kind)
    return f"/media/product-images/{normalized}/{value}"


def cached_file_exists(file_name: str | None, *, owner_kind: str = _DEFAULT_OWNER_KIND) -> bool:
    value = (file_name or "").strip()
    if not value:
        return False
    try:
        return resolve_cached_file_path(value, owner_kind=owner_kind).is_file()
    except HTTPException:
        return False


def resolve_cached_file_path(file_name: str, *, owner_kind: str = _DEFAULT_OWNER_KIND) -> Path:
    normalized = _normalize_owner_kind(owner_kind)
    if "/" in file_name or "\\" in file_name:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    if not file_name.endswith(".webp"):
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    if len(file_name) != 69:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    base = _cache_dir(normalized).resolve()
    target = (base / file_name).resolve()
    if base not in target.parents:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Datei nicht gefunden.")
    return target


def sync_product_image(source_url: str, *, owner_kind: str = _DEFAULT_OWNER_KIND) -> dict[str, str | None]:
    normalized_owner_kind = _normalize_owner_kind(owner_kind)
    normalized_url = _validate_url(source_url)
    file_name = f"{_cache_key(normalized_url)}.webp"
    target_path = _cache_dir(normalized_owner_kind) / file_name
    if target_path.exists():
        return {
            "source_url": normalized_url,
            "cached_path": file_name,
            "mime_type": _PUBLIC_IMAGE_MIME,
            "fetch_status": "ready",
            "fetch_error": None,
        }

    image_bytes, declared_type = _download_bytes(normalized_url)
    optimized_bytes, mime_type = _optimize_image(image_bytes, declared_type)
    target_path.write_bytes(optimized_bytes)
    return {
        "source_url": normalized_url,
        "cached_path": file_name,
        "mime_type": mime_type,
        "fetch_status": "ready",
        "fetch_error": None,
    }


def clear_product_image() -> dict[str, str | None]:
    return {
        "source_url": None,
        "cached_path": None,
        "mime_type": None,
        "fetch_status": "none",
        "fetch_error": None,
    }
