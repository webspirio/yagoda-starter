# Deploying with Coolify (production + staging + PR previews)

The server `188.245.146.122` (Hetzner, 4 vCPU / 7.6 GiB, Ubuntu 26.04 — resized
up from 2 vCPU / 3.7 GiB on 2026-09-10, which is why the spec's sizing
arithmetic reads smaller than the table below) runs
Coolify. Coolify does **not** build anything: `.github/workflows/ci.yml`
builds both images on every commit and pushes them to GHCR as
`sha-<commit>`; Coolify pulls that tag and runs `docker-compose.prod.yml`.
Design: `docs/superpowers/specs/2026-09-09-coolify-deployment-and-cd-design.md`.

| Hostname | What |
|---|---|
| `https://yagoda.webspirio.com` | production — the `production` branch, moved only by releases (`vX.Y.Z`) |
| `https://staging.yagoda.webspirio.com` | staging — `main`, redeployed on every merge; seeded, persistent test data |
| `https://pr-<N>.yagoda.webspirio.com` | preview of PR `N` on the staging application, seeded, removed on close |
| `https://coolify.yagoda.webspirio.com` | the Coolify panel |

## Environments

| Environment | Git | Coolify application | Data | Deploy trigger | URL |
|---|---|---|---|---|---|
| production | branch `production` — moved only by releases | `yagoda` | real; no seed | a published GitHub Release `vX.Y.Z`, or a manual re-deploy of one (`workflow_dispatch`) | `https://yagoda.webspirio.com` |
| staging | branch `main` | `yagoda-staging` (environment `staging`) | demo seed + whatever testers add; persists across deploys | every push to `main` | `https://staging.yagoda.webspirio.com` |
| preview `<N>` | the PR's head | a preview of `yagoda-staging` | demo seed; torn down when the PR closes | `deploy-preview` on an internal PR | `https://pr-<N>.yagoda.webspirio.com` |

`main` is never deployed to production directly, and nobody pushes
`production` by hand: the release workflow fast-forwards it (or, for an
explicit rollback, force-moves it), so every move is a workflow run with a
log. Previews belong to the staging application because the GitHub App
matches a PR webhook to an application by its branch — the PR's base,
`main` — and production no longer tracks `main`.

## How a deploy happens

1. CI (`docker` job) pushes `ghcr.io/webspirio/yagoda-starter-{backend,nginx}:sha-<commit>`
   on every PR, every push to `main` and every release (a release also tags
   the same image `vX.Y.Z`).
2. `deploy-staging` (push to `main`), `deploy-preview` (internal PR, all CI
   jobs green) or `deploy-prod` (release) calls `POST /api/v1/deploy` on
   Coolify (`scripts/ci/coolify-deploy.sh`) for the matching application.
3. Coolify checks out the application's branch HEAD (`main` for staging and
   previews, `production` for production — which `deploy-prod` has just moved
   to the release commit), sets `SOURCE_COMMIT`, and runs `docker compose up`
   on `docker-compose.prod.yml`, whose `image:` lines resolve to
   `sha-${SOURCE_COMMIT}`.
4. The job waits for Coolify, then checks `/api/health/ready`,
   `/api/health/version == sha-<commit>` and (staging, previews) a seeded
   login, and only then passes / comments «Preview ready».

## Releasing to production

A release is a GitHub Release published from `main`:

```bash
gh release create v0.3.0 --target main --generate-notes --title "v0.3.0"
```

The workflow then, in this order and stopping loudly at the first failure:
the `docker` job builds and pushes the images for the tag's commit with both
the `sha-<commit>` and the `v0.3.0` tag (in parallel with `verify`); then
`deploy-prod` resolves the tag (it must exist and its commit must be on
`main`), checks both images are in GHCR, runs the release guard (below — a
release only ever moves production forward), moves `production` to the tag's
commit, deploys the production application and asserts
`/api/health/version` equals the commit. Read the `docker` or `deploy-prod`
job log for any of those steps; production is untouched until the branch
move, and the branch move is the last step before the deploy.

A release marked *pre-release* deploys nothing; publish it as a full release
when it is meant for production.

A hotfix is a normal PR to `main` followed by a release. Never tag a commit
that is not on `main` — the workflow refuses it.

## Rolling back

**Forward-fix first.** Migrations run on backend start-up
(`migrationsRun: true`) and never roll back by themselves, so deploying older
code onto a newer schema is the one move that can break production. The
default rollback is therefore a hotfix release (`v0.3.1`) that fixes or
reverts the change in code.

**Publishing a release never rolls back.** If production is already at a
newer release (two releases published in quick succession can finish out of
order), the guard refuses the older one — «production is already at a NEWER
release». A rollback is always the manual path below.

