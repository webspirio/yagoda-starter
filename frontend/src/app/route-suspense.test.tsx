import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/entities/user';
import { routes } from './router';

/**
 * WHAT THE USER SEES WHILE AN OWNER-ONLY CHUNK IS IN FLIGHT. The whole risk
 * of a Suspense boundary is putting it too high: one placed in App.tsx or
 * around AppLayout's outer <div> unmounts the sidebar and the top bar for
 * the duration, so clicking «Переважування» makes the application vanish and
 * come back. This file pins the boundary's POSITION by asserting on the
 * chrome, not on the fallback alone.
 *
 * The delay in the mock is the point: `./owner-pages` is the real chunk's
 * module, and an async factory that takes a tick reproduces a slow network
 * deterministically, without a timer or a manually-resolved promise to leak
 * between tests.
 */
vi.mock('./owner-pages', async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return {
    PointsPage: () => <p>points page</p>,
    UsersPage: () => <p>users page</p>,
    CatalogPage: () => <p>catalog page</p>,
    JournalPage: () => <p>journal page</p>,
    TransfersPage: () => <p>transfers page</p>,
    ReweighPage: () => <p>reweigh page</p>,
  };
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

describe('the lazy-route Suspense boundary', () => {
  beforeEach(() => {
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'network_owner', display_name: 'Керівник Тест' },
      isPending: false,
      isError: false,
    });
  });

  it('keeps the sidebar and top bar on screen while the chunk loads', async () => {
    renderAt('/reweigh');

    // The fallback is up…
    expect(await screen.findByTestId('route-fallback')).toBeInTheDocument();
    // …and it announces itself rather than being a silent grey rectangle.
    expect(screen.getByRole('status')).toHaveTextContent('Loading');

    // THE ASSERTION THIS FILE EXISTS FOR: the chrome is still mounted. The
    // sidebar (its brand and its nav landmark) and the top bar's sign-out
    // control are all present at the same moment the fallback is.
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText('Yagoda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('replaces the fallback with the screen once the chunk arrives', async () => {
    renderAt('/reweigh');

    expect(await screen.findByText('reweigh page')).toBeInTheDocument();
    expect(screen.queryByTestId('route-fallback')).not.toBeInTheDocument();
    // The chrome never went away in between, so it is still here after.
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
