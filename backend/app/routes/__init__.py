from __future__ import annotations

from fastapi import APIRouter

from . import (
    admin_logs,
    auth,
    backup,
    defaults,
    health,
    label_audit,
    planning,
    qr_groups,
    roles,
    telecom_pass,
    update_notes,
    wms,
    wms_import,
)

# Sicherheits-Hinweis (Security-Audit Paket A):
# Die Router `db_assets` (/api/db/assets), `jobs` (/api/jobs) und `llm`
# (/api/llm) sind bewusst NICHT mehr registriert. Sie waren ohne jede
# Authentifizierung erreichbar (ungeschütztes Asset-CRUD, Job-Steuerung,
# SSRF-fähiger LLM-Proxy) und werden vom WMS-Frontend nicht genutzt.
# Die Modul-Dateien bleiben bestehen; ohne `include_router` sind die
# Endpunkte produktiv jedoch nicht mehr erreichbar (404).

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(defaults.router)
api_router.include_router(auth.router)
api_router.include_router(wms.router)
api_router.include_router(wms_import.router)
api_router.include_router(backup.router)
api_router.include_router(planning.router)
api_router.include_router(admin_logs.router)
api_router.include_router(update_notes.router)
api_router.include_router(label_audit.router)
api_router.include_router(qr_groups.router)
api_router.include_router(roles.router)
api_router.include_router(telecom_pass.router)
