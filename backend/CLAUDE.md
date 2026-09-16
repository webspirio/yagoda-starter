# backend/CLAUDE.md

NestJS REST API for Web Starter.

## Stack

- **NestJS** (Express platform) — modules, controllers, services, guards, pipes
- **TypeORM** + **PostgreSQL 16** — entities with migrations (`synchronize: false`; migrations run automatically on startup)
- **Redis 7** — rate-limit counter storage for `ThrottlerModule`
- **JWT** (passport-jwt) — authentication

## Commands

```bash
npm run dev     # start with hot-reload (port 3000)
npm test        # run Jest unit tests (*.spec.ts — no I/O, everything mocked)
npm run test:db # run DB-backed tests (*.db-spec.ts) against a real Postgres
npm run lint    # ESLint (flat config, eslint.config.mjs)
```

**`test:db` prerequisite** — create the throwaway database once:
`docker compose exec postgres createdb -U app app_test`. The suite connects with
the usual `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD` but overrides the database
name with `TEST_DB_NAME` (default `app_test`); `src/testing/db-harness.ts` refuses
to start if that name equals `DB_NAME` or does not end in `_test`, because these
specs `TRUNCATE`. They run serially (`jest.db.config.js`, `maxWorkers: 1`) and
apply migrations on connect. They exist because they verify **Postgres semantics
that a mocked spec cannot reach** — constraints, unique indexes, cascade rules,
and whether a hand-written statement even parses. `npm test` never picks them
up: its `testRegex` (`.*\.spec\.ts$`) does not match `.db-spec.ts`.

**Testing gotchas worth knowing before you distrust a green run:**
- **BOTH** `test` and `test:db` run Jest under
  `NODE_OPTIONS=--experimental-vm-modules`, and it is load-bearing on each, not
  leftover debris. Several Nest packages are now pure ESM (`"type": "module"`)
  — `@nestjs/schedule` v12 and `@nestjs/passport` v12 so far — so any spec that
  loads one `require()`s an ES module. Jest 30 *can* do that natively, but it
  gates the capability on
  `typeof vm.SourceTextModule?.prototype.hasAsyncGraph === 'function'`, and
  `vm.SourceTextModule` only exists under that flag. Jest's own error message
  ("Use Node v24.9+ where Jest supports require(esm) natively") is misleading:
  a new enough Node is necessary but NOT sufficient without the flag. This is
  also why `engines` floors at Node 24.15 — `hasAsyncGraph` landed in 24.9, so
  the flag is inert on Node 22 and neither suite can pass there.
- **Which suite an ESM dependency breaks depends only on who imports it, so
  don't read a green `npm test` as coverage.** `@nestjs/schedule` is imported
  by `app.module.ts` alone, so it took out only the two db-specs that boot the
  real `AppModule` while `npm test` stayed green and CI's `db-checks` was the
  sole signal. `@nestjs/passport` is imported by `auth.decorators.spec.ts` and
  `jwt.strategy.spec.ts` as well, so it broke the unit suite too. The next
  package to go ESM will land wherever its importers are — check both suites.
- Both jest configs set `watchman: false` — the unit config (the `"jest"` key
  in `package.json`) and `jest.db.config.js` — and it is NOT a preference.
  When the machine's `watchman` binary is broken (a mismatched Homebrew
  boost/folly is the common cause), Jest's haste-map crawler returns an EMPTY
  file list and Jest exits 0 having run nothing. A green exit code for zero
  tests is worse than a red one, so the Node crawler is forced on
  unconditionally.
- **The global rate limiter is per IP, and every db-spec request comes from
  127.0.0.1 — so one test run looks like a single abusive client.** The
  production default is 100 req/min, and the current suite fits under it with a
  thin margin — measured peak `x-ratelimit-remaining` is 79 of 100, so the next
  HTTP spec is roughly where it stops fitting. Each HTTP spec calls
  `relaxThrottleForTests()` from `db-harness.ts` BEFORE importing `AppModule`
  (its decorator runs `ConfigModule.forRoot()` eagerly at import time), which
  sets `THROTTLE_LIMIT` for the process only — **unconditionally**, because
  `db-harness.ts` runs `dotenv` at module load, so a `THROTTLE_LIMIT` copied
  from `.env.example` would otherwise win. Without it the failure is a scatter
  of `429 Too Many Requests` in whichever spec happens to run past request
  100 — which reads like a bug in that spec rather than in the shared budget,
  and moves as specs are added. `THROTTLE_LIMIT` and `THROTTLE_TTL_MS` are
  unset outside tests and fall back to 100 / 60 000.
