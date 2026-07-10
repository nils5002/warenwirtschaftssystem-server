from __future__ import annotations

from typing import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from ..config.settings import get_settings
from .base import Base

settings = get_settings()
DATABASE_URL = settings.database_url

# Bei SQLite:
#   * ``check_same_thread=False`` ist notwendig, weil SQLAlchemy-Connections
#     in FastAPI ueber mehrere Threads (Threadpool) wandern koennen.
#   * ``timeout`` = wie lange das DBAPI-Modul (Python ``sqlite3``) auf ein
#     freies Lock wartet, bevor ein OperationalError geworfen wird. Default
#     ist 5s — fuer Produktion mit gleichzeitigem Polling + Schreibzugriffen
#     deutlich zu kurz. 30s sind ein konservativer Standard, der reale
#     Schreib-Spitzen abfaengt, ohne dass Requests "ewig" haengen.
connect_args = (
    {"check_same_thread": False, "timeout": 30}
    if DATABASE_URL.startswith("sqlite")
    else {}
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    future=True,
    connect_args=connect_args,
)


# PRAGMAs fuer jede neue SQLite-Connection. WAL erlaubt parallele Reader
# waehrend ein Writer aktiv ist (im Default-Rollback-Journal sperrt jeder
# Writer alle Reader). ``busy_timeout`` setzt zusaetzlich serverseitig die
# Wartezeit auf ein Lock — auch wenn das DBAPI bereits einen ``timeout``
# erhaelt, ist das Pragma die robustere Quelle, weil es auch fuer
# direkte ``sqlite3``-Aufrufe waehrend des Connect greift.
# ``synchronous=NORMAL`` ist die empfohlene Begleitung zu WAL: kein Datenverlust
# bei App-Crashes, leicht schnellere Schreib-Performance als FULL.
# Hinweis: ``foreign_keys=ON`` wird HIER bewusst NICHT gesetzt. SQLite hat das
# FK-Enforcement historisch ausgeschaltet, und der bestehende Backup-Import
# (services/backup_service.py) verlaesst sich auf diese Reihenfolge-Toleranz.
# FK-Enforcement waere ein eigenes Mini-Projekt (Insert-Reihenfolge + Tests)
# und gehoert nicht in dieses Stabilitaets-Paket.
if DATABASE_URL.startswith("sqlite"):

    @event.listens_for(Engine, "connect")
    def _sqlite_set_pragmas(dbapi_connection, _connection_record):  # type: ignore[no-untyped-def]
        try:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA busy_timeout=10000")
                cursor.execute("PRAGMA synchronous=NORMAL")
            finally:
                cursor.close()
        except Exception:
            # PRAGMA-Fehler duerfen den App-Start nicht killen — z. B. bei
            # ":memory:"-DBs in Tests sind manche Pragmas no-op. Ein Fehler
            # hier wuerde sonst jeden Connection-Aufbau scheitern lassen.
            pass


SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


# Hot-Path-Indizes, die nachträglich für bereits bestehende Tabellen angelegt
# werden müssen. ``Base.metadata.create_all(checkfirst=True)`` legt Indizes
# nur für neue Tabellen an — bei einer bereits laufenden Production-DB würden
# neu deklarierte ``index=True``-Spalten ohne diesen expliziten Schritt keinen
# Effekt haben. ``CREATE INDEX IF NOT EXISTS`` ist idempotent, berührt keine
# Daten und ist für SQLite und Postgres sicher.
_HOT_PATH_INDEXES: tuple[tuple[str, str, str], ...] = (
    ("ix_assets_status", "assets", "status"),
    ("ix_assets_category", "assets", "category"),
    ("ix_assets_qr_code", "assets", "qr_code"),
    ("ix_maintenance_items_status", "maintenance_items", "status"),
    ("ix_maintenance_items_asset_name", "maintenance_items", "asset_name"),
)


def _ensure_hot_path_indexes() -> None:
    """Legt fehlende Hot-Path-Indizes an, ohne bestehende Daten zu berühren."""
    with engine.begin() as connection:
        for index_name, table_name, column_name in _HOT_PATH_INDEXES:
            statement = text(
                f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({column_name})"
            )
            connection.execute(statement)


