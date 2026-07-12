# Hardwareplanung / Einsatzplanung - Integrationskonzept

## 1) Zielbild
- Neues Modul innerhalb der bestehenden WMS-App, kein Rebuild.
- Fokus: Projektmanager plant Bedarfe pro Kunde/Projekt/Zeitraum und sieht sofort Verfügbarkeit + Engpässe.
- Planung bleibt fachlich getrennt von realen Lagerbewegungen (Check-in/Check-out).

## 2) Fachliche Erkenntnisse aus bestehender Excel-Datei
- Quelle: `D:\DEV\cloud_web\Hardwareplannung\Hardwareplanung_2026 STAND 14.04. .xlsx`
- Struktur:
  - Blatt `Bestand` mit Kategorien + Ist-Bestand + Defekt/Nicht nutzbar + nutzbarer Summe.
  - 53 KW-Blätter (`KW 2 ... KW 53`) mit täglicher Bedarfsmatrix (Mo-So) je Hardwarekategorie.
- Typische Kategorien:
  - Laptop, Kartendrucker, Laserdrucker, Thermodrucker, Scanner, Handheld, Ipad, LTE Gateway, Switch, Router.
- Schlussfolgerung:
  - Excel bildet Bedarf + Bestand ab, aber ist unübersichtlich, fehleranfällig und nicht kollaborativ.
  - Die App sollte dieselbe Fachlogik liefern, aber als strukturierte Planungsobjekte mit Live-Prüfung.

## 3) Modulname und Navigation
- Modulname: `Einsatzplanung` (UI-Label).
- Navigation: neuer Haupteintrag zwischen `Kategorien` und `Ein-/Auslagerung`.
- Neuer `AppPage` key: `planning`.

## 4) Projektmanager-Workflow (Soll)
1. Planung anlegen:
   - Kunde
   - Projekt/Veranstaltung
   - Projektmanager (User)
   - Zeitraum (Start/Ende) oder KW-Auswahl
   - Notiz
   - Status `Entwurf`
2. Tagesbedarfe erfassen:
   - pro Tag mehrere Zeilen: Kategorie + Menge
   - schnelle Eingabe via Tagesspalten + Kategoriezeilen
3. Sofortige Auswertung:
   - Gesamtbedarf je Kategorie
   - Tagesbedarf je Kategorie
   - Peak-Tag / Peak-Kategorie
4. Sofortiger Bestandsabgleich:
   - verfügbar/nutzbar je Kategorie
   - bereits verplante Menge im Zeitraum
   - Ampel je Position (grün/gelb/rot)
5. Planung speichern und später:
   - bearbeiten
   - duplizieren (als Vorlage)
   - Status wechseln (`Entwurf -> Geplant -> Bestätigt -> Abgeschlossen`)

## 5) Datenmodell (Backend)
### 5.1 Tabellen
- `planning`
  - `id` (pk)
  - `external_id` (string, unique, z. B. `pln-...`)
  - `customer_name` (string)
  - `project_name` (string)
  - `event_name` (nullable string)
  - `project_manager_user_id` (nullable, FK auf users.external_id)
  - `start_date` (date)
  - `end_date` (date)
  - `calendar_week` (nullable int)
  - `year` (int)
  - `status` (enum/text: Entwurf, Geplant, Bestaetigt, Abgeschlossen, Storniert)
  - `notes` (text)
  - `template_source_planning_id` (nullable string)
  - `created_at`, `updated_at`

- `planning_day`
  - `id` (pk)
  - `planning_external_id` (FK-like auf planning.external_id, index)
  - `day_date` (date, index)
  - `weekday` (string/int)
  - unique(`planning_external_id`, `day_date`)

- `planning_item`
  - `id` (pk)
  - `planning_day_id` (FK)
  - `category` (string, index)
  - `quantity` (int, >= 0)
  - `notes` (nullable text)
  - unique(`planning_day_id`, `category`)

### 5.2 View/Projection (API)
- `planning_availability_snapshot` (nicht zwingend als DB-View, kann Service-DTO sein):
  - `category`
  - `requested_qty`
  - `total_stock_qty`
  - `usable_stock_qty`
  - `already_planned_qty` (gleicher Tag/Zeitraum, andere Planungen)
  - `remaining_qty`
  - `risk_level` (`ok|warning|critical`)

## 6) Verfügbarkeits- und Warnlogik
### 6.1 Definitionsvorschlag
- `total_stock_qty`:
  - Anzahl Assets je Kategorie insgesamt (ohne Filter).
- `usable_stock_qty`:
  - Assets je Kategorie ohne Status `Defekt` und ohne `In Wartung`.
- `already_planned_qty`:
  - Summe bestätigter/aktiver Planmengen (`Geplant`, `Bestaetigt`) aus anderen Planungen, die denselben Tag betreffen.
