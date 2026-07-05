from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse

from ..services import product_image_service

router = APIRouter(tags=["Media"])


@router.get("/media/product-images/assets/{image_name}")
def get_product_image(image_name: str) -> FileResponse:
    target = product_image_service.resolve_cached_file_path(image_name)
    return FileResponse(
        target,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )
