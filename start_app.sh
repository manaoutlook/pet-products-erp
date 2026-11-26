#!/bin/bash

# Shell script to start the Smart ERP DEVELOPMENT server (http://localhost:5001).
#
# AI Agent Note: this used to run `pkill -f "node"`, which killed EVERY Node
# process on the machine - the production instance (`node dist/index.js` on port
# 5002, see ../SmartERP-prod/logs/prod.log) included, plus any editor helper.
# Starting development therefore took production down silently: its log just
# stops with no error, and `start_prod.sh` could still report "Up" because the
# development server answered /api/health on the production port. Only the
# development server is stopped here.

DEV_PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2)
DEV_PORT=${DEV_PORT:-5001}

# The watcher this folder starts (`tsx watch ... server/index.ts`). Nothing else
# matches: production is plain `node dist/index.js`.
pkill -f "tsx watch .*server/index.ts" 2>/dev/null || true

# A leftover process still holding the development port (e.g. an earlier
# `node dist/index.js` started from this folder by mistake). Only a process whose
# working directory is THIS folder is stopped - a production instance living in
# SmartERP-prod must never be touched from here.
LISTENER=$(lsof -ti tcp:"$DEV_PORT" -sTCP:LISTEN 2>/dev/null | head -1)
if [ -n "$LISTENER" ]; then
  LISTENER_CWD=$(lsof -a -p "$LISTENER" -d cwd -Fn 2>/dev/null | grep '^n' | cut -c2-)
  if [ "$LISTENER_CWD" = "$PWD" ]; then
    echo "Freeing development port $DEV_PORT (pid $LISTENER: $(ps -p "$LISTENER" -o command= 2>/dev/null))"
    kill "$LISTENER" 2>/dev/null || true
    sleep 1
  else
    echo "Port $DEV_PORT is held by pid $LISTENER from $LISTENER_CWD - leaving it alone."
  fi
fi

# Print the URL after a short delay so it appears at the end of the startup logs
(sleep 5 && echo -e "\n========================================================\n  Application started. Access it at: http://localhost:$DEV_PORT\n========================================================\n") &

# Start the development server (foreground, stop with Ctrl+C)
npm run dev
