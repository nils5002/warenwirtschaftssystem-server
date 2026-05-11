# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Arbeitsleitfaden fuer Claude Code in diesem Repository.

Diese Datei ist verbindlich fuer alle Aenderungen in `C:\VS\warenwirtschaftssystem-server`.

## 1) Projektziel (kurz)

Hardware-Warenwirtschaft mit Einsatzplanung:
- Bestand verwalten (Inventar, QR, Status)
- projektbezogene Planung (Availability/Engpaesse)
- Ausgabe/Rueckgabe auf Person + Projekt
- Defekt/Wartung fachlich korrekt steuern

## 1a) Architektur (Big Picture)

Monorepo mit zwei Anwendungen, gemeinsamer Top-Level `package.json` orchestriert beide:

- **Backend** (`backend/`): FastAPI + SQLAlchemy + SQLite. Einstieg `app/main.py:create_app`. Schichten:
  - `app/routes/` — HTTP-Endpoints. Alle WMS-Routen unter Prefix `/api/wms` (siehe `routes/__init__.py:api_router`). Auth/Backup/Planning/Health als eigene Router.
  - `app/services/` — Fachlogik (z. B. `wms_service.py`, `planning_service.py`, `auth_service.py`, `upload_import_service.py`, `hardware_import/`).
  - `app/repositories/` — DB-Zugriff (CRUD pro Aggregat: `asset_`, `category_`, `planning_`, `wms_`, `hardware_import_`).
  - `app/database/` — Engine/Session (`session.py`), ORM-Modelle (`database/models.py`), `init_db`.
  - `app/schemas/` — Pydantic-Schemas (`schemas/wms.py`, `schemas/job.py`). Die Module `app/models.py` und `app/wms_models.py` sind nur Legacy-Re-Exports.
  - `app/domain/` — Stammwerte (z. B. kanonische Kategorien in `domain/categories.py`).
  - `app/config/settings.py` — Pydantic-Settings (env-getrieben, siehe `.env`).
- **Frontend** (`frontend/`): React 18 + TypeScript + Vite + Tailwind. Einstieg `src/App.tsx`. Aufbau:
  - `src/components/` und `src/asset-ui/` — UI-Bausteine, eine zentrale Page-Switch-Komponente `WmsPageView.tsx`.
  - `src/hooks/useWmsController.ts` — zentrale Datenladung/Mutationen, hält den App-State.
  - `src/services/wmsApi.ts` — gebündelter API-Client gegen `/api/...`.
  - `src/routing/appRoutes.ts` — sehr leichtgewichtiges Routing via `history.replaceState`.
  - Dev-Proxy: Vite leitet `/api` an `VITE_PROXY_TARGET` (default `http://127.0.0.1:8000`) bzw. `VITE_DEV_API_TARGET` (im Combo-Dev-Script `8010`).

### Wichtige Laufzeit-Eigenheiten (nicht offensichtlich)

- **Idempotente Schema-Patches beim Startup**: `app/main.py:on_startup` und `app/database/session.py:_ensure_new_columns/_ensure_hot_path_indexes` legen fehlende Spalten/Indizes per `ALTER TABLE ADD COLUMN` bzw. `CREATE INDEX IF NOT EXISTS` an. Diese Patches sind die *aktuelle* Migrationsstrategie für leichte Schema-Erweiterungen — Alembic existiert, wird aber nicht für jede Spalte genutzt. **Neue Spalten daher entweder in Alembic ODER konsistent in diese Listen eintragen**, sonst läuft Production schief.
- **Legacy-Seed**: Beim Startup wird optional aus `app/data/wms_db.json` geseedet (`WMS_SEED_LEGACY_ON_STARTUP`). Local-Dev-Skripte schalten das aus.
- **Standardkategorien werden beim Startup geseedet** (`category_repository.seed_standard_categories`).
- **Auth**: Token-basiert (`AUTH_TOKEN_SECRET`), optionaler Legacy-Header-Modus (`ALLOW_LEGACY_HEADER_AUTH`). Initial-Admin via `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD`.
- **Rollen-Sichtbarkeit im UI**: `App.tsx` filtert die Navigation pro Rolle. Backend muss *zusätzlich* RBAC enforced — UI-Filter ist nur Komfort.

