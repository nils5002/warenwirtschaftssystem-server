---
name: container-verify
description: Verbindliche Container-/Deployment-Validierung vor Commit/Push — sauberer Docker-Build, isolierter Stack-Start, Smoke-Tests, Persistenz- und Git-Checkout-Prüfung. Pflicht bei jeder Änderung an Backend-/Frontend-Code, Dependencies, Dockerfiles, Compose, Ports, Env-Vars, Vite-/Proxy-Konfig, DB-Init oder Schema-Patches. Nur bei reinen Doku-Änderungen entbehrlich.
---

# Container- und Deployment-Validierung

Eine Änderung gilt **nicht** als abgeschlossen, nur weil sie lokal funktioniert. Nach dem
Push baut Portainer den Stack aus dem Git-Repo neu — was nur dank lokaler, untracked
Dateien läuft, bricht in Production. „Fertig" / „deploymentbereit" darf erst gesagt
werden, wenn lokale Prüfungen **und** die produktionsnahe Containerprüfung grün sind.

## Ist-Zustand des Deployments (verifiziert 2026-07-12)

- **Stack-Datei:** Root-`docker-compose.yml` — das ist die Datei, die Portainer als
  Git-Stack verwendet (siehe `DEPLOYMENT.md`). Services `backend` + `frontend`,
  persistentes Volume `warehouse_app_data` → `/app/data` (Backend).
- **Backend-Image** (`backend/Dockerfile`): `python:3.12-slim`, installiert
  `requirements.txt`, Start `uvicorn app.main:app --host 0.0.0.0 --port 8000`
  mit `--proxy-headers`. **Bewusst 1 Worker** (SQLite-Locking) — nicht erhöhen.
  Host-Port `${BACKEND_PORT:-8001}`. Healthcheck: `GET /health` (kein DB-Roundtrip).
- **Frontend-Image** (`frontend/Dockerfile`): `node:20-alpine`, `vite build` zur
  Build-Zeit (Args `VITE_API_URL`/`VITE_API_BASE`/`VITE_PROXY_TARGET`), Auslieferung
  via **`vite preview`** auf 4173 (kein nginx — `frontend/nginx.default.conf` wird vom
  Dockerfile NICHT verwendet). Der Preview-Server proxied `/api` + `/media` über die
  `server.proxy`-Regeln aus `vite.config.ts` (Vite: `preview.proxy` erbt `server.proxy`)
  an `VITE_PROXY_TARGET` (Runtime-Env, Default `http://backend:8000`).
  Host-Port `${FRONTEND_PORT:-8080}`.
- **DATABASE_URL-Gotcha:** Default ist bewusst **absolut** mit 4 Slashes
  (`sqlite:////app/data/app.db`), damit die DB im Volume liegt. Ein relativer Pfad
  landet außerhalb des Volumes → Datenverlust beim Redeploy. Gleiches gilt für
  `PRODUCT_IMAGE_CACHE_PATH`, `LOGIN_BACKGROUND_PATH`, `HARDWARE_IMPORT_PATH`,
  `BACKUP_PATH`.
- **Pflicht-Env ohne Default:** `AUTH_TOKEN_SECRET`, `BASE_URL`, `FRONTEND_URL`,
  `CORS_ORIGINS`, `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`.
- **Server-Runtime:** `/opt/web/cloud_web_runtime/` hält `.env` +
  `docker-compose.prod.yml` (Override: `ports: []`, hinter Reverse Proxy,
  `DB_AUTO_CREATE_SCHEMA=false`). Deploy via `deploy/server/deploy.sh` bzw. Portainer.
  **Runtime-/Server-Konfiguration nie aus dem Repo heraus verändern.**
- Lokal läuft Docker Desktop mit Linux-Containern → produktionsnaher Test möglich
  (inkl. case-sensitiver Dateinamen, Linux-Pfade).

## Wann verpflichtend

