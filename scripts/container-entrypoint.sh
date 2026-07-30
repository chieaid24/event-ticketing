#!/bin/sh
set -eu

role="${1:-${APP_ROLE:-api}}"

case "$role" in
  api)
    exec node apps/api/dist/main.js
    ;;
  migrate)
    exec pnpm --filter @event-ticketing/database db:migrate
    ;;
  web)
    exec pnpm --filter @event-ticketing/web exec next start \
      --hostname 0.0.0.0 \
      --port "${PORT:-3000}"
    ;;
  worker)
    exec node apps/worker/dist/main.js
    ;;
  *)
    printf 'Unknown application role: %s\n' "$role" >&2
    exit 64
    ;;
esac
