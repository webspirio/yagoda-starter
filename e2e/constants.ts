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