- `docker-compose.yml` publishes Redis on `127.0.0.1:6379` (not just the
  internal `app_net`) because `pipeline.db-spec.ts` boots the full
  `AppModule`, whose global `ThrottlerGuard` needs a reachable Redis. Without
  a host-mapped port, every request in that spec 500s instead of throttling.
- `pipeline.db-spec.ts` mints exactly ONE token via a real `/auth/login` call
  (its first test — the one end-to-end proof that scrypt verification works
  over HTTP) and signs every other token in the file with the app's own
  `JwtService`, precisely so `npm run test:db` stays idempotent within a
  minute against the Redis-backed 10-per-minute-per-IP login throttle. A new
  pipeline test that needs a token should mint it the same way, not add
  another `/auth/login` call — that throttle is shared across every test in
  the file and reintroducing several real logins reopens a 429 that shows up
  as a misleading failure in whatever test happens to run fourth.

## Structure

```
src/
  app.module.ts         # root module — TypeORM/logger/throttler config, imports all feature modules
  main.ts               # bootstrap: helmet, trust proxy, CORS allowlist, ValidationPipe, static /uploads, listen :PORT
  auth/                  # JWT strategy (reloads the user every request), @Auth(...roles) decorator, RolesGuard, point-scope assert* helpers; POST /auth/login + /auth/logout only — no public registration
  users/                 # User, UserIdentity, UserCredentials entities; UsersService, CredentialsService; password-hashing.ts (scrypt), normalize-login.ts, display-name.ts (domain only — no controller)
  collection-points/     # CollectionPoint entity + owner-only writes (POST/PATCH), nullable targets, GET scoped by role
  products/               # products and their grades — one aggregate, two entities; §4.1's visibility rule spans both
  tare-types/             # tare catalog — weight_kg and deposit_price, both snapshotted downstream by §2.7
  suppliers/              # point-scoped supplier records — OPERATOR-writable (the only DOMAIN module whose writes are open to both roles; self-service `/me` aside), phone canonicalized to E.164
  grade-prices/           # append-only price journal — current price is the newest row per (point, grade); carries §2.9's max_markup/max_discount
  shifts/                 # one point's working day — the ONLY home of a document's point and business_date. Open/close are OPERATOR-only (§10.3) and each CARRIES A CASH COUNT in the same transaction; reopen is owner-only and demotes that shift's closing count to `midday`. A discrepancy never blocks a close (client ruling 09.09.2026), so `awaiting_explanation` is unreachable by decision; `explanation` is written by the owner AFTER the fact
  intakes/                # the berry receipt — one aggregate, three entities, ONE POST in one transaction. `intake-lines.ts` is pure and holds every computation in the slice. `POST /intakes/preview` (200, both roles) is `create` minus the write — same body without `code`, same snapshots, same refusals — for the reception screen's live numbers
  payouts/                # cash over the counter — the debt half of §3.6's ceiling behind a supplier row lock; `settle-return` records cash physically coming back after a void
  intake-top-ups/         # the owner's third source of supplier debt (#61 «фантомний залишок») — a fixed amount added against an already-recorded receipt when a price is renegotiated after the fact. No `shift_id`/`collection_point_id`/date of its own — both come through `intake_id`, two hops to `suppliers`. Owner-only create and void; both roles read. `amount > 0` only — a negative row would reduce a debt without cash leaving the drawer, so the downward path is §9.3's void-and-reissue of the receipt. Voiding the parent intake neutralises its top-ups WITHOUT a cascading write (`ti.voided_at IS NULL` in `supplier-balance`'s `debtSql`); voiding the top-up itself is a second, equally legal way to drive a supplier's debt negative
  transfers/              # money and empty crates travelling from the base to a point (§7.9), the only thing that puts cash INTO a point's drawer. Five verbs: create/resolve/void are owner-only, accept and dispute are the POINT's alone and refused to the owner (§10.3). Carries its own `collection_point_id`, but `accepted_date` now comes from the OPEN SHIFT accept runs inside (§4.1) rather than from `today` — accepting requires an open shift and takes that shift's `business_date`, so a transfer accepted after midnight still lands on the shift that was open when it happened. A voided transfer keeps `status = 'accepted'`, so every cash query filters `voided_at IS NULL` itself
  supplier-balance/       # owns ONE query: Σ intakes + Σ intake_top_ups − Σ payouts, with `voided_at IS NULL` on all four (the top-ups term carries two — itself and its parent intake) — served per supplier (`GET /suppliers/:id/balance`) and per point (`GET /supplier-balances`, the «Залишки» list: same SQL correlated per row, paginated in Postgres, `include_zero=false` by default but a deactivated supplier with a balance stays listed). Writes nothing, owns no table
  point-cash/              # owns ONE query: accepted transfers in, payouts out, settled returns back, as of a date. Writes nothing, owns no table, same shape as `supplier-balance/`. Serves `GET /point-cash` (the one screen both roles open, §7.10) and `GET /point-cash/:pointId`. Voided PAYOUTS stay subtracted while voided TRANSFERS stop being added — the same column read two opposite ways, §9.3. EVERY COLUMN OF A LIST ROW HONOURS `as_of`, not just `cash`: `unexplained_difference` is bounded by the count's `business_date` and `latest_transfer` is reconstructed to the status it HELD on that date, because a row pairing a September-1 drawer with today's newest trip reads as fact and is not one. Also serves `crate_deposits` — the crates book (`Σ deposit_taken − Σ deposit_refund`, from `crates/crate-balance.service.ts`'s `CRATE_BOOK_SQL`), a SEPARATE field never summed with `cash` and never bounded by `as_of` (§7.5 — «від першої видачі», no date floor at all)
  cash-counts/            # the drawer, counted by a human (§7.6) — READ ONLY here; counts are WRITTEN inside the shift open/close transactions, because a count that can be written on its own can be skipped. `GET /cash-counts?only_discrepancies=true` is the owner's incident list, which is what «notify the owner» means in a project with no email and no push. That list EXCLUDES `midday`, as do `is_open` and `point-cash`'s `unexplained_difference`: a reopen leaves two rows for one physical drift (the demoted closing count and the re-close), and counting both reports −180 where the drawer is −90 out. The demoted row keeps its place in the UNFILTERED list — evidence is never destroyed (§7.6), it just stops being work. `CashBook` (`cash-book.enum.ts`) now has a real `crates` member, but no row is ever written with it: the crates book is DERIVED ONLY (`point-cash/`), because one physical drawer cannot become two counted numbers without either asking the operator to distinguish identical banknotes or making one book unfalsifiable — see the settlement-trio follow-up
  crates/                 # the rented-crate ledger — `crate_issuances` (deposit or receipt, one `code` either way), `crate_returns`, `crate_return_allocations` (the FIFO trail). Two services because the write and read paths share only the allocator: `crates.service.ts` (issue · return · void × 2, under a `SELECT … FOR UPDATE` on the supplier row, §7.3) and `crate-balance.service.ts` (tranches · balance · preview, and `CRATE_BOOK_SQL`, the crates book's one definition — `point-cash/` reads it rather than re-deriving the filter). Three controllers because `/suppliers/:id/crate-balance` cannot live on a `/crate-issuances` prefix. `crate-allocation.ts` is the pure FIFO walk, no Nest, no database, ordered `created_at` then `id`; `mode` is display-only, the money follows `per_unit`, which a receipt-mode issuance carries as 0 by CHECK — so the allocator never branches on mode (§4.1 of the slice spec, which also overrules §6.6's «не змішуються»). `crate-code.ts` allocates `code` inside the write transaction (`pg_advisory_xact_lock` on `hashtext(shift_id || ':' || mode)`, then a row count that INCLUDES voided rows — a number is never reissued). No `tare_type_id` on either table: one standard crate network-wide, `is_crate` exclusive on `tare_types` (`UQ_tare_types_single_crate`, demotes-on-set in `tare-types.service.ts`). No `PATCH`, no `DELETE`, no `crate_shipments` — ledger only, see the slice spec's §9 and the follow-ups doc
  user-admin/             # owner-only POST /users, PATCH /users/:id, PUT /users/:id/password — the only way an account is created
  current-user/          # /me — read, update language_code, avatar upload (the one controller that reads/writes User; identity fields are owner-managed via user-admin)
  audit/                 # append-only audit log (AUDIT_ACTIONS union + AuditService)
  media/                 # local-disk image storage — upload validation, image re-encoding, MediaFile entity
  common/                # cross-cutting: global exception filter, shared pagination DTOs (PaginationQueryDto, Paginated<T>)
  health/                # GET /health/live, GET /health/ready (terminus)
  redis/                 # global RedisModule — shared ioredis client (REDIS_CLIENT token)
  time/                   # TimeService — the one seam for timezone-aware time (APP_TIMEZONE)
  config/                 # typed, namespaced env config factories (app, database, auth, redis, timezone, uploads)
  migrations/             # InitialSchema, SeedDevAdmin (guarded off in production), YagodaFoundation, BootstrapOwner, IndexUserIdentityUser, YagodaCatalog, YagodaSuppliersAndPrices, YagodaIntakesAndPayouts, YagodaTransfers, YagodaCashCounts, DropCashCountExpectedCheck, YagodaIntakeTopUps, YagodaCrates
  seed/                   # dev-seed — idempotent demo dataset for manual testing (`npm run seed:dev`); NOT a migration, never runs on its own
```

