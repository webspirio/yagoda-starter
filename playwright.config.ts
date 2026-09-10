import { defineConfig } from '@playwright/test';
import { BACKEND_URL, PREVIEW_ORIGIN } from './e2e/constants';

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
 * have already populated `frontend/dist`. Reproduced directly: delete `frontend/dist`,
 * run `npm run test:e2e` completely on its own (no prior build, the state of a fresh
 * checkout or a CI runner) — `vite preview` has nothing to serve, never binds the port,
 * and the run dies with `Error: Timed out waiting 60000ms from config.webServer` with
 * NOTHING in `global-setup.ts` having run at all: no compose, no seed, no credentials.
 * That is exactly the confusing-months-from-now failure this row exists to not produce.
 *
 * The fix: `webServer.command` builds the frontend itself, every time, before serving it
 * — a single shell pipeline that cannot depend on anything having run first. `vite
 * build`'s own `emptyOutDir` clears `frontend/dist` on every real invocation (confirmed:
 * this is what actually prevents the OTHER bug this task found, a stale Turbo-cached
 * `frontend/dist` coexisting with a fresher build and doubling `bundle`'s measurement —
 * see `bundle`'s own `blindSpot` in scripts/verify/registry.mjs), so nothing here needs to
 * delete the directory first or after. `VITE_API_URL` is supplied via `webServer.env`,
 * not a shell prefix, so it applies regardless of how this command is ever invoked.
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
    // `VITE_API_URL` is what frontend/src/shared/lib/env/index.ts reads at module load
    // (baked in at BUILD time, never at `vite preview` time), matching the backend's own
    // host-published port (docker-compose.yml's `ports: "3000:3000"`) so the browser this
    // row drives talks to the real compose backend rather than throwing "VITE_API_URL is
    // required" the instant the app boots.
    command: `npm run build -w frontend && npm run preview -w frontend -- --port 4173 --strictPort`,
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
