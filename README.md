# Warenwirtschaftssystem Server

Hardware-Warenwirtschaft für projektbezogene Geräteplanung, Ausgabe/Rückgabe und Defektprozesse.

## Überblick
Dieses Repository enthält ein praxisnahes Warenwirtschaftssystem für Hardware-Projekte (z. B. iPads, Laptops, Handhelds).  
Ziel ist ein klarer, alltagstauglicher Ablauf statt komplexer ERP-Strukturen.

## Hauptfunktionen
- Inventarverwaltung mit Kategorien, Status und QR-Code-Bezug
- Einsatzplanung mit Verfügbarkeitsberechnung und Engpassanzeige
- Übergabe-/Verbundlogik zwischen Projekten
- Check-in/Check-out Prozesse für Gerätezuordnung
- Defekt- und Wartungsworkflow
- Backup/Restore für Bestands- und Planungsdaten

## Tech-Stack
- Backend: FastAPI, SQLAlchemy, SQLite
- Frontend: React, TypeScript, Vite
- Container: Docker, Docker Compose
- CI/CD: GitHub Actions (tag-basierte Releases)

## Projektstruktur
- `backend/` API, Datenmodelle, Fachlogik, Tests
- `frontend/` UI, Seiten, Komponenten, Build
- `deploy/` Deploy-Skripte und Runbooks
- `.github/workflows/` GitHub Actions Workflows
- `Hardwarebestand/` Import-bezogene Hardwaredateien (lokal)
- `Hardwareplannung/` lokale Planungsdateien (lokal)

## Lokale Entwicklung
Empfohlener Ablauf nach frischem Clone:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

npm install
npm run dev
```

Einfacher Local-Modus (ein Befehl, fester Local-Admin, eigene lokale DB):

```powershell
npm run dev:local
```

Local-Login:
- E-Mail: `admin@example.com`
- Passwort: `Admin123!`

Falls der lokale Datenstand zurückgesetzt werden soll:

```powershell
npm run dev:local:fresh
```

Alternativ getrennt:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

```powershell
cd frontend
npm install
npm run dev
```

## Docker-/Server-Hinweis
- `docker-compose.yml` ist für containerisierte Ausführung vorgesehen.
- Deployment-Anleitungen liegen in `DEPLOYMENT.md` und `deploy/`.
- Aktuell ist kein automatisches SSH-Serverdeployment per GitHub Actions aktiv.

## Login-Hintergrundbild
- `frontend/public/login-background.jpg` wurde aus dem Repository `VULGA01/Authentik-Login-theme-Glassmorphism` übernommen.
- Quelle: `Background_2.0.jpg`
- Das Referenz-Repository steht unter MIT-Lizenz.
