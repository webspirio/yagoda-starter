import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { httpClient } from '@/shared/api';
import { useSession } from '@/entities/user';
import { useThemePreference } from '@/shared/lib/theme';
import { HeaderSlot } from '@/shared/ui/header-slot';
import { AppLayout } from './AppLayout';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderLayout(initial = '/', page: React.ReactNode = <p>dashboard body</p>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: page },
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

  // #221 — «Ціни дня» is the owner's screen; the operator reads a grade's
  // price at reception, where it is shown on the grade option itself.
  it('gives the operator no link to the day prices', async () => {
    useSession.setState({ token: 'tok' });
    mock.onGet('/me').reply(200, {
      id: 'u1',
      username: 'operator',
      display_name: 'Olha',
      role: 'point_operator',
      collection_point_id: 'p1',
    });
    renderLayout('/');
    await screen.findByRole('link', { name: 'Summary' });
    expect(screen.queryByRole('link', { name: 'Day prices' })).not.toBeInTheDocument();
  });

  it('keeps the day prices link for the owner', async () => {
    useSession.setState({ token: 'tok' });
    mock.onGet('/me').reply(200, {
      id: 'u0',
      username: 'owner',
      display_name: 'Ivan',
      role: 'network_owner',
      collection_point_id: null,
    });
    renderLayout('/');
    expect(await screen.findByRole('link', { name: 'Day prices' })).toHaveAttribute(
      'href',
      '/prices',
    );
  });

  // Client, 24.10: the owner picks the point in the top bar on every screen; a screen with a
  // picker of its own puts it there instead, and may put its title line there too.
  describe('the top bar scope', () => {
    const OWNER = {
      id: 'u0',
      username: 'owner',
      display_name: 'Ivan',
      role: 'network_owner',
      collection_point_id: null,
    };
    const POINTS = {
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'Shypynky',
          kind: 'reception',
          target_crates: null,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Warehouse',
          kind: 'base',
          target_crates: null,
        },
      ],
      total: 2,
      page: 1,
      limit: 100,
    };

    beforeEach(() => {
      window.localStorage.clear();
      useSession.setState({ token: 'tok' });
      mock.onGet('/collection-points').reply(200, POINTS);
    });

    it('gives the owner a point select, on the warehouse until a point is picked', async () => {
      mock.onGet('/me').reply(200, OWNER);
      renderLayout('/');
      const banner = await screen.findByRole('banner');
      const select = await within(banner).findByRole('combobox', { name: 'Pick a point' });
      await within(select).findByRole('option', { name: 'Shypynky' });
      expect(select).toHaveValue('22222222-2222-4222-8222-222222222222');

      await userEvent.selectOptions(select, 'Shypynky');
      expect(select).toHaveValue('11111111-1111-4111-8111-111111111111');
    });

    it('keeps the operator on the plain «your point» chip', async () => {
      mock.onGet('/me').reply(200, {
        id: 'u1',
        username: 'operator',
        display_name: 'Olha',
        role: 'point_operator',
        collection_point_id: 'p1',
      });
      renderLayout('/');
      const banner = await screen.findByRole('banner');
      expect(await within(banner).findAllByText('your point')).not.toHaveLength(0);
      expect(within(banner).queryByRole('combobox')).not.toBeInTheDocument();
    });

    it("puts a screen's own picker and title line in the bar, in place of the default", async () => {
      mock.onGet('/me').reply(200, OWNER);
      renderLayout(
        '/',
        <>
          <HeaderSlot slot="scope">
            <select aria-label="Screen picker" />
          </HeaderSlot>
          <HeaderSlot slot="title">
            <h1>Screen title</h1>
          </HeaderSlot>
          <p>screen body</p>
        </>,
      );
      const banner = await screen.findByRole('banner');
      expect(
        await within(banner).findByRole('combobox', { name: 'Screen picker' }),
      ).toBeInTheDocument();
      expect(within(banner).getByRole('heading', { name: 'Screen title' })).toBeInTheDocument();
      expect(
        within(banner).queryByRole('combobox', { name: 'Pick a point' }),
      ).not.toBeInTheDocument();
      expect(within(screen.getByRole('main')).queryByRole('heading')).not.toBeInTheDocument();
    });
  });

  it('folds the sidebar to its icons and remembers it, labels kept for screen readers', async () => {
    window.localStorage.removeItem('web-starter:sidebar-collapsed');
    useSession.setState({ token: 'tok' });
    mock.onGet('/me').reply(200, {
      id: 'u0',
      username: 'owner',
      display_name: 'Ivan',
      role: 'network_owner',
      collection_point_id: null,
    });
    const user = userEvent.setup();
    renderLayout('/');

    const prices = await screen.findByRole('link', { name: 'Day prices' });
    expect(prices).not.toHaveAttribute('title');

    await user.click(screen.getByRole('button', { name: 'Collapse menu' }));

    expect(screen.getByRole('navigation')).toHaveClass('md:w-16');
    // Still named for assistive tech, and the name returns on hover.
    expect(screen.getByRole('link', { name: 'Day prices' })).toHaveAttribute('title', 'Day prices');
    expect(screen.getByText('Day prices')).toHaveClass('md:sr-only');
    expect(window.localStorage.getItem('web-starter:sidebar-collapsed')).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(screen.getByRole('navigation')).not.toHaveClass('md:w-16');
    expect(window.localStorage.getItem('web-starter:sidebar-collapsed')).toBe('0');
  });
});
