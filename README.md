# Warehouse-System Server

Hardware-Warenwirtschaft mit FastAPI-Backend und Vite-Frontend.

## Schnellstart lokal

```powershell
# im Projektroot
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

## Portainer Deployment (provider-neutral)

1. Stack aus Git-Repo erstellen.
2. `docker-compose.yml` waehlen.
3. ENV-Werte setzen (mindestens Domain/CORS/Secrets).
4. Deploy ausfuehren.

Wichtige ENV-Werte:
- `BASE_URL`
- `FRONTEND_URL`
- `CORS_ORIGINS`
- `FRONTEND_PORT` (Default `8080`)
- `BACKEND_PORT` (Default `8001`)
- `VITE_API_URL=/api`
- `VITE_API_BASE=`
- `VITE_PROXY_TARGET=http://backend:8000`

## Netzwerkmodell

- Frontend intern: `4173`
- Backend intern: `8000`
- TLS/HTTPS wird vor der App terminiert (Reverse Proxy / Load Balancer / Hosting-Proxy).
- Frontend ruft API relativ ueber `/api` auf.

Zielbild:
- Internet -> DNS/Reverse Proxy -> `SERVER-IP:FRONTEND_PORT` -> Frontend
- Frontend `/api` -> Backend-Service im Docker-Netz

## Domain wechseln

Nur ENV aendern:
- `BASE_URL`
- `FRONTEND_URL`
- `CORS_ORIGINS`

Optional:
- `FRONTEND_PORT`
- `BACKEND_PORT`

Keine feste Domain im Code erforderlich.

## Cloudflare Hinweis

Cloudflare kann optional als DNS/Proxy/CDN genutzt werden.
Ein Cloudflare Tunnel (`cloudflared`) ist nicht erforderlich.

## Details

Ausfuehrliche Deploy-Doku: `DEPLOYMENT.md`


######
###
####