import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The `VITE_*` keys of the repo-root `.env`, with real environment variables layered
 * on top — compose passes `VITE_API_URL` that way and must keep winning. Deliberately
 * tiny: it understands `KEY=value`, `#` comments and optional surrounding quotes,
 * which is all this repo's `.env` has ever contained. A missing file is not an error
 * (CI and compose set the variables directly and ship no file at all).
 */
function rootViteEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = '';
  try {
    raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    /* no root .env — real environment variables below are the only source */
  }
  for (const line of raw.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const [, key, value] = m;
    if (!key.startsWith('VITE_')) continue;
    out[key] = value.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('VITE_') && value !== undefined) out[key] = value;
  }
  return out;
}

export default defineConfig(() => ({
  // Env files resolve against `root` (= `frontend/`), but this repo keeps a single
  // `.env` at the repo root — the one docker compose reads. Without this, a host
  // `npm run dev` leaves VITE_API_URL undefined and `shared/lib/env` throws a
  // ZodError at module load, which reaches the browser as a blank page behind an
  // otherwise healthy 200.
  //
  // `envDir: '..'` is the obvious way to say that and is the WRONG one, because it
  // hands Vite the whole root `.env` — including `NODE_ENV=development`, which that
  // file carries for the backend and docker compose. Vite honours NODE_ENV out of an
  // env file when the real process environment has not set it, so `npm run build`
  // silently produced a DEVELOPMENT bundle: React's development runtime, warning
  // strings and DevTools hooks included, 1,209 kB raw / 347.8 kB gzip against the
  // production build's 918 kB / 266 kB. It is still minified, so nothing about the
  // output looks wrong — it just ships ~291 kB of dev-only code and the slower React.
  // `scripts/verify/checks/bundle-size.mjs` now fails on that marker rather than
  // trusting this comment to be read.
  //
  // So: read ONLY the `VITE_`-prefixed keys out of the root file, which is the whole
  // of what the browser is allowed to see anyway, and inject them explicitly.
  //
  // Vite's own `loadEnv('..', 'VITE_')` looks like the right tool and is NOT: the
  // prefix filters what it RETURNS, not what it reads, and it still sets
  // `process.env.VITE_USER_NODE_ENV` from the file it parsed — which is the exact
  // channel the leak travels down. Using it here reproduced the dev bundle byte for
  // byte. Hence the hand-rolled read: no Vite env machinery touches the root file.
  define: Object.fromEntries(
    Object.entries(rootViteEnv()).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
  ),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Above `asyncUtilTimeout` (5000ms, set in test-setup.ts) with headroom, so
    // a slow `findBy*` reports its own "unable to find element" diagnostic
    // rather than being cut short by a bare "test timed out" with no clue what
    // it was waiting for. Only failing tests ever pay this.
    testTimeout: 15_000,
    env: {
      VITE_API_URL: 'http://localhost:3000',
    },
    // Thresholds read from the SAME COVERAGE_FRONTEND_* variables
    // .github/workflows/ci.yml's `verify` job sets in its `env:` block — see that
    // file's header comment for why they live there and nowhere else. Every one of
    // them defaults to 0 here, so a plain `npm run coverage` on a laptop reports the
    // percentage without ever failing on it; only CI sets these above zero.
    coverage: {
      thresholds: {
        statements: Number(process.env.COVERAGE_FRONTEND_STATEMENTS ?? 0),
        branches: Number(process.env.COVERAGE_FRONTEND_BRANCHES ?? 0),
        functions: Number(process.env.COVERAGE_FRONTEND_FUNCTIONS ?? 0),
        lines: Number(process.env.COVERAGE_FRONTEND_LINES ?? 0),
      },
    },
  },
}));
