from __future__ import annotations

from fastapi import APIRouter
from pydantic import SecretStr

from ..config.settings import get_settings
from ..schemas.job import DefaultsResponse, SortConfig
from ..utils import default_file_types, detect_ocr_engines

router = APIRouter(prefix="/api", tags=["Defaults"])


@router.get("/defaults", response_model=DefaultsResponse)
def get_defaults() -> DefaultsResponse:
    settings = get_settings()
    engines, details = detect_ocr_engines()
    config = SortConfig(
        apple_id="",
        apple_password=SecretStr(""),
        llm_api_base=settings.openai_base_url or None,
        llm_api_key=SecretStr(settings.openai_api_key) if settings.openai_api_key else None,
        model="gpt-4o-mini",
        dry_run=True,
        target_root="AutoSorted",
        max_pdf_pages=3,
        max_bytes_to_read=20000,
        file_types=default_file_types(),
        use_ocr=True,
        ocr_engine="auto" if engines and engines[0] != "none" else None,
        deep_analysis=False,
        request_timeout=30,
    )
    return DefaultsResponse(
        default_config=config,
        available_ocr_engines=engines,
        supports_easyocr=details.get("easyocr_available", False),
        supports_tesseract=details.get("tesseract_ready", False),
        default_file_types=default_file_types(),
    )

