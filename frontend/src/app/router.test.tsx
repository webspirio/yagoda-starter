import { render, screen } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks, useSession } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx for why beforeEach
// would collapse every error status to 0.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { routes } from './router';

let mock: MockAdapter;

const me = (role: 'network_owner' | 'point_operator') => ({
  id: 'u1',
  username: 'alice',
  display_name: 'Alice',
  avatar_url: null,
  language_code: null,
  role,
  collection_point_id: role === 'point_operator' ? 'p1' : null,
});

const emptyList = { data: [], total: 0, page: 1, limit: 100 };

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
    mock = new MockAdapter(httpClient);
  });

  afterEach(() => mock.restore());

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
    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
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

  // The spec's Definition-of-Done line — "an operator sees no nav entry and
  // is redirected from the route" — is two single-expression pieces of
  // wiring (router.tsx wrapping /catalog in RequireRole, AppLayout's
  // NAV.filter), each of which would fail silently. `renderAt` mounts
  // AppLayout too, so these two tests cover both halves at once.
  it('gives an owner the Catalog nav link and renders the catalog page at /catalog', async () => {
    useSession.setState({ token: 'tok' });
    mock.onGet('/me').reply(200, me('network_owner'));
    mock.onGet('/products').reply(200, emptyList);
    mock.onGet('/product-grades').reply(200, emptyList);
    mock.onGet('/tare-types').reply(200, emptyList);

    renderAt('/catalog');

    expect(await screen.findByRole('link', { name: 'Catalog' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Catalog' })).toBeInTheDocument();
  });

  it('hides the Catalog nav link from an operator and redirects them away from /catalog', async () => {
    useSession.setState({ token: 'tok' });
    mock.onGet('/me').reply(200, me('point_operator'));

    renderAt('/catalog');

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Catalog' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Catalog' })).not.toBeInTheDocument();
  });
});
