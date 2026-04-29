#!/usr/bin/env sh
set -eu

APP_DIR="${APP_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)}"
CRON_SCHEDULE="${CRON_SCHEDULE:-*/2 * * * *}"
CRON_CMD="cd $APP_DIR && sh deploy/server/auto_deploy_poll.sh"
TAG="# cloud_web_auto_deploy"

current_cron="$(crontab -l 2>/dev/null || true)"
cleaned="$(printf '%s\n' "$current_cron" | grep -v "$TAG" || true)"

{
  printf '%s\n' "$cleaned"
  printf '%s %s %s\n' "$CRON_SCHEDULE" "$CRON_CMD" "$TAG"
} | crontab -

echo "Auto-Deploy-Cron installiert: $CRON_SCHEDULE"