- `available_for_day`:
  - `usable_stock_qty - already_planned_qty`.
- `remaining_qty`:
  - `available_for_day - requested_qty`.

### 6.2 Ampel
- `grün` (`ok`): `remaining_qty >= 2` oder `>=10%` Reserve.
- `gelb` (`warning`): `remaining_qty` zwischen `0` und Schwellenwert.
- `rot` (`critical`): `remaining_qty < 0` (Überbuchung).

## 7) UI-Struktur (Desktop-first)
### 7.1 Planungsübersicht (Liste)
- Filter: Zeitraum, Kunde, PM, Status.
- Spalten:
  - Kunde, Projekt, Zeitraum/KW, PM, Status, letzte Änderung.
- Aktionen:
  - Öffnen
  - Duplizieren
  - Status ändern
  - Archivieren/Stornieren

### 7.2 Planungsdetail (Editor)
- Kopfbereich:
  - Kunde/Projekt/PM/Zeitraum/Status/Notiz.
- Hauptbereich links:
  - Tagesmatrix (Tabs oder horizontale Tage).
  - je Tag: dynamische Zeilen `Kategorie + Menge`.
- Hauptbereich rechts (sticky):
  - Gesamtbedarf je Kategorie.
  - Tages-Peaks.
  - Bestandsampel (mit Ursachen: Bestand, verplant, Rest).
- Footer-Aktionen:
  - Speichern
  - Als Vorlage duplizieren
  - Status setzen

## 8) API-Design (ergänzend zu bestehendem `/api/wms`)
- `GET /api/wms/planning`
  - Liste + Filter.
- `GET /api/wms/planning/{planning_id}`
  - Detail inkl. Tage + Items + Snapshot.
- `POST /api/wms/planning`
  - Create/Update Planungskopf + Tage + Items.
- `POST /api/wms/planning/{planning_id}/duplicate`
  - 1:1 Kopie als `Entwurf`.
- `POST /api/wms/planning/{planning_id}/status`
  - Statuswechsel.
- `GET /api/wms/planning/{planning_id}/availability`
  - berechneter Snapshot.
- optional:
  - `GET /api/wms/planning/availability?from=...&to=...`
  - globale Engpasssicht.

## 9) Integration in bestehende Architektur
- Frontend:
  - neue Page `PlanningPage.tsx`
  - neues Service-Modul `planningApi.ts` (analog `wmsApi.ts`)
  - Controller-Erweiterung in `useWmsController.ts`
  - `WmsPageView.tsx` um `planning` erweitern
  - Navigationseintrag in `config/navigation.ts`
- Backend:
  - neue SQLAlchemy-Modelle in `backend/app/database/models.py`
  - Repository `planning_repository.py`
  - Service `planning_service.py`
  - Route `backend/app/routes/planning.py` (unter `/api/wms/planning`)
  - Alembic Migration für 3 Tabellen + Indizes

## 10) Verhältnis zur Lagerbewegung (explizit getrennt)
- Phase 1:
  - Planung erzeugt keine echte Ausgabe.
  - nur Bedarf, Reservierungswirkung und Verfügbarkeitsprüfung.
- Phase 2 (optional):
  - aus bestätigter Planung kann eine reale Auslagerung erzeugt werden (Wizard).

## 11) Umsetzungsschritte (empfohlene Reihenfolge)
1. DB-Schema + Migration für `planning`, `planning_day`, `planning_item`.
2. Backend CRUD + Duplicate + Status + Availability Endpoint.
3. Frontend Navigation + Planungsliste.
4. Frontend Planungsdetail mit Tageserfassung.
5. Aggregationen (Gesamtbedarf/Tagesbedarf/Preaks).
6. Bestandsabgleich + Ampelkomponenten.
7. Duplizieren/Vorlage und Status-Workflow.
8. E2E-Tests (Playwright) mit Persistenz-Assertions.
9. Feinschliff UX (Schnelleingaben, Tastaturfluss, Inline-Fehler).

## 12) Teststrategie (Roundtrip)
- Create planning -> reload -> weiterhin sichtbar.
- Add day-items -> reload -> Summen identisch.
- Statuswechsel -> reload + list filter -> korrekt.
- Duplicate -> neue Entwurfsplanung mit kopierten Items.
- Availability:
  - positive Fälle (grün)
  - knappe Fälle (gelb)
  - Überbuchung (rot)

## 13) MVP-Umfang (empfohlen)
- In MVP enthalten:
  - Planung anlegen/bearbeiten, Tagesbedarfe, Summen, Ampel, Duplizieren.
- Nicht im MVP:
  - echte Lagerbuchung aus Planung
  - komplexe Mehrlager-/Seriennummernzuordnung.

