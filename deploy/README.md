# Deploy-Strategie (Git + Runtime-Trennung)

Diese Struktur trennt:
- Git-Code (`/opt/web/cloud_web`)
- serverlokale Runtime-Dateien (`/opt/web/cloud_web_runtime`)

Damit bleiben domain-/provider-spezifische Werte in `.env` und werden nicht durch `git pull` ueberschrieben.

## Runtime-Dateien (serverlokal)

- `/opt/web/cloud_web_runtime/.env`
- `/opt/web/cloud_web_runtime/docker-compose.prod.yml`
- optionale Reverse-Proxy-/TLS-Dateien

## One-Time Setup

```sh
cd /opt/web/cloud_web
sh deploy/server/bootstrap_runtime.sh
```

## Deploy

```sh
cd /opt/web/cloud_web
sh deploy/server/deploy.sh main
```

Health-Checks:
- lokal: `LOCAL_HEALTH_URL` (Default `http://127.0.0.1:8085/`)
- extern: optional ueber `EXTERNAL_HEALTH_URL` in `.env`/Shell setzen

## Systemupdate aus dem WWS (optional)

Statt `deploy.sh` kann ein Admin den Redeploy auch direkt im WWS starten
(`Administration → Systemupdate`). Das WWS ruft dafuer ausschliesslich einen
fest konfigurierten Portainer-Stack-Webhook auf — kein Docker-Socket, keine
Shell-Befehle, kein Portainer-Adminzugang im Backend.

Serverlokale `.env` (Auszug, Webhook-URL ist ein Geheimnis):

```dotenv
SYSTEM_UPDATE_ENABLED=true
PORTAINER_STACK_WEBHOOK_URL=https://portainer.example.com/api/stacks/webhooks/<uuid>
GITHUB_REPOSITORY=nils5002/warenwirtschaftssystem-server
GITHUB_BRANCH=main
```

Der laufende Commit wird beim Image-Build automatisch aus dem Git-Checkout
ermittelt (Build-Kontext ist das Repo-Root) — `APP_GIT_COMMIT` muss nur gesetzt
werden, wenn ohne Git-Kontext gebaut wird. Genau das trifft auf `deploy.sh` zu:
Es synchronisiert per `git archive`, dort fehlt `.git`. Auf diesem Weg gilt die
Version ohne gesetztes `APP_GIT_COMMIT` als unbekannt.

Vor jedem so ausgeloesten Update erstellt das WWS automatisch ein validiertes
Backup unter `BACKUP_PATH`. Details siehe `DEPLOYMENT.md`, Abschnitt A2.

## Domainwechsel

Nur ENV-Werte aendern, z. B.:
- `BASE_URL`
- `FRONTEND_URL`
- `CORS_ORIGINS`

Optional:
- `FRONTEND_PORT`
- `BACKEND_PORT`

## Hinweis zu Cloudflare

Cloudflare kann optional als DNS/Proxy/CDN genutzt werden.
Ein Cloudflare Tunnel (`cloudflared`) ist nicht erforderlich.