# Spalten, die im Lauf neuer Features zu bestehenden Tabellen hinzukommen.
# ``Base.metadata.create_all(checkfirst=True)`` legt nur fehlende TABELLEN
# an — Spalten in bereits bestehenden Tabellen bleiben ohne diesen Schritt
# auf einer Production-DB unverändert. Wir prüfen daher pro Spalte via
# ``PRAGMA table_info`` und setzen sie via ``ALTER TABLE ADD COLUMN``,
# wenn sie fehlt. Das ist für SQLite und Postgres unkritisch und berührt
# keine bestehenden Daten.
_NEW_COLUMNS: tuple[tuple[str, str, str], ...] = (
    # (table_name, column_name, sql_definition)
    ("assets", "ownership_type", "VARCHAR(16) NOT NULL DEFAULT 'owned'"),
    ("assets", "source_name", "VARCHAR(180)"),
    ("assets", "available_from", "DATE"),
    ("assets", "available_until", "DATE"),
    ("assets", "return_due_date", "DATE"),
    ("assets", "returned_at", "DATE"),
    ("assets", "external_note", "TEXT"),
    ("assets", "card_printer_compatible", "BOOLEAN NOT NULL DEFAULT 1"),
    ("assets", "available_for_planning", "BOOLEAN NOT NULL DEFAULT 1"),
    ("assets", "product_image_source_url", "VARCHAR(1024)"),
    ("assets", "product_image_cached_path", "VARCHAR(255)"),
    ("assets", "product_image_mime_type", "VARCHAR(64)"),
    ("assets", "product_image_last_fetched_at", "DATETIME"),
    ("assets", "product_image_fetch_status", "VARCHAR(32) NOT NULL DEFAULT 'none'"),
    ("assets", "product_image_fetch_error", "VARCHAR(255)"),
    ("categories", "default_image_source_url", "VARCHAR(1024)"),
    ("categories", "default_image_cached_path", "VARCHAR(255)"),
    ("categories", "default_image_mime_type", "VARCHAR(64)"),
    ("categories", "default_image_last_fetched_at", "DATETIME"),
    ("categories", "default_image_fetch_status", "VARCHAR(32) NOT NULL DEFAULT 'none'"),
    ("categories", "default_image_fetch_error", "VARCHAR(255)"),
    # Schritt A: erwartetes Rückgabedatum verliehener Eigengeräte. Nullable,
    # damit bestehende Daten und Altbackups ohne Wert unverändert importierbar
    # bleiben (Fallback auf next_return in der Availability-Logik).
    ("assets", "expected_return_date", "DATE"),
    # Schritt B: Planung, FÜR die ein Asset ausgegeben wurde. Nullable → Altdaten
    # ohne Verknüpfung verhalten sich wie Schritt A.
    ("assets", "assigned_planning_id", "VARCHAR(64)"),
    # Security-Audit Paket B2: serverseitige Token-Invalidierung pro Benutzer.
    ("users", "token_version", "INTEGER NOT NULL DEFAULT 0"),
    # Label-Prüfung: Admin-Korrektur von Scans (Soft-Delete + Korrektur-Spur).
    # Alle nullable → Altdaten ohne Wert verhalten sich wie bisher (nicht
    # ignoriert / nicht korrigiert).
    ("label_audit_scans", "note", "VARCHAR(256)"),
    ("label_audit_scans", "ignored_at", "DATETIME"),
    ("label_audit_scans", "ignored_by_user_id", "VARCHAR(64)"),
    ("label_audit_scans", "ignore_reason", "VARCHAR(256)"),
    ("label_audit_scans", "corrected_at", "DATETIME"),
    ("label_audit_scans", "corrected_by_user_id", "VARCHAR(64)"),
    ("label_audit_scans", "correction_note", "VARCHAR(256)"),
    # Rückgabe-Puffer je Planung. NOT NULL DEFAULT 0 → Altzeilen verhalten sich
    # unverändert (Puffer 0 = bisheriges Verhalten).
    ("planning", "return_buffer_days", "INTEGER NOT NULL DEFAULT 0"),
    # Telekompass: kumulierte Buchungsanzahl je Asset. NOT NULL DEFAULT 0 →
    # bestehende Geräte starten bei 0, kein Datenmigrationsbedarf.
    ("assets", "telecom_pass_booking_count_total", "INTEGER NOT NULL DEFAULT 0"),
    # Security-Paket „supman": Login-Metadaten + persistente Brute-Force-Sperre
    # + Freigabe-/Ablehnungs-Spur. Alle nullable bzw. DEFAULT 0 → Bestandsdaten
    # und alte Backups verhalten sich unverändert.
    ("users", "failed_login_count", "INTEGER NOT NULL DEFAULT 0"),
    ("users", "locked_until", "DATETIME"),
    ("users", "last_login_at", "DATETIME"),
    ("users", "last_login_attempt_at", "DATETIME"),
    ("users", "last_login_ip", "VARCHAR(64)"),
    ("users", "last_login_user_agent", "VARCHAR(255)"),
    ("users", "approved_at", "DATETIME"),
    ("users", "approved_by", "VARCHAR(64)"),
    ("users", "rejected_at", "DATETIME"),
    # Signaturfarbe pro Benutzer (Einsatzplanung/Kalender). Nullable — der
    # Startup-Backfill (ensure_signature_colors) füllt nur leere Werte und
    # lässt manuell gesetzte Farben unangetastet.
    ("users", "signature_color", "VARCHAR(16)"),
    ("users", "signature_color_source", "VARCHAR(16)"),
)


def _ensure_new_columns() -> None:
    """Idempotente Migration: ergänzt fehlende Spalten in bestehenden Tabellen."""
    with engine.begin() as connection:
        for table_name, column_name, definition in _NEW_COLUMNS:
            existing = connection.execute(
                text(f"PRAGMA table_info({table_name})")
            ).fetchall()
            existing_names = {row[1] for row in existing}
            if column_name in existing_names:
                continue
            connection.execute(
                text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")
            )


def init_db() -> None:
    # Import models lazily so metadata is populated before create_all.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _ensure_new_columns()
    _ensure_hot_path_indexes()


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

