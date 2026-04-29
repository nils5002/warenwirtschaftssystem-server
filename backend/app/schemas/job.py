from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, SecretStr, validator


class SortConfig(BaseModel):
    apple_id: str = Field(..., description="Apple ID (E-Mail-Adresse)")
    apple_password: SecretStr = Field(..., description="App-spezifisches Passwort")
    llm_api_base: Optional[str] = Field(
        None, description="Basis-URL des OpenAI-kompatiblen HTTP-Endpunkts"
    )
    llm_api_key: Optional[SecretStr] = Field(
        None, description="API-Key fuer den LLM-Anbieter"
    )
    model: str = Field("gpt-4o-mini", description="LLM Modell-ID")
    dry_run: bool = Field(True, description="Nur simulieren, nichts verschieben")
    target_root: str = Field(
        "AutoSorted", description="Zielordner in iCloud Drive fuer sortierte Dateien"
    )
    max_pdf_pages: int = Field(3, ge=1, le=20, description="Maximale Seiten pro PDF")
    max_bytes_to_read: int = Field(
        20000, ge=500, le=1000000, description="Maximale Textlaenge fuer die LLM-Anfrage"
    )
    file_types: list[str] = Field(
        default_factory=list,
        description="Liste erlaubter Dateiendungen (leer = alle)",
    )
    use_ocr: bool = Field(True, description="Texterkennung fuer Bilder aktivieren")
    ocr_engine: Optional[str] = Field(
        None, description="Konkrete OCR-Engine (auto, tesseract, easyocr, ...)"
    )
    deep_analysis: bool = Field(
        False, description="Gruendlichere LLM-Analyse mit ausfuehrlicherem Prompt"
    )
    request_timeout: int = Field(
        30, ge=5, le=120, description="Timeout fuer HTTP-Anfragen an das LLM (Sekunden)"
    )

    @validator("file_types", each_item=True)
    def _normalize_extension(cls, value: str) -> str:
        ext = (value or "").strip().lower()
        if not ext:
            raise ValueError("Leere Dateiendung ist nicht erlaubt")
        if not ext.startswith("."):
            ext = "." + ext
        return ext


class JobStartResponse(BaseModel):
    job_id: str
    status: str


class JobStatus(BaseModel):
    job_id: str
    status: str
    logs: list[str] = Field(default_factory=list)
    processed_files: int = 0
    seen_items: int = 0
    awaiting_two_factor: bool = False
    created_at: datetime
    updated_at: datetime
    error: Optional[str] = None


class TwoFactorPayload(BaseModel):
    code: str = Field(..., min_length=1, description="2FA-Code aus iCloud")


class LoginRequest(BaseModel):
    apple_id: str = Field(..., description="Apple ID (E-Mail-Adresse)")
    apple_password: SecretStr = Field(..., description="App-spezifisches Passwort")
    two_factor_code: Optional[str] = Field(
        None,
        min_length=1,
        description="Optionaler 2FA-Code, falls bereits vorhanden",
    )


class LoginResponse(BaseModel):
    success: bool
    two_factor_required: bool
    trusted_session: bool = False
    message: str


class DefaultsResponse(BaseModel):
    default_config: SortConfig
    available_ocr_engines: list[str]
    supports_easyocr: bool
    supports_tesseract: bool
    default_file_types: list[str]

