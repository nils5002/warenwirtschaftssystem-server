"""
Legacy compatibility module.

Prefer importing from `app.schemas.job`.
"""

from .schemas.job import (  # noqa: F401
    DefaultsResponse,
    JobStartResponse,
    JobStatus,
    LoginRequest,
    LoginResponse,
    SortConfig,
    TwoFactorPayload,
)

