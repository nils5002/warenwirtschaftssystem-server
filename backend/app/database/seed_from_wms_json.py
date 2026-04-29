from __future__ import annotations

from pathlib import Path

try:
    from ..repositories.wms_repository import seed_from_legacy_json
    from .session import SessionLocal, init_db
except ImportError:  # pragma: no cover - allows direct script execution
    from app.repositories.wms_repository import seed_from_legacy_json
    from app.database.session import SessionLocal, init_db


def run_seed(json_path: Path) -> dict[str, int]:
    init_db()
    with SessionLocal() as db:
        return seed_from_legacy_json(db, json_path)


if __name__ == "__main__":
    path = Path(__file__).resolve().parents[1] / "data" / "wms_db.json"
    result = run_seed(path)
    print(f"Seed complete. created={result['created']}")
