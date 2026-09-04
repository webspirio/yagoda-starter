#!/usr/bin/env bash
#
# DESTRUCTIVE. Wipes every row of application data from the database, leaving
# only the schema and TypeORM's `migrations` bookkeeping table.
#
# WHY IT IS ALL-OR-NOTHING
#   "Just wipe users, keep the audit log" is not expressible: ON DELETE
#   RESTRICT foreign keys chain the deletion outwards (audit_log.actor_id ->
#   users.id). So wiping users necessarily wipes user_identities,
#   user_credentials, audit_log and media_files. This script does exactly
#   that, in one TRUNCATE ... CASCADE, rather than pretending a narrower wipe
#   is possible.
#
# WHAT SURVIVES
#   - the schema itself and the `migrations` table (so migrations do NOT re-run)
#   - files on the uploads volume: the media_files ROWS go, the BYTES stay.
#     They become orphaned avatar files with no database row pointing at them.
#
# WHAT DOES NOT COME BACK ON ITS OWN
#   - The dev seed account (username `admin`, password `admin`) is created by
#     the 1788600000001-SeedDevAdmin migration, which is already recorded in
#     `migrations` and will NOT re-run after this wipe. If you need it back,
#     revert that one migration and re-run it, or insert the row by hand.
#
#   - ISSUED JWTs stay valid for up to their configured JWT_EXPIRES_IN.
#     JwtStrategy.validate() never reads the database — it trusts the payload
#     as-is — so a deleted user's token keeps authenticating until it expires.
#     ROTATE JWT_SECRET as part of this reset if that matters for your case.
#     The script cannot do it for you; it lives in the deployment environment.
#
# REDIS
#   Redis holds only rate-limit counters (see backend/src/redis), which are
#   short-lived and safe to lose — nothing durable depends on them, so
#   flushing is optional cleanup rather than a correctness requirement. This
#   script flushes Redis by default; pass --keep-redis to skip.
#
# USAGE
#   ./scripts/reset-data.sh --confirm <DB_NAME> [--yes]
#
#   --confirm <DB_NAME>  must match the database being wiped; typing it is the
#                        safety gate (there is no default that lets this fire).
#   --yes                skip the interactive prompt (for a scripted run).
#   --keep-redis         do NOT flush Redis.
#
#   POSTGRES_CONTAINER=... REDIS_CONTAINER=... DB_USER=... DB_NAME=...
#   BACKUP_DIR=... override the defaults, which point at the PRODUCTION stack.
#
set -euo pipefail

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-web-starter-prod-postgres-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-web-starter-prod-redis-1}"
DB_USER="${DB_USER:-app}"
DB_NAME="${DB_NAME:-app}"
# NOT ./backups: this writes a plain-text dump of every user's display name
# and any other row data. Inside the repo one `git add -A` leaks it
# permanently. `backups/` is gitignored too, as a second line.
BACKUP_DIR="${BACKUP_DIR:-${HOME}/web-starter-backups}"

# Bookkeeping tables that must survive; everything else in `public` is data.
KEEP_TABLES="'migrations','typeorm_metadata'"

confirm_name=""
assume_yes=0
flush_redis=1
while [ $# -gt 0 ]; do
  case "$1" in
    --confirm)
      [ $# -ge 2 ] || { echo "--confirm requires the database name" >&2; exit 2; }
      confirm_name="$2"; shift 2 ;;
    --yes)        assume_yes=1; shift ;;
    --keep-redis) flush_redis=0; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [ "$confirm_name" != "$DB_NAME" ]; then
  echo "refusing to run: pass --confirm $DB_NAME to wipe database '$DB_NAME'" >&2
  echo "(container=$POSTGRES_CONTAINER user=$DB_USER)" >&2
  exit 2
fi

