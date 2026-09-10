import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(__dirname, '.auth', 'compose-state.json');
const SERVICES = ['postgres', 'redis', 'backend'] as const;
const FRONTEND_DIST = path.join(ROOT, 'frontend', 'dist');

/**
 * Returns the state global-setup.ts recorded for it: the subset of `SERVICES` that
 * were ALREADY running before this run's `docker compose up` — i.e. some other
 * worktree's session, or the owner, was using them, and this run must leave them
 * running when it's done. Falls back to "none were already running" (so teardown
 * still tries to stop everything it plausibly started) when the file is missing —
 * global-setup writes it right before `docker compose up`, so this only happens if
 * setup crashed before reaching Docker at all, in which case there is nothing this
 * run brought up to stop anyway and `docker compose stop` on an absent/untouched
 * container is a harmless no-op.
 */
function alreadyRunningBeforeThisRun(): readonly string[] {
  if (!existsSync(STATE_FILE)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Deletes `frontend/dist` — found empirically to be load-bearing, not tidiness.
 * global-setup.ts writes this directory with a direct `npm run build -w frontend`
 * call, which is invisible to Turborepo's own output cache (the `build` verify row's
 * `npm run build` is `turbo build`, tracked by content hash). Reproduced directly: with
 * `frontend/dist` already holding this row's own build (a `VITE_API_URL`-specific
 * content hash Turbo never produced), a plain `npm run build` that Turbo can satisfy
 * from cache does NOT clear the directory first — `vite build`'s own `emptyOutDir`
 * logic only runs when `vite build` actually executes, which a cache HIT skips
 * entirely — so Turbo's cached files land ALONGSIDE this row's leftover ones instead of
 * replacing them. `scripts/verify/checks/bundle-size.mjs` sums every `.js`/`.css` file
 * under `dist/assets`, so two coexisting builds means it measures roughly DOUBLE the
 * real bundle and fails with a false "OVER BUDGET" a great deal larger than any genuine
 * regression would ever produce — confirmed exactly this way, twice, while building
 * this row (534 KiB gzip against a 305 KiB ceiling, immediately after a clean
 * `npm run bundle` had reported the correct 276 KiB moments earlier). Deleting the
 * directory here — after the test has already run, so this never affects the run it
 * belongs to — guarantees the NEXT `build` (this run's own next `npm run test:e2e`, or
 * an unrelated `build`/`bundle`/`docker` row in someone else's run) starts from empty,
 * where a Turbo cache hit was confirmed (same investigation) to restore correctly.
 * global-setup.ts also deletes it before building, for the same reason in the other
 * direction — belt and suspenders, since either the previous run's teardown or this
 * one crashing before reaching here is what the other one covers.
 */
function removeFrontendDist(): void {
  rmSync(FRONTEND_DIST, { recursive: true, force: true });
}

/**
 * Returns this run's stack to exactly the state it found it in — never further than
 * that, and never with `down`/`down -v` (docker-compose.yml's project name, `web-
 * starter`, is SHARED across every worktree of this repo and the main checkout; `-v`
 * would destroy `web-starter_pg_data`/`web-starter_uploads_dev`, the owner's real local
 * data, and plain `down` removes containers other sessions on this machine may depend
 * on — see the environment note this task shipped with). `stop` only ever stops a
 * container; it never touches a volume or removes anything.
 *
 * Only stops a service this run's OWN global-setup actually started — a service
 * `global-setup.ts` found already running (someone else's session) is left exactly as
 * it was, running, on the way out.
 */
export default async function globalTeardown(): Promise<void> {
  removeFrontendDist();

  const preexisting = new Set(alreadyRunningBeforeThisRun());
  const toStop = SERVICES.filter((s) => !preexisting.has(s));
  if (toStop.length === 0) {
    process.stdout.write(
      'smoke/global-teardown: every service was already running before this run — leaving the stack as found, nothing to stop.\n',
    );
    return;
  }
  try {
    execFileSync('docker', ['compose', 'stop', ...toStop], { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Loud, but never `down`/`down -v` as a "fix" — see this function's own doc comment.
    // eslint has no say here (no lint row covers e2e/*.ts — see the plan's typecheck
    // note), so this is a plain thrown Error, same shape as global-setup.ts's.
    throw new Error(
      `smoke/global-teardown: \`docker compose stop ${toStop.join(' ')}\` FAILED — the stack may ` +
        `still be running. Never run \`docker compose down\`/\`down -v\` to "fix" this by hand: ` +
        `the compose project (\`web-starter\`) is shared across every worktree of this repo, and ` +
        `\`-v\` destroys the owner's real local Postgres/uploads volumes. Stop the named services ` +
        `manually instead. (${message})`,
    );
  }
}
