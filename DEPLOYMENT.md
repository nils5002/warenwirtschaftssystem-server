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

### 3. Build-Metadaten (woher das WWS seine Version kennt)

Die Anwendung muss wissen, welchen Commit sie ausfuehrt — sonst laesst sich nach
einem Redeploy nicht pruefen, ob wirklich die Zielversion laeuft. Dafuer gibt es
zwei Wege, in dieser Reihenfolge:

1. **`APP_GIT_COMMIT` / `APP_GIT_BRANCH`** (Stack-Variable bzw. Build-Arg) —
   hat Vorrang.
2. **`/app/build_info.json`**, beim Image-Build aus den Git-Metadaten des
   Build-Kontexts abgeleitet (`backend/scripts/derive_build_info.py`, Kontext
   ist das Repo-Root). `.git` landet dabei nur in der Build-Stufe, **nicht** im
   Laufzeit-Image.

Welcher Weg greift, haengt an der Umgebung:

| Umgebung | Quelle |
| --- | --- |
| Lokal / CI (`docker compose build`) | automatisch aus `.git` |
| **Portainer-Git-Stack** | `APP_GIT_COMMIT`, vom WWS beim Redeploy gesetzt |
| `deploy/server/deploy.sh` (`git archive`) | `APP_GIT_COMMIT` von Hand |

**Wichtig fuer Portainer:** Portainer checkt Git-Stacks **ohne `.git`** aus
(geprueft mit 2.39.1 — in `/data/compose/<id>` liegt nur der Dateibaum). Die
Ableitung beim Build laeuft dort deshalb leer. Damit die Version trotzdem stimmt,
haengt das WWS die Zielversion beim Redeploy an den Webhook an:

```text
POST https://<portainer>/api/stacks/webhooks/<uuid>?APP_GIT_COMMIT=<sha>&APP_GIT_BRANCH=main
```

Portainer uebernimmt Query-Parameter eines Stack-Webhooks als Stack-Variablen,
`docker-compose.yml` reicht sie als Build-Args ins Image. Damit das
funktioniert:

* `APP_GIT_COMMIT` und `APP_GIT_BRANCH` **in den Stack-Variablen belassen**
  (Startwert: aktuell laufender Commit). Das WWS ueberschreibt sie bei jedem
  Update.
* Abschaltbar ueber `SYSTEM_UPDATE_PASS_BUILD_METADATA=false` — dann kann ein
  Update aber nicht mehr als erfolgreich bestaetigt werden.

**Bekannte Grenze:** Wird der Stack **ausserhalb** des WWS neu ausgerollt (z. B.
„Pull and redeploy" in Portainer), bleibt `APP_GIT_COMMIT` auf dem alten Wert
stehen — die Anzeige zeigt dann eine veraltete Version und bietet dasselbe
Update erneut an. Ein Update aus dem WWS heraus setzt den Wert wieder gerade.
Wer manuell redeployt, zieht die Variable am besten mit.

Lokal/CI funktioniert beides:

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