Bei Änderungen an: Backend-/Frontend-Code, Dependencies (`package.json`,
`requirements.txt`), Dockerfiles, Compose, Startbefehlen, Ports, Env-Vars,
Vite-/Proxy-Konfig, API-Routing, DB-Init, Schema-Patches, statischen Builds,
Healthchecks, Deployment-Konfig. Entfallen darf sie nur bei reinen Doku-Änderungen.

## Prüfablauf

### 1. Bestehendes Deployment verstehen

Vor Änderungen die oben genannten Dateien lesen (`docker-compose.yml`, beide
Dockerfiles, `DEPLOYMENT.md`, ggf. `deploy/`). Keine Deployment-Struktur auf
Vermutung ändern.

### 2. Lokale Qualitätsprüfungen

Skills `dev` und `test` befolgen (Backend-Pytest mit frischer DB, Vitest,
`npm --prefix frontend run build`, `compileall`). Bekannte Vorbestände
(tsc-Fehler `loadWms`, Flake `test_tampered_token_is_rejected`) von neuen
Regressionen unterscheiden.

### 3. Sauberer Container-Build

Isolierter Compose-Projektname trennt Container **und Volumes** vom produktiven
Stack — niemals ohne `-p` gegen den Default-Projektnamen bauen/starten:

```bash
docker compose -p wms-verify build --no-cache
```

Prüfen: Build fehlerfrei; neue Dependencies werden im Image installiert; keine
Datei nötig, die untracked oder in `.gitignore` ist (`.dockerignore` beachten!).
Der Container muss allein mit frischem Git-Checkout + dokumentierten Env-Vars +
Volumes funktionieren — ohne lokale `node_modules`, venv, DBs, Caches.

### 4. Isolierter Stack-Start

Test-Env setzen (abweichende Host-Ports gegen Kollisionen, synthetische Secrets,
**nie** produktive Zugangsdaten oder Backups):

```bash
cd /c/VS/warenwirtschaftssystem-server
BACKEND_PORT=18001 FRONTEND_PORT=18080 \
BASE_URL=http://127.0.0.1:18080 FRONTEND_URL=http://127.0.0.1:18080 \
CORS_ORIGINS=http://127.0.0.1:18080 \
AUTH_TOKEN_SECRET=verify-secret-not-prod \
INITIAL_ADMIN_EMAIL=admin@example.com INITIAL_ADMIN_PASSWORD='Admin123!' \
docker compose -p wms-verify up -d
docker compose -p wms-verify ps          # beide Services "running", kein Restart-Loop
docker compose -p wms-verify logs backend | tail -50   # keine unbehandelten Exceptions
```

Prüfen: DB-Init läuft; Schema-Patches idempotent (siehe Schritt 6); Backend lauscht
auf 0.0.0.0:8000 im Container; Frontend auf 4173 erreichbar; Frontend erreicht
Backend über den containerinternen Hostnamen `backend`.

### 5. Smoke-Tests im Containerbetrieb

Achtung: `/health` liegt im Backend auf **Root-Ebene** (nicht unter `/api`) und ist
darum nur direkt am Backend-Port erreichbar. Als öffentlicher Proxy-Check dient
`/api/wms/login-branding` (kein Auth nötig). Login erwartet `email` + `password`.

```bash
curl -fsS http://127.0.0.1:18001/health                 # Backend direkt → {"status":"ok"}
curl -fsS http://127.0.0.1:18080/ | head -5             # Frontend lädt (keine leere Seite)
curl -fsS -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:18080/api/wms/login-branding         # Proxy Frontend→Backend → 200
curl -fsS -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:18080/einsatzplanung                 # Deep-Link/Refresh → 200, nicht 404
curl -fsS -X POST http://127.0.0.1:18080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"Admin123!"}' \
  -c /tmp/wms-verify-cookies.txt -o /dev/null -w '%{http_code}\n'   # → 200, setzt wms_auth-Cookie
curl -fsS -b /tmp/wms-verify-cookies.txt -o /dev/null -w '%{http_code}\n' \
  http://127.0.0.1:18080/api/wms/overview               # authentifizierter API-Call → 200
```

