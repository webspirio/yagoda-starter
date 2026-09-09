# Deploying with Coolify (production + PR previews)

The server `188.245.146.122` (Hetzner, 2 vCPU / 3.7 GiB, Ubuntu 26.04) runs
Coolify. Coolify does **not** build anything: `.github/workflows/ci.yml`
builds both images on every commit and pushes them to GHCR as
`sha-<commit>`; Coolify pulls that tag and runs `docker-compose.prod.yml`.
Design: `docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md`.

| Hostname | What |
|---|---|
| `https://yagoda.webspirio.com` | production (`main`) |
| `https://pr-<N>.yagoda.webspirio.com` | preview of PR `N`, seeded, removed on close |
| `https://coolify.yagoda.webspirio.com` | the Coolify panel |

## How a deploy happens

1. CI (`docker` job) pushes `ghcr.io/webspirio/yagoda-starter-{backend,nginx}:sha-<commit>`.
2. `deploy-prod` (push to `main`) or `deploy-preview` (internal PR, all CI jobs green)
   calls `POST /api/v1/deploy` on Coolify (`scripts/ci/coolify-deploy.sh`).
3. Coolify checks out the commit, sets `SOURCE_COMMIT`, and runs
   `docker compose up` on `docker-compose.prod.yml`, whose `image:` lines resolve
   to `sha-${SOURCE_COMMIT}`.
4. The job waits for Coolify, then checks `/api/health/ready`,
   `/api/health/version == sha-<commit>` and (previews) a seeded login, and only
   then comments «Preview ready» / passes.

Coolify's own auto-deploy is **off**; CI is the only trigger, so Coolify never
pulls a tag that has not been pushed yet. Previews are removed by Coolify's
GitHub App webhook when the PR closes.

## One-time server setup (done 2026-09-…; repeat only for a new server)

1. **Hetzner Cloud Firewall** (console): inbound TCP 22, 80, 443 only. Do this
   *before* installing Coolify — Docker publishes ports past UFW, and the panel
   would otherwise sit on `:8000` over plain HTTP.
2. `scp scripts/vps/bootstrap.sh root@188.245.146.122:/root/ && ssh root@188.245.146.122 bash /root/bootstrap.sh`
   (2 GB swap, `vm.swappiness=10`, `curl git jq`, `/data/backups`).
3. Coolify, unattended so nobody can grab the first-admin slot:
   ```bash
   ssh root@188.245.146.122 'PASS=$(openssl rand -base64 24); umask 077; printf "user=owner\nemail=<owner email>\npassword=%s\n" "$PASS" > /root/coolify-root-credentials; \
     env ROOT_USERNAME=owner ROOT_USER_EMAIL=<owner email> ROOT_USER_PASSWORD="$PASS" AUTOUPDATE=false \
     bash -c "curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash"'
   ```
   Then in the panel (reach it once over an SSH tunnel: `ssh -N -L 8000:localhost:8000 root@188.245.146.122` → `http://localhost:8000`): *Settings → Instance domain* = `https://coolify.yagoda.webspirio.com`. Change the root password.
   `AUTOUPDATE=false`: update Coolify deliberately (Settings → Update) after reading its release notes.
4. **GitHub App** (Coolify → *Sources → + GitHub App*): organization `webspirio`,
   enable **Preview Deployments**; install it on `yagoda-starter` only.
5. **Registry credentials for pulls.** Preferred: Coolify → *Settings → Docker
   registries* (if present in the installed version) → `ghcr.io`, a PAT with
   `read:packages`. Fallback: on the server
   `echo "<PAT>" | docker login ghcr.io -u <github user> --password-stdin`
   (credential lands in `/root/.docker/config.json`, mode 600). Either way note
   the PAT's **expiry date** here: `…`. Rotation: create the new PAT, repeat the
   login, then `docker pull ghcr.io/webspirio/yagoda-starter-nginx:sha-<any recent>` must succeed.
   GHCR PATs are *classic* tokens — fine-grained tokens cannot read packages.
6. **Application** (Coolify → project *yagoda* → *+ New → Private repository (GitHub App)*):
   repo `webspirio/yagoda-starter`, branch `main`, build pack **Docker Compose**,
   compose location `/docker-compose.prod.yml`. Then:
   - *General*: domain for service `nginx` = `https://yagoda.webspirio.com`; **Auto Deploy: off**;
     *Preview Deployments*: on, URL template `pr-{{pr_id}}.yagoda.webspirio.com`.
   - *Advanced*: **Include Source Commit** (`SOURCE_COMMIT`) on.
   - *Environment Variables* — production and preview sets below.
   - Traefik body size: *Custom labels* on `nginx` →
     `traefik.http.middlewares.yagoda-body.buffering.maxRequestBodyBytes=12582912`
     and `traefik.http.routers.<router>.middlewares=yagoda-body` (uploads are 10 MB; the
     internal nginx already allows 12 MB).