**One pending production deploy at a time.** `deploy-prod` runs under a
single concurrency group, and GitHub keeps only one *pending* run per group:
a release published while a rollback run is still waiting replaces it
silently, and the other way round. Let the run you started finish before
publishing or dispatching anything else; `/api/health/version` says what
actually landed.

**Re-deploying an older release** — *Actions → CI → Run workflow* with
`tag = v0.2.0` — is allowed when no migration file changed between the
commit `production` points at and the target: `deploy-prod` runs
`scripts/ci/release-guard.sh`, which refuses a move backwards across
`backend/src/migrations/` and prints the files. `allow_schema_rollback=true`
turns that refusal into a warning; use it only after verifying the down path
by hand (or after restoring the pair from `docs/backup-restore.md`). A
release's images are `v*`-tagged, which the weekly cleanup never deletes, so
an old release always has its images.

**After a failed production deploy** the `production` branch may point at a
commit that is not live (the branch moves before the deploy call).
`/api/health/version` is the truth, never the branch: re-run the release
(same tag) or re-deploy the previous one; both move the branch again.

## Staging

Staging is `main`, always: every merge redeploys `yagoda-staging` within
minutes (`deploy-staging`, paused with `STAGING_ENABLED=false`). It boots with
the demo seed (`SEED_DEV_DATA=true`, idempotent) and keeps its Postgres and
uploads volumes across deploys, so test data accumulates until someone
resets it: Coolify → `yagoda-staging` → *Persistent Storage* → delete the
`pg-data` and `uploads-data` volumes → *Redeploy* (the next boot re-seeds).
It runs at the preview-sized memory defaults (see «Memory»); it is public,
like previews, and its owner password lives only in its Coolify env set.

Coolify's own auto-deploy is **off** on both applications, so every deploy is
CI's: production from the `production` branch a release has just moved,
staging from `main` on every push — and Coolify never pulls a tag CI has not
pushed yet. Previews are different, and deliberately so: on every PR
`opened`/`synchronize`/`reopened` the GitHub App webhook makes Coolify create
the preview record **and attempt a deploy** of `sha-<head>`. The record is
what CI's later `POST /deploy?pr=<N>`
relies on (the API cannot create it), and the attempt fails on
`docker compose pull` because CI has not built that tag yet. The deployment
log shows that pull running *before* the old containers are stopped («Pulling
image-based services before stopping the current deployment»), so a live
preview is not touched — observed on #179's webhook deploys, which had no
healthy preview to protect yet; the first `synchronize` against a healthy one
will confirm it. Expect one red webhook deployment per push in Coolify's
list; the API-triggered one that follows is the one CI verifies.
Previews are removed by the same webhook when the PR closes (gate 4 below).

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
4. **GitHub App** (Coolify → *Sources → + GitHub App*): name
   `yagoda-coolify-pr-preview`, **Organization `webspirio`** — that field is
   what makes GitHub create the App under the org rather than under the
   clicking user; an App owned by a personal account cannot be installed on
   the org's repositories at all (what stalled #68). Register it, then install
   it on `yagoda-starter` only (Preview Deployments are a per-application
   setting — see step 6). Done 2026-09-29, with two surprises the panel
   does not explain:
   - the redirect back from GitHub answered **422**, yet the App row was
     saved (`github_apps`: app id, client id, private key and webhook secret
     all present) — only `installation_id` was empty. Installing from GitHub
     itself (`https://github.com/apps/<app>/installations/new` → the org →
     *Only select repositories*) fills it in;
   - the application's *Git Source* page in 4.3.23 offers deploy keys only, so
     an application created with a deploy key cannot be moved onto the App in
     the UI. It was switched in the database (after
     `create table applications_backup_issue68 as select * from applications where id = 1`):
     `source_id` = the App's row, `source_type` = `App\Models\GithubApp`,
     `private_key_id` = NULL, `git_repository` = `webspirio/yagoda-starter`,
     `repository_project_id` = the repository's numeric GitHub id
     (`gh api repos/webspirio/yagoda-starter --jq .id`) — the column the
     webhook matches applications on. The old deploy key (`private_keys` id 1,
     and its read-only counterpart on the repository) is now unused.
   The App needs *Pull requests: read & write* plus the `pull_request` and
   `push` events; Coolify's manifest requests exactly that.
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
     **Preview Deployments: off** (previews belong to the staging application);
     branch **`production`** — not `main`; only the release workflow moves it
     (`docs/coolify-deploy.md` «Releasing to production»).
   - *Advanced*: **Include Source Commit** (`SOURCE_COMMIT`) on; *Watch Paths* blank.
   - *Environment Variables* — the production set below.
   - **Staging application** `yagoda-staging` (project *yagoda*, environment
     `staging`, created 2026-09-30 through the API — the exact calls are in
     `docs/superpowers/plans/2026-09-30-staging-deployment.md`, Task 5): same
     repository through the App, branch **`main`**, Docker Compose,
     `/docker-compose.prod.yml`, domain for `nginx` =
     `https://staging.yagoda.webspirio.com`; **Auto Deploy off**;
     **Preview Deployments on**, URL template `pr-{{pr_id}}.yagoda.webspirio.com`,
     *PR deployment access: repository members only*; *Watch Paths* **blank** —
     a watch path also filters the PR webhook, and it returns *before* the
     preview record is created, so CI's deploy would be refused with
     «Pull request N not found». Two env sets: staging (its own) and preview.
   - Request body size: **nothing to configure.** Traefik imposes no default
     limit (`buffering.maxRequestBodyBytes` defaults to 0 = unlimited), and the
     `buffering` middleware is opt-in — adding it would *introduce* a cap and
     make Traefik buffer whole uploads before forwarding them. The 12 MB rule
     belongs to the standalone path, where a host **nginx** terminates TLS and
     its 1 MB default would 413 an upload. Here the path is already clear:
     Traefik unlimited → internal nginx `client_max_body_size 12m`
     (`nginx/default.conf.template:32`) → the app's own 10 MB cap (`MEDIA_MAX_BYTES`).
