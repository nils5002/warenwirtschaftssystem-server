# Warenwirtschaftssystem Server

Hardware-Warenwirtschaft für projektbezogene Geräteplanung, Ausgabe/Rückgabe und
Defektprozesse. Fokus auf einen praxisnahen, alltagstauglichen Ablauf – bewusst
kein komplexes ERP.

## Überblick

Das System verwaltet Hardwarebestand (z. B. iPads, Laptops, Handhelds), plant
Geräte projektbezogen ein und bildet den realen Lager- und Gerätefluss ab:
Planung → Bedarf → Ausgabe (QR-Scan) → Zuordnung zu Person/Projekt → Rückgabe →
Defekt-/Wartungsbearbeitung.

## Hauptfunktionen

- Inventarverwaltung mit festen Kategorien, Status und QR-Code-Bezug
- Einsatzplanung mit Verfügbarkeitsberechnung und Engpassanzeige
- Übergabe-/Verbundlogik zwischen Projekten
- Check-in/Check-out für die Gerätezuordnung (inkl. Mobile-/Scan-Flow)
- Defekt- und Wartungsworkflow (Offen → In Bearbeitung → Erledigt)
- Backup/Restore für Bestands- und Planungsdaten
- Rollenbasierte Rechte (Admin/Techniker, Projektmanager, Mitarbeiter)

## Tech-Stack

- **Backend:** FastAPI, SQLAlchemy, SQLite (Einstieg `backend/app/main.py`)
- **Frontend:** React 18, TypeScript, Vite, Tailwind (Einstieg `frontend/src/App.tsx`)
- **Container:** Docker, Docker Compose
- **Deployment:** serverseitig pull-basiert über die Skripte in `deploy/`
  (kein GitHub-Actions-Workflow im Repo)

## Projektstruktur

```text
.
├── backend/            FastAPI-App, Datenmodelle, Fachlogik, Tests, Alembic-Migrationen
│   ├── app/            routes/ · services/ · repositories/ · database/ · schemas/ · domain/
│   ├── alembic/        Datenbank-Migrationen
│   ├── scripts/        einmalige Backfill-/Wartungsskripte
│   └── tests/          pytest-Suite
├── frontend/           React/Vite-UI (src/, public/, Build-Konfiguration)
├── deploy/             Deploy-Skripte, Runbook und Runtime-Beispiele
├── docs/               Architektur-, Status- und Analyse-Dokumentation
├── scripts/            lokale Entwickler-Hilfsskripte (PowerShell)
├── docker-compose.yml  Container-Orchestrierung (Backend + Frontend)
├── .env.example        Vorlage für die Umgebungskonfiguration
├── AGENTS.md           Arbeitsregeln für KI-/Entwickler-Beiträge
├── PROJECT_CONTEXT.md  Fachlogik, Rollen und Abläufe (maßgeblich)
├── CONTRIBUTING.md     Beitragshinweise
├── CHANGELOG.md        Änderungshistorie
└── DEPLOYMENT.md       Deployment-Anleitung
```

> `Hardwarebestand/` und `Hardwareplannung/` sind rein lokale Import-/Arbeitsordner
> und bewusst per `.gitignore` ausgeschlossen (keine echten Bestandsdateien im Repo).

## Voraussetzungen

- Python 3.12
- Node.js 20
- optional: Docker / Docker Compose für den containerisierten Betrieb

## Lokale Installation & Entwicklung

