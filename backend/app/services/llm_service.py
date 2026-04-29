from __future__ import annotations

from typing import Optional

import requests
from fastapi import HTTPException


def list_models(base: str, api_key: Optional[str]) -> list[str]:
    base = (base or "").strip().rstrip("/")
    if not base:
        raise HTTPException(status_code=400, detail="Parameter 'base' darf nicht leer sein")
    try:
        models = _fetch_llm_models(base, api_key or None)
    except requests.HTTPError as exc:
        status = exc.response.status_code if exc.response else 502
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not models:
        raise HTTPException(status_code=404, detail="Keine Modelle gefunden")
    return models


def _fetch_llm_models(base: str, api_key: Optional[str]) -> list[str]:
    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    use_openai = (
        "/v1" in base
        or base.endswith("/models")
        or base.endswith("/chat")
        or base.endswith("/chat/completions")
    )
    if use_openai:
        url = base if base.endswith("/models") else f"{base}/models"
    else:
        if base.endswith("/api/tags"):
            url = base
        elif base.endswith("/api"):
            url = f"{base}/tags"
        else:
            url = f"{base}/api/tags"
    resp = requests.get(url, headers=headers, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    models: list[str] = []
    if isinstance(data, dict):
        if isinstance(data.get("data"), list):
            models.extend(
                str(item["id"]) for item in data["data"] if isinstance(item, dict) and item.get("id")
            )
        if not models and isinstance(data.get("models"), list):
            for entry in data["models"]:
                if isinstance(entry, dict):
                    value = entry.get("id") or entry.get("model") or entry.get("name")
                    if value:
                        models.append(str(value))
                elif isinstance(entry, str):
                    models.append(entry)
    if not models and isinstance(data, list):
        models = [str(x) for x in data]
    return sorted(dict.fromkeys(models))

