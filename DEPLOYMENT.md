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
