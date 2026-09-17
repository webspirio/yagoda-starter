import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
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
});