## Key conventions

- Every feature lives in its own NestJS module under `src/<feature>/`.
- Entities register themselves — `TypeOrmModule.forRootAsync` in `app.module.ts` uses `autoLoadEntities: true`, so any entity passed to a module's `TypeOrmModule.forFeature([...])` is picked up automatically; a new `<feature>.entity.ts` needs no central list. The CLI data source (`src/data-source.ts`, used by `migration:generate`/`run`/`revert`) discovers entities and migrations independently via `__dirname`-relative globs (`**/*.entity{.ts,.js}`), so it works unchanged from both `src/` (ts-node) and compiled `dist/` (the prod migration step — see "Migrations" below).
- **Strict TypeScript** — `"strict": true` in `tsconfig.json`, with `strictPropertyInitialization` off (entities and DTOs are populated by TypeORM/class-validator, not constructors). No `@ts-ignore`, no `as any`.
- **Route protection — `@Auth(...roles)` is the only blessed pattern.** From `src/auth/decorators/auth.decorators.ts`: `@Auth()` (any authenticated user) or `@Auth(UserRole.NetworkOwner)` (owner only), composing `JwtAuthGuard` (populates `request.user`) then `RolesGuard` (`src/auth/guards/roles.guard.ts`, reads it). Roles match EXACTLY — there is no hierarchy, so an owner does not implicitly satisfy an operator-only route. A bare `@Auth()` on one method of a role-restricted controller INHERITS the class's roles rather than clearing them; see the decorator's own doc comment for why the metadata is `undefined`, not `[]`, when no role is given.
- **Guards decide from the request alone; `assert*` methods decide from a row.** `@Auth(...)` only ever answers a role-only question. A rule that has to read data first — "only the owning point may accept" (`assertOwnsPoint`), "which points can this caller see" (`resolvePointFilter`, `src/auth/access/point-scope.ts`), the last-active-owner lockout guard — is a named `assert*`/`resolve*` method on the relevant service, called explicitly from the handler, never a guard.
- **Pagination** — collection endpoints take `PaginationQueryDto` (`?page=&limit=`, `src/common/dto/pagination-query.dto.ts`, page ≥ 1, 1 ≤ limit ≤ 100) and return the `Paginated<T>` envelope (`{ data, total, page, limit }`, `src/common/dto/paginated.ts`). Copy this pair for every new list endpoint instead of an unpaginated `find()` — nothing in this starter uses it yet, but it's the intended shape for the first one that does.
- **Serialization boundary** — a global `ClassSerializerInterceptor` (wired in `main.ts`) runs on every response. Mark sensitive entity fields `@Exclude()` (class-transformer) — see `UserCredentials.password_hash` and `UserIdentity.provider_data` — instead of hand-picking fields per controller; the exclusion then applies no matter which handler returns the entity.
- **Identity seam** — `user_identities(provider, provider_user_id)` (`UNIQUE`, plus a plain index on `user_id` for the per-request auth lookup — see `IndexUserIdentityUser`) is the single login lookup path (`UsersService.findByIdentity`, `findAuthContext`). This starter writes exactly one provider, `'local'` (`LOCAL_PROVIDER` in `user-identity.entity.ts`); adding an OAuth provider means writing a different value there, with no schema change. `AuthService.login` and `UserAdminService` (account creation, login changes) are the reference callers.
- **Password storage is scrypt, self-describing.** `CredentialsService.set()`/`.verify()` (`src/users/credentials.service.ts`) delegate to `src/users/password-hashing.ts`'s `hashPassword`/`verifyPassword` — the *only* place a password is read, written or compared. `node:crypto` scrypt, `N=16384, r=8, p=1`, a 64-byte derived key and a 16-byte random salt per password. The stored value is `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>` (`UserCredentials.password_hash`) rather than parameters implied by whatever code happens to be deployed — raising the cost later re-hashes nothing and locks out nobody, because every stored value still carries the parameters it was created with. `verifyPassword` returns `false` rather than throwing for every failure shape (wrong password, malformed value, unknown scheme), so a corrupt row can't be distinguished from a wrong password by an attacker or turned into a 500.
- **Account-creation vs. login asymmetry is intentional.** `CreateUserDto`/`SetPasswordDto` (`src/user-admin/dto/`) enforce an 8-character minimum on a new password; `LoginDto` (`src/auth/dto/login.dto.ts`) enforces none, only a DoS-guard `@MaxLength`. A length rule on login would lock out credentials that were valid when created, the first time anyone tightens the policy — tighten the account-creation DTOs freely, never add a `@Length` minimum to `LoginDto`.
- **`numeric` is a string end to end.** Postgres `numeric` columns are typed `string | null` on the entity, with no TypeORM transformer converting them to `number` — see `CollectionPoint`'s doc comment and the round-trip db-spec asserting `typeof … === 'string'`.
- **ALL money and weight arithmetic goes through `src/common/money.ts`, and nothing else may do any.** Strings in, strings out, bigint kopiykas inside, half-up at scale 2. **Rounding is applied PER LINE and the rounded values are then summed** — the receipt prints the lines above the total, and `round(Σ)` can differ from `Σ round(each)` by a kopiyka, which the schema treats as no different from 350 ₴. An eslint rule (`eslint.config.mjs`) bans `*`, `/`, `Number()`, `parseFloat` and `toFixed` inside `intakes/`, `payouts/`, `shifts/`, `supplier-balance/`, `transfers/`, `point-cash/`, `cash-counts/` and `intake-top-ups/`; pagination offsets use `skipOf()` from `common/dto/pagination-query.dto.ts` rather than a disable comment. `decimal.js` is deliberately still not a dependency — when the arithmetic stops being provisional it replaces the internals of that one file.
- **A document is never edited.** §2.7 freezes `intakes.amount` and §9.3 makes a correction a void plus a NEW document, so there is no `PATCH` and no update method on `IntakesService`/`PayoutsService` — only a `void` that writes the mandatory `void_*` trio. An operator may void only a document they RECORDED THEMSELVES, and only while the shift is open (§9.4 — «чужа квитанція → приймальник НІКОЛИ»); the owner may void anything, anywhere. Voiding a payout does NOT return the cash: that is a separate owner-only `settle-return` (§9.3, «інакше сторно стає способом красти»).
- **`intakes` and `payouts` store neither the point nor the business date** — both come from `shift_id` (§2.3). Scoping a query to an operator's point is therefore a JOIN on `shifts`, not a `WHERE` on a column that exists on those tables.
- **A phone number is stored canonical (E.164) and nothing else.** `src/suppliers/phone.ts` is the only place one is normalized, and `CHK_suppliers_phone_e164` is the real guarantee — the function only produces the friendly 400. This DIVERGES from the catalog's "store exactly as typed, compare case-insensitively" rule on purpose: a name's capitalization is content, a phone's dashes are presentation. See the spec's §5.7.
- Environment variables are managed via `@nestjs/config` with typed namespaced factories in `src/config/`. Use `@Inject(xConfig.KEY)` with `ConfigType<typeof xConfig>` to access config in services. `PORT` (default 3000) sets the listen port; `JWT_SECRET` must be at least 32 characters (Joi-validated at startup, see `app.module.ts`). `DB_SSL` (default `false`) enables TLS on the Postgres connection for managed providers (Neon/RDS/Supabase/…); the bundled compose Postgres doesn't need it.
- **Media** — one purpose, `MediaPurpose.Avatar` (`src/media/media.constants.ts`), demonstrating the per-purpose directory pattern without importing a domain. Adding a purpose means adding a member to that enum, a subdirectory under `UPLOADS_DIR`, and an `ALTER TYPE` migration for the `media_purpose` Postgres enum. `MEDIA_MAX_BYTES` (10 MB) is the single source of truth for the size cap, enforced by each `FileInterceptor`'s `limits.fileSize` (413 before the buffer lands) and mirrored client-side for UX. Any reverse proxy in front of the app must allow at least ~12 MB request bodies, or an at-the-limit upload 413s before it ever reaches Nest.
- **Audit log** — append-only, no update/delete API, ever (`src/audit/audit-log.entity.ts`). `AUDIT_ACTIONS` is a TS string union stored as `varchar`, not a DB enum, so adding an action is a code change with no migration. `target_type`/`target_id` are polymorphic with no foreign key, which is what lets one log serve every table a consuming project adds — the price is that a `target_id` can outlive the row it names, so `before`/`after` should carry enough context to stay readable after the target is gone.
- **Deliberately deferred** — API versioning (no `/v1` prefix or header-based scheme) and soft-delete (no `deleted_at` column) aren't implemented; deactivation (`is_active`) is the only removal verb this slice has, and there is no `DELETE` route anywhere. Add these when a real requirement shows up rather than pre-building for a hypothetical one.
- **Frontend contract drift** — DTO shapes returned here (e.g. the `GET /me` response) are hand-mirrored on the frontend as plain TypeScript types (e.g. `Me` in `frontend/src/entities/user`), not generated. Fine at the current API surface; if keeping them in sync by hand becomes error-prone as the API grows, consider a shared `packages/contracts` workspace (types, maybe zod schemas) both sides import instead.

