import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

/**
 * `import.meta.env.DEV` is a compile-time constant Vite substitutes when a module is
 * TRANSFORMED, not a runtime lookup — `vi.stubEnv('DEV', …)` after a module has already
 * been imported does nothing (see router.tsx's own note on this exact limitation, re: the
 * `/ui-kit` route). Every OTHER test file in this repo runs under `DEV: true` (vitest's
 * `MODE` is `"test"`) and so only ever exercises ErrorFallback's DEV branch — which is why
 * `fullHeight`, a PRODUCTION-branch-only prop, has no coverage anywhere else. The one way to
 * actually reach the production branch here is `vi.resetModules()` before a fresh dynamic
 * `import()`: that forces Vite to re-transform the module against whatever env is stubbed
 * AT THAT MOMENT, which a top-level static `import` — already bound at file-load time,
 * before any test body runs — cannot do.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** @returns the freshly (re-)imported `ErrorFallback`, reflecting whatever env is stubbed now. */
async function importFreshErrorFallback() {
  vi.resetModules();
  const mod = await import('./ErrorFallback');
  return mod.ErrorFallback;
}

test('fullHeight defaults to true, which sizes the production fallback for a whole page (min-h-dvh)', async () => {
  vi.stubEnv('DEV', false);
  const ErrorFallback = await importFreshErrorFallback();
  render(<ErrorFallback error={new Error('boom')} />);
  const heading = await screen.findByRole('heading', { level: 1 });
  expect(heading.parentElement).toHaveClass('min-h-dvh');
  expect(heading.parentElement).not.toHaveClass('min-h-[50vh]');
});

test('fullHeight={false} sizes the production fallback for a pane instead (min-h-[50vh]), for the owner-only group errorElement', async () => {
  vi.stubEnv('DEV', false);
  const ErrorFallback = await importFreshErrorFallback();
  render(<ErrorFallback error={new Error('boom')} fullHeight={false} />);
  const heading = await screen.findByRole('heading', { level: 1 });
  expect(heading.parentElement).toHaveClass('min-h-[50vh]');
  expect(heading.parentElement).not.toHaveClass('min-h-dvh');
});

test('the DEV branch (stack trace) carries no min-h-* class either way — fullHeight has nothing to swap there', async () => {
  // Ordinary static import: this vitest run's MODE is "test", so DEV is true here and this
  // hits the DEV branch, same as every other test file in this repo — no reset needed.
  const { ErrorFallback } = await import('./ErrorFallback');
  render(<ErrorFallback error={new Error('boom')} fullHeight={false} />);
  const heading = screen.getByRole('heading', { name: /unhandled error/i });
  expect(heading.parentElement?.className ?? '').not.toMatch(/min-h-/);
});
