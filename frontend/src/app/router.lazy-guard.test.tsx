import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { useSession } from '@/entities/user';
import { routes } from './router';

/**
 * THE PROPERTY THIS FILE EXISTS FOR: code-splitting must not quietly become
 * authorisation-by-download. An operator who navigates to an owner-only path
 * has to be turned around by `RequireRole` BEFORE the owner chunk is
 * requested — otherwise the split has still shipped every operator the
 * owner's code and merely delayed it by one network round trip.
 *
 * WHY IT IS ITS OWN FILE, AND WHY ITS TWO TESTS ARE ORDERED. The evidence is
 * "this module was never evaluated", which is a fact about the module
 * registry, not about a single test: the instant anything renders /reweigh,
 * the module is cached and a later `toBe(0)` would pass for the wrong
 * reason. Vitest isolates module registries per FILE, so this file may not
 * render an owner-only route before the negative assertion has been made.
 * The owner case therefore runs SECOND, and asserts the counter moved 0 → 1
 * — which is what stops the negative test from passing merely because the
 * mock was never wired up.
 *
 * WHY A PLAIN COUNTER AND NOT `vi.fn()`. The mock factory runs at module
 * load, before any test body; vitest resets `vi.fn()` call history between
 * that point and the first test, so a spy here reads zero calls whether or
 * not the module was loaded — a false green. A plain hoisted object is not
 * reset, so it records what actually happened.
 */
const loaded = vi.hoisted(() => ({ reweigh: 0 }));
vi.mock('@/pages/reweigh', () => {
  loaded.reweigh += 1;
  return { ReweighPage: () => <p>reweigh page</p> };
});

const meMock = vi.hoisted(() => vi.fn());
vi.mock('@/entities/user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/user')>();
  return { ...actual, useMeQuery: () => meMock() };
});

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

function signInAs(role: 'point_operator' | 'network_owner') {
  useSession.setState({ token: 'tok' });
  meMock.mockReturnValue({
    data: { role, display_name: 'Тест' },
    isPending: false,
    isError: false,
  });
}

describe('owner-only chunks are gated, not merely deferred', () => {
  it('turns an operator away from /reweigh without ever loading the reweigh module', async () => {
    signInAs('point_operator');
    renderAt('/reweigh');

    // RequireRole sends them back to the dashboard…
    expect(await screen.findByRole('heading', { name: /summary/i })).toBeInTheDocument();
    expect(screen.queryByText('reweigh page')).not.toBeInTheDocument();

    // …and the chunk was never asked for. This assertion is what fails the
    // moment the route goes back to a static import.
    expect(loaded.reweigh).toBe(0);
  });

  it('loads the reweigh module only once an owner actually reaches it', async () => {
    signInAs('network_owner');
    renderAt('/reweigh');

    expect(await screen.findByText('reweigh page')).toBeInTheDocument();
    expect(loaded.reweigh).toBe(1);
  });
});
