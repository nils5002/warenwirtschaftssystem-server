from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AssetRecord(TimestampMixin, Base):
    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    # Status und Kategorie werden bei jeder Verfügbarkeits-/Konflikt-
    # Berechnung gefiltert (Inventar, Planungs-Availability, Summary).
    # Mit Index spart das bei großen Beständen O(N)-Scans.
    category: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    location: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="Verfuegbar", index=True)
    assigned_to: Mapped[str] = mapped_column(String(120), nullable=False, default="-")
    next_return: Mapped[str] = mapped_column(String(120), nullable=False, default="-")
    tag_number: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    serial_number: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    device_model: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mac_lan: Mapped[str | None] = mapped_column(String(32), nullable=True)
    mac_wlan: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # qr_code wird beim QR-Scan in Ein-/Auslagerung gesucht.
    qr_code: Mapped[str] = mapped_column(String(255), nullable=False, default="", index=True)
    maintenance_state: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    last_checkout: Mapped[str] = mapped_column(String(120), nullable=False, default="-")
    next_reservation: Mapped[str] = mapped_column(String(120), nullable=False, default="-")
    source_file: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_image_source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    product_image_cached_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    product_image_mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    product_image_last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    product_image_fetch_status: Mapped[str] = mapped_column(String(32), nullable=False, default="none")
    product_image_fetch_error: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # --- Fremdbestand-Felder ---
    # Bestandsart: owned (Eigenbestand, Default) oder rented / borrowed /
    # external. Bestehende Geräte werden durch den Default automatisch als
    # owned behandelt — keine Datenmigration nötig.
    ownership_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="owned", index=True
    )
    # Optionale Quelle (Vermieter / Verleiher / Kunde) — nur für nicht-owned.
    source_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    # Verfügbarkeitsfenster für Fremdbestand. Bei owned IGNORIERT.
    available_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    available_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    return_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Wenn gesetzt, gilt das Gerät als "zurückgegeben" und zählt nicht mehr
    # als verfügbarer Bestand in Planungen.
    returned_at: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    external_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Kompatibilität mit Kartendruckern. Default True = abwärtskompatibel,
    # bestehende Geräte verhalten sich unverändert. Wird in der Planungs-
    # Verfügbarkeitslogik nur ausgewertet, wenn die Planung mindestens einen
    # Kartendrucker fordert UND das Asset Kategorie "Laptop" hat (z. B. um
    # MacBook Neo aus Projekten mit Kartendrucker auszuschließen).
    card_printer_compatible: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )

    # Globaler Planungs-Ausschluss. Default True = Asset zählt normal in der
    # Einsatzplanung. False = Asset bleibt im Inventar voll sichtbar/bearbeitbar
    # (Checkout/Scan/Detail unverändert), wird aber in der Planungs-
    # Verfügbarkeitsberechnung komplett übersprungen — weder in totalStock noch
    # in usableStock noch in der Konfliktbatchlogik. Beispielanwendung:
    # interne Server-Laptops, die nie für Projekte eingeplant werden dürfen.
    available_for_planning: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )

    # Erwartetes Rückgabedatum eines verliehenen Eigengeräts (Schritt A). Wird
    # beim Checkout gesetzt und beim Checkin wieder geleert. In der Planungs-
    # Verfügbarkeit (planning_repository._is_asset_usable_on_date) blockiert ein
    # verliehenes Eigengerät NUR bis einschließlich dieses Datums — ab dem Tag
    # danach zählt es wieder als planbarer Bestand. Eine eintägige Ausgabe
    # sperrt damit nicht mehr den gesamten künftigen Planungshorizont. Bei
    # Fremdbestand und bei Status 'Verfuegbar' bleibt das Feld ohne Wirkung.
    expected_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # Schritt B: konkrete Verknüpfung zur Einsatzplanung, FÜR die dieses Asset
    # ausgegeben wurde (referenziert PlanningRecord.external_id, "pln-..."). Wird
    # beim Checkout gesetzt (sofern die UI eine Planung mitliefert) und beim
    # Checkin wieder geleert. Die Availability-Berechnung verrechnet ein so
    # zugeordnetes, aktuell verliehenes Gerät als ERFÜLLTEN Bedarf seiner Planung
    # (statt es zusätzlich als Engpass zu zählen). NULL = keine Zuordnung
    # (Altbestand/Freitext-Projekt) → Verhalten wie Schritt A.
    assigned_planning_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Telekompass: kumulierte Anzahl erfasster Telekompass-Buchungen dieses
    # Geräts. Fachlich nur für LTE-Router relevant, das Feld existiert aber an
    # jedem Asset (Default 0 = abwärtskompatibel, kein Datenmigrationsbedarf).
    # WICHTIG: Der Zähler wird AUSSCHLIESSLICH über den dedizierten Telekompass-
    # Endpunkt (telecom_pass_repository) gepflegt — der generische Asset-Upsert
    # rührt ihn nie an, damit ein Bearbeiten/Checkout den Zähler nicht
    # versehentlich überschreibt oder zurücksetzt.
    telecom_pass_booking_count_total: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )


