import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSession } from '@/entities/user';
import { routes } from './router';

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
  beforeEach(() => useSession.setState({ token: null }));

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
});
