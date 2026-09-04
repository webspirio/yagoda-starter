# Database & uploads backup and restore

The prod stack's durable state spans THREE volumes (`docker-compose.prod.yml`):
Postgres's `pg_data`, the backend's `uploads_data` (avatar images and any
other uploaded media), and Redis's `redis_data`. Of those, `pg_data` and
`uploads_data` are both business data and both belong in the backup
rotation — `media_files` rows in Postgres reference files that live only on
`uploads_data`, so backing up one without the other leaves you either with
rows pointing at bytes that don't exist, or files nothing references. This
doc covers backing up and restoring both, together.

## Volume inventory

### `pg_data`

The database itself — every table, `media_files` included. Backed up with
`pg_dump` below.

### `uploads_data`

Uploaded images (avatars today; any media a consuming project adds) written
under `/app/uploads` in the backend container and served as static assets.
Business data: a `media_files` row is only meaningful while the file it
points at still exists on this volume, so it needs the same backup rotation
as `pg_data`, not just "survive redeploys."

### `redis_data`

Holds rate-limit counters (the `ThrottlerModule` storage backend). Losing it
just resets those counters to zero — no user-visible state depends on it. It
is **not** business data and does not need to be in the backup rotation; it
needs to survive redeploys, which the volume plus `--appendonly yes` provides.

## Nightly backup with cron + pg_dump + tar

Run this on the VPS, from the same directory as `docker-compose.prod.yml`
(wherever you deployed the repo, e.g. `/opt/web-starter` or your own
`DEPLOY_PATH`). It dumps the database through the running `postgres`
container and archives `uploads_data` through a throwaway container — no
extra Postgres client (or anything else) needs to be installed on the host.
Both run in the SAME script invocation so the two snapshots are taken close
together — `media_files` rows and the files on disk drift out of sync the
longer the gap between the two, since nothing pauses uploads in between.

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
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_DIR/$STAMP-db.sql.gz"

# uploads_data: a throwaway alpine container mounts the named volume
# read-only and tars it straight to stdout — no need to stop the backend or
# touch the running container.
docker run --rm -v web-starter-prod_uploads_data:/data:ro alpine \
  tar czf - -C /data . > "$BACKUP_DIR/$STAMP-uploads.tar.gz"

# Retention: keep the last 14 daily backups (both files), prune the rest.
find "$BACKUP_DIR" -name '*-db.sql.gz' -mtime +14 -delete
find "$BACKUP_DIR" -name '*-uploads.tar.gz' -mtime +14 -delete
```

```bash
chmod +x scripts/backup-db.sh
```

Schedule it (as the `deploy` user, so it can run `docker` and `docker compose`):

```bash
crontab -e
# Nightly at 02:30 server time
30 2 * * * /opt/web-starter/scripts/backup-db.sh >> /var/log/web-starter-backup.log 2>&1
```

The volume name (`web-starter-prod_uploads_data` above) follows Compose's
`<project>_<volume>` convention from this stack's `name: web-starter-prod`
(`docker-compose.prod.yml`); confirm yours with `docker volume ls` if you
overrode the project name.

Adjust `DB_USER`/`DB_NAME` defaults (`app`/`app`) if you changed them in
`.env`; adjust the retention window (`-mtime +14`) to taste.

## Off-box copies

A backup that lives only on the same VPS doesn't protect you from disk
failure or a compromised host. Ship BOTH files — the `-db.sql.gz` dump and
the `-uploads.tar.gz` archive — somewhere else; a copy of one without the
other is exactly the inconsistent state described above, just moved off-box.
Pick whichever fits your setup:

- **rsync/scp to another machine** — simplest option, e.g. a cron job on a
  second host that pulls nightly: `rsync -az deploy@vps:/opt/backups/web-starter/ /local/backups/`.
- **[restic](https://restic.net/)** — encrypted, deduplicated backups to S3,
  Backblaze B2, SFTP, or a local disk; add a `restic backup "$BACKUP_DIR"`
  line to the script above once a repository is initialized.
- **Cloud object storage directly** — `aws s3 cp`, `rclone copy`, or your
  provider's CLI, appended to the backup script after the two lines above.

Whichever you choose, keep at least one copy that isn't reachable from the
VPS itself (so a compromised or destroyed VPS can't take out your backups
too).

## Restore procedure

Restore the database and the uploads volume TOGETHER, from a matching pair
of backup files (same `$STAMP`) — restoring one without the other reproduces
the inconsistency the nightly script exists to avoid.

1. Copy the desired `-db.sql.gz` and `-uploads.tar.gz` onto the VPS (or
   wherever you're restoring to) and decompress the dump:
   `gunzip -k 20260707-023000-db.sql.gz`.
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
     psql -U "$DB_USER" "$DB_NAME" < 20260707-023000-db.sql
   ```
5. Replace `uploads_data`'s contents with the matching archive — this
   discards whatever is currently on the volume, same caveat as step 3:
   ```bash
   docker run --rm -v web-starter-prod_uploads_data:/data \
     -v "$(pwd)":/backup alpine sh -c \
     'rm -rf /data/* && tar xzf /backup/20260707-023000-uploads.tar.gz -C /data'
   ```
6. Restart the backend:
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
stack, or a throwaway database and volume on the same box under different
names — and confirm the app actually boots, reads data correctly, AND that
an avatar image (or other upload) referenced by a `media_files` row actually
loads — not just that the row exists. Finding out a dump is corrupt or
incomplete (or that the two backups drifted out of sync) during an actual
outage is the worst possible time to learn that.