Empfohlener Ablauf nach frischem Clone (Windows/PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

npm install
npm run dev
```

`npm run dev` startet Backend (uvicorn) und Frontend (Vite) parallel.
In der lokalen Entwicklung läuft das Frontend auf Port `4173`, das Backend auf
`8010`; Vite leitet `/api` an das Backend weiter.

Einfacher Local-Modus (ein Befehl, fester Local-Admin, eigene lokale DB):

```powershell
npm run dev:local          # Login: admin@example.com / Admin123!
npm run dev:local:fresh    # zusätzlich: lokalen Datenstand zurücksetzen
```

Alternativ getrennt starten:

```powershell
# Backend
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Tests & Build

```powershell
# Backend-Tests (immer aus dem backend-Verzeichnis)
cd backend
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest tests

# Frontend: Tests und Produktions-Build
cd frontend
npm run test
npm run build
```

## Docker

Lokaler containerisierter Start (baut beide Images):

```bash
cp .env.example .env      # Werte anpassen, insbesondere AUTH_TOKEN_SECRET
docker compose up --build
```

Standard-Ports laut `.env.example`: Frontend `${FRONTEND_PORT}` (8080),
Backend `${BACKEND_PORT}` (8001). Backend-Daten liegen im persistenten Volume
`warehouse_app_data` unter `/app/data`.

## Konfiguration (Umgebungsvariablen)

Alle Einstellungen kommen aus Umgebungsvariablen. `.env.example` enthält die
vollständige Vorlage mit Platzhaltern; die wichtigsten:

| Variable | Zweck |
| --- | --- |
| `AUTH_TOKEN_SECRET` | Signaturgeheimnis für Auth-Tokens (langer Zufallswert!) |
| `DATABASE_URL` | SQLite-Pfad – **muss** auf das persistente Volume zeigen (4 Slashes = absolut) |
| `BASE_URL` / `FRONTEND_URL` / `CORS_ORIGINS` | Domain-/Origin-Konfiguration |
| `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` | Initial-Admin beim ersten Start |
| `FRONTEND_PORT` / `BACKEND_PORT` | veröffentlichte Container-Ports |
| `WMS_SEED_LEGACY_ON_STARTUP` | Legacy-Seed beim Start (Default: `false`) |

> **Wichtig:** Niemals echte Secrets committen. `.env` ist per `.gitignore`
> ausgeschlossen; nur `.env.example` mit Platzhaltern gehört ins Repo.

## Backup & Datenbank

- Persistente Daten (SQLite-DB, Uploads, Bild-Cache, Backups) liegen im
  Docker-Volume `warehouse_app_data` unter `/app/data` – nicht im Image.
- Backup/Restore ist in der Anwendung als Funktion verfügbar; Details siehe
  `docs/MIGRATIONS.md` und `DEPLOYMENT.md`.
- Datenbankdateien (`*.db`, `*.db-wal`, `*.db-shm`) werden nie versioniert.

## Deployment (Grundprinzip)

Das Deployment ist **pull-basiert auf dem Server** und trennt Git-Code von
serverlokaler Runtime-Konfiguration (`.env`, Prod-Compose außerhalb von Git):

```sh
cd /opt/web/cloud_web
sh deploy/server/deploy.sh main
```

Optional pollt `deploy/server/auto_deploy_poll.sh` (per Cron) den `main`-Branch
und deployt neue Commits automatisch. **Ein Push auf `main` kann daher ein
Re-Deployment auslösen.** Vollständige Anleitung: `DEPLOYMENT.md` und
`deploy/README.md` / `deploy/RUNBOOK.md`.

## Rollen (Kurzform)

- **Admin / Techniker:** Stammdaten, Inventar, Kategorien, Defekt/Wartung
- **Projektmanager:** Einsatzplanung, Verfügbarkeit, Engpässe
- **Mitarbeiter / Junior:** Ausgabe/Rückgabe, Defektmeldung

Details und die verbindliche Fachlogik: **[`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)**.
Arbeits- und Beitragsregeln: **[`AGENTS.md`](AGENTS.md)**.

## Lizenz / Nutzung

Interne Anwendung – es liegt derzeit keine gesonderte Open-Source-Lizenz bei.
Das Login-Hintergrundbild `frontend/public/login-background.jpg` stammt aus dem
Repository `VULGA01/Authentik-Login-theme-Glassmorphism` (Quelle `Background_2.0.jpg`,
MIT-Lizenz).
