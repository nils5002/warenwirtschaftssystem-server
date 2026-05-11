# MASTER_AUDIT.md

Stand: 2026-05-11
Geltungsbereich: gesamtes Repository `warenwirtschaftssystem-server`
Quelle: Senior-Entwickler-Audit auf Basis von Code-Read, PROJECT_CONTEXT.md, AGENTS.md, RBAC_MATRIX.md, vorhandenen Tests.

Diese Datei ist eine reine Doku. Sie ändert keinen Code, keine Schemata und keinen Betrieb. Sie ist die zentrale Anlaufstelle für „was haben wir, was funktioniert, was nicht anfassen, was als nächstes verbessern".

---

## 1. Ziel des Systems

Hardware-Warenwirtschaft für **Akkreditierungsprojekte**. Kein komplexes ERP, kein Asset-Management-Framework, sondern eine alltagstaugliche Anwendung für:

- Geräte (z. B. Laptops, iPads, Handhelds, Drucker, Switches, Router) verwalten — Bestand, Status, QR-Code.
- Hardware **projektbezogen planen** mit Availability- und Engpassanzeige.
- Geräte per QR-Code auf **Person + Projekt** ausgeben und zurücknehmen.
- Defekte/Wartung **vereinfacht** abbilden (Offen / In Bearbeitung / Erledigt).
- Fremdbestand (Miet-/Leih-/Externe Geräte) zeitfenster-genau einbinden.
- Backup/Restore und Excel-Upload-Import unterstützen.

Die UX folgt dem Prinzip „weniger ist mehr". Mobile Nutzung ist nicht optional — sie ist Pflicht, weil die operativen Rollen das Tool im Lager am Telefon nutzen.

---

## 2. Aktueller Architekturüberblick

### Backend (`backend/app/`)

Saubere Schicht-Trennung, FastAPI + SQLAlchemy + SQLite:

- `routes/` — HTTP-Endpunkte; alle WMS-Routen unter Prefix `/api/wms`. Auth/Backup/Planning/Health/Jobs als eigene Router. Router-Einstieg in `routes/__init__.py`.
- `services/` — Fachorchestrierung. `wms_service.py` (dünner Orchestrator), `planning_service.py`, `auth_service.py`, `backup_service.py`, `upload_import_service.py`, `hardware_import/` (Excel-Pipeline).
- `repositories/` — CRUD pro Aggregat: `asset_repository`, `category_repository`, `planning_repository`, `wms_repository`, `hardware_import_repository`. Hier liegt der Großteil der Fachlogik.
- `database/` — Engine, Session, ORM-Modelle (`database/models.py`), Idempotenter Init-DB-Pfad.
- `schemas/` — Pydantic-Schemas (`schemas/wms.py`, `schemas/planning.py`, `schemas/auth.py`, `schemas/job.py`, `schemas/backup.py`, `schemas/hardware_import.py`, `schemas/asset.py`). Module `app/models.py` und `app/wms_models.py` sind nur Legacy-Re-Exports.
- `domain/` — Stammwerte; kanonische Kategorien + Alias-Map in `domain/categories.py`.
- `config/settings.py` — pydantic-settings, env-getrieben (`AUTH_TOKEN_SECRET`, `DATABASE_URL`, `WMS_SEED_LEGACY_ON_STARTUP`, `INITIAL_ADMIN_*` etc.).

Migrationsbasis:
- 5 Alembic-Versionen in `backend/alembic/versions/`.
- Parallel: `database/session.py:_ensure_new_columns` + `_ensure_hot_path_indexes` für Hot-Patches.
- Parallel: `app/main.py:on_startup` für punktuelle `ALTER TABLE`s.

### Frontend (`frontend/src/`)

React 18 + TypeScript + Vite + Tailwind:

