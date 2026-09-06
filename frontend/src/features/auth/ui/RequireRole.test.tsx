import { render, screen } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks, useSession } from '@/entities/user';

// Attached ONCE at module scope, never in beforeEach: `httpClient` is a shared
// axios singleton and `attachAuthInterceptors` is NOT idempotent — a second
// attachment stacks a handler that receives the first's ApiError (no
// `.response`), collapsing every status to 0.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { RequireRole } from './RequireRole';

const me = (role: 'network_owner' | 'point_operator') => ({
  id: 'u1',
  username: 'alice',
  display_name: 'Alice',
  avatar_url: null,
  language_code: null,
  role,
  collection_point_id: role === 'point_operator' ? 'p1' : null,
});

let mock: MockAdapter;

const renderGuarded = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/catalog',
        element: (
          <RequireRole role="network_owner">
            <p>secret catalog</p>
          </RequireRole>
        ),
      },
      { path: '/', element: <p>dashboard</p> },
    ],
    { initialEntries: ['/catalog'] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('RequireRole', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
    useSession.setState({ token: 'tok' });
  });

  afterEach(() => {
    mock.restore();
    useSession.setState({ token: null });
  });

  it('renders children for the required role', async () => {
    mock.onGet('/me').reply(200, me('network_owner'));
    renderGuarded();
    expect(await screen.findByText('secret catalog')).toBeInTheDocument();
  });

  it('redirects a user with the wrong role', async () => {
    mock.onGet('/me').reply(200, me('point_operator'));
    renderGuarded();
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
    expect(screen.queryByText('secret catalog')).not.toBeInTheDocument();
  });

  // THE REASON THIS COMPONENT EXISTS. Role is not in the JWT — the payload is
  // `{ sub }` — so it arrives from the `me` query. A guard that redirects
  // synchronously would bounce an owner to the dashboard on every cold load of
  // /catalog, for one frame, and the bug would be near-impossible to reproduce
  // by hand.
  it('redirects nobody while the me query is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.onGet('/me').reply(async () => {
      await gate;
      return [200, me('network_owner')];
    });

    renderGuarded();

    expect(screen.queryByText('secret catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();

    release();
    expect(await screen.findByText('secret catalog')).toBeInTheDocument();
  });
});
