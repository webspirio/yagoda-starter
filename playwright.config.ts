import { defineConfig } from '@playwright/test';

/**
 * The `smoke` row (root CLAUDE.md's verify table) — the one check in this repo that
 * drives a real browser against the real compose stack (Postgres + Redis + the backend
 * container) and a real production frontend build (`vite preview`, not the dev server).
 *
 * The compose lifecycle (`docker compose up`/`stop`, `npm run db:seed`) lives in
 * `e2e/global-setup.ts` / `e2e/global-teardown.ts`, NOT here and NOT in the `test:e2e`
 * npm script — that is deliberate, so a bare `npx playwright test` behaves identically to
 * `npm run test:e2e`. See global-setup.ts's own header for why it also rebuilds the
 * frontend with an explicit `VITE_API_URL`, beyond the three steps the brief for this row
 * names.
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
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    // `vite preview` serves whatever is already sitting in frontend/dist — it does not
    // build. global-setup.ts is what guarantees that directory is fresh and correctly
    // configured before this command ever starts (see its header comment).
    command: 'npm run preview -w frontend -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    // strictPort is deliberate: a collision (e.g. something else already bound to 4173)
    // must fail loudly, not silently hand the tests a server on a different port than the
    // one baseURL points at.
    reuseExistingServer: false,
  },
});
