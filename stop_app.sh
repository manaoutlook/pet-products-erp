#!/bin/bash

# Shell script to stop the Smart ERP DEVELOPMENT server.
#
# AI Agent Note: this used to run `pkill -f "node"`, which also stopped the
# production instance (`node dist/index.js`, port 5002, ../SmartERP-prod) and
# every other Node process on the machine. Only this folder's development server
# is stopped now, and only if it really is this folder's process.

DEV_PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
DEV_PORT=${DEV_PORT:-5001}

echo "Stopping the development server..."

pkill -f "tsx watch .*server/index.ts" 2>/dev/null || true

LISTENER=$(lsof -ti tcp:"$DEV_PORT" -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$LISTENER" ]; then
  LISTENER_CWD=$(lsof -a -p "$LISTENER" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)
  if [ "$LISTENER_CWD" = "$PWD" ]; then
    kill "$LISTENER" 2>/dev/null || true
    sleep 1
    kill -9 "$LISTENER" 2>/dev/null || true
  else
    echo "Port $DEV_PORT is held by pid $LISTENER from $LISTENER_CWD - leaving it alone."
  fi
fi

echo ""
echo "========================================================"
echo "  Development server stopped (port $DEV_PORT)."
echo "  Production (SmartERP-prod, port 5002) was not touched."
echo "========================================================"
echo ""