- `App.tsx` — Auth-Boot, Mounting der `LoginPage` oder des authentifizierten Layouts, neuer `UpdateNotesModal`.
- `hooks/useWmsController.ts` — zentraler Daten- und Mutations-Stapel. Hält den App-State, Polling, Mutationen, Routing-Sync.
- `services/wmsApi.ts` — REST-Client gegen `/api/...`. Auth-Header, Project-Context-Header, Access-Persistierung in localStorage.
- `asset-ui/pages/` — Page-Komponenten: `AssetsPage`, `PlanningPage`, `PlanningCalendarAddOn`, `CheckinCheckoutPage`, `MaintenancePage`, `ReservationsPage`, `BackupPage`, `CategoriesPage`, `UsersPage`, `LocationsPage`, `ImportExportPage`, `QrFunctionsPage`, `MassPrintPage`, `MobileDashboardPage`, `AssetDetailPage`, `DashboardPage`, `ExternalPoolPage`.
- `asset-ui/components/` — UI-Bausteine (Sidebar, Topbar, StatusBadge, QR-Scanner, QuickView, KpiCard).
- `components/` — Auth, Dialogs, Loading, plus zentrale Page-Switch-Komponente `WmsPageView.tsx`.
- `routing/appRoutes.ts` — Sehr leichtgewichtiges Routing über `history.replaceState`/`popstate`.
- `asset-ui/updateNotes.ts` + `asset-ui/components/UpdateNotesModal.tsx` — versions-gesteuertes „Was ist neu?"-Modal mit `localStorage`-Key `wms.lastSeenUpdateVersion`.

### Zentrale Datenflüsse

1. **Login**: `POST /api/auth/login` → HMAC-SHA256-signiertes Token (kein echter JWT, eigenes Format `<payload>.<sig>`), 12 h gültig.
2. **Boot**: `App.tsx` validiert per `GET /api/auth/me`; Mount-First-Login zeigt das `UpdateNotesModal`, wenn `wms.lastSeenUpdateVersion ≠ updateNotes.version`.
3. **Daten-Refresh**: `useWmsController` lädt nach Login `GET /api/wms/overview` und pollt es alle 15 s. Polling ist nicht `isLoading`-laut, damit die UI nicht flackert.
4. **Mutationen** (CRUD, Checkout, Checkin, Planning-Speichern, Backup, Defekt) → REST → DB → anschließend `loadWms()` → State-Refresh.
5. **Planung-Verfügbarkeit**: separater Endpunkt `GET /api/wms/planning/{id}/availability` mit datums-/kategorie-aufgelöster Auswertung (`PlanningPage` zeigt sie im Detail-Modal).
6. **Batch-Scan** (Ein-/Auslagerung): Scan → lokal validieren und in `checkoutQueue` / `checkinQueue` pushen → ein Submit ruft `onCheckout`/`onCheckin` sequenziell pro Queue-Eintrag. Keine Backend-API-Erweiterung.

---

## 3. Fachliche Kernlogik

### Inventar
- `AssetRecord` trägt Kernfelder + Indizes (`status`, `category`, `qr_code`, `tag_number`, `serial_number`).
- Kanonischer Statussatz wird über `_normalize_asset_status` zentriert. Legacy-Werte (`Reserviert`, `Ausgegeben`, `Unterwegs`, `Verloren`) werden automatisch auf den fachlichen 4er-Satz reduziert.
- QR-Code wird beim Save automatisch erzeugt, falls fehlend: Format `WMS|<external_id>|<tag_number>`.

### Einsatzplanung
- Datenmodell: `PlanningRecord → PlanningDayRecord → PlanningItemRecord`. Cascading Delete, Unique-Constraints `(planning_day_id, category_key)` und `(planning_id, planning_date)`.
- `planning_repository.get_planning_availability` rechnet pro (Tag, Kategorie) Bestand, andere Planungen, Handover-Verrechnung, `shortage_after_handover_qty`. Status-Farben `green/yellow/red`.
- `get_open_conflict_summaries_for_plannings` ist die Batch-Variante für die Planungsliste + Overview (liefert `count` und `missingItems`).
- `_build_planning_summary` aggregiert „heute" + „nächste 7 Tage" für die Dashboard-/Overview-Kacheln.

