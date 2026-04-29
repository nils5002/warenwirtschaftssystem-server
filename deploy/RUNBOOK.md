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