## Security & observability

- **helmet** and an always-on CORS allowlist (the `APP_URL` origin, plus the Vite dev origin outside production) are applied in `main.ts`; `trust proxy` is set to `TRUST_PROXY_HOPS` for correct client-IP resolution behind nginx.
- **Health** — `GET /health/live` (process up, no dependency checks) and `GET /health/ready` (DB + Redis via terminus; 503 when either is down). Compose healthchecks hit `/health/ready`.
- **Rate limiting** — global `ThrottlerGuard`: 100 req/min per IP by default, Redis-backed storage so counters are shared across replicas and survive restarts.
- **Logging** — structured JSON via `nestjs-pino` (pretty-printed when `NODE_ENV=development`); `Authorization` headers are redacted and `/health*` requests are not access-logged. Each request gets a UUID `requestId`.
- **Errors** — the global `AllExceptionsFilter` (`src/common/filters/`) returns `{ statusCode, error, message, path, timestamp, requestId }`, plus an optional `reason` passed through from an `HttpException` response body when present; unknown errors are logged in full but respond with a generic 500. `reportError()` in that file is the single hook to wire up an error tracker (Sentry/Bugsnag/…) — it mirrors the frontend stub in `frontend/src/shared/lib/error-reporting`.
- **Static uploads** — `main.ts` serves `UPLOADS_DIR` under the `/uploads/` prefix with `Cross-Origin-Resource-Policy: cross-origin` (avatars are loaded via `<img>` from a different origin than the API in dev).