7. **GitHub repository settings**: secrets `COOLIFY_URL`, `COOLIFY_API_TOKEN`
   (Coolify → *Keys & Tokens → API tokens*, permissions `deploy` + `read`; add `write`
   only if the fallback below is in force), `COOLIFY_APP_UUID` (from the application URL),
   `PRODUCTION_BRANCH_KEY` — the private half of the write deploy key titled
   «ci: production branch mover (#186)», which `deploy-prod` uses to move the
   `production` branch (the Actions token cannot push a range that changes
   `.github/workflows/*`):
   `ssh-keygen -t ed25519 -N '' -C ci-production-branch -f key`,
   `gh repo deploy-key add key.pub --title "ci: production branch mover (#186)" --allow-write`,
   `gh secret set PRODUCTION_BRANCH_KEY < key`, then delete both local files.
   To rotate it, delete that deploy key in the repository settings and repeat
   the three commands;
   variables `COOLIFY_ENABLED=true`, `PROD_URL=https://yagoda.webspirio.com`,
   `PREVIEW_DOMAIN=yagoda.webspirio.com`, `PREVIEW_CAP` (optional; overrides the
   default cap of 11 live previews without a commit — `ci.yml` reads
   `vars.PREVIEW_CAP || 11`; the default was recalibrated on 2026-09-10 against
   the resized server and Coolify's measured RSS, and lowered from 12 when
   staging took one slot of the same budget — see «Memory» below).
8. **Backups**: `scp scripts/vps/backup.sh root@…:/usr/local/bin/yagoda-backup.sh`,
   the two unit files to `/etc/systemd/system/`, `yagoda-backup.env.example` → `/etc/yagoda-backup.env`
   (fill `PG_CONTAINER`, `UPLOADS_VOLUME` from `docker ps` / `docker volume ls` — pick
   the **production** application's container/volume, not a preview's (previews
   also run a postgres and an uploads volume)), then
   `chmod +x /usr/local/bin/yagoda-backup.sh`, `chmod 600 /etc/yagoda-backup.env`, then
   `systemctl daemon-reload && systemctl enable --now yagoda-backup.timer && systemctl start yagoda-backup.service`.
   Pairs land in `/data/backups`; restore per `docs/backup-restore.md`.

## Environment variables in Coolify

| Variable | Production (`yagoda`) | Staging (`yagoda-staging`) | Preview (`yagoda-staging`, preview set) | Note |
|---|---|---|---|---|
| `APP_URL` | `https://yagoda.webspirio.com` | `https://staging.yagoda.webspirio.com` | `https://yagoda.webspirio.com`¹ | CORS allowlist |
| `JWT_SECRET` | 48+ random chars | different 48+ random chars | different again | `openssl rand -base64 48` |
| `DB_PASSWORD` | random | random | random | |
| `BOOTSTRAP_OWNER_LOGIN` / `_PASSWORD` / `_FIRST_NAME` / `_LAST_NAME` | the real owner | `owner` / *generated* / `Staging` / `Owner` | `owner` / *generated* / `Preview` / `Owner` | read once, on the first boot of an empty DB. Each password is generated on the server and lives only in its Coolify set — a password written into a repo doc is a password on every deploy forever |
| `PASSWORD_VAULT_KEY` | *(set it, or leave the feature off)* | *(optional)* | *(optional)* | `openssl rand -base64 32`. Lets the owner READ an issued password back on «Користувачі» (issue #11). Absent = the feature is off and passwords are hashed only. **Never change it after passwords have been issued** — the existing copies stop opening (logins keep working; each password has to be reissued to become readable again) |
| `SEED_DEV_DATA` | *(absent — or the empty row the parser creates by itself)* | `true` | `true` | enables the one-shot `seed` service — **the only thing that keeps demo data out of production; never set it in the production env set**. Written as `${SEED_DEV_DATA}` in the compose: with a `:-` default the parser hardcodes production's empty value into previews and the seed never runs (see below) |
| `IMAGE_TAG` | *(absent)* | *(absent)* | *(absent)* | **never set** unless the fallback below is in force |
| `POSTGRES_MEM_LIMIT` | `768m` | *(absent → 256m)* | *(absent → 256m)* | see «Memory» below |
| `BACKEND_MEM_LIMIT` / `BACKEND_HEAP_MB` | `768m` / `576` | *(absent → 384m / 256)* | *(absent → 384m / 256)* | the heap cap must stay well below the mem_limit, so an OOM is a Node error, not a SIGKILL |
| `REDIS_MEM_LIMIT` / `NGINX_MEM_LIMIT` | `128m` / `64m` | *(absent → 64m / 64m)* | *(absent → 64m / 64m)* | |
| `SEED_MEM_LIMIT` / `SEED_HEAP_MB` | *(irrelevant — no seed in prod)* | *(absent → 256m / 192)* | *(absent → 256m / 192)* | |

**`KEY: ${KEY:-default}` is rewritten by Coolify's parser — never use it for a
key an env set defines.** For an `environment:` entry whose value is a
`${VAR:-default}` (or `${VAR-default}`) reference to a variable *of the same
name*, the compose parser replaces the value with the stored **production**
row's literal (`bootstrap/helpers/parsers.php`, the default-value branch:
`$environment[$varName] = $envVar->value`) — in previews too, so the preview
env set is ignored and compose never sees a variable to interpolate. A bare
`${VAR}` is kept as a reference («Keep the ${VAR} reference in compose —
Docker Compose resolves from .env at deploy time», same file) and resolves
against that deployment's own `.env`. Observed on 2026-09-29, the day the
first preview came up (#181): its backend carried production's
`BOOTSTRAP_OWNER_PASSWORD` (the preview row held a different, 15-character
one), its seed container had `SEED_DEV_DATA=''` — the parser-created, empty
production row — so no preview seed had ever run, while `JWT_SECRET` and
`DB_PASSWORD`, written as `${JWT_SECRET}` / `${DB_PASSWORD}`, were the
preview's own. `docker-compose.prod.yml` therefore writes every
per-environment key as a bare `${KEY}`; `:-` survives only on keys whose value
is the same in both sets (`APP_TIMEZONE`, `JWT_EXPIRES_IN`, `DB_USER`,
`DB_NAME`). The two previews that leaked (#181, #183) ran for minutes on public
hostnames without basic auth; the credential itself never left their
containers, but rotating the production owner password afterwards is cheap
insurance. `PASSWORD_VAULT_KEY` travelled by the same mechanism but was unset
in production at the time (both containers and both rows held an empty value),
so nothing was carried; had it been set, the choice would have been to accept
the exposure or to rotate it and reissue every stored password — see its row
in the table. The rule — and the sibling-hostname one from «What Coolify renames
in a preview» — is enforced by the `compose` verify row
(`npm run compose:check`, `scripts/verify/checks/compose-conventions.mjs`),
which fails on that form outside a dated allowlist of same-value keys and on
any `environment:` value that is a bare service name.

### Memory

Every limit in `docker-compose.prod.yml` is a variable whose default is the
tight preview profile; production raises them in its own Coolify env set, and
recalibration is an env edit, not a commit — which would otherwise have to be
merged before any preview could pick it up (see «The compose comes from
`main`» below).

Budget on the resized server (measured 2026-09-10): 7.56 GiB total − 0.37 OS −
0.63 Coolify − ~1.0 production ≈ **5.5 GiB** for previews. Staging runs at the
same preview-sized defaults and is always on, so it is the first tenant of
that budget: ~0.25 GiB. At ~0.25 GiB per preview, the cap of **11**
(`PREVIEW_CAP`, `ci.yml`; 12 before staging existed) uses ~2.75, which with
staging's ~0.25 leaves ~2.5 GiB — well past the ≥0.8–1.0 GiB the design
requires. Raise the cap with `gh variable set PREVIEW_CAP --body <n>` — it
takes effect on the next run, with no commit.

¹ Coolify substitutes `{{pr_id}}` in the preview URL template; whether it does so
inside env values is checked in the spike. If it does not, set the preview
`APP_URL` to `https://yagoda.webspirio.com`: `APP_URL` only feeds the CORS
allowlist, and the SPA calls the API same-origin, so nothing user-visible
changes — only a cross-origin call to a preview API would be refused.

## When development slows down

Turn **Preview Deployments** off in the staging application `yagoda-staging`
(Coolify removes any live previews on their PRs' close as before), and set the
repository variable `STAGING_ENABLED=false` to stop redeploying staging on
every merge. Nothing else changes: Coolify keeps running production, renewing
TLS and taking the nightly backups. To leave
Coolify altogether, see the last section.

## Spike results (fill in during setup — spec §3.1 gates)

| Gate | Result |
|---|---|
| `SOURCE_COMMIT` interpolates in compose | ✅ 2026-09-10 — production runs `…-backend:sha-94ea42ee…`, the merge commit, and `/api/health/version` returns it |
| Preview `SOURCE_COMMIT` == PR head SHA | ✅ 2026-09-29 — #181, the first PR after the #180 merge (it could not be shown on #180 itself, whose preview still ran main's old compose — «The compose comes from `main`» below): `https://pr-181.yagoda.webspirio.com/api/health/version` returned `0faf3e46…`, its head; on the server the backend had `DB_HOST=postgres-pr-181`, zero `EAI_AGAIN`, and nginx's rendered config read `proxy_pass http://backend-pr-181:3000/`. Its seed, however, exited 0 **without running** — `SEED_DEV_DATA` reached it empty, the parser rewrite fixed in #184 — so the seeded login was 401 and `deploy-preview` red. Whole job green on #185, the first PR after #184: version `a0a5ddb…` == head, seed applied (`intakes=810`), seeded login 200, and the preview backend's `BOOTSTRAP_OWNER_PASSWORD` hash equal to the preview env set's row, not production's |
| Manual «Redeploy» keeps the same SHA | not exercised — CI re-runs `deploy-preview` instead. Per the deployment job's source the button checks out `pull/<N>/head`: pressed after a CI deploy it redeploys that same head; pressed right after a push it fails on pull, because CI has not built the new head yet |
| Preview deleted on PR close with Auto Deploy off | ✅ 2026-09-29 — #179 closed at 20:56:15Z; by 20:58:10Z `docker ps -a`, `docker volume ls` and `docker network ls` showed nothing named `pr-179` and `application_previews` was empty. That stack had never come up healthy, so this also covers the failed-preview case of amendment #5 |
| API lists previews (cap source) | ✗ — 4.3.23 exposes only `/applications/{uuid}/previews/{pr}/logs`, `PATCH` and `DELETE`, no list, and the application JSON carries none; the `preview` label stays the cap's source |
| Coolify holds registry credentials | ✗ — this version has no registry store; use the `docker login` fallback (step 5) |
| `docker compose up` does not fail on the one-shot `seed` exiting 0 | ✅ 2026-09-10 — production is the risky case (no `SEED_DEV_DATA`, so the seed exits 0 immediately) and the deployment still reached `finished` |
| Coolify routes the domain to nginx's port 8080 | ✅ 2026-09-10 — with `expose: 8080` in the compose and the port set on the domain, `https://yagoda.webspirio.com` answers 200 |

**Previews require the GitHub App; a deploy key is not enough.** With the SSH
deploy key alone, `POST /api/v1/deploy?uuid=<app>&pr=<N>` is refused with
«Pull request N not found for this resource»: Coolify only learns a PR exists
from the App's webhook, and `application_previews.pull_request_html_url` is
`NOT NULL`, so no other path can create the row. Production CD is unaffected —
`deploy-prod` sends no `&pr=`. That is why the workflow has two gates:
`COOLIFY_ENABLED` arms production and staging, `STAGING_ENABLED` arms staging,
`PREVIEWS_ENABLED` arms previews. `COOLIFY_ENABLED` and `PREVIEWS_ENABLED` are
`true` since 2026-09-29 (#68); flip `PREVIEWS_ENABLED` (or `STAGING_ENABLED`)
to pause previews (or staging) without a commit.

### What Coolify renames in a preview

Every service, volume and network of a preview carries a `-pr-<N>` suffix
(`postgres` → `postgres-pr-179`, volume `<uuid>_pg-data-pr-179`, network
`<uuid>-179`), and a container's DNS name follows its service name. A compose
file that names a sibling service literally therefore works in production and
dies in every preview — the first preview of this stack ended on
`getaddrinfo EAI_AGAIN postgres` in the backend. Coolify's contract for this
is `SERVICE_NAME_<SERVICE>`, which it writes into the deployment `.env` and
into every container's environment — `postgres-pr-179` in the preview (both
seen on #179: the `.env` under `/data/coolify/applications/<uuid>/` and
`docker inspect` of its backend), `postgres` in production (the same code
path with no PR number). `docker-compose.prod.yml` reads it with a default
(`DB_HOST: ${SERVICE_NAME_POSTGRES:-postgres}`), so the standalone path, where
nothing sets it, keeps the plain name; the nginx image renders the same
variable into `proxy_pass` from `nginx/default.conf.template` at start-up.
Two side effects worth knowing: Coolify's compose parser registers every
`$SERVICE_*` reference it sees as a hidden, value-less environment variable of
the application — observed on the first parse of the fixed compose
(2026-09-29 21:35:39Z: `environment_variables` rows `SERVICE_NAME_POSTGRES`,
`_REDIS`, `_BACKEND` with `NULL` values, one per env set), and harmless: the
production `.env` written two minutes later carried the full
`SERVICE_NAME_POSTGRES=postgres` etc., because the deployment job drops stored
`SERVICE_NAME_*` rows before generating that file. And
`docker compose config` shows the rendered result locally:
`SERVICE_NAME_POSTGRES=postgres-pr-9 docker compose -f docker-compose.prod.yml config`.

The webhook deploy at push time has one edge: on `opened`/`reopened` of a head
CI has already built (a branch reused for a new PR), Coolify's own deploy
succeeds minutes before `deploy-preview` claims the `preview` label, so the
cap under-counts by one until that job runs. Accepted — the window is short
and the job always runs on those events.

Sources, because none of this is on Coolify's *application* pages:
`SERVICE_NAME_<SERVICE>` is documented only for *Services*
(<https://coolify.io/docs/services/configuration/docker-compose>: «Coolify
creates this variable automatically for every Compose service»); the `-pr-<N>`
value for application previews lives in `app/Jobs/ApplicationDeploymentJob.php`
(`addPreviewDeploymentSuffix`), and coollabsio/coolify#10186 (2026-06) is the
fix that stops a stale user-defined `SERVICE_NAME_*` from overriding it — so
never define those keys in the env sets. Volume suffixing is documented
(<https://coolify.io/docs/core/persistent-storage/storage-mounts/volume-mounts>).
For a compose application the `deploy?pr=<N>` API creates no preview record
(only the `dockerimage` build pack gets that), which is why the webhook is
mandatory. Known 4.3.x issues to expect: coollabsio/coolify#9014 — compose
previews share one project name, so deploying one preview can 502 its siblings
for a few seconds; #12005 — a preview's storage *records* outlive the preview
in Coolify's database (the volumes themselves are removed, see gate 4);
#11534 — a preview delete also removes user-named (`external`/`name:`)
volumes and networks, which this compose deliberately has none of.

### The compose comes from `main`, not from the PR

Coolify does not deploy the compose file of the commit it checks out. On every
deploy — production, staging and preview alike — `ApplicationDeploymentJob` calls
`loadComposeFile()`, which clones the application's configured branch
(`git_branch`: `main` for staging and previews, `production` for production) with `only_checkout` (it never passes the PR
number to `generateGitImportCommands`) and stores that file as
`docker_compose_raw`; the parser then renders *that* file against the PR's
commit. Observed on #180: its rendered `docker-compose-pr-180.yaml` still had
the literal `DB_HOST: postgres` the branch had already replaced, while its
`.env` carried the correct `SERVICE_NAME_*=…-pr-180`. Consequences:

- a PR that edits `docker-compose.prod.yml` gets a preview of its **code**
  under **main's compose**; the edit itself is exercised by the first preview
  after the merge (and by production);
- a compose change that previews *need* — like the `SERVICE_NAME_*` fix —
  cannot be proven green on its own PR: expect that PR's `deploy-preview` to
  fail the old way, and verify on the next PR;
- CI's `changes` job still treats `docker-compose*.yml` as a docker input so
  that such a PR builds images and gets a preview of its code at all.

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

## Deploy timings and cache baselines (measured 2026-09-17)

What a healthy merge looks like, so that a slow run can be told from a hung one
and a cache regression from ordinary variance. Two consecutive merges were
measured: `4e7bb56` (#111, source in both workspaces) and `57586ec` (#83, a
dependabot lockfile bump — the worst case for every cache).

**Merge to live production: 3 min 34 s** (`57586ec`: run created 13:40:20Z,
`/api/health/version` verified 13:43:54Z). `checks` is the critical path; the
deploy itself adds under a minute.

| Stage | `4e7bb56` (code) | `57586ec` (lockfile bump) |
|---|---|---|
| `checks` | 2:45 | 2:32 |
| `docker` | 1:09 | 1:57 |
| `db-checks` | 1:03 | 1:16 |
| `deploy-prod` job | 0:08 (superseded) | 0:51 |
| └ `coolify-deploy` action | skipped | 44.9 s |

The three test jobs run in parallel, so the run total is `checks` plus the deploy.

**Inside `coolify-deploy` (44.9 s):** trigger → Coolify reports `finished`
(43.1 s) → `/api/health/ready` 200 (0.6 s) → `/api/health/version` matches
(0.5 s).

### What Coolify does with those 41 seconds

Server-side, from `application_deployment_queues` (id 8). Offsets are from the
deployment's own start:

```
+ 0.3s  helper container up
+ 3.4s  git fetch main → 57586ec
+10.4s  clone finished                     ← ~7 s of git, on every deploy
+15.7s  "No services to build"             ← confirms Coolify never builds
+16.1s  removing old containers  ──┐
+19.1s  image pull starts           │
+21.9s  nginx pulled                │  production is down
+26.3s  backend pulled              │  for ~22 s
+27.2s  all containers created      │
+32.9s  postgres healthy            │
+38.6s  backend healthy             │
+38.8s  nginx started  ─────────────┘
+39.1s  "New container started"
```

Six deploys (2026-09-11 … 2026-09-17) took **36–41 s** server-side, so that
range is the baseline; a deploy past a minute is worth a look, and the 900 s
`DEPLOY_TIMEOUT_SEC` is nowhere near it.

**A deploy costs ~22 s of downtime.** Coolify removes the old containers before
it creates the new ones, so between +16.6 s and +38.8 s Traefik has no backend
for the host. This is the plain `down`/`up` strategy, not a misconfiguration.
Coolify can do rolling updates, but this app runs its migrations on backend
startup, so two versions would race for them — treat the switch as its own
piece of work, not a checkbox.

### Cache

| Layer | Code-only merge | Lockfile bump |
|---|---|---|
| npm (`setup-node`) | hit | miss — `package-lock.json` is the key |
| Turborepo | restored, but **0 of 2 tasks replayed** | full miss |
| buildx (`type=gha`) | base layers `CACHED`; backend 27 s, nginx 23 s | backend 55 s, nginx 42 s |

Turborepo replays only the workspace a change did not touch: #107 and #93 each
reported `1 cached, 2 total` for lint, test and build, while #111 — which
touched backend and frontend — got `0 cached, 2 total`. Restoring and saving
`.turbo` costs ~11 s for 6.7 MB, so on a wide change the cache is a small net
loss and on a narrow one a large win. Do not read a `0 cached` line as a broken
cache.

**Layer reuse on the server is what makes the pull cheap.** The backend image is
492 MB, but only one ~10.5 MB layer crossed the network — everything else was
already on the host from the previous deploy. Both images pulled in 7.2 s. The
host therefore keeps two generations of images (4.178 GB total, 845.6 MB
reclaimable); that is the price of the fast pull, at roughly 0.5 GB per
generation against 28 GB free.

**Actions cache: 4.40 GB of the 10 GB repository limit**, 589 entries.

```
3122 MB  x317  buildkit-blob  [PR]      ← 70 % of the budget
 645 MB  x7    npm            [PR]
 489 MB  x98   buildkit-blob  [main]
 138 MB  x37   turbo-checks   [PR]
  52 MB  x13   turbo-checks   [main]
```

Scoping PR builds to `*-pr` keeps them from *overwriting* the `*-main` seed, but
it does not keep them from *evicting* it: GitHub evicts by LRU across the whole
repository once it crosses 10 GB, and the `*-main` entries are the least
recently used precisely because only main touches them. If the budget gets
tight, drop PR buildkit blobs first — losing them costs one slow PR build,
losing the main seed slows every PR.

### Health of the deployed stack

`/api/health/ready` answers 200 in 0.13 s, `/` in 0.14 s. Against the compose
limits the containers sit at backend 61/384 MiB, postgres 21/256, nginx
4.7/64, redis 3.7/64; the host uses 1.3 of 7.7 GiB and 8.7 of 38 GB of disk.

### Re-measuring

`jq` is not required anywhere below — `gh` has its own `--jq`.

```bash
# CI: per-job and per-step durations for a run
gh run view <run-id> --json jobs \
  --jq '.jobs[] | "\(.name) \(.conclusion) \(.startedAt) \(.completedAt)"'

# CI: which caches hit
gh run view <run-id> --log | grep -E "Cache (hit|restored|saved)|Cached: .*total|CACHED"

# CI: the deploy script's own timeline
gh run view <run-id> --log | grep "deploy-prod.*coolify-deploy"

# Actions cache budget
gh api repos/webspirio/yagoda-starter/actions/cache/usage

# Server: the deployment's timeline, straight from Coolify's database
ssh root@<vps> "docker exec coolify-db psql -U coolify -d coolify -t -A -F'|' \
  -c \"select id, deployment_uuid, status, created_at, finished_at \
      from application_deployment_queues order by id desc limit 6;\""
# …and the log of one deployment (field: logs, a JSON array of {output,timestamp})

# Server: what is actually running, and since when
ssh root@<vps> 'docker ps --format "{{.Names}}\t{{.Status}}\t{{.Image}}"; docker system df'
```

## When a deploy goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `deploy-*` job: «image pull failed — check the GHCR credential» | PAT expired / removed | Rotate per step 5 |
| `deploy-*` job: Coolify `failed`, log shows compose error | compose file in that branch is invalid | `docker compose -f docker-compose.prod.yml config` locally |
| `serves commit 'X', expected 'Y'` | Coolify deployed another commit (fallback misuse, or Auto Deploy got switched on) | Check Auto Deploy is off; re-run the job |
| `/ready` never 200 | backend crash-loop | Coolify → application → logs; usually a missing env var |
| A preview's backend logs `getaddrinfo EAI_AGAIN postgres` (or `redis`) | a service hostname is hardcoded in the compose (previews suffix every service), or someone defined `SERVICE_NAME_<SVC>` — even empty — in a Coolify env set | reference it as `${SERVICE_NAME_<SVC>:-<svc>}` and never define those keys yourself — «What Coolify renames in a preview» |
| `deploy-preview`: «login as seeded user … returned 401 — did the seed run?», and the seed container exited 0 with no output | `SEED_DEV_DATA` reached the seed container empty — a `:-` default let the parser inject production's empty row | write the key as `${SEED_DEV_DATA}` («Environment variables in Coolify»); `docker inspect` the seed container for `SEED_DEV_DATA=true` |
| A preview runs with a production value (owner password, vault key) although the preview env set differs | the same parser rule: `KEY: ${KEY:-…}` becomes the production literal | bare `${KEY}` only; close the PR to tear the preview down until the compose on `main` is fixed |
| A preview ignores the PR's change to `docker-compose.prod.yml` | expected — the compose is loaded from `main` on every deploy («The compose comes from `main`») | merge, then check the next preview |
| Coolify lists a **failed** deployment seconds after every PR push, before CI is green | expected: the App webhook deploys `sha-<head>` before CI has pushed it; the pull fails, and it runs before the old containers are stopped, so a live preview stays up | nothing — `deploy-preview`'s API deploy is the one that counts |
| «Preview not deployed — limit reached» | `PREVIEW_CAP` live previews (default 11). A PR whose deploy FAILED keeps its `preview` label on purpose — the stack is still running and still holding memory | close or merge an older PR, or remove its `preview` label once you have confirmed Coolify no longer runs that preview |
| `deploy-preview` shows "cancelled", no comment | another PR took the single pending slot of the `preview-allocation` concurrency group while this one waited | re-run the job |
| `deploy-staging` skipped with «main is at X, not Y» | correct: a newer merge owns staging, and its own run deploys it | nothing — unless that newer run went red, in which case staging is behind `main` until it is fixed and re-run |
| CI green after a merge but production unchanged | expected — production moves only on a release («Releasing to production»); check staging instead | publish a release when the change is meant for production |
| Prod is wrong after a release | | re-deploy the previous release (*Run workflow* with its tag) or ship a hotfix release — «Rolling back». **Neither reverts schema migrations** — see `docs/backup-restore.md` to restore last night's pair if a migration destroyed data. |
| `deploy-prod`: «no tag named …» / «… is not on main» | the Release was published from a tag that does not exist or was not cut from `main` | delete the Release, tag the right `main` commit, publish again |
| `deploy-prod` on a release: «production is already at a NEWER release» | a newer release finished first; a release only moves production forward | nothing — production already runs the newer release; to go back deliberately, *Run workflow* with the older tag — «Rolling back» |
| `deploy-prod`: «rolling back production … crosses these migrations» | the target release is older than a migration that is live | forward-fix (hotfix release); or re-run with `allow_schema_rollback=true` after verifying the down path — «Rolling back» |
| Staging did not update after a merge | `deploy-staging` skipped (`STAGING_ENABLED` not `true`, or a newer merge superseded the run) | check the job's notice; the newer merge's own run owns staging |

## Leaving Coolify

Same images, same compose: `docker compose -f docker-compose.prod.yml -f docker-compose.standalone.yml up -d`
with `IMAGE_TAG=sha-<commit>` in `.env`, host nginx + Certbot per `docs/vps-tls-setup.md`,
data moved with `docs/backup-restore.md`. About 30 minutes.
