#!/bin/bash
# Start ONLY the production instance.
# Unlike ../../pet-products-erp/start_app.sh this never runs `pkill node`, so the
# development server on port 5001 keeps running untouched.
set -e
cd "$(dirname "$0")"

# Load THIS folder's .env into the shell and export it.
#
# `dotenv` (loaded by the server) does not override variables that already exist
# in the environment, and macOS shells often carry a DATABASE_URL inherited from
# the development terminal. Without this, the production process could silently
# run against the development database. `source` does override the shell value,
# so the child process gets exactly what is in this file.
set -a
# shellcheck disable=SC1091
source ./.env
set +a

DBNAME=${DATABASE_URL##*/}
DBNAME=${DBNAME%%\?*}
echo "Database: $DBNAME"

PORT_LINE=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
PORT=${PORT_LINE:-5002}
PID_FILE=.prod.pid

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Production instance is already running (pid $(cat "$PID_FILE"))."
  exit 0
fi

if [ ! -f dist/index.js ]; then
  echo "No production build found. Run: npm run build"
  exit 1
fi

mkdir -p logs
NODE_ENV=production nohup node dist/index.js >> logs/prod.log 2>&1 &
echo $! > "$PID_FILE"

echo "Starting production instance on http://localhost:$PORT ..."
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "Up: http://localhost:$PORT  (pid $(cat "$PID_FILE"), log: logs/prod.log)"
    exit 0
  fi
  sleep 1
done

echo "Did not answer /api/health within 30s - check logs/prod.log"
exit 1
