# Deploying with Coolify (production + PR previews)

The server `188.245.146.122` (Hetzner, 4 vCPU / 7.6 GiB, Ubuntu 26.04 — resized
up from 2 vCPU / 3.7 GiB on 2026-09-10, which is why the spec's sizing
arithmetic reads smaller than the table below) runs
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
   to `sha-${SOURCE_COMMIT}` (the `SOURCE_COMMIT` behaviour is confirmed by the
   spike below before the first real deploy).
4. The job waits for Coolify, then checks `/api/health/ready`,
   `/api/health/version == sha-<commit>` and (previews) a seeded login, and only
   then comments «Preview ready» / passes.

Coolify's own auto-deploy is **off**; CI is the only trigger, so Coolify never
pulls a tag that has not been pushed yet. Previews are removed by Coolify's
GitHub App webhook when the PR closes.

`deploy-preview` runs `scripts/ci/coolify-deploy.sh` from the PR's own checkout
with the Coolify token in its environment — acceptable for internal PRs only,
which is why fork PRs are excluded.

**Previews are on the public internet.** «Nobody knows the hostname» is not a
control: every Let's Encrypt certificate publishes its hostname to Certificate
Transparency logs within minutes of issue, so `pr-<N>.yagoda.webspirio.com` is
discoverable by anyone watching those feeds. A preview carries seeded demo data
and a `network_owner` account, and its 10 MB upload endpoint writes to a volume
on the **same 38 GB disk as production** — a preview filled with junk uploads is
a production outage. Put Traefik basic auth on the preview routers (same place
as the body-size middleware in step 6):
`traefik.http.middlewares.yagoda-preview-auth.basicauth.users=<htpasswd line>`,
added to the preview router's `middlewares=` list.

**If you add that middleware you MUST also set the `PREVIEW_BASIC_AUTH`
repository secret** to the same `user:pass`. The middleware covers every path,
so `deploy-preview`'s three assertions (`/api/health/ready`,
`/api/health/version`, the seeded login) would otherwise all get 401 and every
preview deploy would fail. `ci.yml` passes the secret to the deploy script,
which sends it as `curl -u`; unset means no credentials are sent, which is
correct for previews with no middleware. Never reuse a production password for
the preview owner or for this middleware.

## One-time server setup (steps 1–4, 6–7 done 2026-09-09; repeat only for a new server)

1. **Hetzner Cloud Firewall** (console): inbound TCP 22, 80, 443 only. Do this
   *before* installing Coolify — Docker publishes ports past UFW, and the panel
   would otherwise sit on `:8000` over plain HTTP.
2. `ssh root@188.245.146.122 'apt-get update && apt-get upgrade -y'`, then
   `scp scripts/vps/bootstrap.sh root@188.245.146.122:/root/ && ssh root@188.245.146.122 bash /root/bootstrap.sh`
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
   - Request body size: **nothing to configure.** Traefik imposes no default
     limit (`buffering.maxRequestBodyBytes` defaults to 0 = unlimited), and the
     `buffering` middleware is opt-in — adding it would *introduce* a cap and
     make Traefik buffer whole uploads before forwarding them. The 12 MB rule
     belongs to the standalone path, where a host **nginx** terminates TLS and
     its 1 MB default would 413 an upload. Here the path is already clear:
     Traefik unlimited → internal nginx `client_max_body_size 12m`
     (`nginx/nginx.conf:24`) → the app's own 10 MB cap (`MEDIA_MAX_BYTES`).
