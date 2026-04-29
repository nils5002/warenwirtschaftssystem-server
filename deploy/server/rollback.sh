#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/web/cloud_web_runtime}"
TARGET_COMMIT="${1:-}"

LAST_SUCCESS_FILE="$RUNTIME_DIR/state/last_successful_commit"
PREVIOUS_SUCCESS_FILE="$RUNTIME_DIR/state/previous_successful_commit"

if [ -z "$TARGET_COMMIT" ]; then
  TARGET_COMMIT="$(cat "$PREVIOUS_SUCCESS_FILE" 2>/dev/null || true)"
fi

if [ -z "$TARGET_COMMIT" ]; then
  TARGET_COMMIT="$(cat "$LAST_SUCCESS_FILE" 2>/dev/null || true)"
fi

[ -n "$TARGET_COMMIT" ] || {
  echo "ERROR: Kein Rollback-Commit gefunden."
  exit 1
}

echo "Rollback auf Commit: $TARGET_COMMIT"
cd "$APP_DIR"
SKIP_GIT_PULL=true ROLLBACK_TO="$TARGET_COMMIT" sh deploy/server/deploy.sh main
