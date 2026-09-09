import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { UsersPage } from './UsersPage';
import type { AdminUser } from '../model/user';

const { queryMock, createMock, updateMock, setPasswordMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  setPasswordMock: vi.fn(),
}));

vi.mock('../api/users', () => ({
  useUsersQuery: () => queryMock(),
  useCreateUserMutation: () => ({ mutateAsync: createMock }),
  useUpdateUserMutation: () => ({ mutateAsync: updateMock }),
  useSetPasswordMutation: () => ({ mutateAsync: setPasswordMock }),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => ({
    data: [
      { id: 'p1', name: 'Shypynky' },
      { id: 'p2', name: 'Haiove' },
    ],
    isPending: false,
    isError: false,
  }),
}));

const owner: AdminUser = {
  id: 'u1',
  login: 'owner',
  first_name: 'Olena',
  last_name: 'H',
  display_name: 'Olena H.',
  role: 'network_owner',
  collection_point_id: null,
  is_active: true,
  avatar_url: null,
  created_at: '2026-08-01',
};

const operator: AdminUser = {
  id: 'u2',
  login: 'maria',
  first_name: 'Maria',
  last_name: 'S',
  display_name: 'Maria S.',
  role: 'point_operator',
  collection_point_id: 'p1',
  is_active: true,
  avatar_url: null,
  created_at: '2026-08-01',
};

const loaded = (rows: AdminUser[]) => ({
  data: { data: rows, total: rows.length, page: 1, limit: 20 },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  queryMock.mockReset();
  createMock.mockReset().mockResolvedValue(operator);
  updateMock.mockReset().mockResolvedValue(operator);
  setPasswordMock.mockReset().mockResolvedValue(undefined);
});

describe('UsersPage', () => {
  it('shows a spinner while loading', () => {
    queryMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<UsersPage />);
    expect(screen.queryByText('Maria S.')).toBeNull();
  });

  it('renders users and the New action when loaded', async () => {
    queryMock.mockReturnValue(loaded([owner, operator]));
    const { container } = render(<UsersPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText('Maria S.')).toBeInTheDocument();
    expect(screen.getByText('maria')).toBeInTheDocument();
    expect(screen.getByText('Point operator')).toBeInTheDocument();
    expect(screen.getByText('Network owner')).toBeInTheDocument();
    expect(screen.getByText('Shypynky')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('creates an operator through the New dialog with the mapped payload', async () => {
    queryMock.mockReturnValue(loaded([]));
    render(<UsersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    expect(screen.getByText('New user account')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('First name'), 'Maria');
    await userEvent.type(screen.getByLabelText('Last name'), 'S');
    await userEvent.type(screen.getByLabelText('Login'), 'maria');
    await userEvent.type(screen.getByLabelText('Password'), 'password1');
    await userEvent.selectOptions(screen.getByLabelText('Collection point'), 'p1');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({
      first_name: 'Maria',
      last_name: 'S',
      login: 'maria',
      password: 'password1',
      role: 'point_operator',
      collection_point_id: 'p1',
    });
  });

  it('hides the point select when the role is network owner', async () => {
    queryMock.mockReturnValue(loaded([]));
    render(<UsersPage />);
    await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    expect(screen.getByLabelText('Collection point')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'network_owner');
    expect(screen.queryByLabelText('Collection point')).toBeNull();
  });
});