7. **GitHub repository settings**: secrets `COOLIFY_URL`, `COOLIFY_API_TOKEN`
   (Coolify → *Keys & Tokens → API tokens*, permissions `deploy` + `read`; add `write`
   only if the fallback below is in force), `COOLIFY_APP_UUID` (from the application URL);
   variables `COOLIFY_ENABLED=true`, `PROD_URL=https://yagoda.webspirio.com`,
   `PREVIEW_DOMAIN=yagoda.webspirio.com`, `PREVIEW_CAP` (optional; overrides the
   default cap of 12 live previews without a commit — `ci.yml` reads
   `vars.PREVIEW_CAP || 12`; the default was recalibrated on 2026-09-10 against
   the resized server and Coolify's measured RSS — see «Memory» below).
8. **Backups**: `scp scripts/vps/backup.sh root@…:/usr/local/bin/yagoda-backup.sh`,
   the two unit files to `/etc/systemd/system/`, `yagoda-backup.env.example` → `/etc/yagoda-backup.env`
   (fill `PG_CONTAINER`, `UPLOADS_VOLUME` from `docker ps` / `docker volume ls` — pick
   the **production** application's container/volume, not a preview's (previews
   also run a postgres and an uploads volume)), then
   `chmod +x /usr/local/bin/yagoda-backup.sh`, `chmod 600 /etc/yagoda-backup.env`, then
   `systemctl daemon-reload && systemctl enable --now yagoda-backup.timer && systemctl start yagoda-backup.service`.
   Pairs land in `/data/backups`; restore per `docs/backup-restore.md`.

## Environment variables in Coolify

| Variable | Production | Preview | Note |
|---|---|---|---|
| `APP_URL` | `https://yagoda.webspirio.com` | `https://pr-{{pr_id}}.yagoda.webspirio.com`¹ | CORS allowlist |
| `JWT_SECRET` | 48+ random chars | different 48+ random chars | `openssl rand -base64 48` |
| `DB_PASSWORD` | random | random | |
| `BOOTSTRAP_OWNER_LOGIN` / `_PASSWORD` / `_FIRST_NAME` / `_LAST_NAME` | the real owner | `owner` / *generate one* / `Preview` / `Owner` | read once, on the first boot of an empty DB. Generate the preview password too (`openssl rand -base64 18`) and keep it in Coolify only — a password written into a repo doc is a password on every preview forever |
| `PASSWORD_VAULT_KEY` | *(set it, or leave the feature off)* | *(optional)* | `openssl rand -base64 32`. Lets the owner READ an issued password back on «Користувачі» (issue #11). Absent = the feature is off and passwords are hashed only. **Never change it after passwords have been issued** — the existing copies stop opening (logins keep working; each password has to be reissued to become readable again) |
| `SEED_DEV_DATA` | *(absent)* | `true` | enables the one-shot `seed` service — **the only thing that keeps demo data out of production; never set it in the production env set** |
| `IMAGE_TAG` | *(absent)* | *(absent)* | **never set** unless the fallback below is in force |
| `POSTGRES_MEM_LIMIT` | `768m` | *(absent → 256m)* | see «Memory» below |
| `BACKEND_MEM_LIMIT` / `BACKEND_HEAP_MB` | `768m` / `576` | *(absent → 384m / 256)* | the heap cap must stay well below the mem_limit, so an OOM is a Node error, not a SIGKILL |
| `REDIS_MEM_LIMIT` / `NGINX_MEM_LIMIT` | `128m` / `64m` | *(absent → 64m / 64m)* | |
| `SEED_MEM_LIMIT` / `SEED_HEAP_MB` | *(irrelevant — no seed in prod)* | *(absent → 256m / 192)* | |

### Memory

`docker-compose.prod.yml` is deployed **from each branch**, so a hardcoded
`mem_limit` could only be changed by committing and then redeploying every open
PR. Every limit is therefore a variable whose default is the tight preview
profile; production raises them in its own Coolify env set, and recalibration is
an env edit, not a commit.

Budget on the resized server (measured 2026-09-10): 7.56 GiB total − 0.37 OS −
0.63 Coolify − ~1.0 production ≈ **5.5 GiB** for previews. At ~0.25 GiB each,
the cap of 12 (`PREVIEW_CAP`, `ci.yml`) uses ~3.0 and leaves ~2.5 GiB, well past
the ≥0.8–1.0 GiB the design requires. Raise the cap with
`gh variable set PREVIEW_CAP --body <n>` — it takes effect on the next run, with
no commit.

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
| `SOURCE_COMMIT` interpolates in compose | ✅ 2026-09-10 — production runs `…-backend:sha-94ea42ee…`, the merge commit, and `/api/health/version` returns it |
| Preview `SOURCE_COMMIT` == PR head SHA | **blocked** — previews need the GitHub App (#68) |
| Manual «Redeploy» keeps the same SHA | blocked, same reason |
| Preview deleted on PR close with Auto Deploy off | blocked, same reason |
| API lists previews (cap source) | blocked, same reason — `application_previews` is empty |
| Coolify holds registry credentials | ✗ — this version has no registry store; use the `docker login` fallback (step 5) |
| `docker compose up` does not fail on the one-shot `seed` exiting 0 | ✅ 2026-09-10 — production is the risky case (no `SEED_DEV_DATA`, so the seed exits 0 immediately) and the deployment still reached `finished` |
| Coolify routes the domain to nginx's port 8080 | ✅ 2026-09-10 — with `expose: 8080` in the compose and the port set on the domain, `https://yagoda.webspirio.com` answers 200 |

**Previews require the GitHub App; a deploy key is not enough.** With the SSH
deploy key alone, `POST /api/v1/deploy?uuid=<app>&pr=<N>` is refused with
«Pull request N not found for this resource»: Coolify only learns a PR exists
from the App's webhook, and `application_previews.pull_request_html_url` is
`NOT NULL`, so no other path can create the row. Production CD is unaffected —
`deploy-prod` sends no `&pr=`. That is why the workflow has two gates:
`COOLIFY_ENABLED` arms production, `PREVIEWS_ENABLED` arms previews and stays
unset until #68 is closed.

**Fallback (only if a `SOURCE_COMMIT` gate failed):** CI sets `IMAGE_TAG` in the
relevant env set via `PATCH /api/v1/applications/<uuid>/envs` right before
`deploy`, under the same `concurrency` group. Then **never press «Redeploy» on a
preview in the Coolify UI** — it would use whichever PR wrote `IMAGE_TAG` last;
re-run the PR's `deploy-preview` job instead. The `/api/health/version` check
turns a wrong image into a failed job, not a silent wrong preview.

## First production deploy (2026-09-10)

`94ea42e` — `/api/health/version` returns the merge commit, `/api/health/ready`
and `/` answer 200 over a valid certificate, and the stack is postgres + redis +
backend (all healthy) + nginx. Memory: 1.3 GiB of 7.6 used with everything
running, against a budget that assumed ~1.0 for production alone.

Two CI defects had to be fixed first, and both are worth remembering because
neither turned anything red:

1. **A skipped job propagates its skip transitively down `needs`.** `changes`
   skips itself on `push`, `docker` survives on `always()`, and every job below
   it inherited that skip — so `deploy-prod` was skipped while its own condition
   evaluated true. Two merges reported success and deployed nothing. Both deploy
   jobs now start with `!cancelled()` and assert their needs' results.
2. **A deploy job that is *skipped* is invisible**, unlike one that fails. When
   «is production actually on `main`?» matters, check
   `/api/health/version`, not the colour of the run.

## When a deploy goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `deploy-*` job: «image pull failed — check the GHCR credential» | PAT expired / removed | Rotate per step 5 |
| `deploy-*` job: Coolify `failed`, log shows compose error | compose file in that branch is invalid | `docker compose -f docker-compose.prod.yml config` locally |
| `serves commit 'X', expected 'Y'` | Coolify deployed another commit (fallback misuse, or Auto Deploy got switched on) | Check Auto Deploy is off; re-run the job |
| `/ready` never 200 | backend crash-loop | Coolify → application → logs; usually a missing env var |
| «Preview not deployed — limit reached» | `PREVIEW_CAP` live previews (default 12). A PR whose deploy FAILED keeps its `preview` label on purpose — the stack is still running and still holding memory | close or merge an older PR, or remove its `preview` label once you have confirmed Coolify no longer runs that preview |
| `deploy-preview` shows "cancelled", no comment | another PR took the single pending slot of the `preview-allocation` concurrency group while this one waited | re-run the job |
| `deploy-prod` skipped with «main is at X, not Y» | correct: a newer merge owns production, and its own run deploys it | nothing — unless that newer run went red, in which case prod is deliberately behind `main` until it is fixed and re-run |
| CI green but production still on the old commit | a deploy job was *skipped*, not run — a skip anywhere upstream in `needs` propagates | check the `deploy-prod` job exists in the run at all, then `/api/health/version` |
| Prod is wrong after a merge | | `git revert <merge>` + push. **This does not revert schema migrations** — see `docs/backup-restore.md` to restore last night's pair if a migration destroyed data. |

## Leaving Coolify

Same images, same compose: `docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml up -d`
with `IMAGE_TAG=sha-<commit>` in `.env`, host nginx + Certbot per `docs/vps-tls-setup.md`,
data moved with `docs/backup-restore.md`. About 30 minutes.