### Ausgabe/Rücknahme
- Endpunkt: `POST /api/wms/assets`. Mitarbeiter/PM dürfen ausschließlich `Verfügbar↔Verliehen`-Statuswechsel, kontrolliert über `_movement_only_allowed`. Stammdatenänderung in dieser Rolle ist gesperrt.
- Activity-Eintrag mit Operator-Label entsteht automatisch in `upsert_asset`, wenn Statuswechsel der Movement-Klasse erkannt wird.
- Frontend: `CheckinCheckoutPage.tsx` mit Mode-Tabs „Ausgabe" / „Rücknahme", Scan-Queue (Batch), Projekt-Picker als Bottom-Sheet auf Mobile, sticky Submit-Button.

### Defekte / Wartung
- Workflow: `Offen → In Bearbeitung → Erledigt`. „Erledigt" gibt das Asset nur frei, wenn kein weiterer aktiver Maintenance-Satz auf das Gerät matcht. Implementiert in `_sync_asset_maintenance_status`. Mit Test `test_maintenance_locks_asset_…` abgesichert.

### Kategorien
- Kanonische Liste in `domain/categories.py` (12 Werte: Laptop, iPad, Handheld, Smartphone, QR-Code-Scanner, Drucker, Kartendrucker, Switch, Router, LTE-Router, Zubehör, Sonstiges).
- `_CATEGORY_ALIASES` mappt Synonyme („Notebook" → Laptop, „Tablet" → iPad, …).
- `category_repository.create_category` blockt Synonyme über `category_hint`. CategoryRecord hat unique `normalized_name`.
- Unklare Kategorie → `Zuordnung erforderlich`, nicht blind `Sonstiges`.

### Fremdbestand (Miet-/Leih-/Externe Geräte)
- Erweiterung am bestehenden `AssetRecord`: `ownership_type` (`owned`/`rented`/`borrowed`/`external`), `source_name`, `available_from`, `available_until`, `return_due_date`, `returned_at`, `external_note`.
- Datums-Verfügbarkeit über `_is_asset_usable_on_date`: Eigenbestand immer, Fremdbestand nur im Fenster.
- `POST /api/wms/assets/external-pool` (Admin + PM): legt eine Charge an.
- `POST /api/wms/assets/{id}/mark-returned` (Admin + PM): markiert Fremdbestand als zurückgegeben — verweigert, solange Asset noch `Verliehen` ist.

### Backup/Restore
- `GET /api/wms/backup/export` (Admin) liefert vollständiges JSON inkl. Categories, Users (mit `passwordHash`), Assets (mit Fremdbestand- und QR-Feldern), Activities, Reservations, Maintenance, Locations, Plannings (mit Handover-Links).
- `POST /api/wms/backup/import` validiert das Schema, normalisiert Status- und Planungswerte und committed in einer Transaktion (Rollback bei `IntegrityError` und Fehlern).
- `POST /api/wms/backup/reset-for-import` löscht systematisch, behält aber mindestens einen aktiven Admin. Standardkategorien werden re-geseedet.

### QR-Code-Stabilität
- QR-Code wird einmal beim Save erzeugt (`_build_qr_code(id, tag)`) und ist persistent in `assets.qr_code` (indiziert).
- `resolveAssetByScan` im Frontend findet Geräte tolerant per QR-Code, Tag-Number oder Serial-Number.

---

## 4. Was gut gelöst ist

