import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSession } from '@/entities/user';
import { RequireAuth } from './RequireAuth';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>login screen</p> },
      {
        path: '/private',
        element: (
          <RequireAuth>
            <p>secret</p>
          </RequireAuth>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

/**
 * The login screen surfaces router `location.state` so this test can inspect
 * what RequireAuth actually handed it — a rendered string, not an assertion
 * against the redirect's internals, so it fails the same way a real
 * `LoginForm` reading `location.state?.from` would fail.
 */
function LoginScreenSurfacingState() {
  const location = useLocation();
  return <p>login screen: {JSON.stringify(location.state)}</p>;
}

function renderAtSurfacingState(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginScreenSurfacingState /> },
      {
        path: '/private',
        element: (
          <RequireAuth>
            <p>secret</p>
          </RequireAuth>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  return render(<RouterProvider router={router} />);
}

describe('RequireAuth', () => {
  beforeEach(() => useSession.setState({ token: null }));

  it('redirects to /login when there is no token', async () => {
    renderAt('/private');
    expect(await screen.findByText('login screen')).toBeInTheDocument();
  });

  it('renders children when a token is present', async () => {
    useSession.setState({ token: 'tok' });
    renderAt('/private');
    expect(await screen.findByText('secret')).toBeInTheDocument();
  });

  it('carries the attempted path in router state so the login screen can return there', async () => {
    renderAtSurfacingState('/private');
    const node = await screen.findByText(/login screen:/);
    expect(node).toHaveTextContent(JSON.stringify({ from: '/private' }));
  });

  it('carries the attempted path AND query string in router state', async () => {
    renderAtSurfacingState('/private?tab=settings');
    const node = await screen.findByText(/login screen:/);
    expect(node).toHaveTextContent(JSON.stringify({ from: '/private?tab=settings' }));
  });
});
