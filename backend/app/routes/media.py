from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse

from ..services import product_image_service

router = APIRouter(tags=["Media"])

# Bewusst OHNE Auth: <img>-Tags koennen keine Authorization-Header senden und
# die Dateinamen sind nicht erratbare SHA256-Hashes. resolve_cached_file_path
# verhindert Path-Traversal.
#
# Primaerpfad liegt unter /api/wms, damit Bilder garantiert dieselbe
# Proxy-Kette wie alle API-Requests nehmen. Die alten /media-Pfade bleiben als
# Alias fuer bereits ausgelieferte (gecachte) URLs bestehen.


def _serve_cached_image(image_name: str, owner_kind: str) -> FileResponse:
    target = product_image_service.resolve_cached_file_path(image_name, owner_kind=owner_kind)
    return FileResponse(
        target,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )


@router.get("/api/wms/product-images/assets/{image_name}")
@router.get("/media/product-images/assets/{image_name}")
def get_product_image(image_name: str) -> FileResponse:
    return _serve_cached_image(image_name, "assets")


@router.get("/api/wms/product-images/categories/{image_name}")
@router.get("/media/product-images/categories/{image_name}")
def get_category_product_image(image_name: str) -> FileResponse:
    return _serve_cached_image(image_name, "categories")
