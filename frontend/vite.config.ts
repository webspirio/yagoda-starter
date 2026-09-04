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
  },
});
