/**
 * Shared between `playwright.config.ts` and `global-setup.ts` so the two origins this row
 * depends on are declared exactly once. See the two files' own comments for how each is
 * used; this file is intentionally just data.
 */

/**
 * The frontend preview server's own fixed, `--strictPort` origin (playwright.config.ts's
 * `webServer` and `use.baseURL`). 4173, not the Vite DEV server's 5173, on purpose — a
 * dev server may legitimately already be running on 5173 for a human, and this row must
 * never collide with it silently.
 */
export const PREVIEW_ORIGIN = 'http://localhost:4173';

/**
 * docker-compose.yml publishes the backend on this host port (`ports: "3000:3000"`), so
 * this is the URL a browser running on the HOST reaches it at — not `http://backend:3000`,
 * which only resolves inside the compose network.
 */
export const BACKEND_URL = 'http://localhost:3000';

/**
 * FIX ROUND 3 — `smoke`'s OWN build output directory, never `frontend/dist`. Passed to
 * both `vite build` and `vite preview` via their `--outDir` flag (`playwright.config.ts`'s
 * `webServer.command`). `frontend/dist` is `build`'s output and `bundle`'s input — see
 * `bundle`'s own `blindSpot` in scripts/verify/registry.mjs for two reasons that turned
 * out to matter, both reproduced directly while fixing this:
 *
 *  1. `build` writes `frontend/dist` through `turbo build`; `smoke` used to write the same
 *     directory directly (`npm run build -w frontend`, bypassing Turbo entirely). Turbo
 *     restores its cached files ALONGSIDE whatever is already on disk rather than clearing
 *     first, so the two builds' outputs coexisted and `bundle` measured roughly double.
 *  2. Worse: that direct build baked `VITE_API_URL=http://localhost:3000` — smoke's own
 *     environment, never a real production value — into `frontend/dist`. `bundle` exists to
 *     measure the artifact that ships; if `smoke` ran last, it was silently measuring one
 *     that could never actually ship, with no RED to notice it by.
 *
 * A separate directory closes both: `smoke` never reads or writes a single byte of
 * `frontend/dist`, so it cannot corrupt what `build` produced or what `bundle` measures, in
 * either direction, regardless of run order. Gitignored (`.gitignore`) — nothing this repo
 * ships is meant to come from here.
 */
export const E2E_OUT_DIR = 'dist-e2e';
