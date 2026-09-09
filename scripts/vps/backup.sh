#!/usr/bin/env bash
# Nightly backup of the yagoda prod stack: ONE logical snapshot = a pg_dump
# and a tar of the uploads volume taken back-to-back under one STAMP.
# media_files rows reference files that live only on the uploads volume, so
# the two halves are only meaningful together (docs/backup-restore.md).
#
# Atomic: both halves are written as *.partial, verified, and renamed into
# place only when BOTH succeeded; on any failure both partials are removed, so
# the backup directory never contains an unmatched file. flock serializes a
# manual run against the timer.
#
# Config: /etc/yagoda-backup.env (see yagoda-backup.env.example).
set -euo pipefail

CONFIG=${CONFIG:-/etc/yagoda-backup.env}
[ -r "$CONFIG" ] || { echo "missing config $CONFIG" >&2; exit 1; }
# shellcheck disable=SC1090
. "$CONFIG"
: "${PG_CONTAINER:?set in $CONFIG}" "${UPLOADS_VOLUME:?set in $CONFIG}"
: "${DB_USER:?set in $CONFIG}" "${DB_NAME:?set in $CONFIG}"
BACKUP_DIR=${BACKUP_DIR:-/data/backups}
RETENTION_DAYS=${RETENTION_DAYS:-14}
LOCK=${LOCK:-/run/lock/yagoda-backup.lock}

mkdir -p "$BACKUP_DIR" "$(dirname "$LOCK")"
exec 9>"$LOCK"
flock -n 9 || { echo "another backup is running; skipping" >&2; exit 0; }

STAMP=$(date +%Y%m%d-%H%M%S)
DB="$BACKUP_DIR/$STAMP-db.sql.gz"
UP="$BACKUP_DIR/$STAMP-uploads.tar.gz"

cleanup_partials() { rm -f "$DB.partial" "$UP.partial"; }
trap 'cleanup_partials; echo "backup $STAMP FAILED" >&2' ERR

echo "backup $STAMP: database"
docker exec "$PG_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$DB.partial"
gzip -t "$DB.partial"
# Drain gunzip fully instead of letting head close the pipe early: under
# pipefail an early close hands gunzip SIGPIPE (exit 141) and would fail
# every backup larger than the pipe buffer.
gunzip -c "$DB.partial" | { head -c 4096; cat >/dev/null; } | grep -q 'PostgreSQL database dump'

echo "backup $STAMP: uploads"
# docker run -v auto-creates a missing named volume, which would produce an
# empty but "valid" archive from a stale name; fail loudly instead.
docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1 || { echo "uploads volume '$UPLOADS_VOLUME' does not exist" >&2; false; }
docker run --rm -v "$UPLOADS_VOLUME:/data:ro" alpine tar czf - -C /data . > "$UP.partial"
tar -tzf "$UP.partial" >/dev/null

mv "$DB.partial" "$DB"
mv "$UP.partial" "$UP"
# Retention runs untrapped on purpose: a pruning glitch must not mark the snapshot just taken as FAILED.
trap - ERR
echo "backup $STAMP: ok ($(du -h "$DB" | cut -f1) db, $(du -h "$UP" | cut -f1) uploads)"

# Retention by pair: a pair is pruned when its db half is older than the window.
find "$BACKUP_DIR" -name '*-db.sql.gz' -mtime +"$RETENTION_DAYS" -print0 |
  while IFS= read -r -d '' old; do
    rm -f "$old" "${old%-db.sql.gz}-uploads.tar.gz"
    echo "pruned ${old##*/} and its uploads half"
  done