## Migrations

TypeORM migrations run automatically on startup (`migrationsRun: true`). `synchronize` is disabled in all environments. The CLI data source (`src/data-source.ts`) and the runtime config (`src/config/database.config.ts`) share one set of DB connection defaults via `src/config/database.defaults.ts`.

**Multi-replica caveat:** `migrationsRun: true` is safe today because the prod stack (`docker-compose.prod.yml`) runs exactly one backend replica and TypeORM's migration runner is idempotent — re-applying an already-applied migration on the next boot is a no-op. It stops being safe the moment more than one replica starts concurrently, since two containers could race to apply the same pending migration. CD deploys through Coolify (`docs/coolify-deploy.md`) with a single replica and no separate migration step; before scaling the backend past one replica, remove `migrationsRun: true` from `app.module.ts` entirely and run migrations as an explicit, single, one-shot step before the new containers start.

**`migration:generate` cannot report "no changes" in this repo, and never could.** It proposes renaming every hand-written foreign-key constraint to a TypeORM-generated hash — `FK_user_identities_user`, `FK_audit_log_actor`, `UQ_product_grades_product_name_lower` and the rest. Hand-written names are the convention here. What IS worth checking after a schema change is that no COLUMN, type or constraint-body drift appears: generate into a scratch file, `grep -v '"FK_'`, read what is left, then delete it. Note also that generate runs against `DB_NAME` from `.env` (the dev database), so an unmigrated dev database makes it propose creating everything — use `DB_NAME=app_test` if that database is the migrated one.