## 2) Source of Truth

Vor jeder groesseren Aufgabe lesen und beachten:
- `PROJECT_CONTEXT.md`
- `AGENTS.md`

Wenn Regeln kollidieren:
1. Sicherheit/Datenschutz
2. Fachlogik aus `PROJECT_CONTEXT.md`
3. Entwicklungsregeln aus `AGENTS.md`
4. Bestehende Code-Struktur

## 3) Harte Projektregeln

1. Kein Full-Rebuild / kein unnötiger Umbau.
2. Bestehende Struktur beibehalten; gezielte Fixes bevorzugen.
3. Keine Runtime-/Cloudflare-/Server-Konfiguration anfassen.
4. Keine Secrets einchecken.
5. Keine echten Bestandsdateien committen.
6. Import bleibt Upload-basiert (kein Ordner-Import reaktivieren).

## 4) Datenschutz & Git Hygiene

### Excel-Dateien
- Lokale Bestandsdateien in `Hardwarebestand/` sind sensibel.
- Niemals echte Inhalte in Doku, Tests oder Commits kopieren.
- Nur synthetische Testdaten in Tests/Template verwenden.

### Muss in `.gitignore` bleiben
- `Hardwarebestand/*.xlsx`
- `Hardwarebestand/*.xlsm`

### Vor Commit immer pruefen
```powershell
git status --short
git ls-files Hardwarebestand/*
```

Erwartung: `git ls-files Hardwarebestand/*` liefert keine echten Dateien.

## 5) Rollen- und Fachregeln

### Rollen
- Admin/Techniker: Stammdaten, Inventar, Kategorien, Defekt/Wartung
- Projektmanager: Planung/Availability
- Mitarbeiter/Junior: Ausgabe/Rueckgabe/Defektmeldung

### Kritische Fachregeln (nicht verletzen)
- Defektmeldung sperrt Asset sofort (`Defekt`).
- `Erledigt` gibt Asset nur frei, wenn **kein** weiterer aktiver Defekt/Wartungseintrag existiert.
- Fehler in Wartungs-Statuspersistenz duerfen keine Folgeupdates ausloesen.
- Check-in darf kein fremdes `lastProject` blind uebernehmen.

## 6) Kategorien (kanonisch)

Standardkategorien:
- Laptop
- iPad
- Handheld
- Smartphone
- QR-Code-Scanner
- Drucker
- Kartendrucker
- Switch
- Router
- LTE-Router
- Zubehoer
- Sonstiges

Regeln:
1. Keine freien Kategorie-Freitexte beim Asset-Onboarding.
2. Neue Kategorien nur im Kategorien-Modul (rollenbasiert).
3. Synonyme zentral normalisieren.
4. Unklare Kategorie => `Zuordnung erforderlich`, nicht blind `Sonstiges`.

## 7) Import/Export Regeln

### Upload-Flow (verbindlich)
- `POST /api/wms/import/preview`
- `POST /api/wms/import/confirm`
- `GET /api/wms/import/template`

Nicht erlaubt:
- "Import aus Ordner Hardwarebestand"
- Dry-Run ueber serverseitige Verzeichnis-Scans aus UI

### Importanforderungen
- Titelzeilen erkennen/ueberspringen.
- Header robust normalisieren (Alias-Listen pflegen).
- Leere Zeilen ignorieren.
- Kategorie aus mehreren Quellen ableiten (Spalte > Header > Sheet > Dateiname > Titel).
- Wenn Name fehlt: sinnvoll auto-generieren.
- Wenn Seriennummer fehlt: deterministische `AUTO-*`-Seriennummer.
- Dedupe-Reihenfolge:
  1) echte Seriennummer
  2) MAC (LAN/WLAN)
  3) Name + Kategorie
  4) IP + Kategorie
  5) `AUTO-*` als technischer Fallback