7. **GitHub repository settings**: secrets `COOLIFY_URL`, `COOLIFY_API_TOKEN`
   (Coolify → *Keys & Tokens → API tokens*, permissions `deploy` + `read`; add `write`
   only if the fallback below is in force), `COOLIFY_APP_UUID` (from the application URL);
   variables `COOLIFY_ENABLED=true`, `PROD_URL=https://yagoda.webspirio.com`,
   `PREVIEW_DOMAIN=yagoda.webspirio.com`, `PREVIEW_CAP` (optional; overrides the
   default cap of 6 live previews without a commit — `ci.yml` reads
   `vars.PREVIEW_CAP || 6`; set by the recalibration step after Coolify's real
   RSS is measured).
8. **Backups**: `scp scripts/vps/backup.sh root@…:/usr/local/bin/yagoda-backup.sh`,
   the two unit files to `/etc/systemd/system/`, `yagoda-backup.env.example` → `/etc/yagoda-backup.env`
   (fill `PG_CONTAINER`, `UPLOADS_VOLUME` from `docker ps` / `docker volume ls`), then
   `systemctl daemon-reload && systemctl enable --now yagoda-backup.timer && systemctl start yagoda-backup.service`.
   Pairs land in `/data/backups`; restore per `docs/backup-restore.md`.

## Environment variables in Coolify

| Variable | Production | Preview | Note |
|---|---|---|---|
| `APP_URL` | `https://yagoda.webspirio.com` | `https://pr-{{pr_id}}.yagoda.webspirio.com`¹ | CORS allowlist |
| `JWT_SECRET` | 48+ random chars | different 48+ random chars | `openssl rand -base64 48` |
| `DB_PASSWORD` | random | random | |
| `BOOTSTRAP_OWNER_LOGIN` / `_PASSWORD` / `_FIRST_NAME` / `_LAST_NAME` | the real owner | `owner` / `preview-owner-1` / `Preview` / `Owner` | read once, on the first boot of an empty DB |
| `SEED_DEV_DATA` | *(absent)* | `true` | enables the one-shot `seed` service |
| `IMAGE_TAG` | *(absent)* | *(absent)* | **never set** unless the fallback below is in force |

¹ Coolify substitutes `{{pr_id}}` in the preview URL template; whether it does so
inside env values is checked in the spike. If it does not, set the preview
`APP_URL` to `https://yagoda.webspirio.com`: `APP_URL` only feeds the CORS
allowlist, and the SPA calls the API same-origin, so nothing user-visible
changes — only a cross-origin call to a preview API would be refused.

## When development slows down

Turn **Preview Deployments** off in the application (Coolify removes any live
previews on their PRs' close as before). Nothing else changes: Coolify keeps
running production, renewing TLS and taking the nightly backups. To leave
Coolify altogether, see the last section.

## Spike results (fill in during setup — spec §3.1 gates)

| Gate | Result |
|---|---|
| `SOURCE_COMMIT` interpolates in compose | |
| Preview `SOURCE_COMMIT` == PR head SHA | |
| Manual «Redeploy» keeps the same SHA | |
| Preview deleted on PR close with Auto Deploy off | |
| API lists previews (cap source) | |
| Coolify holds registry credentials | |

**Fallback (only if a `SOURCE_COMMIT` gate failed):** CI sets `IMAGE_TAG` in the
relevant env set via `PATCH /api/v1/applications/<uuid>/envs` right before
`deploy`, under the same `concurrency` group. Then **never press «Redeploy» on a
preview in the Coolify UI** — it would use whichever PR wrote `IMAGE_TAG` last;
re-run the PR's `deploy-preview` job instead. The `/api/health/version` check
turns a wrong image into a failed job, not a silent wrong preview.

## When a deploy goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `deploy-*` job: «image pull failed — check the GHCR credential» | PAT expired / removed | Rotate per step 5 |
| `deploy-*` job: Coolify `failed`, log shows compose error | compose file in that branch is invalid | `docker compose -f docker-compose.prod.yml config` locally |
| `serves commit 'X', expected 'Y'` | Coolify deployed another commit (fallback misuse, or Auto Deploy got switched on) | Check Auto Deploy is off; re-run the job |
| `/ready` never 200 | backend crash-loop | Coolify → application → logs; usually a missing env var |
| «Preview not deployed — limit reached» | 6 live previews | close/merge an older PR |
| Prod is wrong after a merge | | `git revert <merge>` + push. **This does not revert schema migrations** — see `docs/backup-restore.md` to restore last night's pair if a migration destroyed data. |

## Leaving Coolify

Same images, same compose: `docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml up -d`
with `IMAGE_TAG=sha-<commit>` in `.env`, host nginx + Certbot per `docs/vps-tls-setup.md`,
data moved with `docs/backup-restore.md`. About 30 minutes.
