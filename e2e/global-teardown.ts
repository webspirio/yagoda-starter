import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(__dirname, '.auth', 'compose-state.json');
const SERVICES = ['postgres', 'redis', 'backend'] as const;

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
 *
 * FIX ROUND 2 — this function no longer touches `frontend/dist`. An earlier version
 * deleted it here, reasoning that `smoke`'s own direct `npm run build -w frontend` call
 * was invisible to Turborepo's cache and could leave a stale, doubled `frontend/dist`
 * for `build`/`bundle` to trip over later. That reasoning was correct, but deleting the
 * shared artifact in TEARDOWN was the wrong fix: `frontend/dist` is `build`'s output and
 * `bundle`'s input, not something this row owns, and deleting it here is exactly what
 * made row ORDER load-bearing for this row's own next run (or a completely unrelated
 * standalone `npm run test:e2e`) — with `frontend/dist` gone, `webServer` has nothing to
 * serve, `vite preview` never binds the port, and Playwright times out after 60s having
 * never reached `global-setup.ts` at all (`webServer` starts before `globalSetup`; see
 * playwright.config.ts's own header comment). `webServer.command` now builds the
 * frontend itself before serving it, every run, which is what actually needed fixing —
 * see playwright.config.ts. Deleting `frontend/dist` in a teardown a build's own
 * `emptyOutDir` already keeps correct was never the right layer for that fix.
 *
 * FIX ROUND 3 — moot now, in the best way: `webServer.command` builds and serves from
 * `E2E_OUT_DIR` (`frontend/dist-e2e`, see `e2e/constants.ts`), never `frontend/dist`, so
 * this function (and `global-setup.ts`) have nothing of `build`'s or `bundle`'s to
 * accidentally touch in either direction any more — the paragraph above is kept as the
 * record of why deleting a SHARED path from here was wrong, not as live guidance.
 */
export default async function globalTeardown(): Promise<void> {
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
