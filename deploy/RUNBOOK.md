# Runbook: Git -> Produktion (domain-/provider-neutral)

## 1) Trennung

Aus Git:
- `backend/**`, `frontend/**`, `docker-compose.yml`, `deploy/**`, Doku

Serverlokal:
- `/opt/web/cloud_web_runtime/.env`
- `/opt/web/cloud_web_runtime/docker-compose.prod.yml`
- optionale Reverse-Proxy-/TLS-Dateien

## 2) Erstinitialisierung

```sh
cd /opt/web/cloud_web
sh deploy/server/bootstrap_runtime.sh
```

## 3) Standard-Deploy

```sh
cd /opt/web/cloud_web
sh deploy/server/deploy.sh main
```

Verhalten:
- Git-Update im Repo
- Sync nach Deploy-Ziel
- `docker compose up -d --build`
- lokaler Health-Check
- externer Health-Check optional ueber `EXTERNAL_HEALTH_URL`
- Auto-Rollback bei Fehler

## 3b) Update aus dem WWS (Portainer-Webhook)

Alternative zum Skript-Deploy, ausschliesslich fuer Admins im WWS unter
`Administration → Systemupdate`.

Ablauf:
- Versionspruefung gegen `GITHUB_REPOSITORY` / `GITHUB_BRANCH`
- vollstaendiges, validiertes Backup unter `BACKUP_PATH` (ZIP mit `backup.json`
  plus Login-Hintergruende und Produktbild-Cache)
- genau EIN Aufruf des Portainer-Stack-Webhooks (kein Retry), mit der
  Zielversion als Query-Parameter `?APP_GIT_COMMIT=<sha>&APP_GIT_BRANCH=<branch>`
- Portainer zieht den Git-Stand und baut den Stack neu
- nach dem Neustart bewertet das WWS den Vorgang anhand von `APP_GIT_COMMIT`

Voraussetzungen in der serverlokalen `.env` bzw. den Portainer-Stack-Variablen:
- `SYSTEM_UPDATE_ENABLED=true`
- `PORTAINER_STACK_WEBHOOK_URL=<Webhook-URL des Stacks>` (Geheimnis)
- `APP_GIT_COMMIT`/`APP_GIT_BRANCH` als Stack-Variablen vorhanden lassen: das
  WWS ueberschreibt sie beim Redeploy. Portainer checkt Git-Stacks ohne `.git`
  aus, die Ableitung beim Image-Build greift dort nicht.
- Achtung: Ein Redeploy **ausserhalb** des WWS laesst `APP_GIT_COMMIT` veralten
  (Anzeige zeigt dann den alten Commit) — Variable mitziehen oder das naechste
  Update aus dem WWS heraus starten.

Stoerungsfaelle:
- Backup fehlgeschlagen -> kein Redeploy, Vorgang als fehlgeschlagen protokolliert
- Portainer nicht erreichbar -> kein Redeploy, Lock sofort frei
- Backend kommt nicht zurueck -> nach `SYSTEM_UPDATE_TIMEOUT_SECONDS` „Zeitueberschreitung";
  Stack in Portainer pruefen, im Ernstfall Pre-Update-Backup aus `BACKUP_PATH`
  ueber `Administration → Backup` wiederherstellen
- Es laeuft immer nur EIN Update gleichzeitig (persistenter Lock in der Datenbank)

Vor der ersten produktiven Nutzung einmal gegen einen Staging-Stack testen.

## 4) Domainwechsel

Nur ENV anpassen:
- `BASE_URL`
- `FRONTEND_URL`
- `CORS_ORIGINS`

Optional:
- `FRONTEND_PORT`
- `BACKEND_PORT`

## 5) Reverse Proxy

HTTPS/TLS wird vor der App terminiert (Nginx, Apache, Traefik, Caddy, Cloudflare Proxy, LB).
Die App selbst spricht intern HTTP.

## 6) Cloudflare

Cloudflare ist optional als DNS/Proxy nutzbar.
Cloudflare Tunnel ist keine Voraussetzung.
