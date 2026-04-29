#!/usr/bin/env sh
set -eu

BRANCH="${1:-main}"
APP_DIR="${APP_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/web/cloud_web_runtime}"
DEPLOY_TARGET_DIR="${DEPLOY_TARGET_DIR:-/opt/stacks/cloud_web}"
ENV_FILE="${ENV_FILE:-$RUNTIME_DIR/.env}"
PROD_COMPOSE_FILE="${PROD_COMPOSE_FILE:-$RUNTIME_DIR/docker-compose.prod.yml}"
PROJECT_NAME="${PROJECT_NAME:-cloud_web}"
REMOVE_ORPHANS="${REMOVE_ORPHANS:-false}"
AUTO_STASH="${AUTO_STASH:-true}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-false}"
ROLLBACK_TO="${ROLLBACK_TO:-}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:8085/}"
EXTERNAL_HEALTH_URL="${EXTERNAL_HEALTH_URL:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"

STATE_DIR="$RUNTIME_DIR/state"
BACKUP_DIR="$RUNTIME_DIR/backups"
LAST_SUCCESS_FILE="$STATE_DIR/last_successful_commit"
PREVIOUS_SUCCESS_FILE="$STATE_DIR/previous_successful_commit"
LAST_DEPLOY_LOG="$STATE_DIR/last_deploy.log"
LOCK_FILE="$STATE_DIR/deploy.lock"

log() {
  printf '%s\n' "$*"
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' nicht gefunden"
}

require_cmd git
require_cmd docker
require_cmd tar
require_cmd curl

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
else
  die "weder 'docker compose' noch 'docker-compose' verfuegbar"
fi

[ -d "$APP_DIR/.git" ] || die "APP_DIR ist kein Git-Repository: $APP_DIR"
[ -f "$ENV_FILE" ] || die "Runtime .env fehlt: $ENV_FILE"
[ -f "$PROD_COMPOSE_FILE" ] || die "Runtime compose override fehlt: $PROD_COMPOSE_FILE"
mkdir -p "$DEPLOY_TARGET_DIR" "$STATE_DIR" "$BACKUP_DIR"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "Ein anderes Deploy laeuft bereits"
fi

timestamp() {
  date +%Y%m%d_%H%M%S
}

backup_runtime_files() {
  TS="$(timestamp)"
  cp "$ENV_FILE" "$BACKUP_DIR/env.${TS}.bak"
  cp "$PROD_COMPOSE_FILE" "$BACKUP_DIR/docker-compose.prod.${TS}.yml.bak"
  if [ -f "$DEPLOY_TARGET_DIR/docker-compose.yml" ]; then
    cp "$DEPLOY_TARGET_DIR/docker-compose.yml" "$BACKUP_DIR/stack-compose.${TS}.yml.bak"
  fi
}

compose_up() {
  if [ "$REMOVE_ORPHANS" = "true" ]; then
    $COMPOSE_CMD \
      --project-name "$PROJECT_NAME" \
      --env-file "$ENV_FILE" \
      -f "$PROD_COMPOSE_FILE" \
      up -d --build --remove-orphans
  else
    $COMPOSE_CMD \
      --project-name "$PROJECT_NAME" \
      --env-file "$ENV_FILE" \
      -f "$PROD_COMPOSE_FILE" \
      up -d --build
  fi
}

wait_backend_healthy() {
  backend_id="$(
    $COMPOSE_CMD \
      --project-name "$PROJECT_NAME" \
      --env-file "$ENV_FILE" \
      -f "$PROD_COMPOSE_FILE" \
      ps -q backend
  )"

  [ -n "$backend_id" ] || return 1

  deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))
  while [ "$(date +%s)" -le "$deadline" ]; do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$backend_id" 2>/dev/null || true)"
    if [ "$status" = "healthy" ]; then
      return 0
    fi
    sleep 3
  done
  return 1
}

