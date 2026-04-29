# Runbook: Git -> Produktion (ohne Verlust der Aussenanbindung)

## 1) Dateitrennung

### A) Kommt aus Git (Code)

- `backend/**` (Anwendungscode, Migrationen, Requirements)
- `frontend/**` (UI-Code)
- `docker-compose.yml` (Basisstack)
- `deploy/**` (Deploy-Skripte/Runbook)
- Dokumentation (`README.md`, `*.md`)

### B) Bleibt serverlokal (nicht aus Git)

- `/opt/web/cloud_web_runtime/.env`
- `/opt/web/cloud_web_runtime/docker-compose.prod.yml`
- `/opt/web/cloud_web_runtime/cloudflared/**`
- weitere Secrets/Certs unter `/opt/web/cloud_web_runtime/**`

## 2) Erstinitialisierung auf dem Server

```sh
cd /opt/web/cloud_web
sh deploy/server/bootstrap_runtime.sh
```

Danach produktive Dateien in `/opt/web/cloud_web_runtime` pruefen.

## 3) Standard-Deploy auf dem Server

```sh
cd /opt/web/cloud_web
sh deploy/server/deploy.sh main
```

Deploy-Verhalten:
- Git-Update passiert in `/opt/web/cloud_web`.
- Danach werden Code-Dateien nach `/opt/stacks/cloud_web` synchronisiert.
- Runtime-Dateien bleiben in `/opt/web/cloud_web_runtime` und werden nicht aus Git ueberschrieben.
- Vor Deploy wird ein Backup in `/opt/web/cloud_web_runtime/backups` erstellt.
- Nach Deploy laufen Health-Checks (lokal + extern).
- Bei fehlgeschlagenem Health-Check erfolgt ein Auto-Rollback auf das letzte funktionierende Commit.

## 4) Standard-Deploy von lokal aus

```powershell
powershell -ExecutionPolicy Bypass -File deploy/local/deploy-prod.ps1 -Server "root@SERVER_IP" -ServerAppDir "/opt/web/cloud_web" -Branch "main"
```

## 5) Sicherheitsprinzip

`deploy/server/deploy.sh` bricht ab, wenn Runtime-Dateien fehlen. Dadurch wird verhindert, dass versehentlich nur mit Basis-Compose deployt wird und produktive Routing-/Tunnel-Settings verloren gehen.

## 6) Auto-Deploy aktivieren (einfach)

```sh
cd /opt/web/cloud_web
sh deploy/server/install_auto_deploy_cron.sh
```

Standard: alle 2 Minuten Polling auf `origin/main`, Deploy nur bei neuem Commit.

Wichtig:
- Wenn GitHub-Actions-Deploy aktiv ist, Cron wieder entfernen:

```sh
crontab -l | grep -v cloud_web_auto_deploy | crontab -
```

## 7) Rollback

```sh
cd /opt/web/cloud_web
sh deploy/server/rollback.sh
```
