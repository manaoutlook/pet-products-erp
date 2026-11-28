#!/bin/bash
# Release origin/main (or another branch) to the SmartERP production server.
#
# Usage (on the server, as the `deploy` user):
#   cd /opt/SmartERP && ./deploy-server.sh            # origin/main
#   cd /opt/SmartERP && ./deploy-server.sh develop    # origin/develop
#
# This is the Linux counterpart of ./deploy.sh (which serves the Mac two-checkout
# setup). Differences:
#   * restart is `systemctl restart smart-erp` instead of stop_prod.sh/start_prod.sh
#     (the environment comes from EnvironmentFile, not from a sourced shell)
#   * health is checked against 127.0.0.1:$PORT with a retry loop
#
# `db:push` prompts before anything destructive, so run this in an interactive
# SSH session - never from cron or a CI runner.
#
# `.env` and `uploads/` are gitignored, so `git reset --hard` cannot destroy them.
set -euo pipefail
cd "$(dirname "$0")"

# AI Agent Note - do NOT remove this. V8 sizes its heap from installed RAM (~470-500 MB
# on this 1 GB VPS) and `vite build` for this client exceeds that within a minute:
#   FATAL ERROR: Ineffective mark-compacts near heap limit ... Aborted (core dumped)
# Docs 8.1 calls 896 "required, not a fallback"; the 2 GB swap from Step 1.5 is what
# makes it safe. Without it this script dies *during* `vite build`, after `emptyOutDir`
# has already cleared `dist/public` - which leaves the running service with no client
# assets until someone rebuilds: the site goes blank, not just "deploy failed".
# Respect a caller's value if they set one explicitly.
export NODE_OPTIONS=${NODE_OPTIONS:---max-old-space-size=896}

BRANCH=${1:-main}
SERVICE=${SMART_ERP_SERVICE:-smart-erp}

echo "==> Fetching origin"
git fetch origin

echo "==> Resetting working tree to origin/$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Installing dependencies (dev deps included: db:push and build need them)"
NODE_ENV=development npm ci

echo "==> Applying the schema to the production database"
set -a
# shellcheck disable=SC1091
source ./.env
set +a
npm run db:push

echo "==> Building"
echo "    NODE_OPTIONS=$NODE_OPTIONS"
NODE_ENV=development npm run build

echo "==> Restarting $SERVICE"
sudo systemctl restart "$SERVICE"

PORT_TO_CHECK=${PORT:-5001}
echo "==> Waiting for http://127.0.0.1:$PORT_TO_CHECK/api/health"
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT_TO_CHECK/api/health" >/dev/null 2>&1; then
    echo "Up: http://127.0.0.1:$PORT_TO_CHECK/api/health"
    curl -s "http://127.0.0.1:$PORT_TO_CHECK/api/health"; echo
    exit 0
  fi
  sleep 1
done

echo "Restarted, but /api/health did not answer within 30s. Last log lines:"
sudo journalctl -u "$SERVICE" -n 40 --no-pager
exit 1
