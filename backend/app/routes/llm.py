from __future__ import annotations

from typing import Optional

from fastapi import APIRouter

from ..services.llm_service import list_models

router = APIRouter(prefix="/api/llm", tags=["LLM"])


@router.get("/models")
def list_llm_models(base: str, api_key: Optional[str] = None) -> dict[str, list[str]]:
    return {"models": list_models(base, api_key)}

