from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database.models import AssetRecord, CategoryRecord
from ..domain.categories import CANONICAL_CATEGORIES, category_hint, normalize_known_category
from ..domain.categories import _category_key as category_key
from ..schemas.wms import CategoryItem


def _to_schema(record: CategoryRecord) -> CategoryItem:
    return CategoryItem(
        id=record.id,
        name=record.name,
        isStandard=record.is_standard,
        isActive=record.is_active,
    )


def seed_standard_categories(db: Session) -> None:
    changed = False
    existing = {
        record.name: record
        for record in db.scalars(select(CategoryRecord)).all()
    }
    for name in CANONICAL_CATEGORIES:
        normalized_name = category_key(name)
        record = existing.get(name)
        if record is None:
            db.add(
                CategoryRecord(
                    name=name,
                    normalized_name=normalized_name,
                    is_standard=True,
                    is_active=True,
                )
            )
            changed = True
            continue
        if record.normalized_name != normalized_name or not record.is_standard or not record.is_active:
            record.normalized_name = normalized_name
            record.is_standard = True
            record.is_active = True
            changed = True
    if changed:
        db.commit()


def list_categories(db: Session, *, include_inactive: bool = False) -> list[CategoryItem]:
    stmt = select(CategoryRecord)
    if not include_inactive:
        stmt = stmt.where(CategoryRecord.is_active.is_(True))
    records = db.scalars(stmt.order_by(CategoryRecord.is_standard.desc(), CategoryRecord.name.asc())).all()
    order = {name: index for index, name in enumerate(CANONICAL_CATEGORIES)}
    records = sorted(records, key=lambda item: (order.get(item.name, 10_000), item.name.lower()))
    return [_to_schema(record) for record in records]


def active_category_names(db: Session) -> set[str]:
    return set(db.scalars(select(CategoryRecord.name).where(CategoryRecord.is_active.is_(True))).all())


def normalize_category_value(value: str | None, active_names: set[str]) -> str:
    return normalize_known_category(value, active_names)


def normalize_category_for_db(db: Session, value: str | None) -> str:
    return normalize_known_category(value, active_category_names(db))


def create_category(db: Session, name: str) -> CategoryItem:
    cleaned = " ".join(name.strip().split())
    normalized_name = category_key(cleaned)
    if not cleaned:
        raise HTTPException(status_code=422, detail="Kategoriename darf nicht leer sein.")

    hint = category_hint(cleaned)
    if hint:
        raise HTTPException(
            status_code=409,
            detail=f"Diese Kategorie entspricht wahrscheinlich {hint}. Bitte vorhandene Kategorie verwenden.",
        )

    existing = db.scalar(select(CategoryRecord).where(CategoryRecord.normalized_name == normalized_name))
    if existing:
        if not existing.is_active:
            existing.is_active = True
            db.commit()
            db.refresh(existing)
            return _to_schema(existing)
        raise HTTPException(status_code=409, detail="Diese Kategorie existiert bereits.")

    record = CategoryRecord(
        name=cleaned,
        normalized_name=normalized_name,
        is_standard=False,
        is_active=True,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return _to_schema(record)


def _count_assets_in_category(db: Session, *, category_name: str, normalized_name: str) -> int:
    """Zählt Assets, die diese Kategorie aktuell verwenden.

    Berücksichtigt sowohl exakten Namen (z. B. "Laptop") als auch den
    normalisierten Schlüssel (z. B. "laptop"), damit Assets mit
    leichten Schreibvarianten (Großschreibung, Whitespace) zuverlässig
    erkannt werden — die Kategorie-Normalisierung im Restbau ist
    case-/whitespace-tolerant, der Vergleich hier muss das spiegeln.
    """
    target_normalized = normalized_name.strip().lower()
    if not target_normalized:
        return 0
    # Exakter Treffer per SQL ist günstig; alles andere fangen wir mit
    # einem zweiten LIKE-freien Vergleich in Python ab (kleine Tabelle, OK).
    exact_count = db.scalar(
        select(func.count())
        .select_from(AssetRecord)
        .where(AssetRecord.category == category_name)
    ) or 0
    if exact_count > 0:
        return int(exact_count)
    # Fallback: normalisierte Vergleichsschleife für Edge-Cases
    # (z. B. Asset wurde mit Whitespace oder anderer Schreibweise angelegt).
    fallback = 0
    for value in db.scalars(select(AssetRecord.category)).all():
        if value and category_key(str(value)) == target_normalized:
            fallback += 1
    return fallback


def delete_category(db: Session, category_id: int) -> dict[str, object]:
    """Löscht eine Kategorie hart, sofern sie aktuell von keinem Asset genutzt wird.

    Liefert HTTPException auf Konflikt:
      - 404 wenn die Kategorie nicht existiert
      - 409 wenn noch Assets damit verknüpft sind (Anzahl wird mitgegeben)

    Es werden bewusst KEINE Assets automatisch umgehängt oder gelöscht —
    Kategorien sind Stammdaten und ein automatisches Umhängen würde
    Bestandszählung und Planungs-Availability stillschweigend verfälschen.
    """
    record = db.scalar(select(CategoryRecord).where(CategoryRecord.id == category_id))
    if record is None:
        raise HTTPException(status_code=404, detail="Kategorie nicht gefunden.")
    in_use = _count_assets_in_category(
        db, category_name=record.name, normalized_name=record.normalized_name
    )
    if in_use > 0:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Kategorie kann nicht gelöscht werden, weil noch {in_use} "
                f"Gerät(e) damit verknüpft sind."
            ),
        )
    db.delete(record)
    db.commit()
    return {"deleted": True, "id": category_id}