class ActivityRecord(TimestampMixin, Base):
    __tablename__ = "activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(140), nullable=False)
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    timestamp_text: Mapped[str] = mapped_column(String(80), nullable=False)
    asset_external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)


class ReservationRecord(TimestampMixin, Base):
    __tablename__ = "reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    requested_by: Mapped[str] = mapped_column(String(120), nullable=False)
    team: Mapped[str] = mapped_column(String(120), nullable=False)
    period: Mapped[str] = mapped_column(String(120), nullable=False)
    assets: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="Angefragt")
    location: Mapped[str] = mapped_column(String(120), nullable=False)


class MaintenanceRecord(TimestampMixin, Base):
    __tablename__ = "maintenance_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    # asset_name wird in _sync_asset_maintenance_status für die
    # Asset-Zuordnung gefiltert. Index verhindert Full-Table-Scans bei
    # jedem Status-Wechsel eines Defekts.
    asset_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    issue: Mapped[str] = mapped_column(Text, nullable=False)
    reported_at: Mapped[str] = mapped_column(String(80), nullable=False)
    due_date: Mapped[str] = mapped_column(String(80), nullable=False)
    priority: Mapped[str] = mapped_column(String(32), nullable=False, default="Mittel")
    # status wird im Board und im Sync-Pfad gefiltert (Offen / In Bearbeitung
    # / Erledigt) — Index hilft bei der Filterung der aktiven Items.
    status: Mapped[str] = mapped_column(String(64), nullable=False, default="Offen", index=True)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    location: Mapped[str] = mapped_column(String(120), nullable=False)


class LocationRecord(TimestampMixin, Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    capacity: Mapped[str] = mapped_column(String(64), nullable=False)
    assigned_assets: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_assets: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    manager: Mapped[str] = mapped_column(String(120), nullable=False)


class CategoryRecord(TimestampMixin, Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    normalized_name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    is_standard: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    default_image_source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    default_image_cached_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    default_image_mime_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    default_image_last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    default_image_fetch_status: Mapped[str] = mapped_column(String(32), nullable=False, default="none")
    default_image_fetch_error: Mapped[str | None] = mapped_column(String(255), nullable=True)


class UserRecord(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(64), nullable=False, default="Mitarbeiter")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Serverseitige Session-Invalidierung (Security-Audit Paket B2):
    # Ein Auth-Token gilt nur, solange seine eingebettete token_version mit
    # diesem Wert uebereinstimmt. Erhoehen invalidiert alle bestehenden Tokens
    # des Benutzers (Logout, Passwortwechsel, Rollenwechsel, Deaktivierung).
    token_version: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_active: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Aktiv")
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Signaturfarbe (Einsatzplanung/Kalender): einmal vergeben, dann stabil.
    # source = 'auto' (Vergabe/Backfill) oder 'manual' (Admin) — die Automatik
    # überschreibt 'manual' nie. Beide nullable → Altdaten/Backups kompatibel.
    signature_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    signature_color_source: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # --- Security-/Login-Metadaten (Security-Paket „supman") ---
    # Alle nullable bzw. mit Default 0, damit Bestandsdaten und alte Backups
    # ohne diese Felder unverändert funktionieren. "Registriert am" ist das
    # vorhandene created_at (TimestampMixin) — bewusst keine neue Spalte.
    failed_login_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # Temporäre Brute-Force-Sperre (läuft automatisch ab). NICHT zu verwechseln
    # mit dem administrativen Status "Gesperrt" (manuell, bis zum Entsperren).
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_login_user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PlanningRecord(TimestampMixin, Base):
    __tablename__ = "planning"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    customer_name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    project_name: Mapped[str] = mapped_column(String(180), nullable=False, index=True)
    event_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    project_manager_user_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.external_id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Optionaler On-Site-Verantwortlicher (vor Ort) - unabhaengig vom
    # Projektverantwortlichen; derselbe Benutzer darf beides sein. Rein
    # organisatorisches Feld ohne Einfluss auf Verfuegbarkeit/Konflikte.
    on_site_responsible_user_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("users.external_id", ondelete="SET NULL"), nullable=True, index=True
    )
    calendar_week: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Entwurf", index=True)
    template_source_planning_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Rückgabe-Puffer (0-3 Tage). Verlängert AUSSCHLIESSLICH das Blockier-Fenster
    # über den Rückgabetag hinaus (Rücktransport/Abbau/verspätete Rückgabe) — das
    # normale Projektfenster [start, end) und der Eigenbedarf bleiben unverändert.
    # Default 0 = exakt bisheriges Verhalten. Siehe planning_repository.
    return_buffer_days: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )


