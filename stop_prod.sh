#!/bin/bash
# Stop ONLY the production instance (pid file first, then whatever listens on
# the production port). The development server is never touched.
cd "$(dirname "$0")"
PID_FILE=.prod.pid

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    sleep 1
    kill -9 "$PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi

PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-5002}
LISTENER=$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$LISTENER" ]; then
  # Only kill it when it really is a production process started from this
  # folder. The development server can end up on this port (server/index.ts
  # falls back to the next free port), and this script must not take it down.
  LISTENER_CWD=$(lsof -a -p "$LISTENER" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)
  if [ "$LISTENER_CWD" = "$PWD" ]; then
    kill "$LISTENER" 2>/dev/null || true
  else
    echo "Port $PORT is held by pid $LISTENER from $LISTENER_CWD - not the production instance, leaving it alone."
  fi
fi

echo "Production instance stopped (port $PORT). Development server left alone."
