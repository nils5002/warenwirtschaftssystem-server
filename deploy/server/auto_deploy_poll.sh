#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/web/cloud_web_runtime}"
BRANCH="${BRANCH:-main}"
LOCK_FILE="$RUNTIME_DIR/state/auto_deploy.lock"
STATE_FILE="$RUNTIME_DIR/state/last_successful_commit"
LOG_FILE="$RUNTIME_DIR/logs/auto-deploy.log"

mkdir -p "$RUNTIME_DIR/state" "$RUNTIME_DIR/logs"

log() {
  printf '%s %s\n' "$(date -Iseconds)" "$*" >> "$LOG_FILE"
}

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "skip: lock active"
    exit 0
  fi
fi

cd "$APP_DIR"
git fetch --prune origin >/dev/null 2>&1

REMOTE_COMMIT="$(git rev-parse "origin/$BRANCH")"
LAST_DEPLOYED="$(cat "$STATE_FILE" 2>/dev/null || true)"

if [ "$REMOTE_COMMIT" = "$LAST_DEPLOYED" ]; then
  log "skip: no changes ($REMOTE_COMMIT)"
  exit 0
fi

log "change detected: $LAST_DEPLOYED -> $REMOTE_COMMIT; deploying"
if AUTO_STASH=true sh deploy/server/deploy.sh "$BRANCH" >> "$LOG_FILE" 2>&1; then
  log "deploy success"
else
  log "deploy failed"
  exit 1
fi