psql() { docker exec -i "$POSTGRES_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -tA "$@"; }

echo "target: container=$POSTGRES_CONTAINER db=$DB_NAME user=$DB_USER"
echo

# --- 1. what is about to be destroyed -----------------------------------------
echo "=== rows to be destroyed ==="
# ANALYZE first: pg_stat_user_tables.n_live_tup is an estimate, and it reads 0
# after a restore, a failover or pg_stat_reset() — which would show an empty
# destruction list for a full database, defeating the only human safety gate here.
psql -c "ANALYZE;" > /dev/null
psql -F'|' -c "
  SELECT relname, n_live_tup
  FROM pg_stat_user_tables
  WHERE schemaname = 'public' AND relname NOT IN ($KEEP_TABLES) AND n_live_tup > 0
  ORDER BY n_live_tup DESC;" | awk -F'|' '{printf "  %-28s %s\n", $1, $2}'
echo

# --- 2. backup first -----------------------------------------------------------
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$BACKUP_DIR/pre-reset-$DB_NAME-$stamp.sql.gz"
echo "=== backing up to $dump ==="
docker exec "$POSTGRES_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$dump"

# A dump that is trivially small means pg_dump failed into a pipe that still
# produced valid gzip. Refuse to wipe on the strength of a useless backup.
size="$(wc -c < "$dump" | tr -d ' ')"
# 10 KB, not 1 KB: a whole-schema dump of an EMPTY database is already tens of
# KB, so 1 KB would have accepted a truncated file.
if [ "$size" -lt 10000 ]; then
  echo "backup is only ${size} bytes — aborting without wiping" >&2
  exit 1
fi
if ! gunzip -t "$dump" 2>/dev/null; then
  echo "backup failed its gzip integrity check — aborting without wiping" >&2
  exit 1
fi
echo "  ok (${size} bytes)"
echo

# --- 3. last chance ------------------------------------------------------------
if [ "$assume_yes" -ne 1 ]; then
  printf 'Type WIPE to destroy all application data in %s: ' "$DB_NAME"
  read -r answer
  [ "$answer" = "WIPE" ] || { echo "aborted"; exit 1; }
fi

# --- 4. truncate ---------------------------------------------------------------
# Enumerated dynamically so a table added later is not silently spared. CASCADE
# resolves FK order for us; RESTART IDENTITY resets any sequences.
tables="$(psql -c "
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ')
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename NOT IN ($KEEP_TABLES);")"

if [ -z "$tables" ]; then
  echo "no data tables found — nothing to do" >&2
  exit 1
fi

echo "=== truncating ==="
# lock_timeout: TRUNCATE takes ACCESS EXCLUSIVE, so one live backend transaction
# would otherwise block it indefinitely while queuing every other query behind it.
# Failing fast is better than a silent outage — stop the backend and re-run.
psql -c "SET lock_timeout = '30s'; TRUNCATE $tables RESTART IDENTITY CASCADE;"
echo "  done"
echo

# --- 5. redis ------------------------------------------------------------------
if [ "$flush_redis" -eq 1 ]; then
  echo "=== flushing redis ($REDIS_CONTAINER) ==="
  # Non-fatal on purpose: under `set -e` an unreachable redis would abort the
  # script AFTER the database is already wiped and BEFORE the next-steps block
  # prints — leaving the operator with no instructions.
  if docker exec "$REDIS_CONTAINER" redis-cli FLUSHDB > /dev/null 2>&1; then
    echo "  done"
  else
    echo "  WARNING: redis flush FAILED — flush it manually if needed." >&2
  fi
else
  echo "=== redis NOT flushed (--keep-redis) ==="
fi
echo

# --- 6. verify -----------------------------------------------------------------
remaining="$(psql -c "
  SELECT coalesce(sum(n_live_tup), 0)
  FROM pg_stat_user_tables
  WHERE schemaname = 'public' AND relname NOT IN ($KEEP_TABLES);")"
migrations_kept="$(psql -c "SELECT count(*) FROM migrations;")"

echo "=== result ==="
echo "  data rows remaining : $remaining  (stat counters may lag; 0 expected)"
echo "  migrations rows kept: $migrations_kept  (must be > 0)"
[ "$migrations_kept" -gt 0 ] || { echo "  migrations table was emptied — restore from $dump" >&2; exit 1; }
echo
echo "Next:"
echo "  1. ROTATE JWT_SECRET in the deployment env if you need already-issued"
echo "     tokens to stop working immediately; otherwise they stay valid until"
echo "     they expire, since JwtStrategy never checks the database."
echo "  2. If you need the dev seed account back, revert and re-run"
echo "     1788600000001-SeedDevAdmin (it will not re-run on its own)."
echo "  3. verify: GET /health/ready"
echo "  4. backup kept at $dump"
