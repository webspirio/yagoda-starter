import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const AUTH_DIR = path.join(__dirname, '.auth');
const COMPOSE_STATE_FILE = path.join(AUTH_DIR, 'compose-state.json');
const COMPOSE_SERVICES = ['postgres', 'redis', 'backend'];
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');

// The frontend's production build (`vite preview`, what `playwright.config.ts`'s
// `webServer` serves) always runs on this fixed, `--strictPort` origin — see
// playwright.config.ts's own comment for why 4173, not 5173.
const PREVIEW_ORIGIN = 'http://localhost:4173';

// docker-compose.yml publishes the backend on this host port (`ports: "3000:3000"`),
// so this is the URL a browser on the HOST reaches it at — not `http://backend:3000`,
// which only resolves inside the compose network.
const BACKEND_URL = 'http://localhost:3000';

// Match docker-compose.yml's own hardcoded `POSTGRES_USER: app` / `POSTGRES_DB: app` —
// not read from .env, the same way the compose file itself doesn't for these two.
const PG_USER = 'app';
const PG_DB = 'app';

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
 * Brings up the real stack the `smoke` row exists to prove composes, then hands the
 * specs a fresh, correctly-configured frontend build and the seeded owner's real
 * credentials. Steps 1 and 3 are the brief's own two remaining items (seeding is step
 * 2); steps 0, 1.5 and 3 are additions this task made beyond the brief's literal
 * 3-step list — each documented here, up front, because each is a genuine deviation:
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
 *     testing nothing about composition at all. This only ever affects the env of the
 *     one `docker compose up` call below (never this shared compose project's `.env`
 *     file, and never any other worktree's session): the unconditional 5173 entry means
 *     a real dev frontend using this same backend container is unaffected, and the next
 *     plain `docker compose up` (no override) recreates the backend with the ordinary
 *     `APP_URL` from `.env` again.
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
 *     business_date < CURRENT_DATE`) so a shift already correctly open for TODAY, on a
 *     same-day re-run, is never touched. `CURRENT_DATE` is Postgres's own (server
 *     timezone, typically UTC for this image) rather than the app's `APP_TIMEZONE`
 *     (Europe/Kyiv) — close enough for this repo's actual UTC offset that the two dates
 *     disagree only in a narrow window near midnight Kyiv time, accepted here rather
 *     than plumbing `APP_TIMEZONE` into a shell one-liner.
 *
 *  2. `npm run db:seed` — idempotent (backend/CLAUDE.md's Dev seed section) once 1.5 has
 *     cleared the one case that isn't: running it again on top of whatever the database
 *     already holds inserts nothing new when the demo dataset for today is already
 *     present, and populates it from empty otherwise.
 *
 *  3. Deletes `frontend/dist`, then rebuilds it with an explicit `VITE_API_URL`. Vite
 *     bakes `VITE_API_URL` into the bundle at BUILD time (`frontend/src/shared/lib/env/
 *     index.ts` reads it off `import.meta.env` at module load), never at `vite preview`
 *     time — so a dist built without that variable set (exactly what plain `npm run
 *     build`, and this repo's own `build` verify row, produce today: neither sets it)
 *     throws "VITE_API_URL is required" the instant the app boots in a real browser.
 *     That is a real bug this task surfaced, not a hypothetical: this row is the first
 *     one in the whole verify layer to actually EXECUTE the built frontend rather than
 *     just compile it. Rebuilding here, every run, with the value that matches step 1's
 *     published port, guarantees the preview server always serves a dist wired to the
 *     real compose backend — regardless of whether `build` ran first, and regardless of
 *     what env it ran with. Deleting first is ALSO load-bearing, not tidiness — a second
 *     real bug this task surfaced, this time affecting `build`/`bundle` on whatever runs
 *     NEXT: `npm run build -w frontend` (a direct workspace script call) is invisible to
 *     Turborepo's own output cache, and a plain `npm run build` (the `build` verify row,
 *     `turbo build`) that Turbo can satisfy from cache does NOT clear `frontend/dist`
 *     first — `vite build`'s own `emptyOutDir` only runs when `vite build` actually
 *     executes, which a Turbo cache HIT skips — so the restored cached files land
 *     ALONGSIDE whatever this step left rather than replacing it, and
 *     scripts/verify/checks/bundle-size.mjs (which sums every `.js`/`.css` file under
 *     `dist/assets`) then measures roughly DOUBLE the real bundle and fails with a false
 *     "OVER BUDGET" nowhere close to any genuine regression. Reproduced directly while
 *     building this row (534 KiB gzip against a 305 KiB ceiling, immediately after a
 *     clean `npm run bundle` had reported the correct 276 KiB). Deleting before AND after
 *     (global-teardown.ts does this too, deleting after the test instead of before it) is
 *     belt and suspenders: whichever one runs is what protects a run that starts from a
 *     crash the other side of it.
 *
 *  4. Writes the seeded owner's credentials to `e2e/.auth/owner.json` (gitignored,
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
      "WHERE status = 'open' AND business_date < CURRENT_DATE;",
  ]);

  runOrExplain('db seed', 'npm', ['run', 'db:seed']);

  // See this function's own doc comment (step 3) for why this delete is load-bearing,
  // not tidiness: it keeps a stale Turbo-cached `frontend/dist` (from `npm run build`,
  // the `build` verify row) from landing ALONGSIDE this build's own output.
  rmSync(FRONTEND_DIST, { recursive: true, force: true });
  runOrExplain(
    'frontend build (with VITE_API_URL set for the preview server)',
    'npm',
    ['run', 'build', '-w', 'frontend'],
    { ...process.env, VITE_API_URL: BACKEND_URL },
  );

  writeFileSync(
    path.join(AUTH_DIR, 'owner.json'),
    JSON.stringify({ username: OWNER_USERNAME, password: OWNER_PASSWORD }, null, 2) + '\n',
  );
}