**`SeedDevAdmin` (…0001) is deliberately not amended** to write `first_name`/`last_name`/`role` — it runs before `YagodaFoundation` (…0002), so a version referencing those columns would fail on every fresh database. `YagodaFoundation` backfills the row it left instead. This is why a migration is layout-frozen once another migration is written to depend on its output: fix forward, don't edit history.

**`BootstrapOwner` (…0003) needs its environment variables set before the FIRST production boot.** It creates the first `network_owner` from `BOOTSTRAP_OWNER_LOGIN`/`BOOTSTRAP_OWNER_PASSWORD` (plus optional first/last name), but only when the `users` table is empty — so it silently no-ops in development (`SeedDevAdmin` already populated a user) and, more importantly, no-ops for good on a production database that first boots without those variables set: a migration runs once, and an unset-variable boot still records itself as applied. Recovery at that point is a manual `INSERT`, not a re-run. See the migration's own doc comment.

## Dev seed

`npm run seed:dev -w backend` (or `npm run db:seed` from the repo root) loads the
demo dataset from `src/seed/dev-seed.data.ts` — the mock CRM's season reduced to
the tables that exist: 11 collection points (5 working, the warehouse, 5 in the
registry), 10 products with 14 grades (2 inactive), 4 tare types, 7 operators
(one deactivated), 17 suppliers, and a day price for every active grade at every
working point plus three intraday corrections on Шипинки so the price journal has
a «latest wins» case — and, once the intakes slice is in, a closed shift yesterday
and open shifts today on Шипинки / Конищів / Гайове with ten receipts and four
payouts whose numbers come from the server's own `buildIntake()` and
`composeDocumentCode()`, so the demo stores exactly what the API would have.
Since the cash counts slice it also writes **four transfers** (one accepted per
working point, one `disputed` at Конищів and one still `sent` at Гайове, so both
point actions have something to act on) and **a cash count for every seeded
shift** — without those a point reads `0.00` however many documents it has, and
closing a shift with no opening count silently records a zero discrepancy. The
seed never computes an expectation itself: it asks `PointCashService` for each
one inside its own transaction, so the demo cannot drift from the rule the API
enforces. Шипинки's close is 90 ₴ short **on purpose** — it is the one seeded
incident, and it is what makes the owner's working list non-empty on a fresh
database.

