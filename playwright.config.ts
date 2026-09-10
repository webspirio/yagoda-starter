import { defineConfig } from '@playwright/test';
import { BACKEND_URL, E2E_OUT_DIR, PREVIEW_ORIGIN } from './e2e/constants';

/**
 * The `smoke` row (root CLAUDE.md's verify table) — the one check in this repo that
 * drives a real browser against the real compose stack (Postgres + Redis + the backend
 * container) and a real production frontend build (`vite preview`, not the dev server).
 *
 * The compose lifecycle (`docker compose up`/`stop`, `npm run db:seed`) lives in
 * `e2e/global-setup.ts` / `e2e/global-teardown.ts`, NOT here and NOT in the `test:e2e`
 * npm script — that is deliberate, so a bare `npx playwright test` behaves identically to
 * `npm run test:e2e`.
 *
 * FIX ROUND 2 — `webServer` OWNS THE FRONTEND BUILD, NOT `global-setup.ts`, and this is
 * load-bearing, not a style choice. Playwright's own task order
 * (`createGlobalSetupTasks`, packages/playwright/lib/runner/index.js) is: remove output
 * dirs, THEN run every plugin's `setup()` — `webServer` is implemented as a plugin — THEN
 * run `config.globalSetup`. So `webServer.command` starts, and Playwright begins polling
 * its `url`, BEFORE a single line of `global-setup.ts` executes. An earlier version of
 * this row built the frontend inside `global-setup.ts` and pointed `webServer.command` at
 * a bare `vite preview` — which only ever worked because something ELSE (this repo's own
 * `build` verify row, running earlier in the SAME `verify:full` invocation) happened to
 * have already populated `frontend/dist`. Reproduced directly: delete the build output,
 * run `npm run test:e2e` completely on its own (no prior build, the state of a fresh
 * checkout or a CI runner) — `vite preview` has nothing to serve, never binds the port,
 * and the run dies with `Error: Timed out waiting 60000ms from config.webServer` with
 * NOTHING in `global-setup.ts` having run at all: no compose, no seed, no credentials.
 * That is exactly the confusing-months-from-now failure this row exists to not produce.
 *
 * The fix: `webServer.command` builds the frontend itself, every time, before serving it
 * — a single shell pipeline that cannot depend on anything having run first. `VITE_API_URL`
 * is supplied via `webServer.env`, not a shell prefix, so it applies regardless of how this
 * command is ever invoked.
 *
 * FIX ROUND 3 — BUILDS AND SERVES FROM `E2E_OUT_DIR` (`frontend/dist-e2e`), NEVER
 * `frontend/dist`, via `vite build`/`vite preview`'s own `--outDir` flag. Round 2's fix
 * made `webServer.command` run a direct `npm run build -w frontend` — correct for
 * standalone reliability, but it wrote the SAME directory `build`'s own `turbo build`
 * writes, and reproduced two real problems doing it (see `e2e/constants.ts`'s own comment
 * on `E2E_OUT_DIR` for the full account): Turbo's cache restore does not clear
 * `frontend/dist` first, so the two builds' files coexisted and `bundle` measured roughly
 * double; and this row's own build baked `VITE_API_URL=http://localhost:3000` — smoke's
 * environment, never a real one — into the exact directory `bundle` measures as the
 * shipped artifact. A dedicated output directory this row alone ever writes closes both:
 * `smoke` cannot corrupt `build`'s output or `bundle`'s input in either direction,
 * regardless of run order, because it never touches the same path.
 *
 * A BUILD failure inside this command is NOT a 60/120s timeout either — read directly out
 * of the installed package (`_waitForProcess`, packages/playwright/lib/runner/index.js):
 * the process's own early-exit rejection is raced (`Promise.race`) against the URL-ready
 * wait, so an early exit wins immediately. Confirmed by temporarily pointing this command
 * at a nonexistent workspace (`npm run build -w bogus-workspace-does-not-exist && ...`):
 * failed in 0.5s flat with `Error: Process from config.webServer was not able to start.
 * Exit code: 1`, plus npm's own "No workspaces found" naming the real cause — never the
 * generic `Timed out waiting ...` message a hung server would produce.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  // A retried flake is a red result rounded up to green — this row's whole value is that
  // it fails when the stack genuinely does not compose, and a retry would hide exactly
  // that signal on the one run where it actually happened.
  retries: 0,
  // The default 'html' reporter opens a browser tab locally on a failing run — wrong for
  // an unattended/headless verify row (and a second browser process racing the one under
  // test). 'list' just prints to the terminal, the same place every other row in this
  // layer reports through.
  reporter: 'list',
  use: {
    baseURL: PREVIEW_ORIGIN,
  },
  webServer: {
    // Builds THEN serves, every run, self-sufficient regardless of what (if anything) ran
    // before it — see this file's own header comment above for why that is load-bearing.
    // `--outDir` on BOTH commands routes this row's own build to `E2E_OUT_DIR`
    // (`frontend/dist-e2e`), never `frontend/dist` — see this file's header (FIX ROUND 3)
    // and `e2e/constants.ts` for why that separation is load-bearing, not tidiness.
    // `VITE_API_URL` is what frontend/src/shared/lib/env/index.ts reads at module load
    // (baked in at BUILD time, never at `vite preview` time), matching the backend's own
    // host-published port (docker-compose.yml's `ports: "3000:3000"`) so the browser this
    // row drives talks to the real compose backend rather than throwing "VITE_API_URL is
    // required" the instant the app boots.
    command: `npm run build -w frontend -- --outDir ${E2E_OUT_DIR} && npm run preview -w frontend -- --port 4173 --strictPort --outDir ${E2E_OUT_DIR}`,
    env: { VITE_API_URL: BACKEND_URL },
    url: PREVIEW_ORIGIN,
    // strictPort is deliberate: a collision (e.g. something else already bound to 4173)
    // must fail loudly, not silently hand the tests a server on a different port than the
    // one baseURL points at.
    reuseExistingServer: false,
    // The build alone is ~0.5s warm, but a cold `tsc -b` plus `vite build` on a busy
    // machine can run longer than Playwright's own default `timeout` (60s) budgets for
    // "server never became ready" — this is the one number in this file that pads for a
    // slow BUILD, not a slow SERVER, so it is intentionally generous rather than tuned to
    // the measured ~0.5s.
    timeout: 120_000,
  },
});