1. **Klare Schicht-Trennung** im Backend (routes → services → repositories → database).
2. **Wartungs-Verriegelung** `_sync_asset_maintenance_status` ist nachweislich korrekt und mit Test abgesichert. Asset wird nur freigegeben, wenn kein anderer aktiver Defekt mehr existiert.
3. **Kategorie-Normalisierung** über Aliasmap + `normalized_name`-Unique-Constraint verhindert Doubletten zuverlässig.
4. **Initial-Admin-Lockout-Schutz**: `ensure_initial_admin` legt aus ENV den Admin an, `clear_data_for_import` behält mindestens einen aktiven Admin.
5. **Fremdbestand am bestehenden AssetRecord** statt parallelem Modell — kein doppeltes Inventar.
6. **Batch-Scan wiederverwendet vorhandene API** (`onCheckout`/`onCheckin` pro Eintrag), kein paralleler Backend-Pfad.
7. **Hot-Path-Indizes** auf `status`, `category`, `qr_code`, `tag_number`, `serial_number`, `maintenance.asset_name`, `maintenance.status`.
8. **Volume-Persistenz mit ausdrücklicher Pfad-Warnung** in `.env.example` und `docker-compose.yml` (SQLite-„4-Slashes"-Falle).
9. **RBAC-Tests** auf API-Ebene decken die kritischen Verbote ab.
10. **Polling statt WebSocket** ist für die Größenordnung pragmatisch und stabil; UI-Layout-Springen ist bewusst verhindert.

---

## 5. Fachliche Risiken

1. **Zwei parallele Schreibpfade ändern den Asset-Status**: `upsert_asset` (Movement) und `_sync_asset_maintenance_status` (Wartung) — bei „Defekt während Ausgabe"-Szenarien laufen sie konkurrierend, kein expliziter Test dafür.
2. **Polling-Race** alle 15 s vs. lokaler Eingabe: theoretisch kann ein Refresh lokale, gerade gescannte Werte überschreiben.
3. **Activity-Log entsteht nur in `upsert_asset`-Movement-Pfad**. Wartungs-/Fremdbestand-Statuswechsel (z. B. `mark_asset_returned`, `_sync_asset_maintenance_status`) erzeugen keinen Activity-Eintrag → Audit-Lücke.
4. **`assigned_to` als Freitext-String** (`"<Person> · <Projekt>"`) wird zur Laufzeit geparst (`_extract_checkout_assignee_and_project`); fragil bei Namen mit `·`.
5. **Datumsfelder als Text** in `next_return`, `last_checkout`, `due_date`, `reported_at`, `timestamp_text` → keine verlässlichen Range-Queries.
6. **Konflikt-Definition zählt „pro (Planung, Tag, Kategorie)"** — ein 30-Tage-Engpass = 30 Konflikte, gefühlte Inflation.
7. **Planning-Update last-write-wins**, kein optimistic locking. Zwei PMs überschreiben sich.
8. **`require_project_scope`** wird kaum durchgesetzt — RBAC-Doku verspricht „Mitarbeiter nur mit Projektkontext", Backend lässt es heute oft durch.
9. **`IntegrityError`-Response leakt SQLite-interne Texte** (`UNIQUE constraint failed: assets.tag_number`).

---

## 6. Technische Schulden

1. **Drei parallele Migrationsquellen**: Alembic + `_ensure_new_columns` + `on_startup`-Schema-Patches. Drift wahrscheinlich.
2. **Monolithische Frontend-Files**: `PlanningPage.tsx` ~2900 Zeilen, `AssetsPage.tsx` ~1589 Zeilen, `useWmsController.ts` 1206 Zeilen.
3. **TypeScript-Fehler bei `tsc --noEmit`**: ~15 bestehende, u. a. `String.prototype.replaceAll` ohne ES2021-Target, `LoadingButton`-Ref ohne `forwardRef`, `Record<AppPage, ...>` ist nicht vollständig (`externalPool` fehlt im Topbar-Type). Build bleibt grün, weil Vite/SWC nicht typecheckt.
4. **`tsconfig.node.json` target=ES2020**, Code nutzt ES2021-APIs.
5. **Doppelte Demand/Stock-Berechnung** an drei Stellen (`get_planning_availability`, `get_open_conflict_summaries_for_plannings`, `_build_planning_summary`).
6. **`/api/wms/overview` als „Alles-in-Einem"** mit 15-s-Poll — skaliert nicht für viele tausend Assets, kein ETag.
7. **Auth-Token ist Eigenbau** (kein `alg`-Header, kein Standardlib); konservativ implementiert, aber dokumentationsbedürftig.
8. **Test-Suite zu dünn** in `test_auth_api.py` (2 Tests). Keine Frontend-Tests (Playwright als devDep, aber kein Spec-Ordner).
9. **`logging`-Output ohne Correlation-IDs, ohne strukturierte Logs**; kein Sentry/OTel.

---

## 7. UI/UX-Probleme

1. **Insel-Stellen ohne `dark:`-Variante**: Kategoriewahl-`<select>` (amber-50 hart), Filter-Checkboxen „Nur verfügbare/defekte Assets", Backup-Hinweis-Cards.
2. **„Zuordnung erforderlich"** wird in Inventarlisten wie ein normaler Kategoriewert angezeigt — kein dedizierter Warn-Badge.
3. **Activity-Liste mit textuellen Zeitstempeln** — keine Sortierung, keine relative Anzeige („vor 2 Std.").
4. **Konflikt-Inflation** (siehe Risiken): pro-Tag-pro-Kategorie-Zählung ist für Endnutzer schwer einzuordnen.
5. **Empfänger-Auswahl `assignedTo`** als Freitext mit Datalist → Tippfehler können neue „Personen" erzeugen.
6. **Bulk-Aktionen-Card immer sichtbar** in AssetsPage, auch wenn nichts markiert ist.
7. **Update-Modal ohne Versions-History** — nur das aktuelle `updateNotes` wird gezeigt, keine Archiv-Sicht.

---

## 8. Dinge, die nicht unnötig angefasst werden sollen

Diese Bereiche sind fachlich heikel, gut eingespielt oder funktionieren stabil. Nicht ohne expliziten Auftrag und Test-Netz anfassen:

1. **`_sync_asset_maintenance_status`** — fachlich heikel, getestet.
2. **Kategorie-Normalisierung** (`domain/categories.py` + `category_repository`) — Backbone.
3. **Idempotenter Startup-Seed + Initial-Admin-Lockout-Schutz**.
4. **`_movement_only_allowed`-Guard** in `routes/wms.py` — schützt Mitarbeiter/PM vor versehentlichen Stammdatenänderungen.
5. **Backup-Roundtrip-Logik mit Status-Normalisierung** — getestet inkl. Fremdbestand + Handover.
6. **Eigenbau-Auth-Token** — konservativ und stabil; Wechsel auf python-jose etc. ist Tausch ohne sichtbaren Gewinn.
7. **Vite-Proxy + `npm run dev:local` / `dev:local:fresh`-Skripte** — eingespielt.
8. **15-s-Polling + initial-only `isLoading`** — Layout-Springen ist absichtlich verhindert.
9. **`/api/wms`-Prefix und Routenstruktur** — viele Frontend-Calls hängen davon ab.
10. **Schema-Patches in `main.py` + `database/session.py`** — solange Alembic nicht zur einzigen Wahrheitsquelle gemacht ist, halten sie Production stabil.

---

## 9. Priorisierte Verbesserungen

Die Reihenfolge ist absichtlich risikoarm: erst Dokumentation und kleine Härtungen, dann Tests, dann Refactoring.

### P0 — Dokumentation und Sicherheit

- **P0.1** Diese `docs/MASTER_AUDIT.md` als zentrale Quelle der Wahrheit etablieren.
- **P0.2** `IntegrityError`-Response sanitisieren: kein `str(exc.orig)`-Leak; domänen-gemappter Detail-Text (z. B. „Inventarnummer bereits vergeben").
- **P0.3** RBAC_MATRIX.md auf den Ist-Stand ziehen: Planning ist NICHT scope-gebunden, sondern rollenbasiert; Maintenance darf Mitarbeiter erstellen mit Status-Cap. Lücken explizit markieren.
- **P0.4** `docs/AUTH_TOKEN.md` anlegen (Spezifikation Eigenbau-Token-Format, Begründung).
- **P0.5** `docs/BACKUP_RUNBOOK.md` anlegen — Export, Wipe (mit Admin-Erhalt!), Import, Wiederanlauf, SQLite-„4-Slashes"-Warnung.

### P1 — kleine Stabilitäts-Fixes

- **P1.1** TypeScript-Fehler im Frontend beheben: `replaceAll` ersetzen oder Target auf ES2021 anheben; `LoadingButton` mit `forwardRef`; `Record<AppPage, …>` vervollständigen (`externalPool`).
- **P1.2** Activity-Eintrag auch in `_sync_asset_maintenance_status` und `mark_asset_returned` erzeugen — Audit-Lücke schließen, ohne fachliche Pfade zu ändern.
- **P1.3** `BACKUP_PATH` tatsächlich nutzen: Export zusätzlich auf Disk schreiben (Best-Effort, Browser-Download bleibt).
- **P1.4** `tsc --noEmit` als CI-Gate aufnehmen, sobald die bestehenden Fehler weg sind.
- **P1.5** `clear_data_for_import` zusätzlich `Activities`-Wipe-Verhalten testen (heute deckt der Test nicht alles ab).

### P2 — Tests und zentrale Fachlogik

- **P2.1** Status-Lifecycle-Matrix-Test: Eigenbestand + Fremdbestand × {Verfügbar/Verliehen/Defekt/In Wartung} mit jedem zulässigen Übergang.
- **P2.2** Concurrent-Edit-Test für Planungen: zwei PMs editieren parallel; aktuell last-write-wins dokumentieren oder optimistic locking einführen.
- **P2.3** Token-Ablauf-Test (`Session abgelaufen`-Pfad).
- **P2.4** Performance-Smoke-Test mit synthetisch ~1000 Assets + 50 aktiven Planungen, um Regressionen am Overview-Endpunkt früh zu sehen.
- **P2.5** Frontend-Smoke-Tests (Playwright) für: Login, Inventar lädt, Check-out 1 Gerät, Batch-Check-out 3 Geräte. Kein Vollabdeckungs-Ziel.

### P3 — Strukturrefactoring

- **P3.1** Demand/Stock-Berechnung konsolidieren: ein gemeinsamer Helper für `get_planning_availability`, `get_open_conflict_summaries_for_plannings` und `_build_planning_summary`. Test-Netz P2.1 + Planning-Tests vorher absichern.
- **P3.2** `PlanningPage.tsx` schrittweise nach `pages/planning/`-Unterordner aufteilen (List, Detail-Modal, Calendar, Editor, Availability-Sheet) — ohne Verhaltensänderung.
- **P3.3** `useWmsController.ts` nach Mutations-Bereichen splitten (Assets, Planning, Backup, User) — als kleine Hooks-Sammlung, weiterhin ein Provider.
- **P3.4** `assigned_to` schrittweise strukturieren: zusätzliches `assigned_user_id`-Feld + Migration; Freitext bleibt als Display-Variante.

### P4 — größere technische Modernisierung

- **P4.1** Datumsfelder typisieren: `next_return`, `last_checkout`, `due_date`, `reported_at` von String auf `Date`. Alembic-Migration, Schema-Patches synchron, Frontend-Anpassung. Schrittweise pro Feld.
- **P4.2** `/api/wms/overview` aufteilen oder ETag-fähig machen. Polling-Cadence dynamisch (länger im Hintergrund, kürzer nach Aktion).
- **P4.3** Optimistic-Lock für Planungen (`updated_at`-Echo im PUT-Body, 409 bei Mismatch).
- **P4.4** Migrationsquellen vereinheitlichen: Alembic als alleinige Wahrheitsquelle, Hot-Patches schrittweise abbauen.
- **P4.5** Strukturierte Logs + Correlation-IDs (`X-Request-ID`) + optional Sentry/OTel-Anbindung.

---

## 10. Regeln für zukünftige Codex-Aufgaben

Diese Regeln sind verbindlich, weil das System fachlich heikel und mobil-kritisch ist:

1. **Immer kleine Änderungen.** Eine PR adressiert eine konkrete Sache. Keine Drive-by-Refactorings.
2. **Keine parallelen Refactorings mit Fachlogikänderungen.** Verhalten ändern oder Struktur ändern — nie beides in derselben Änderung.
3. **Tests vor heiklen Umbauten.** Bevor `_sync_asset_maintenance_status`, `get_planning_availability` oder die Schreibpfade von `upsert_asset` angefasst werden: zuerst Tests erweitern, dann ändern.
4. **Keine Full-Rebuilds.** Bestehende Struktur beibehalten. Kein Neuaufsetzen von Modulen, Frameworks oder Layern „aus Prinzip".
5. **Keine unnötige Komplexität.** Keine neuen State-Libraries, kein zusätzliches Cache-Layer, kein gRPC, kein WebSocket „auf Vorrat". Was die Aufgabe nicht zwingend braucht, wird nicht eingebaut.
6. **UI praxisnah halten.** Endnutzer arbeiten am Telefon im Lager. Weniger Felder, klare Buttons, große Touch-Flächen, keine Vollbild-Overlays für inline-Tätigkeiten.
7. **Keine Änderungen an Deployment, Cloudflare, ENV, Secrets oder Docker** ohne explizit dafür formulierten Auftrag.
8. **Kategorien-Domäne ist tabu** außer für gezielte Erweiterungen — Standardliste und Aliasmap sind das Rückgrat des Systems.
9. **Backup-Pfad ist tabu** außer für additive Felder mit Default; nie Felder löschen oder umbenennen.
10. **`/api/wms`-Prefix und Routen-Namen sind tabu** — Frontend-Calls hängen direkt davon ab.
11. **Bei Unklarheit:** PROJECT_CONTEXT.md (Fachlogik) zuerst, dann AGENTS.md (Entwicklungsregeln), dann RBAC_MATRIX.md, dann bestehende Code-Struktur. Bei Konflikt entscheidet die fachliche Korrektheit.

---

## Zusammenfassung

- **Erstellt:** `docs/MASTER_AUDIT.md` (diese Datei). Verzeichnis `docs/` wurde neu angelegt.
- **Keine Codeänderungen.** Kein Backend-, Frontend-, Test- oder Konfigurationsfile wurde verändert. Kein Refactoring, kein Schema-Touch, keine Deployment-/ENV-/Cloudflare-/Secret-/Docker-Änderung.
- **Sinnvolle nächste Dokumentationsdateien** (in dieser Reihenfolge, jede klein und eigenständig):
  1. `docs/STATUS_LIFECYCLE.md` — Asset-Status-Übergangsmatrix als Tabelle (Eigen-/Fremdbestand × {Verfügbar/Verliehen/Defekt/In Wartung}, inkl. Sperren).
  2. `docs/MIGRATIONS.md` — Entscheidungsregel: wann Alembic, wann `_ensure_new_columns`, wann `on_startup`-Patch. Damit die drei Migrationsquellen nicht weiter driften.
  3. `docs/BACKUP_RUNBOOK.md` — Schritt für Schritt Export/Wipe/Import + Wiederanlauf + SQLite-Pfad-Falle.
  4. `docs/AUTH_TOKEN.md` — Spezifikation des Eigenbau-Token-Formats und Begründung.
  5. `docs/RBAC_REALITY.md` (oder direktes Update von `RBAC_MATRIX.md`) — Soll-Doku auf Ist-Stand bringen, Lücken markieren.
  6. `docs/PERFORMANCE_NOTES.md` — Polling-Cadence, Asset-Scan-Stellen, Indizes, Test-Schwellen.
  7. `docs/TESTING.md` — Test-Konvention (cwd `backend`, UUID-Suffixe wegen shared SQLite, fehlende Frontend-Test-Strategie).
  8. `docs/RELEASE_NOTES_HISTORY.md` — Archiv der `updateNotes`-Inhalte pro Version.
  9. `docs/FRONTEND_ARCH.md` — `useWmsController` als zentraler State, Polling, leichtgewichtiges Routing.
  10. `docs/UI_DESIGN_TOKENS.md` — Konsolidierte Übersicht über `surface-card`, `btn-*`, Dark-Mode-Erwartungen.
