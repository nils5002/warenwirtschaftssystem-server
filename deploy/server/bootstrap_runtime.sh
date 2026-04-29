#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/web/cloud_web_runtime}"
TS="$(date +%Y%m%d_%H%M%S)"

log() {
  printf '%s\n' "$*"
}

copy_if_missing() {
  src="$1"
  dst="$2"
  if [ -f "$src" ] && [ ! -f "$dst" ]; then
    cp "$src" "$dst"
    log "Uebernommen: $src -> $dst"
  fi
}

mkdir -p "$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR/backups"
mkdir -p "$RUNTIME_DIR/cloudflared"

cd "$APP_DIR"

if [ -f ".env" ]; then
  cp ".env" "$RUNTIME_DIR/backups/env.${TS}.bak"
  copy_if_missing ".env" "$RUNTIME_DIR/.env"
fi

for candidate in docker-compose.prod.yml docker-compose.production.yml docker-compose.override.yml; do
  if [ -f "$candidate" ]; then
    cp "$candidate" "$RUNTIME_DIR/backups/${candidate}.${TS}.bak"
    copy_if_missing "$candidate" "$RUNTIME_DIR/docker-compose.prod.yml"
    break
  fi
done

if [ -d "cloudflared" ] && [ -z "$(ls -A "$RUNTIME_DIR/cloudflared" 2>/dev/null || true)" ]; then
  cp -R "cloudflared/." "$RUNTIME_DIR/cloudflared/" || true
  log "Cloudflared-Verzeichnis initial uebernommen nach $RUNTIME_DIR/cloudflared"
fi

if [ ! -f "$RUNTIME_DIR/.env" ] && [ -f "$APP_DIR/deploy/server/example-runtime/.env.prod.example" ]; then
  cp "$APP_DIR/deploy/server/example-runtime/.env.prod.example" "$RUNTIME_DIR/.env"
  log "Beispiel-.env erstellt: $RUNTIME_DIR/.env"
fi

if [ ! -f "$RUNTIME_DIR/docker-compose.prod.yml" ] && [ -f "$APP_DIR/deploy/server/example-runtime/docker-compose.prod.yml.example" ]; then
  cp "$APP_DIR/deploy/server/example-runtime/docker-compose.prod.yml.example" "$RUNTIME_DIR/docker-compose.prod.yml"
  log "Beispiel-Compose-Override erstellt: $RUNTIME_DIR/docker-compose.prod.yml"
fi

log "Runtime-Bootstrap abgeschlossen."
log "Bitte pruefen: $RUNTIME_DIR/.env und $RUNTIME_DIR/docker-compose.prod.yml"