**The dataset is in TWO parts, and the split is load-bearing.**
`src/seed/dev-seed.data.ts` is CURATED and hand-written — today and yesterday,
carrying every case a screen is read against and every figure
`dev-seed.db-spec.ts` asserts. `src/seed/dev-seed.history.ts` is GENERATED: a
further **30 business days** at the five working points (823 receipts, 150
closed shifts, 141 payouts with a funding transfer each, 300 cash counts),
produced from a constant PRNG seed so the output is byte-identical on every
run. That determinism is not a nicety: the receipt code is the natural key
every insert is looked up by, so a dataset that moved between runs could not be
idempotent. **No test asserts a generated figure by hand** — the history spec
asserts the file's PROPERTIES instead, which is what the split buys.

Two properties are worth knowing before touching either file. First, **the
generated season is invisible to the curated cash chain**: `anchor` overrides a
computed expectation, and the last closing count the generator writes for each
point carries that point's curated anchor, so the chain arrives at yesterday
holding exactly what yesterday expects. That is why the db-spec can still
assert Шипинки 20 910.00, Конищів 12 800.00 and Гайове 500.00 with a season
inserted in front of them; if those ever move, the generator stopped landing on
the anchor — fix the generator, not the assertion. Second, **every generated
payout is funded by a transfer of exactly its amount**, accepted the same
business date, because a receipt puts no cash in the drawer (the formula is
«transfers accepted minus payouts») and `CHK_cash_counts_counted_non_negative`
is real.