### Preview-Qualitaet
Preview soll mindestens liefern:
- erkannte Kategorie + Quelle
- erkannte Spalten + Mapping
- valid/new/duplicates/errors
- auto-generierte Namen
- auto-generierte Seriennummern
- unresolved category rows

## 8) Technische Leitplanken

### Backend
- FastAPI + SQLAlchemy Patterns beibehalten.
- Fehler als JSON mit klarer `detail`-Message.
- Keine stillen Folgefehler bei partiellen Fehlschlaegen.

### Frontend
- Bestehende Seiten/Komponenten gezielt erweitern.
- Klare Fehlermeldungen statt "hängen".
- Kritische Requests mit Timeout/sauberem Fehlerpfad.

## 9) Lokaler Workflow

### Starten (Standard)
```powershell
npm run dev
```
Startet Backend (uvicorn) und Frontend (Vite) parallel via `concurrently` aus `frontend/package.json`.

Ports (Dev):
- Frontend (Vite): **4173**
- Backend (uvicorn, via `dev:backend`): **8010**
- Vite-Proxy `/api` → `127.0.0.1:8010` (gesetzt via `VITE_DEV_API_TARGET`)

Production-Default des Backends ist Port **8000** (siehe `app/main.py`).

Bei Portkonflikten: pruefen, welcher Prozess auf `4173`/`8010` lauscht und gezielt beenden — niemals blind die Konfiguration ändern.

### Starten (Local-Modus mit fixem Admin)
```powershell
npm run dev:local         # isolierte DB app.local.db, Login admin@example.com / Admin123!
npm run dev:local:fresh   # zusätzlich: lokalen Datenstand zurücksetzen
```
Diese Skripte (`scripts/dev-local.ps1`) setzen `DATABASE_URL=sqlite:///./app/data/app.local.db`, deaktivieren den Legacy-Seed und legen Initial-Admin-Credentials per Env an.

### Build/Compile
```powershell
npm --prefix frontend run build
cd backend
python -m compileall app
```

### Tests (wichtig: Arbeitsverzeichnis)
Backend-Tests immer aus `backend` starten:
```powershell
cd C:\VS\warenwirtschaftssystem-server\backend
.\.venv\Scripts\python.exe -m pytest tests
```

Einzelner Test:
```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_planning_availability_no_seeding.py -k "specific_case" -x
```

Wenn stattdessen aus Repo-Root getestet wird, kann `ModuleNotFoundError: app` auftreten.

## 10) Definition of Done (DoD)

Ein Task ist erst fertig, wenn:
1. Fachlogik korrekt implementiert ist.
2. Betroffene Tests angepasst/neu erstellt sind.
3. `frontend build` + `compileall` gruen sind.
4. Keine sensiblen Dateien versehentlich getrackt sind.
5. Kurzbericht vorhanden ist:
   - Ursache
   - geaenderte Dateien
   - Validierung
   - Rest-Risiken

## 11) Commit-Qualitaet

Commit Messages:
- praezise, fachlich, in einem Thema gebuendelt
- Beispiel:
  - `fix(import): robust category inference and deterministic auto-serial fallback`
  - `fix(maintenance): prevent asset release while active defects remain`

Vor Push bei Rejected-Non-Fast-Forward:
```powershell
git pull --rebase origin main
git push origin main
```

## 12) Nicht tun

- Keine echten Excel-Bestaende ins Repo.
- Keine grossen Refactors ohne Auftrag.
- Keine neuen Parallel-Architekturen einziehen.
- Keine "temporären" Workarounds ohne klare Rueckbaustrategie.

---

Wenn unklar ist, was fachlich korrekt ist: zuerst an `PROJECT_CONTEXT.md` ausrichten, dann kleinstmoegliche sichere Aenderung umsetzen.