Danach mit Browser (Chrome via playwright-core, siehe Skill `test`): Login
`admin@example.com`/`Admin123!`, Hauptanwendung lädt, Inventar öffnen,
Einsatzplanung öffnen; keine CORS-/Proxy-/Cookie-/Routing-Fehler in der Konsole;
statische Assets laden. Bei Änderungen an einem Modul zusätzlich einen
Modul-Smoke-Test.

### 6. Persistenz & DB schützen

- **Nie** produktive DB/Volumes verwenden; keine vorhandene `app.db`/`app.local.db`
  überschreiben. Der `-p wms-verify`-Stack erzeugt ein eigenes Volume
  `wms-verify_warehouse_app_data`.
- Bei DB-/Schema-Änderungen zusätzlich: Start mit leerer DB, Start mit DB im
  bisherigen Schema, mehrfacher Neustart
  (`docker compose -p wms-verify restart backend` ×2) — Schema-Patches müssen
  idempotent bleiben, keine doppelten/fehlschlagenden ALTERs in den Logs.
- Aufräumen nach Abschluss (entfernt auch das Test-Volume):

```bash
docker compose -p wms-verify down -v
```

### 7. Git-Checkout-Realität

```bash
git status --short
git ls-files Hardwarebestand/*    # muss leer sein
```

Alles für Build/Start Nötige muss versioniert sein; nichts darf nur dank einer
untracked Datei funktionieren. Nicht einchecken: `.claude/settings.local.json`,
`.env`-Dateien/Secrets, `.local-backups/`, DBs, Logs, Caches, Testartefakte.
Neue Pflicht-Env-Vars in `DEPLOYMENT.md` dokumentieren.

## Abschluss-Gate vor Commit/Push

Alle 12 Punkte müssen beantwortbar sein — ungeprüfte Punkte als ungeprüft benennen,
nie „sicher funktionsfähig" behaupten:

1. Lokale Tests grün? 2. Frontend-Prod-Build grün? 3. Backend-Start ok?
4. Betroffene Images bauen sauber? 5. Container ohne Restart-Loop?
6. Frontend erreichbar? 7. Backend erreichbar? 8. Frontend↔Backend-Kommunikation ok?
9. Login-/Anwendungs-Smoke-Test ok? 10. Start rein mit eingecheckten Dateien?
11. Keine produktiven Daten/Volumes berührt? 12. Neue Env-Vars dokumentiert?

## Verhalten bei Fehlern

Lokal ok, Container rot → **nicht pushen, nicht „fertig" melden.** Logs analysieren,
Abweichung lokal↔Container identifizieren, gezielt fixen, kompletten Ablauf
wiederholen. Typische Ursachen: Datei fehlt im Build-Kontext/.dockerignore;
Dependency nur lokal; Bindung an 127.0.0.1 statt 0.0.0.0; fehlende Env-Var;
Vite-**Dev**-Proxy mit Prod-Konfig verwechselt (Prod = `vite preview` +
`VITE_PROXY_TARGET`); Schreibrechte im Volume; case-sensitive Dateinamen unter
Linux (bekanntes Repo-Thema, z. B. timelineMath); Windows-Pfade im Code.

## Abschlussbericht

Getrennt ausweisen:
- **Lokal:** ausgeführte Tests, Ergebnisse, bekannte Vorbestände/Flakes.
- **Container:** gebaute Images, verwendete Stack-Konfig, Startstatus, geprüfte
  Endpunkte, Smoke-Ergebnis, relevante Logs, verwendetes Test-Volume/DB.
- **Git-/Deployment-Bereitschaft:** alles Nötige versioniert, keine Secrets,
  kein lokaler Datei-Bedarf, Start nach frischem Checkout nachvollziehbar.
