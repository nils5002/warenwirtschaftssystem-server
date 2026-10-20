---
name: dev
description: App lokal starten (Backend + Frontend) — mit den realen Ports, Env-Vars und bekannten Stolperfallen dieses Repos. Nutzen, wenn die App gestartet, neu gestartet oder gegen sie getestet werden soll.
---

# Lokalen Dev-Stack starten

## Realität zuerst (Stand 2026-07)

- Es existiert **kein venv** (weder `.venv/` im Root noch `backend/.venv/`).
  Backend-Dependencies sind im **System-Python (3.12)** installiert. `dev:backend`
  (in `frontend/package.json`) nimmt `..\.venv\Scripts\python.exe`, falls vorhanden, sonst `python`.
- `vite.config.ts` nimmt als Proxy-Ziel `VITE_PROXY_TARGET`, sonst `VITE_DEV_API_TARGET`
  (von `dev:frontend` auf :8010 gesetzt), sonst `http://127.0.0.1:8000`.
  `npm run dev` ist damit konsistent: Backend :8010, Vite :4173 → Proxy :8010.
  **Achtung:** `npm run dev` ohne `DATABASE_URL` nutzt die persistente `app.db` → lieber
  `npm run dev:local` (setzt `app.local.db`) oder den Weg unten.
- Parallele Task-Worktrees (`<repo>.tasks\<name>`): `task dev` aus dem externen Task Studio
  (`C:\VS\TaskStudio`, nicht Teil dieses Repos) startet auf eigenen Ports und setzt `VITE_PROXY_TARGET`.

## Funktionierender Start

Backend (Port **8000**, mit isolierter Local-DB und fixem Admin — Env analog `scripts/dev-local.ps1`):

```bash
cd backend
APP_ENV=development \
DATABASE_URL="sqlite:///./app/data/app.local.db" \
DB_AUTO_CREATE_SCHEMA=true \
WMS_SEED_LEGACY_ON_STARTUP=false \
INITIAL_ADMIN_EMAIL=admin@example.com \
INITIAL_ADMIN_PASSWORD='Admin123!' \
INITIAL_ADMIN_NAME=Admin \
AUTH_TOKEN_SECRET=local-dev-secret-change-me \
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend (Vite auf Port **4173**, Proxy `/api` + `/media` → :8000 per Default; nicht `dev:frontend`,
das zielt auf :8010):

```bash
cd frontend && npx vite
```

- Login danach: `admin@example.com` / `Admin123!`
- Health-Check: `curl http://127.0.0.1:8000/api/health`
- Für Hintergrund-Starts: Bash-Tool mit `run_in_background: true` verwenden.

## Stolperfallen

- **Portkonflikt 4173/8000**: prüfen, welcher Prozess lauscht (`netstat -ano | grep :8000`)
  und gezielt beenden — niemals Ports/Konfiguration umbiegen.
- **Nie** die persistente `backend/app/data/app.db` für Dev-Experimente verwenden —
  immer `app.local.db` via `DATABASE_URL` (siehe oben).
- `scripts/dev-local-fresh.ps1` löscht den lokalen Datenstand — nur auf ausdrücklichen Wunsch.
- Frontend-Rollen-Filter in `App.tsx` ist nur Komfort; RBAC-Prüfungen immer im Backend testen.
