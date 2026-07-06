"""Repariert den lokalen Produktbild-Cache aus den gespeicherten Quell-URLs.

Hintergrund: Nach einem Redeploy (frisches Container-Filesystem) oder einem
Backup-Restore koennen Assets/Kategorien auf Cache-Dateien zeigen, die nicht
(mehr) existieren — die UI zeigt dann kaputte Bilder trotz Status "ready".
Dieses Skript laedt alle fehlenden Bilder aus der jeweils gespeicherten
Quell-URL neu. Quellen, die nicht mehr erreichbar sind, werden sauber auf
Status "failed" + Fehlermeldung gesetzt (Platzhalter im UI statt kaputtem
Bild-Icon).

Aufruf (immer aus dem backend-Verzeichnis):

    python -m scripts.recache_product_images            # Dry-Run (Standard)
    python -m scripts.recache_product_images --apply    # wirklich schreiben

Der Lauf ist idempotent: intakte Cache-Dateien werden nie neu geladen.
"""

from __future__ import annotations

import argparse


def _print_report(report: dict[str, object], *, apply: bool) -> None:
    print("Produktbild-Recache")
    print(f"  Datensaetze mit Quell-URL : {report['checked']}")
    print(f"  Cache intakt              : {report['intact']}")
    if apply:
        print(f"  Neu geladen               : {report['refetched']}")
        print(f"  Fehlgeschlagen            : {report['failed']}")
    details = report.get("details") or []
    if details:
        print("\nDetails:")
        for item in details:
            print(f"  [{item['owner']}] {item['name']}: {item['action']}")
    if apply:
        print("\nANGEWENDET: fehlende Bilder wurden neu geladen bzw. auf 'failed' gesetzt.")
    else:
        print("\nDRY-RUN: keine Änderung. Zum Anwenden erneut mit --apply ausführen.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Fehlende Produkt-/Kategoriebilder aus Quell-URLs neu cachen (Dry-Run-Standard).",
    )
    parser.add_argument("--apply", action="store_true", help="Änderungen wirklich schreiben.")
    args = parser.parse_args(argv)

    from app.database.session import SessionLocal
    from app.services import product_image_service

    with SessionLocal() as db:
        report = product_image_service.recache_missing_images(db, apply=args.apply)
    _print_report(report, apply=args.apply)
    return 0 if not report["failed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
