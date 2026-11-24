#!/bin/bash
# Deploy what is on origin/main to this production instance, then restart it.
#
# Usage: ./deploy.sh            # deploy origin/main
#        ./deploy.sh <branch>   # deploy origin/<branch>
#
# Production never commits. Anything you want here must be pushed from the
# development checkout first.
#
# NOTE: `.env` is untracked (removed from the index - `.gitignore` always listed
# it), so `git reset --hard` no longer touches this instance's file. The
# backup/restore below is kept as cheap insurance only: without it, a `.env`
# accidentally re-added to the index would silently point production at the
# development database and port.
set -e
cd "$(dirname "$0")"

BRANCH=${1:-main}

echo "==> Preserving this instance's .env"
cp .env .env.prod-instance

echo "==> Fetching origin"
git fetch origin
echo "==> Checking out origin/$BRANCH"
git reset --hard "origin/$BRANCH"
mv .env.prod-instance .env

echo "==> Installing dependencies"
# AI Agent Note - two traps here, both of which break the deploy before it starts:
#  1. Do NOT re-add `--legacy-peer-deps`. `ws` lists `bufferutil` and `utf-8-validate` as
#     *optional* peers (`peerDependenciesMeta.optional: true`). npm 11 with that flag treats
#     them as required and then fails with "Missing: bufferutil@4.2.0 from lock file" even
#     though the lockfile is correct. Plain `npm ci` installs the lockfile as-is.
#  2. Do NOT rely on the caller's shell. `drizzle-kit` (db:push) and `vite`/`esbuild` (build)
#     are devDependencies, and a shell that already exports NODE_ENV=production makes `npm ci`
#     prune them - leaving "drizzle-kit: command not found" two steps later. NODE_ENV is set
#     explicitly so the script behaves the same whatever it is launched from.
NODE_ENV=development npm ci

echo "==> Applying the schema to the production database"
# `db:push` is the only schema mechanism in this project (the SQL journal under
# migrations/ is reference only). It prompts before anything destructive, so it
# belongs in an interactive terminal, not in a cron job.
set -a
# shellcheck disable=SC1091
source ./.env
set +a
npm run db:push

echo "==> Building"
npm run build

echo "==> Restarting"
./stop_prod.sh
./start_prod.sh