class PlanningDayRecord(TimestampMixin, Base):
    __tablename__ = "planning_days"
    __table_args__ = (UniqueConstraint("planning_id", "planning_date", name="uq_planning_days_planning_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    planning_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("planning.id", ondelete="CASCADE"), nullable=False, index=True
    )
    planning_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    weekday: Mapped[str] = mapped_column(String(16), nullable=False)


class PlanningItemRecord(TimestampMixin, Base):
    __tablename__ = "planning_items"
    __table_args__ = (UniqueConstraint("planning_day_id", "category_key", name="uq_planning_items_day_category"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    planning_day_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("planning_days.id", ondelete="CASCADE"), nullable=False, index=True
    )
    category_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    qty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    handover_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    linked_planning_external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    handover_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class HardwareImportRunRecord(Base):
    __tablename__ = "hardware_import_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="running")
    import_path: Mapped[str] = mapped_column(String(255), nullable=False)
    files_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    files_processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rows_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    details_json: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)


class HardwareImportRowErrorRecord(Base):
    __tablename__ = "hardware_import_row_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sheet_name: Mapped[str] = mapped_column(String(128), nullable=False, default="Sheet1")
    row_number: Mapped[int] = mapped_column(Integer, nullable=False)
    serial_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    raw_data: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class UpdateNoteRecord(TimestampMixin, Base):
    """Schritt E: admin-pflegbare Versionshinweise (Update-Notes).

    Ersetzt die statische ``updateNotes.ts`` als Datenquelle. Mehrere Notes
    dürfen existieren (Historie); ``latest`` ist die veröffentlichte Note mit
    dem höchsten ``published_at``. Die statische Datei bleibt im Frontend als
    Fallback erhalten.
    """

    __tablename__ = "update_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    note_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Liste von Bulletpoints (Strings) — JSON wie ReservationRecord.assets.
    items_json: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LabelAuditSessionRecord(TimestampMixin, Base):
    """Serverseitige Prüfrunde der Admin-Seite "Label-Prüfung".

    Reines Audit-/Lese-Werkzeug: Eine Prüfrunde bündelt das physische
    Abscannen frisch beklebter QR-Labels. Es werden AUSSCHLIESSLICH eigene
    Audit-Tabellen geschrieben — niemals echte Hardwaredaten (Asset-Status,
    Planung, Defekte, Reservierungen) verändert.

    status: ``active`` (laufende Runde) oder ``archived`` (abgeschlossen). Es
    gibt konzeptionell höchstens eine aktive Runde; beim Start einer neuen
    Runde werden bestehende aktive Runden archiviert.
    """

    __tablename__ = "label_audit_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # external_id des anlegenden Benutzers (nur Audit-Spur, kein FK-Enforcement).
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class LabelAuditScanRecord(Base):
    """Einzelner Scan innerhalb einer Prüfrunde.

    ``scan_kind``: ``matched`` (Asset erkannt, erstmals geprüft), ``duplicate``
    (Asset in dieser Runde erneut gescannt), ``unknown`` (QR-Code/Wert keinem
    Asset zuzuordnen — nur der Rohwert wird gespeichert) oder ``corrected``
    (ein zuvor unbekannter Scan wurde von einem Admin nachträglich einem Asset
    zugeordnet).

    Stabilität über Reimport hinweg: Neben der volatilen ``asset_id``
    (Asset-external_id zum Scan-Zeitpunkt) wird ``asset_stable_key`` gespeichert
    (Seriennummer → Inventarnummer → Fallback asset.id, normalisiert). Ändert
    sich die asset.id durch einen Reimport, bleibt die Prüfung über den stabilen
    Key wieder zuordenbar.

    Admin-Korrektur (Soft-Delete statt Hard-Delete): Falsche/doppelte Scans
    werden über ``ignored_at`` aus der Auswertung genommen, nicht gelöscht. So
    bleibt die Audit-Spur erhalten und lässt sich rückgängig machen. Es werden
    AUSSCHLIESSLICH diese Audit-Felder verändert — niemals echte Hardwaredaten.
    """

    __tablename__ = "label_audit_scans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    session_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("label_audit_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scan_value: Mapped[str] = mapped_column(String(512), nullable=False)
    scan_kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    asset_stable_key: Mapped[str | None] = mapped_column(String(256), nullable=True, index=True)
    asset_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    serial_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    tag_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    scanned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    scanned_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Freie Notiz eines Admins zu diesem Scan (Audit-Spur).
    note: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Soft-Delete / Ignorieren: gesetzt = Scan zählt nicht mehr in die Summary.
    ignored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ignored_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ignore_reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # Nachträgliche Korrektur (z. B. unknown → Asset zugeordnet).
    corrected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    corrected_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    correction_note: Mapped[str | None] = mapped_column(String(256), nullable=True)


class RolePermissionRecord(Base):
    """Persistente, admin-editierbare Rollen-Rechte (Feature „Rollen & Rechte").

    Je gewährtem Recht eine Zeile ``(role_key, permission_key)``. Die Tabelle
    wird beim Startup mit Defaults geseedet (nur wenn leer), die das bisherige
    hartkodierte Verhalten 1:1 abbilden. ``role_key`` entspricht der
    normalisierten Rolle aus ``AccessContext.role``; es werden keine neuen
    Rollen eingeführt. Diese Tabelle ersetzt keine Hardwaredaten — sie steuert
    ausschließlich Berechtigungen.
    """

    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role_key", "permission_key", name="uq_role_permissions_role_perm"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    role_key: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    permission_key: Mapped[str] = mapped_column(String(64), nullable=False)


class QrCodeGroupRecord(TimestampMixin, Base):
    """Sammel-QR ("Sammel-QR") für eine Gruppe bereits vorhandener Assets.

    Eine Gruppe bündelt mehrere echte Einzel-Assets (typisch Fremdbestand, z. B.
    70 Miet-iPads) hinter einem einzigen QR-Code als schnellem Buchungseinstieg.
    Sie erzeugt KEINEN eigenen Bestand: gebucht werden immer die echten Assets
    über den bestehenden Ausgabe-/Rücknahme-Pfad (wms_repository.upsert_asset).
    Die Einsatzplanung liest ausschließlich AssetRecord und sieht diese Tabellen
    nie — daher kann durch eine Gruppe weder doppelter Bestand noch doppelte
    Planungszählung entstehen.

    ``qr_token`` ist der im QR-Code kodierte, zufällige Wert; der Scan-Wert
    lautet ``GROUP:<qr_token>`` und ist damit eindeutig vom Einzel-Asset-Format
    ``WMS|<id>|<tag>`` unterscheidbar.
    """

    __tablename__ = "qr_code_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    # Im QR-Code kodierter Token; Scan-Wert ist "GROUP:<qr_token>".
    qr_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    # Kanonische Kategorie der Gruppe (einkategorig — macht den Mengen-Dialog
    # eindeutig). Reine Anzeige/Filter-Hilfe; verändert keinen Bestand.
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    # Informative Bestandsart (rented/borrowed/external) der Mitglieder.
    stock_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    # external_id des anlegenden Benutzers (nur Audit-Spur, kein FK-Enforcement).
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)


