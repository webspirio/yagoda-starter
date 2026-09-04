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

  it('serves /register without a token', async () => {
    renderAt('/register');
    expect(await screen.findByRole('heading', { name: /create account/i })).toBeInTheDocument();
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
});
