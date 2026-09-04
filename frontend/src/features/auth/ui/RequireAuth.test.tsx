import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
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
});
