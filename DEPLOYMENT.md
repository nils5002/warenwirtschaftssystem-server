# DEPLOYMENT

## A) Portainer Deployment

1. In Portainer neuen Stack aus Git-Repository anlegen.
2. `docker-compose.yml` als Compose-Datei waehlen.
3. ENV-Werte setzen.
4. Deploy starten.

Empfohlene Basiswerte:

```dotenv
APP_NAME=Warehouse-System
APP_ENV=production
BASE_URL=https://warehouse.example.com
FRONTEND_URL=https://warehouse.example.com
CORS_ORIGINS=https://warehouse.example.com,http://localhost:5173,http://127.0.0.1:5173
VITE_API_URL=/api
VITE_API_BASE=
VITE_PROXY_TARGET=http://backend:8000
FRONTEND_PORT=8080
BACKEND_PORT=8001
```

## A2) Systemupdate aus dem WWS (Portainer-Webhook)

Ein Admin kann den Redeploy direkt im WWS starten
(`Administration → Systemupdate`). Das WWS verwaltet dabei **kein Docker**: Es
ruft ausschliesslich einen fest konfigurierten Portainer-Stack-Webhook auf.
Portainer zieht daraufhin selbst den aktuellen Git-Stand und baut den Stack neu.

### 1. Webhook in Portainer aktivieren

1. Portainer → Stacks → WWS-Stack → **Webhooks**.
2. `Enable webhook` einschalten (bzw. bereits vorhandene URL kopieren).
3. Die URL hat die Form
   `https://<portainer-host>/api/stacks/webhooks/<uuid>` und ist ein Geheimnis:
   Wer sie kennt, kann den Stack neu ausrollen.

### 2. Webhook in der Server-`.env` eintragen

Nur serverlokal (z. B. `/opt/web/cloud_web_runtime/.env`) — **niemals im
Repository**:

```dotenv
SYSTEM_UPDATE_ENABLED=true
PORTAINER_STACK_WEBHOOK_URL=https://portainer.example.com/api/stacks/webhooks/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
GITHUB_REPOSITORY=nils5002/warenwirtschaftssystem-server
GITHUB_BRANCH=main
SYSTEM_UPDATE_TIMEOUT_SECONDS=600
# optional (privates Repo / hoeheres API-Rate-Limit):
GITHUB_API_TOKEN=
```

In Portainer werden diese Werte unter *Stacks → WWS-Stack → Environment
variables* gesetzt; anschliessend einmal **Update the stack**, sonst greifen
sie nicht.

Fehlt `PORTAINER_STACK_WEBHOOK_URL` oder ist `SYSTEM_UPDATE_ENABLED=false`,
bleibt die Seite sichtbar, meldet aber lediglich „Systemupdates sind auf diesem
Server nicht aktiviert." Die uebrige Anwendung ist davon nicht betroffen.

### 3. Build-Metadaten (automatisch — kein Handgriff noetig)

Das Backend ermittelt seinen eigenen Commit **beim Image-Build selbst**: Der
Build-Kontext des Backends ist das Repo-Root (`context: .`,
`dockerfile: backend/Dockerfile`), eine vorgeschaltete Build-Stufe liest den
Commit aus den Git-Metadaten des Checkouts
(`backend/scripts/derive_build_info.py`) und legt ihn als `/app/build_info.json`
ins Image. `.git` selbst landet **nicht** im Laufzeit-Image.

Damit stimmt die angezeigte Version nach jedem Portainer-Redeploy automatisch —
auch bei einem Update, das aus dem WWS heraus ausgeloest wurde. Eine
Stack-Variable `APP_GIT_COMMIT` ist **nicht** noetig.

Ueberschreiben laesst sich das trotzdem, z. B. wenn ohne Git-Kontext gebaut wird
(Deploy ueber `deploy/server/deploy.sh` nutzt `git archive`, dort fehlt `.git`):

```dotenv
APP_GIT_COMMIT=<voller 40-stelliger Commit-SHA>
APP_GIT_BRANCH=main
APP_BUILD_TIME=2026-07-27T09:00:00Z
```

Gesetzte Werte haben Vorrang vor der automatisch ermittelten Datei. Lokal/CI
funktioniert beides:

```sh
docker compose build backend                                             # automatisch aus .git
docker compose build --build-arg APP_GIT_COMMIT=$(git rev-parse HEAD) backend   # explizit
```

Laesst sich die Version weder automatisch noch per ENV feststellen, funktioniert
das Update weiterhin — das WWS meldet den Vorgang danach aber bewusst **nicht**
als erfolgreich, sondern als „Version nach Neustart nicht ueberpruefbar". Es
wird nie faelschlich Erfolg gemeldet.

### 4. Ablauf und Backupverhalten

```text
Admin oeffnet Systemupdate
  -> WWS prueft den neuesten Commit auf GitHub
  -> WWS vergleicht installierte und verfuegbare Version
  -> Admin bestaetigt "Backup erstellen und Update installieren"
  -> WWS erstellt ein vollstaendiges Backup und validiert es
  -> WWS ruft den Portainer-Webhook GENAU EINMAL auf
  -> Portainer zieht den Git-Stand, baut und startet den Stack neu
  -> WWS erkennt nach dem Neustart die laufende Version
```

