#!/bin/bash
# Print what the production instance is really doing: process, port, the database
# its environment points at, whether that database is the one receiving traffic,
# and a couple of sanity counts. Read-only - safe to run any time.
set -e
cd "$(dirname "$0")"

PID_FILE=.prod.pid

if [ ! -f "$PID_FILE" ] || ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Production instance: NOT RUNNING (no live pid in $PID_FILE)"
  exit 0
fi
PID=$(cat "$PID_FILE")

echo "pid:      $PID"
echo "command:  $(ps -p "$PID" -o command=)"
echo "cwd:      $(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)"

ENV_URL=$(ps eww -p "$PID" | tr ' ' '\n' | grep '^DATABASE_URL=' | head -1 | cut -d= -f2-)
echo "env db:   $(printf '%s' "$ENV_URL" | sed -E 's#://[^:]*:[^@]*@#://***:***@#')"

FILE_URL=$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)
echo "file db:  $(printf '%s' "$FILE_URL" | sed -E 's#://[^:]*:[^@]*@#://***:***@#')"

if [ "$ENV_URL" != "$FILE_URL" ]; then
  echo "WARNING: running process does NOT match .env - restart with ./stop_prod.sh && ./start_prod.sh"
else
  echo "OK:      process and .env agree"
fi

DBNAME=${ENV_URL##*/}
DBNAME=${DBNAME%%\?*}
PORT=$(grep -E '^PORT=' .env | cut -d= -f2)

echo ""
echo "health:   $(curl -s --max-time 3 "http://localhost:$PORT/api/health" || echo 'no answer')"
echo "company:  $(psql -h localhost -U postgres -d "$DBNAME" -Atc 'select company_name from company' 2>/dev/null || echo 'n/a')"
echo "counts:   users=$(psql -h localhost -U postgres -d "$DBNAME" -Atc 'select count(*) from users' 2>/dev/null) products=$(psql -h localhost -U postgres -d "$DBNAME" -Atc 'select count(*) from products' 2>/dev/null) sessions=$(psql -h localhost -U postgres -d "$DBNAME" -Atc 'select count(*) from user_sessions' 2>/dev/null)"
