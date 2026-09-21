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
// The rest of the owner-only group (§router.tsx's pathless RequireRole
// layout) — stubbed the same way so mounting one on `lazy` resolution
// doesn't drag in every query those real pages read.
vi.mock('@/pages/points', () => ({
  PointsPage: () => <p>points page</p>,
}));
vi.mock('@/pages/users', () => ({
  UsersPage: () => <p>users page</p>,
}));
vi.mock('@/pages/catalog', () => ({
  CatalogPage: () => <p>catalog page</p>,
}));
vi.mock('@/pages/journal', () => ({
  JournalPage: () => <p>journal page</p>,
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

/**
 * `createMemoryRouter(routes, { initialEntries: [path] })` is exactly a
 * DIRECT load — a fresh router with no prior in-app navigation — which is
 * the one case where React Router needs a `hydrateFallbackElement`/
 * `HydrateFallback` somewhere in the matched chain: without one, it warns
 * "No `HydrateFallback` element provided to render during initial
 * hydration" (`console.warn`, via react-router's `warningOnce`) and renders
 * nothing while the route's `lazy` resolves. Spies on both `console.warn`
 * and `console.error` since that's the surface a regression here would show
 * up on; callers must restore the spies themselves.
 */
function watchForHydrateFallbackWarning() {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  return {
    assertNone() {
      for (const spy of [warn, error]) {
        for (const call of spy.mock.calls) {
          expect(call.join(' ')).not.toContain('HydrateFallback');
        }
      }
    },
    restore() {
      warn.mockRestore();
      error.mockRestore();
    },
  };
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

  // /points, /users, /catalog and /journal share /transfers' guard — one
  // pathless `RequireAuth` + `RequireRole` layout wrapping four `lazy`
  // children (router.tsx) — so each pair below is the same assertion shape
  // as the two /transfers tests above, proving the `lazy` module only
  // mounts once the guard actually passes.
  it.each([
    ['/points', 'points page'],
    ['/users', 'users page'],
    ['/catalog', 'catalog page'],
    ['/journal', 'journal page'],
  ] as const)('keeps %s away from an operator', async (path, text) => {
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'point_operator', display_name: 'Оператор Тест' },
      isPending: false,
      isError: false,
    });
    renderAt(path);
    expect(await screen.findByRole('heading', { name: /summary/i })).toBeInTheDocument();
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  });

  it.each([
    ['/points', 'points page'],
    ['/users', 'users page'],
    ['/catalog', 'catalog page'],
    ['/journal', 'journal page'],
  ] as const)('lets an owner onto %s', async (path, text) => {
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'network_owner', display_name: 'Керівник Тест' },
      isPending: false,
      isError: false,
    });
    renderAt(path);
    expect(await screen.findByText(text)).toBeInTheDocument();
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

  it('serves the ui-kit gallery at /ui-kit, no auth required, without a HydrateFallback warning', async () => {
    // `import.meta.env.DEV` is `true` for every Vitest run (mode defaults to
    // "test", never "production"), and it is read once when router.tsx's
    // module-level `routes` array is built — `vi.stubEnv('DEV', ...)` cannot
    // flip it after that, so this only proves today's (dev) behaviour: the
    // route exists and renders unauthenticated. The production branch (the
    // route entry not existing at all) is asserted by the bundle build
    // itself having no `ui-kit` chunk, not by a test here.
    //
    // `/ui-kit` sits OUTSIDE `AppLayout`, so it has no ancestor to inherit a
    // `hydrateFallbackElement` from — it needs its own on this exact route
    // object, or a direct load like this one warns and renders nothing
    // until the module resolves.
    const warning = watchForHydrateFallbackWarning();
    renderAt('/ui-kit');
    expect(await screen.findByRole('heading', { name: /ui kit/i })).toBeInTheDocument();
    warning.assertNone();
    warning.restore();
  });

  it('loads /journal directly without a HydrateFallback warning', async () => {
    // Unlike /ui-kit, /journal is nested under AppLayout, which carries the
    // shared `hydrateFallbackElement` — this is the regression guard proving
    // that ancestor fallback still covers a directly-loaded lazy route
    // nested several layers down (AppLayout > the owner-only guard layout >
    // /journal itself).
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'network_owner', display_name: 'Керівник Тест' },
      isPending: false,
      isError: false,
    });
    const warning = watchForHydrateFallbackWarning();
    renderAt('/journal');
    expect(await screen.findByText('journal page')).toBeInTheDocument();
    warning.assertNone();
    warning.restore();
  });
});
