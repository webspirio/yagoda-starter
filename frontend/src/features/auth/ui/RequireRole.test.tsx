import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RequireRole } from './RequireRole';

const useMeQueryMock = vi.hoisted(() => vi.fn());
vi.mock('@/entities/user', () => ({ useMeQuery: () => useMeQueryMock() }));

function renderGuarded() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>dashboard</p> },
      {
        path: '/points',
        element: (
          <RequireRole role="network_owner">
            <p>points admin</p>
          </RequireRole>
        ),
      },
    ],
    { initialEntries: ['/points'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('RequireRole', () => {
  beforeEach(() => useMeQueryMock.mockReset());

  it('shows neither children nor a redirect while me is pending', () => {
    useMeQueryMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderGuarded();
    expect(screen.queryByText('points admin')).toBeNull();
    expect(screen.queryByText('dashboard')).toBeNull();
  });

  it('renders children when the role matches', () => {
    useMeQueryMock.mockReturnValue({
      data: { role: 'network_owner' },
      isPending: false,
      isError: false,
    });
    renderGuarded();
    expect(screen.getByText('points admin')).toBeInTheDocument();
  });

  it('redirects to / when the role does not match', () => {
    useMeQueryMock.mockReturnValue({
      data: { role: 'point_operator' },
      isPending: false,
      isError: false,
    });
    renderGuarded();
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(screen.queryByText('points admin')).toBeNull();
  });

  it('renders an error when the me query failed', () => {
    useMeQueryMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderGuarded();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