Das Backup entsteht **vor** dem Webhook-Aufruf und liegt als ZIP unter
`BACKUP_PATH` (Default `/app/data/backups`, also im persistenten Volume). Es
enthaelt `backup.json` mit dem kompletten Datenbestand (Assets, Kategorien,
Benutzer, Planungen, Wartungen, Systemeinstellungen, ...) sowie unter `files/`
die hochgeladenen Login-Hintergruende und den Produktbild-Cache. Standardmaessig
werden die letzten 10 Pre-Update-Backups aufbewahrt
(`SYSTEM_UPDATE_BACKUP_RETENTION`).

**Schlaegt das Backup fehl, wird kein Webhook ausgeloest und das Update
abgebrochen.**

### 5. Verhalten bei Fehlern

| Fall | Verhalten |
| --- | --- |
| GitHub nicht erreichbar | Versionspruefung meldet den Fehler; die App bleibt normal nutzbar |
| Backup fehlgeschlagen | Update wird abgebrochen, **kein** Redeploy, Vorgang als „Fehlgeschlagen" protokolliert |
| Portainer nicht erreichbar / lehnt ab | Kein Redeploy, Update-Lock wird sofort freigegeben |
| Backend kommt nicht zurueck | Nach `SYSTEM_UPDATE_TIMEOUT_SECONDS` gilt der Vorgang als „Zeitueberschreitung" |
| Nach Neustart laeuft ein anderer Commit | Vorgang wird als „Fehlgeschlagen" protokolliert — Stack in Portainer pruefen |

Wiederherstellung im Ernstfall: Das Pre-Update-Backup aus `BACKUP_PATH`
entpacken und `backup.json` ueber `Administration → Backup → Wiederherstellen`
einspielen.

### 6. Vorher in einer Staging-Umgebung testen

Vor der ersten Nutzung produktiv einmal gegen einen Test-Stack pruefen:

1. Zweiten Portainer-Stack (Staging) aus demselben Repository anlegen.
2. Dessen Webhook-URL in der Staging-`.env` eintragen, `SYSTEM_UPDATE_ENABLED=true`.
3. Update im Staging-WWS ausloesen und pruefen: Backup vorhanden, genau ein
   Redeploy, Version nach dem Neustart korrekt erkannt, Historie plausibel.

## B) Domain wechseln

Fuer eine neue Domain nur diese ENV-Werte anpassen:
- `BASE_URL`
- `FRONTEND_URL`
- `CORS_ORIGINS`

Optional:
- `FRONTEND_PORT`
- `BACKEND_PORT`

Beispiel neue Domain:

```dotenv
BASE_URL=https://lager.firma.de
FRONTEND_URL=https://lager.firma.de
CORS_ORIGINS=https://lager.firma.de,http://localhost:5173,http://127.0.0.1:5173
```

## C) Reverse-Proxy-neutrales Beispiel

Beispiel mit beliebigem Reverse Proxy:
- Domain: `warehouse.example.com`
- Forward Host/IP: `SERVER-IP`
- Forward Port: `8080`
- Scheme: `http`
- SSL: Zertifikat im Reverse Proxy hinterlegen

Wichtig:
- Die App terminiert kein TLS.
- Intern nur HTTP:
  - Frontend Container-Port `4173`
  - Backend Container-Port `8000`

## D) Cloudflare optional (ohne Tunnel)

Cloudflare kann optional als DNS/Proxy genutzt werden.
Cloudflare Tunnel (`cloudflared`) ist nicht erforderlich.

Beispiel Cloudflare ohne Tunnel:
- DNS Record:
  - Type: `A`
  - Name: `warehouse`
  - IPv4: oeffentliche Server-IP
  - Proxy: optional `AN`
- Reverse Proxy auf dem Server leitet `warehouse.example.com` auf `http://127.0.0.1:8080`.

## API-Routing

Frontend nutzt standardmaessig relative API-URL:
- `VITE_API_URL=/api`
- `VITE_API_BASE=`

Dadurch funktioniert die App domain-neutral hinter jedem Reverse Proxy.

## SPA-Deep-Links (URL-Routing)

Die App nutzt URL-basiertes Routing mit tiefen Pfaden (z. B. `/inventar/<assetId>`,
`/einsatzplanung/<planningId>`). Damit Refresh und direkte Links funktionieren,
muss die Frontend-Auslieferung fuer alle Nicht-`/api`-Pfade die `index.html`
liefern (SPA-Fallback).

- Aktuelles Setup: Der Frontend-Container laeuft mit `vite preview`
  (`frontend/Dockerfile`) — dessen SPA-Fallback ist eingebaut, es ist
  **keine zusaetzliche Konfiguration noetig**.
- Falls die Auslieferung spaeter auf nginx/statisches Hosting umgestellt wird:
  SPA-Fallback konfigurieren (nginx: `try_files $uri /index.html;`),
  `/api` und `/media` weiterhin ans Backend proxien.