wait_http_ok() {
  url="$1"
  max_time="$2"
  label="$3"
  deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECONDS ))

  while [ "$(date +%s)" -le "$deadline" ]; do
    http_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time "$max_time" "$url" || true)"
    case "$http_code" in
      2*|3*)
        log "$label erreichbar (HTTP $http_code): $url"
        return 0
        ;;
      *)
        log "$label noch nicht bereit (HTTP ${http_code:-n/a}): $url"
        ;;
    esac
    sleep 3
  done
  return 1
}

health_check() {
  wait_backend_healthy || return 1
  wait_http_ok "$LOCAL_HEALTH_URL" 10 "Lokaler Health-Check" || return 1
  if [ -n "$EXTERNAL_HEALTH_URL" ]; then
    wait_http_ok "$EXTERNAL_HEALTH_URL" 15 "Externer Health-Check" || return 1
  fi
  return 0
}

sync_from_ref() {
  ref="$1"
  git -C "$APP_DIR" cat-file -e "${ref}^{commit}" >/dev/null 2>&1 || die "Git-Ref nicht gefunden: $ref"
  git -C "$APP_DIR" archive "$ref" \
    | tar -x -C "$DEPLOY_TARGET_DIR" \
      --exclude='docker-compose.yml' \
      --exclude='.env' \
      --exclude='.env.*' \
      --exclude='docker-compose.override.yml' \
      --exclude='docker-compose.prod.yml' \
      --exclude='docker-compose.production.yml' \
      --exclude='deploy/runtime/' \
      --exclude='deploy/server-local/' \
      --exclude='cloudflared/'
}

rollback_to_commit() {
  rollback_ref="$1"
  log "Rollback auf Commit $rollback_ref"
  sync_from_ref "$rollback_ref"
  compose_up
  if health_check; then
    log "Rollback erfolgreich."
    return 0
  fi
  return 1
}

cd "$APP_DIR"

if [ "$SKIP_GIT_PULL" != "true" ]; then
  if [ -n "$(git status --porcelain)" ] && [ "$AUTO_STASH" = "true" ]; then
    STASH_TAG="deploy-autostash-$(timestamp)"
    git stash push --include-untracked -m "$STASH_TAG" >/dev/null || true
    log "Hinweis: dirty Worktree gestasht: $STASH_TAG"
  fi

  log "Aktualisiere Git-Stand fuer Branch: $BRANCH"
  git fetch --prune origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

TARGET_REF="${ROLLBACK_TO:-HEAD}"
TARGET_COMMIT="$(git rev-parse --short "$TARGET_REF")"
PREV_SUCCESS_COMMIT="$(cat "$LAST_SUCCESS_FILE" 2>/dev/null || true)"

backup_runtime_files

log "Deploye Commit: $TARGET_COMMIT (Ref: $TARGET_REF)"
sync_from_ref "$TARGET_REF"
compose_up

if health_check; then
  if [ -n "$PREV_SUCCESS_COMMIT" ] && [ "$PREV_SUCCESS_COMMIT" != "$TARGET_COMMIT" ]; then
    printf '%s\n' "$PREV_SUCCESS_COMMIT" > "$PREVIOUS_SUCCESS_FILE"
  fi
  printf '%s\n' "$TARGET_COMMIT" > "$LAST_SUCCESS_FILE"
  printf 'success %s %s\n' "$(date -Iseconds)" "$TARGET_COMMIT" > "$LAST_DEPLOY_LOG"
  log "Health-Check erfolgreich."
else
  printf 'failed %s %s\n' "$(date -Iseconds)" "$TARGET_COMMIT" > "$LAST_DEPLOY_LOG"
  if [ -n "$PREV_SUCCESS_COMMIT" ]; then
    log "Health-Check fehlgeschlagen, versuche Auto-Rollback auf $PREV_SUCCESS_COMMIT"
    rollback_to_commit "$PREV_SUCCESS_COMMIT" || die "Rollback fehlgeschlagen"
  else
    die "Health-Check fehlgeschlagen und kein Rollback-Commit vorhanden"
  fi
fi

log "Container-Status:"
$COMPOSE_CMD \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$PROD_COMPOSE_FILE" \
  ps

log "Deploy abgeschlossen."
