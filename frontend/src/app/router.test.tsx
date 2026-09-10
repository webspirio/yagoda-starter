import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from '@/entities/user';
import { routes } from './router';

// This suite is testing the ROUTE-level guard (which role reaches which
// path), not the guarded pages' own content — those have full suites of
// their own (`TransfersPage.test.tsx`, `PointCashPage.test.tsx`). Stubbing
// both keeps this file from having to mock every entity/feature query those
// pages read just to get past a pending state.
const meMock = vi.hoisted(() => vi.fn());
vi.mock('@/entities/user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/user')>();
  return { ...actual, useMeQuery: () => meMock() };
});
vi.mock('@/pages/transfers', () => ({
  TransfersPage: () => <p>transfers page</p>,
}));
vi.mock('@/pages/point-cash', () => ({
  PointCashPage: () => <p>point-cash page</p>,
}));

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('router', () => {
  beforeEach(() => {
    useSession.setState({ token: null });
    // Default: no role opinion yet (mirrors a pending/absent `me`) — tests
    // that care about a specific role override this explicitly.
    meMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
  });

  it('sends an unauthenticated visitor from / to the login screen', async () => {
    renderAt('/');
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('serves /login without a token', async () => {
    renderAt('/login');
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders the dashboard for an authenticated visitor', async () => {
    useSession.setState({ token: 'tok' });
    renderAt('/');
    // The dashboard's heading is the "Summary" label (mock's «Зведення»).
    expect(await screen.findByRole('heading', { name: /summary/i })).toBeInTheDocument();
  });

  it('renders the not-found page for an unknown path', async () => {
    useSession.setState({ token: 'tok' });
    renderAt('/nope');
    expect(await screen.findByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor from an unknown path to the login screen, not the 404', async () => {
    // The catch-all is wrapped in RequireAuth individually (see router.tsx's
    // doc comment), so an unauthenticated visitor hitting a bogus path never
    // reaches NotFoundPage — CHROMELESS and RequireAuth interact here.
    renderAt('/nope');
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /page not found/i })).not.toBeInTheDocument();
  });

  it('keeps /transfers away from an operator', async () => {
    // Debt owed to OTHER points is not an operator's business (§7, G16) —
    // this is a route-level RequireRole gate, so an operator never even
    // mounts TransfersPage; they land back on the dashboard.
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'point_operator', display_name: 'Оператор Тест' },
      isPending: false,
      isError: false,
    });
    renderAt('/transfers');
    expect(await screen.findByRole('heading', { name: /summary/i })).toBeInTheDocument();
    expect(screen.queryByText('transfers page')).not.toBeInTheDocument();
  });

  it('lets an owner onto /transfers', async () => {
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'network_owner', display_name: 'Керівник Тест' },
      isPending: false,
      isError: false,
    });
    renderAt('/transfers');
    expect(await screen.findByText('transfers page')).toBeInTheDocument();
  });

  it('lets both roles onto /point-cash', async () => {
    // An operator is pinned to their own point by the token, an owner picks
    // one — either way `/point-cash` is RequireAuth with no role gate.
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'point_operator', display_name: 'Оператор Тест' },
      isPending: false,
      isError: false,
    });
    renderAt('/point-cash');
    expect(await screen.findByText('point-cash page')).toBeInTheDocument();

    cleanup();

    meMock.mockReturnValue({
      data: { role: 'network_owner', display_name: 'Керівник Тест' },
      isPending: false,
      isError: false,
    });
    renderAt('/point-cash');
    expect(await screen.findByText('point-cash page')).toBeInTheDocument();
  });
});
