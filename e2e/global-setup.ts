import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PREVIEW_ORIGIN } from './constants';

const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(__dirname, '.auth');
const COMPOSE_STATE_FILE = path.join(AUTH_DIR, 'compose-state.json');
const COMPOSE_SERVICES = ['postgres', 'redis', 'backend'];

// Match docker-compose.yml's own hardcoded `POSTGRES_USER: app` / `POSTGRES_DB: app` —
// not read from .env, the same way the compose file itself doesn't for these two.
const PG_USER = 'app';
const PG_DB = 'app';

// The SAME default `dev-seed.ts:331` and `timezone.config.ts` use for the identical
// value — read here, not hardcoded, so the "close stale shifts" step below compares
// against the SAME business date the seed itself is about to write, on whatever
// APP_TIMEZONE this process actually has. A hardcoded 'Europe/Kyiv' here would be a
// second source of truth that silently stops matching the moment anyone runs this
// suite with a different APP_TIMEZONE.
const APP_TIMEZONE = process.env.APP_TIMEZONE ?? 'Europe/Kyiv';

/**
 * `admin` / `admin` — the one account `backend/src/migrations/1788600000001-
 * SeedDevAdmin.ts` inserts directly as a raw SQL literal (see its own header comment),
 * confirmed live by `backend/CLAUDE.md`'s Dev seed section ("Sign in as `admin`/`admin`
 * (owner)"). Unlike the seeded OPERATORS — `backend/src/seed/dev-seed.data.ts` exports
 * `DEV_OPERATOR_PASSWORD` as a real constant — there is no equivalent export for the
 * owner: the migration is layout-frozen (backend/CLAUDE.md: "fix forward, don't edit
 * history") and writes the value inline, once, before `dev-seed` ever runs. These two
 * constants are this file's read of that value, not a second definition of it — nothing
 * else in this repo could be imported instead.
 */
const OWNER_USERNAME = 'admin';
const OWNER_PASSWORD = 'admin';

/**
 * Runs `cmd` with inherited stdio (so a failure's real output lands directly in the
 * terminal, not swallowed into a caught Error's `.message`) and rethrows with a short,
 * named explanation of what this step was for — the whole point being that a developer
 * who has never touched this row can tell from the failure alone what broke and why,
 * rather than staring at a generic non-zero exit code.
 */
function runOrExplain(step: string, cmd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  try {
    execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: env ?? process.env });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `smoke/global-setup: ${step} FAILED (\`${cmd} ${args.join(' ')}\`) — see the command's own ` +
        `output above for the real cause. The specs never ran against a stack that wasn't ` +
        `actually ready. (${message})`,
    );
  }
}

/**
 * The subset of `COMPOSE_SERVICES` already running BEFORE this run touches anything —
 * global-teardown.ts reads this back so it only ever stops what THIS run started,
 * leaving a service some other worktree's session (or the owner) was already using
 * exactly as it found it, running, on the way out.
 */
