#!/bin/bash
# SmartERP - nightly backup: PostgreSQL dump + uploaded files, on the server and
# (optionally) in OneDrive.
#
# One cron entry, 03:00 server time:
#   0 3 * * * /opt/SmartERP/deploy/backup.sh >> /opt/SmartERP/logs/backup.log 2>&1
#
# Local output, in /opt/SmartERP/backups:
#   db_<stamp>.dump       pg_dump -Fc, one per night, kept BACKUP_KEEP_DAYS (14)
#   uploads_<stamp>.tgz   full tar of uploads/, kept BACKUP_KEEP_DAYS (14)
#   last_backup.txt       status=ok|failed, timestamp, sizes, remote state of the run
#
# Off-site output, when BACKUP_RCLONE_REMOTE is set in .env (e.g. OneDrive):
#   <remote>/db_<stamp>.dump   copied nightly, pruned after BACKUP_REMOTE_KEEP_DAYS (30)
#   <remote>/uploads/...       incremental copy, never deletes
#
# Why the files are mirrored instead of tarred off-site: the uploads tree only
# grows (product pictures, signed delivery notes, archived invoice HTML), so 14
# daily tarballs would multiply it by 14 and blow a 5 GB OneDrive quota. Mirroring
# uploads once and keeping the small database dumps for 30 days costs roughly one
# copy of the files plus a few hundred MB.
#
# Why database AND files together: the tables store only /uploads/... URLs; a dump
# without the files restores rows that point at documents nobody can open.
#
# Configuration read from /opt/SmartERP/.env:
#   BACKUP_RCLONE_REMOTE     e.g. onedrive:SmartERP-backups  (empty = local only)
#   BACKUP_KEEP_DAYS         local retention, default 14
#   BACKUP_REMOTE_KEEP_DAYS  remote dump retention, default 30

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
set -a; source ./.env; set +a

KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
REMOTE_KEEP_DAYS=${BACKUP_REMOTE_KEEP_DAYS:-30}
REMOTE=${BACKUP_RCLONE_REMOTE:-}

STAMP=$(date +%Y%m%d_%H%M)
# `date -Is` is GNU-only; this form works on Ubuntu and on a Mac alike.
ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
mkdir -p backups logs

DB_FILE="backups/db_${STAMP}.dump"
UPLOADS_FILE="backups/uploads_${STAMP}.tgz"

# One run at a time: an upload over a slow line must never overlap with tomorrow's.
if command -v flock >/dev/null; then
  exec 9>"${TMPDIR:-/tmp}/smart-erp-backup.lock"
  flock -n 9 || { echo "$(ts) another backup is still running - skipping this run"; exit 0; }
fi

REMOTE_STATUS="skipped (BACKUP_RCLONE_REMOTE not set in .env)"
# Pessimistic until the last line: any failure after this point is recorded, so
# `cat backups/last_backup.txt` in the morning never lies about last night.
FINAL_STATUS="failed"

write_status() {
  {
    echo "finished=$(ts)"
    echo "status=$FINAL_STATUS"
    if [ -f "$DB_FILE" ]; then echo "db=$DB_FILE ($(du -h "$DB_FILE" | cut -f1))"; fi
    if [ -f "$UPLOADS_FILE" ]; then echo "uploads=$UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1))"; fi
    echo "remote=$REMOTE_STATUS"
  } > backups/last_backup.txt.tmp && mv backups/last_backup.txt.tmp backups/last_backup.txt
}
trap write_status EXIT

echo "$(ts) ===== SmartERP backup start ====="

echo "$(ts) dumping database"
pg_dump -Fc "$DATABASE_URL" -f "$DB_FILE"

echo "$(ts) archiving uploads"
tar czf "$UPLOADS_FILE" uploads

echo "$(ts) local: $DB_FILE ($(du -h "$DB_FILE" | cut -f1)), $UPLOADS_FILE ($(du -h "$UPLOADS_FILE" | cut -f1))"

echo "$(ts) pruning local files older than ${KEEP_DAYS} days"
find backups -maxdepth 1 -type f \( -name 'db_*.dump' -o -name 'uploads_*.tgz' \) \
  -mtime "+${KEEP_DAYS}" -print -delete

if [ -n "$REMOTE" ]; then
  if ! command -v rclone >/dev/null; then
    echo "$(ts) ERROR rclone is not installed - the local backup is fine, the off-site copy is not"
    exit 1
  fi
  RCLONE_CONF=${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}
  if [ ! -f "$RCLONE_CONF" ]; then
    echo "$(ts) ERROR no rclone config at $RCLONE_CONF - see docs/PRODUCTION_SERVER.md Step 10.4"
    exit 1
  fi

  echo "$(ts) off-site: $DB_FILE -> $REMOTE"
  rclone copy "$DB_FILE" "$REMOTE" --transfers 2 --stats-one-line --stats 30s

  echo "$(ts) off-site: mirroring uploads/ -> $REMOTE/uploads (adds and updates only)"
  rclone copy uploads "$REMOTE/uploads" --transfers 2 --stats-one-line --stats 30s

  echo "$(ts) off-site: pruning database dumps older than ${REMOTE_KEEP_DAYS} days"
  rclone delete "$REMOTE" --include 'db_*.dump' --min-age "${REMOTE_KEEP_DAYS}d"

  echo "$(ts) off-site: verifying tonight's dump arrived with the right size"
  name=$(basename "$DB_FILE")
  local_bytes=$(wc -c < "$DB_FILE" | tr -d ' ')
  # --files-only matters: on rclone 1.60 `lsf` still lists directories under the
  # remote, so the size column also contains a -1 row for `uploads` and the string
  # comparison fails with `local=223207B remote=223207\n-1B`.
  remote_bytes=$(rclone lsf "$REMOTE" --include "$name" --files-only --format sp \
    | cut -d';' -f1 | head -1 | tr -d '[:space:]')
  if [ "$remote_bytes" != "$local_bytes" ]; then
    echo "$(ts) ERROR off-site dump size mismatch: local=${local_bytes}B remote=${remote_bytes:-missing}B"
    exit 1
  fi

  REMOTE_STATUS="ok ($REMOTE)"
fi

echo "$(ts) off-site: $REMOTE_STATUS"
FINAL_STATUS="ok"
echo "$(ts) ===== SmartERP backup OK ====="