class QrCodeGroupMemberRecord(Base):
    """Zuordnung einer Gruppe zu einem vorhandenen Asset.

    Referenziert ``AssetRecord.external_id`` als String (kein harter FK,
    konsistent mit ``assigned_planning_id`` / Activity-Referenzen). Bei der
    Auflösung werden Mitglieder live gegen vorhandene Assets gejoint; auf ein
    gelöschtes Asset zeigende Mitglieder werden defensiv übersprungen.
    """

    __tablename__ = "qr_code_group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "asset_external_id", name="uq_qr_group_members_group_asset"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    group_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("qr_code_groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    asset_external_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)


class HandoverExecutionRecord(TimestampMixin, Base):
    """Audit-/Protokollzeile einer automatischen Projektübergabe (Asset A→B).

    Eine Zeile je übergebenem Asset. Quelle der Wahrheit für die exakte
    Wiederherstellung (Undo) und für die lückenlose Protokollierung. Es werden
    nur Verweise gespeichert (Asset-/Planning-external_ids), kein harter FK —
    konsistent mit ``assigned_planning_id`` / Activity-Referenzen.

    Doppel-Ausführungs-Schutz: partieller Unique-Index auf ``asset_external_id``
    nur für ``status='active'`` → höchstens EINE aktive Übergabe je Asset. Ein
    konkurrierender Zweit-Insert (Race / mehrere Worker) schlägt mit
    IntegrityError fehl und wird im Service übersprungen.
    """

    __tablename__ = "handover_executions"
    __table_args__ = (
        Index(
            "uq_handover_active_per_asset",
            "asset_external_id",
            unique=True,
            sqlite_where=text("status = 'active'"),
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    # Execution-Kennung: gruppiert alle Transfers EINES Laufs (auto oder manuell).
    batch_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    asset_external_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(120), nullable=False)
    source_planning_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_planning_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Vorwerte für exaktes Undo.
    prev_assigned_planning_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    prev_expected_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    prev_assigned_to: Mapped[str] = mapped_column(String(120), nullable=False, default="-")
    prev_next_return: Mapped[str] = mapped_column(String(120), nullable=False, default="-")
    executed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # None = automatisch durch den Scheduler (System), sonst external_id des Admins.
    executed_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    undone_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    undone_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class SystemSettingRecord(TimestampMixin, Base):
    """Globale, admin-pflegbare Key/Value-Systemeinstellungen.

    Generischer Key/Value-Store für einzelne globale Konfigurationswerte (z. B.
    den Telekompass-Preis pro Buchung unter dem Key ``telecom_pass_unit_price``).
    Werte werden als String gespeichert und beim Lesen typisiert interpretiert.
    Fehlt ein Key, gilt der jeweilige Default im Service — Altinstallationen und
    Backups ohne diesen Wert funktionieren damit unverändert weiter.
    """

    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    key: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")


class SecurityEventRecord(TimestampMixin, Base):
    """Persistentes Security-/Auth-Audit-Log (Vorfall „supman").

    Eine Zeile je sicherheitsrelevantem Ereignis (Login, Registrierung,
    Admin-Aktion an Benutzern, Backup-Export/-Import, ...). Zweck:
    Nachvollziehbarkeit — wer hat wann von wo was versucht/getan.

    Bewusst NIEMALS gespeichert: Passwörter, Passwort-Hashes, Tokens,
    Cookies, Authorization-Header. ``entered_identifier`` ist nur die
    normalisierte E-Mail-/Benutzername-Eingabe, ``meta_json`` enthält
    ausschließlich unkritische Zusatzinfos (z. B. Grund-Codes).

    Diese Tabelle wird absichtlich NICHT in den Backup-Export aufgenommen:
    das Forensik-Log soll einen (destruktiven) Restore überleben und nicht
    von ihm überschrieben werden.
    """

    __tablename__ = "security_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="info")
    success: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    user_external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    # Normalisierte Eingabe (E-Mail/Benutzername) — auch bei unbekanntem Konto.
    entered_identifier: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # external_id des ausführenden Admins bei Admin-Aktionen.
    actor_external_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    forwarded_for: Mapped[str | None] = mapped_column(String(255), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    http_method: Mapped[str | None] = mapped_column(String(8), nullable=True)
    path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    origin: Mapped[str | None] = mapped_column(String(255), nullable=True)
    referer: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Sicherer Grund-Code, z. B. invalid_password / inactive_user / unknown_user
    # / rate_limited — nie die Fehlermeldung selbst.
    reason_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class PlanningEventRecord(TimestampMixin, Base):
    """Fachliches Audit-Log je Planung (Historie-Tab der Planungs-Detailseite).

    Eine Zeile je Ereignis: Planung erstellt, Status/Zeitraum/Menge geändert,
    Position hinzugefügt/entfernt, Notiz hinzugefügt, Ausgabe/Rückgabe erfasst.
    ``payload_json`` trägt die strukturierten Details (alt/neu-Werte,
    Kategorie, Inventarnummer, Notiztext) — keine Secrets. Verweist wie üblich
    nur über ``planning_external_id`` (kein harter FK). Im Gegensatz zu
    ``security_events`` sind das Geschäftsdaten; bestehende Planungen starten
    mit leerer Historie (kein Backfill).
    """

    __tablename__ = "planning_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    planning_external_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # external_id des ausführenden Benutzers (None bei System-Vorgängen).
    actor_external_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class TelecomPassBookingRecord(Base):
    """Verlaufseintrag der Telekompass-Erfassung bei einer LTE-Router-Rückgabe.

    Eine Zeile je erfasster Telekompass-Menge zu einer Rückgabe (kind=``booking``)
    bzw. je Admin-Korrektur des Zählers (kind=``correction``). Hält die Menge
    sowie den Preis-Snapshot fest, damit nachvollziehbar bleibt, zu welchem Preis
    und bei welcher Rückgabe gezählt wurde. Verweist nur über
    ``asset_external_id`` (kein harter FK — konsistent mit anderen Referenzen).

    Idempotenz: ``idempotency_key`` ist — sofern gesetzt — eindeutig. Ein erneut
    gesendeter Rückgabe-Request mit demselben Key erhöht den Zähler NICHT erneut
    (Schutz vor Doppel-Submits/Retries). Admin-Korrekturen lassen den Key leer.
    """

    __tablename__ = "telecom_pass_bookings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    asset_external_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # Optionaler Planungsbezug (PlanningRecord.external_id) der Rückgabe.
    planning_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Preis-Snapshots als String (dezimalgenau, unabhängig von Float-Rundung).
    unit_price_snapshot: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    total_price_snapshot: Mapped[str] = mapped_column(String(32), nullable=False, default="0")
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="booking", index=True)
    idempotency_key: Mapped[str | None] = mapped_column(
        String(64), nullable=True, unique=True, index=True
    )
    created_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )


class LoginBackgroundRecord(TimestampMixin, Base):
    """Admin-verwaltete Hintergrundbilder der (öffentlichen) Login-Seite.

    Neue Tabelle → wird beim Startup per ``Base.metadata.create_all`` angelegt
    (kein Spalten-Patch nötig). Die eigentlichen Bilddateien liegen im
    persistenten Volume unter ``app/data/login_backgrounds/`` (analog zum
    Produktbild-Cache) — hier stehen nur die Metadaten. Genau EIN Datensatz
    darf ``is_active`` sein; die öffentliche Login-Seite lädt diesen.
    """

    __tablename__ = "login_backgrounds"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    # Gespeicherter Dateiname im Volume (nicht erratbar, .webp). Getrennt vom
    # ursprünglichen Upload-Namen, der nur zur Anzeige dient.
    file_name: Mapped[str] = mapped_column(String(128), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False, default="image/webp")
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    height: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Denormalisiert für die Audit-Anzeige „hochgeladen von" — überlebt auch das
    # spätere Löschen/Deaktivieren des Benutzers.
    uploaded_by_user_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    uploaded_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
