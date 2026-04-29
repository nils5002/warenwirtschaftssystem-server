# Deploy-Strategie (Git + produktive Serverkopplung)

Diese Struktur trennt dauerhaft:

- Git-gesteuerten Code (`/opt/web/cloud_web`)
- produktive, serverspezifische Laufzeitdateien (`/opt/web/cloud_web_runtime`)

Damit bleiben Cloudflare-/Tunnel-/Secret-Dateien auf dem Server erhalten und werden nicht durch `git pull` ueberschrieben.

## Verzeichnisprinzip

- Repo-Code: `/opt/web/cloud_web`
- Laufender Stack-Code (Deploy-Ziel): `/opt/stacks/cloud_web`
- Runtime (nicht in Git): `/opt/web/cloud_web_runtime`
  - `.env`
  - `docker-compose.prod.yml`
  - `cloudflared/` (falls Tunnel-Konfig hier liegt)
  - weitere Secrets / Certs

## One-Time Setup auf dem Server

1. Repo auf dem Server im Zielpfad vorhanden halten (z. B. `/opt/web/cloud_web`).
2. Runtime bootstrap ausfuehren:

```sh
cd /opt/web/cloud_web
sh deploy/server/bootstrap_runtime.sh
```

3. Runtime-Dateien pruefen/erganzen:
   - `/opt/web/cloud_web_runtime/.env`
   - `/opt/web/cloud_web_runtime/docker-compose.prod.yml`
   - optional `/opt/web/cloud_web_runtime/cloudflared/*`

Beispielvorlagen liegen in:

- `deploy/server/example-runtime/.env.prod.example`
- `deploy/server/example-runtime/docker-compose.prod.yml.example`

## Deploy (Server)

```sh
cd /opt/web/cloud_web
sh deploy/server/deploy.sh main
```

Das Script macht:

1. `git fetch` + `git pull --ff-only` (mit Auto-Stash falls Worktree nicht clean)
2. Deploy des aktuellen Git-Commit-Standes nach `/opt/stacks/cloud_web` (ohne Runtime-/Secret-Dateien)
3. `docker compose` nur mit Runtime-Dateien:
   - `docker-compose.prod.yml` aus Runtime (serverlokal)
   - `.env` aus Runtime (serverlokal)
4. `up -d --build --remove-orphans`
5. Health-Check intern + extern (`https://warehouse.nilshome.loan/`)
6. Bei Fehlern: automatischer Rollback auf letztes erfolgreiches Commit

## Rollback (manuell)

```sh
cd /opt/web/cloud_web
sh deploy/server/rollback.sh
```

Optional expliziter Commit:

```sh
cd /opt/web/cloud_web
sh deploy/server/rollback.sh <commit-sha>
```

## Auto-Deploy (Polling + Cron)

Installiert einen leichten Polling-Trigger (Standard alle 2 Minuten):

```sh
cd /opt/web/cloud_web
sh deploy/server/install_auto_deploy_cron.sh
```

Manuell testen:

```sh
cd /opt/web/cloud_web
sh deploy/server/auto_deploy_poll.sh
```

Hinweis:
- Nutze **entweder** GitHub Actions Auto-Deploy **oder** Cron-Polling.
- Wenn GitHub Actions aktiv ist, Cron-Polling deaktivieren, um parallele Deploys zu vermeiden.

## Deploy (lokal getriggert)

Optionaler Helfer:

```powershell
powershell -ExecutionPolicy Bypass -File deploy/local/deploy-prod.ps1 -Server "root@SERVER_IP" -ServerAppDir "/opt/web/cloud_web" -Branch "main"
```

Der Helfer pusht zuerst den Branch und triggert dann das Server-Deploy-Script per SSH.
