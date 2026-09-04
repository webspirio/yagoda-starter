# Database backup & restore

The prod stack's durable state includes the Postgres `pg_data` volume
(`docker-compose.prod.yml`). Redis backs HTTP rate-limiting counters only —
not business data — and does not need backup rotation (see volume inventory
below). This doc covers backing up and restoring Postgres.

## Volume inventory

### `redis_data`

Holds rate-limit counters (the `ThrottlerModule` storage backend). Losing it
just resets those counters to zero — no user-visible state depends on it. It
is **not** business data and does not need to be in the backup rotation; it
needs to survive redeploys, which the volume plus `--appendonly yes` provides.

## Nightly backup with cron + pg_dump

Run this on the VPS, from the same directory as `docker-compose.prod.yml`
(wherever you deployed the repo, e.g. `/opt/web-starter` or your own
`DEPLOY_PATH`). It dumps the database through the running `postgres`
container — no extra Postgres client needs to be installed on the host.

```bash
#!/usr/bin/env bash
# /opt/web-starter/scripts/backup-db.sh
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source .env; set +a   # loads DB_USER / DB_NAME (and everything else) into the shell

BACKUP_DIR="/opt/backups/web-starter"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/$STAMP.sql.gz"

# Retention: keep the last 14 daily dumps, prune the rest.
find "$BACKUP_DIR" -name '*.sql.gz' -mtime +14 -delete
```

```bash
chmod +x scripts/backup-db.sh
```

Schedule it (as the `deploy` user, so it can run `docker compose`):

```bash
crontab -e
# Nightly at 02:30 server time
30 2 * * * /opt/web-starter/scripts/backup-db.sh >> /var/log/web-starter-backup.log 2>&1
```

Adjust `DB_USER`/`DB_NAME` defaults (`app`/`app`) if you changed them in
`.env`; adjust the retention window (`-mtime +14`) to taste.

## Off-box copies

A backup that lives only on the same VPS doesn't protect you from disk
failure or a compromised host. Ship the dumps somewhere else — pick whichever
fits your setup:

- **rsync/scp to another machine** — simplest option, e.g. a cron job on a
  second host that pulls nightly: `rsync -az deploy@vps:/opt/backups/web-starter/ /local/backups/`.
- **[restic](https://restic.net/)** — encrypted, deduplicated backups to S3,
  Backblaze B2, SFTP, or a local disk; add a `restic backup "$BACKUP_DIR"`
  line to the script above once a repository is initialized.
- **Cloud object storage directly** — `aws s3 cp`, `rclone copy`, or your
  provider's CLI, appended to the backup script after the `pg_dump` line.

Whichever you choose, keep at least one copy that isn't reachable from the
VPS itself (so a compromised or destroyed VPS can't take out your backups
too).

## Restore procedure

1. Copy the desired `.sql.gz` onto the VPS (or wherever you're restoring to)
   and decompress it: `gunzip -k 20260707-023000.sql.gz`.
2. Stop the backend so it isn't writing during the restore (Postgres itself
   stays up):
   ```bash
   docker compose -f docker-compose.prod.yml stop backend
   ```
3. Drop and recreate the database (this discards whatever is currently in
   it — make sure that's what you want, or restore into a fresh/renamed
   database instead if you need to keep the current data around for
   comparison):
   ```bash
   docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U "$DB_USER" -d postgres -c "DROP DATABASE \"$DB_NAME\";"
   docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$DB_NAME\";"
   ```
4. Load the dump:
   ```bash
   docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U "$DB_USER" "$DB_NAME" < 20260707-023000.sql
   ```
5. Restart the backend:
   ```bash
   docker compose -f docker-compose.prod.yml up -d backend
   ```
   `migrationsRun: true` will no-op if the dump already matches the current
   schema; if you're restoring an older dump onto a newer codebase, pending
   migrations apply automatically on this startup.

## Test your restore

A backup you've never restored is a hope, not a plan. Periodically (e.g.
quarterly, or after any significant schema change) run the restore procedure
above against a scratch environment — a second VPS, a local `docker compose`
stack, or a throwaway database on the same box under a different name — and
confirm the app actually boots and reads data correctly against the restored
copy. Finding out a dump is corrupt or incomplete during an actual outage is
the worst possible time to learn that.
