from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
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
    calendar_week: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="Entwurf", index=True)
    template_source_planning_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


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
