from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Warehouse-System"
    app_version: str = "0.2.0"
    app_env: str = "development"

    database_url: str = "sqlite:///./app/data/app.db"
    db_auto_create_schema: bool = True
    cors_origins: str = "*"

    openai_api_key: str | None = None
    openai_base_url: str | None = None
    auth_token_secret: str = "change-me-in-production"
    allow_legacy_header_auth: bool = True
    initial_admin_email: str | None = None
    initial_admin_password: str | None = None
    initial_admin_name: str | None = None

    wms_seed_legacy_on_startup: bool = True
    wms_legacy_json_path: str = "app/data/wms_db.json"
    hardware_import_path: str = "/app/data/hardware_imports"

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    def resolve_legacy_json_path(self, base_dir: Path) -> Path:
        path = Path(self.wms_legacy_json_path)
        if path.is_absolute():
            return path
        return (base_dir / path).resolve()

    def resolve_hardware_import_path(self, base_dir: Path) -> Path:
        path = Path(self.hardware_import_path)
        if path.is_absolute():
            return path
        return (base_dir / path).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