function runningComposeServices(): string[] {
  const out = execFileSync(
    'docker',
    ['compose', 'ps', '--status', 'running', '--services', ...COMPOSE_SERVICES],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Brings up the real stack the `smoke` row exists to prove composes, seeds it, and hands
 * the spec the seeded owner's real credentials. Building and serving the FRONTEND is
 * deliberately NOT this file's job any more — see playwright.config.ts's `webServer` and
 * its own header comment (FIX ROUND 2) for why: Playwright starts `webServer` BEFORE this
 * file's `export default` ever runs, so anything this file did to prepare the frontend
 * would race it and lose.
 *
 * Step numbers below match the brief's own list where they overlap; 0 and 1.5 are
 * additions this task made, each documented because each is a genuine deviation:
 *
 *  0. Records which of postgres/redis/backend are ALREADY running, to
 *     `e2e/.auth/compose-state.json`, BEFORE step 1 touches anything — see
 *     global-teardown.ts, which reads this back.
 *
 *  1. `docker compose up -d --wait postgres redis backend` — `--wait` blocks on the
 *     healthchecks docker-compose.yml already defines (`/health/ready` for the backend),
 *     so this step alone is most of "fail loudly": Compose itself reports a clear,
 *     named error and a non-zero exit when a service never becomes healthy, rather than
 *     leaving a spec to time out guessing why the app never rendered.
 *
 *     `APP_URL` is overridden to this preview server's own origin for this one `up`
 *     invocation. The backend's CORS allowlist (`backend/src/config/app.config.ts`) is
 *     `[APP_URL's origin, plus http://localhost:5173 unconditionally outside
 *     production]` — 5173 (the Vite DEV server) is baked in, but 4173 (this row's
 *     `vite preview`, deliberately a different port so it never collides with a real
 *     dev server already running on 5173) is not. Without this override every request
 *     the spec's browser makes would be rejected by CORS before it ever reached the
 *     app — a failure that looks exactly like "the stack doesn't compose" while actually
 *     testing nothing about composition at all.
 *
 *     BLIND SPOT / SHARED-STATE WARNING, worth repeating even though `smoke`'s own
 *     `blindSpot` in scripts/verify/registry.mjs says it too: an env-var change makes
 *     Compose RECREATE the `backend` container (a fresh container, not merely a restart),
 *     even though only THIS one child-process invocation's env differs — this container
 *     is the SAME one docker-compose.yml names for ordinary dev use, shared across every
 *     worktree of this repo and the main checkout. Non-destructive (the next plain
 *     `docker compose up`, with no override, recreates it again with the ordinary
 *     `APP_URL` from `.env`) but it IS a mutation of shared state, not scoped purely to
 *     this process the way an env var normally would be — anyone with the dev stack
 *     actively running elsewhere on this machine will see their `backend` container
 *     restart when this row runs.
 *
 *     TESTING TRAP, for the next person who tries to reproduce the backend-down failure
 *     this row is supposed to catch: `docker compose stop backend` does NOT work, because
 *     THIS line's own `--wait ... backend` brings it right back up a moment later, inside
 *     the very run you are trying to break. The backend has to be missing from the `up`
 *     call itself — temporarily edit the services array two lines below to
 *     `['postgres', 'redis']`, run, capture the failure, then revert. Costs about ten
 *     minutes to rediscover if you don't already know it; this comment is so you don't
 *     have to.
 *
 *  1.5. Closes any OPEN seeded shift dated before today, straight in Postgres. Found
 *     empirically, not hypothesised: the very first time this file ran against this
 *     worktree's real, persistent `web-starter_pg_data` volume, `npm run db:seed`
 *     (step 2) died on `duplicate key value violates unique constraint
 *     "UQ_shifts_open_per_point"` — a real Postgres partial-unique index on
 *     `(collection_point_id) WHERE closed_at IS NULL`, i.e. AT MOST ONE open shift per
 *     point, ever, independent of date. `dev-seed.data.ts`'s `SEED_SHIFTS` opens a shift
 *     per working point for "today" (computed at RUN TIME, via `TimeService`, never
 *     closed by the seed itself) and never closes yesterday's — so `db:seed` is
 *     idempotent only WITHIN the calendar day it first ran; the very first run on any
 *     later day collides with the still-open shift the previous day's run left behind.
 *     `test:db` never sees this (it drops and recreates a scratch `app_test` database on
 *     every run — backend/CLAUDE.md's own "test:db prerequisite" section), and no row in
 *     this verify layer before `smoke` ever calls `db:seed` against a database that
 *     persists across real time. This is a real gap in `dev-seed.ts` — `backend/src` is
 *     out of scope for this task, so it isn't fixed there — worked around here the same
 *     way `dev-seed.ts` itself already writes these rows: a direct SQL statement against
 *     the `shifts` table, scoped to exactly the stale case (`status = 'open' AND
 *     business_date < (now() AT TIME ZONE '<APP_TIMEZONE>')::date`) so a shift already
 *     correctly open for TODAY, on a same-day re-run, is never touched.
 *
 *     FIX ROUND 1 (found by code review, not by this row's own tests): an earlier
 *     version of this comparison used bare `CURRENT_DATE` instead. `CURRENT_DATE` is
 *     POSTGRES'S OWN DATE — the server's date in ITS session timezone (UTC for this
 *     image) — and it is NOT the business date the app (or this seed) ever writes;
 *     `TimeService`, `dev-seed.ts:331` and `shift.entity.ts` all derive `business_date`
 *     from `APP_TIMEZONE` instead, and `shifts.service.ts:70`'s own comment names
 *     exactly this class of misfiling for the identical reason. Kyiv is UTC+3, so for
 *     THREE HOURS EVERY SINGLE DAY (21:00–24:00 UTC) Postgres's `CURRENT_DATE` is a
 *     calendar day BEHIND the business date the seed is about to write — not a rare
 *     edge case, but every Kyiv evening, on the machine of whoever is actually
 *     developing this. Reproduced for real during this task's own validation: this
 *     process's wall clock crossed Kyiv midnight mid-run, `CURRENT_DATE` was still
 *     "yesterday" in UTC, the three shifts genuinely stale by the app's own reckoning
 *     survived this step untouched, and `db:seed` (step 2) died on exactly the
 *     `UQ_shifts_open_per_point` collision described above. Comparing against
 *     `(now() AT TIME ZONE APP_TIMEZONE)::date` instead — the SAME expression
 *     `dev-seed.ts:331`'s `seedDocuments()` already uses for its own `today`/`yesterday`
 *     — closes exactly the shifts that are stale by the app's OWN calendar, regardless
 *     of what day it is in UTC. Do not "simplify" this back to `CURRENT_DATE`: that
 *     reintroduces a three-hour-a-day window where this step does nothing and `db:seed`
 *     fails on every affected evening run.
 *
 *  2. `npm run db:seed` — idempotent (backend/CLAUDE.md's Dev seed section) once 1.5 has
 *     cleared the one case that isn't: running it again on top of whatever the database
 *     already holds inserts nothing new when the demo dataset for today is already
 *     present, and populates it from empty otherwise.
 *
 *  3. Writes the seeded owner's credentials to `e2e/.auth/owner.json` (gitignored,
 *     regenerated every run) for `smoke.spec.ts` to read. The spec still drives the
 *     real sign-in FORM — this file only supplies the values it types into it, never a
 *     shortcut (a `storageState`, a minted token) around the UI login the brief's first
 *     assertion exists to exercise.
 */
export default async function globalSetup(): Promise<void> {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(COMPOSE_STATE_FILE, JSON.stringify(runningComposeServices()) + '\n');

  runOrExplain(
    'docker compose up (postgres, redis, backend)',
    'docker',
    ['compose', 'up', '-d', '--wait', 'postgres', 'redis', 'backend'],
    { ...process.env, APP_URL: PREVIEW_ORIGIN },
  );

  runOrExplain('close stale seeded shifts from a previous day', 'docker', [
    'compose',
    'exec',
    '-T',
    'postgres',
    'psql',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    PG_USER,
    '-d',
    PG_DB,
    '-c',
    "UPDATE shifts SET status = 'closed', closed_at = now(), closed_by_user_id = opened_by_user_id " +
      // `(now() AT TIME ZONE '<tz>')::date` is the app's own business date, the same
      // expression dev-seed.ts:331 uses — NOT `CURRENT_DATE` (Postgres's server-timezone
      // date), which disagrees with it for three hours every day at UTC+3. See this
      // function's own doc comment (step 1.5, FIX ROUND 1) for why that distinction is
      // load-bearing rather than cosmetic.
      //
      // APP_TIMEZONE is interpolated directly into the SQL text rather than bound via
      // psql's `-v`/`:'var'` substitution: verified empirically that this psql build
      // (16.14) does NOT perform `:'var'` interpolation on a `-c` command string (only
      // on script/stdin input), so a `-v tz=... AT TIME ZONE :'tz'` version fails with a
      // literal `syntax error at or near ":"` — this is an internal config value, never
      // user input at this point, so a single-quote-doubling escape is defensive rather
      // than load-bearing, and is applied anyway.
      `WHERE status = 'open' AND business_date < (now() AT TIME ZONE '${APP_TIMEZONE.replace(/'/g, "''")}')::date;`,
  ]);

  runOrExplain('db seed', 'npm', ['run', 'db:seed']);

  writeFileSync(
    path.join(AUTH_DIR, 'owner.json'),
    JSON.stringify({ username: OWNER_USERNAME, password: OWNER_PASSWORD }, null, 2) + '\n',
  );
}
