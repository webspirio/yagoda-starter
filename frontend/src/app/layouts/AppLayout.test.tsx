import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSession } from '@/entities/user';
import { AppLayout } from './AppLayout';

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
  beforeEach(() => useSession.setState({ token: null }));

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

  it('signs the user out from the header menu', async () => {
    useSession.setState({ token: 'tok' });
    renderLayout('/');
    await userEvent.click(await screen.findByRole('button', { name: /sign out/i }));
    expect(useSession.getState().token).toBeNull();
  });
});
