import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpClient } from '@/shared/api';
import { useSession } from '@/entities/user';
import { useThemePreference } from '@/shared/lib/theme';
import { AppLayout } from './AppLayout';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderLayout(initial = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <p>dashboard body</p> },
          { path: '/login', element: <p>login screen</p> },
        ],
      },
    ],
    { initialEntries: [initial] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('AppLayout', () => {
  let mock: MockAdapter;

  beforeEach(() => {
    useSession.setState({ token: null });
    useThemePreference.setState({ preference: 'system' });
    document.documentElement.classList.remove('dark');
    mockMatchMedia(false);
    mock = new MockAdapter(httpClient);
  });

  afterEach(() => {
    mock.restore();
    vi.unstubAllGlobals();
  });

  it('renders the routed page inside the shell', async () => {
    useSession.setState({ token: 'tok' });
    renderLayout('/');
    expect(await screen.findByText('dashboard body')).toBeInTheDocument();
  });

  it('shows the sidebar navigation when signed in', async () => {
    useSession.setState({ token: 'tok' });
    renderLayout('/');
    expect(await screen.findByRole('navigation')).toBeInTheDocument();
  });

  it('hides the navigation chrome on the auth screens', async () => {
    renderLayout('/login');
    expect(await screen.findByText('login screen')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('clears the session even when the logout call fails — sign-out is unconditional, the network call is a courtesy', async () => {
    mock.onPost('/auth/logout').networkError();
    useSession.setState({ token: 'tok' });
    renderLayout('/');
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(useSession.getState().token).toBeNull();
  });

  it('clears the session when the logout call succeeds', async () => {
    mock.onPost('/auth/logout').reply(204);
    useSession.setState({ token: 'tok' });
    renderLayout('/');
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(useSession.getState().token).toBeNull();
  });

  // Regression guard: sign-out must wipe the persisted TanStack Query cache,
  // not just the session token — otherwise a still-valid bearer token (via
  // `buster`) and the signed-out user's cached `/me` profile stay behind in
  // localStorage under a second key for as long as the JWT remains valid.
  // This fails if `persister.removeClient()` is removed from `signOut`.
  it('wipes the persisted query cache blob on sign-out', async () => {
    mock.onPost('/auth/logout').reply(204);
    window.localStorage.setItem(
      'web-starter-rq-cache',
      JSON.stringify({
        timestamp: Date.now(),
        buster: 'v1:deadbeef',
        clientState: { mutations: [], queries: [] },
      }),
    );
    useSession.setState({ token: 'tok' });
    renderLayout('/');
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(window.localStorage.getItem('web-starter-rq-cache')).toBeNull();
  });

  it('offers a theme switch in the header that stores the chosen preference', async () => {
    useSession.setState({ token: 'tok' });
    mock.onGet('/me').reply(200, {
      id: 'u1',
      username: 'admin',
      display_name: 'Dev Admin',
      role: 'network_owner',
      collection_point_id: null,
    });
    renderLayout('/');
    const toggle = await screen.findByRole('button', { name: 'Theme' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(useThemePreference.getState().preference).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('applies the dark class to <html> when the OS prefers dark and no explicit preference is set', async () => {
    mockMatchMedia(true);
    useSession.setState({ token: 'tok' });
    renderLayout('/');
    await screen.findByText('dashboard body');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('wraps the sidebar brand in a link back to /', async () => {
    useSession.setState({ token: 'tok' });
    renderLayout('/');
    await screen.findByRole('navigation');
    const brandLink = screen.getByText('Yagoda').closest('a');
    expect(brandLink).toHaveAttribute('href', '/');
  });

  it('gives the operator a route back to the overview, ungated by role', async () => {
    useSession.setState({ token: 'tok' });
    mock.onGet('/me').reply(200, {
      id: 'u1',
      username: 'operator',
      display_name: 'Olha',
      role: 'point_operator',
      collection_point_id: 'p1',
    });
    renderLayout('/');
    const dashboardLink = await screen.findByRole('link', { name: 'Summary' });
    expect(dashboardLink).toHaveAttribute('href', '/');
  });
});
