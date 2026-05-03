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
Schnellstart im Projektroot:

```powershell
npm run dev
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

## GitHub Releases
Normale Änderung veröffentlichen:

```powershell
git add .
git commit -m "feat: beschreibung"
git push
```

Neue Release über Tag veröffentlichen:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

Optional mit GitHub CLI:

```powershell
gh release create v1.0.0 --title "v1.0.0" --generate-notes
```

## Screenshots (Platzhalter)
- `docs/screenshots/dashboard.png` (optional)
- `docs/screenshots/planning.png` (optional)
- `docs/screenshots/checkin-checkout.png` (optional)
