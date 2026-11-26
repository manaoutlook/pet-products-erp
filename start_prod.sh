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

# Refuse to start while somebody else owns the port.
#
# server/index.ts falls back to the next free port when PORT is taken. Without
# this guard the sequence was: production hits EADDRINUSE and exits, the *dev*
# server (which had fallen back to 5002) answers /api/health, and this script
# printed "Up" for an instance that was never running.
LISTENER=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$LISTENER" ]; then
  echo "Port $PORT is already in use by pid $LISTENER: $(ps -p "$LISTENER" -o command= 2>/dev/null)"
  echo "Stop it first (production: ./stop_prod.sh), then run this script again."
  exit 1
fi

mkdir -p logs
NODE_ENV=production nohup node dist/index.js >> logs/prod.log 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"

echo "Starting production instance on http://localhost:$PORT (pid $PID) ..."
for _ in $(seq 1 30); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Production process $PID exited during startup. Last log lines:"
    tail -n 20 logs/prod.log
    rm -f "$PID_FILE"
    exit 1
  fi
  # "Up" means: our pid is alive, our pid is the one listening on $PORT, and
  # /api/health answers - not merely that something answers on the port.
  if [ "$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)" = "$PID" ] \
     && curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo "Up: http://localhost:$PORT  (pid $PID, log: logs/prod.log)"
    exit 0
  fi
  sleep 1
done

echo "pid $PID is alive but did not answer /api/health on port $PORT within 30s - check logs/prod.log"
exit 1
