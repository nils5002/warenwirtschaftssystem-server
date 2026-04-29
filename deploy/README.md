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
