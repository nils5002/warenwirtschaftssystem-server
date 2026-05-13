from __future__ import annotations

from fastapi import APIRouter

from . import admin_logs, auth, backup, db_assets, defaults, health, jobs, llm, planning, wms, wms_import

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(defaults.router)
api_router.include_router(auth.router)
api_router.include_router(jobs.router)
api_router.include_router(llm.router)
api_router.include_router(wms.router)
api_router.include_router(wms_import.router)
api_router.include_router(backup.router)
api_router.include_router(planning.router)
api_router.include_router(db_assets.router)
api_router.include_router(admin_logs.router)