The generator writes **no `grade_prices` rows**. Prices carry over until changed
(spec `2026-09-07` §8.1 removed `business_date`), so the historical price IS the
current one, and a row per day would silently re-introduce the daily scheme that
slice removed.

Points carry real receipt-code prefixes (`SHP`, `KON`, …). Sign in as `admin`/`admin` (owner) or as an operator
(`oksana`, `maria`, `taras`, `ihor`, `bohdan`, `lesia`) with password `operator`.

It is a SCRIPT, not a migration, on purpose: migrations are frozen once applied,
the seed is meant to evolve with the screens, and a migration would also run
inside every `*.db-spec.ts` suite. It is **idempotent** — every row is looked up
by its natural key and inserted only when missing; existing rows are never
modified, so hand edits survive a re-run and re-running only restores what was
deleted. One transaction: a failure leaves the database untouched. The CLI
refuses under `NODE_ENV=production` and on a database with pending migrations.
Runs from the host (`.env`'s `DB_HOST=localhost`; compose publishes Postgres on
5432) or inside the container (`docker compose exec backend npm run seed:dev -w backend`).
`src/seed/dev-seed.db-spec.ts` proves idempotency and the journal ordering
against a real Postgres; `dev-seed.spec.ts` checks the dataset's own consistency.
Because that spec seeds `app_test` and nothing truncates it, the throwaway database
carries the demo dataset permanently after a `test:db` run — every other db-spec
already scopes its fixtures by a per-run uuid, and that convention is now load-bearing.
The CLI also refuses a non-local `DB_HOST` unless `SEED_ALLOW_REMOTE_DB=1`.

**Workflow for schema changes:**

```bash
# 1. Make your entity changes in src/<feature>/<name>.entity.ts
# 2. Generate a migration (run from backend/):
npm run migration:generate -- src/migrations/DescribingYourChange

# 3. Review the generated file in src/migrations/ — confirm it only changes what you intended
# 4. Start the app — migration applies automatically:
npm run dev

# Other useful commands:
npm run migration:show    # list applied / pending migrations
npm run migration:revert  # roll back the last applied migration
npm run migration:run     # apply pending migrations without starting the full app
```

`npm run migration:run:prod -w backend` (`typeorm migration:run -d dist/data-source.js`) is the production variant — it targets the compiled `dist/data-source.js` instead of `src/data-source.ts`, so it needs `npm run build -w backend` first. Run this as the migration step before starting new containers in any deploy that doesn't run migrations another way.

Migration files are committed to git. Every developer gets the same schema after `git pull && npm run dev`.

**Note:** Migration generation requires a running Postgres instance. `docker-compose.yml` publishes Postgres on `0.0.0.0:5432`, so `DB_NAME=app_test npm run migration:generate -w backend -- src/migrations/YourChangeName` also works directly from the host once the dev stack is up. The container route below remains valid too — it's just no longer the only option (paths are relative to the image's `/app` = repo root):

```bash
# From repo root — ensure the dev stack is running first:
docker compose up -d postgres redis backend

# Generate (the backend service already has DB_* env and the app_net network):
docker compose exec backend \
  npm run migration:generate -w backend -- src/migrations/YourChangeName

# The dev compose mounts ./backend/src into the container, so the generated
# file appears in your working tree; review and commit it.
```
