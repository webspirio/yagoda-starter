import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  number: 1,
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
  number: 12,
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

  // #250: the number is assigned by the database — neither dialog offers a field for it.
  it.each([
    ['create', 'New user'],
    ['edit', 'Maria S.'],
  ])('offers no number field in the %s dialog', async (_, opener) => {
    queryMock.mockReturnValue(loaded([operator]));
    render(<UsersPage />);
    await userEvent.click(screen.getByText(opener));
    const dialog = screen.getByRole('dialog');
    // Neither a field labelled as a number in either language, nor one holding
    // the row's number (the edit dialog prefills every field it has).
    expect(within(dialog).queryByLabelText(/number|номер|№|^No\.?$/i)).toBeNull();
    expect(within(dialog).queryByDisplayValue(String(operator.number))).toBeNull();
  });

  // #250: the same number the receipt header prints as «Operator No. 12» —
  // and a deactivated user keeps theirs, because their old receipts still print it.
  it('shows each user\'s number, deactivated ones included', () => {
    queryMock.mockReturnValue(loaded([owner, { ...operator, is_active: false }]));
    render(<UsersPage />);
    expect(screen.getByRole('columnheader', { name: 'No.' })).toBeInTheDocument();
    const row = screen.getByText('Maria S.').closest('tr')!;
    expect(within(row).getByRole('cell', { name: '12' })).toBeInTheDocument();
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
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

  // The column could only ever say «Viewing is off» where the deployment has no
  // vault key — the client asked for it gone (#250). Reissuing stays in the dialog.
  it('has no password column', () => {
    queryMock.mockReturnValue(loaded([owner, operator]));
    render(<UsersPage />);
    expect(screen.queryByRole('columnheader', { name: /password/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show password' })).toBeNull();
  });

  // The server caps a read at 100 rows: a sorted table that holds only the first
  // page must say so instead of looking complete.
  it('says the list is partial when the server holds more users than it sent', () => {
    queryMock.mockReturnValue({
      data: { data: [owner, operator], total: 101, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });
    render(<UsersPage />);
    expect(screen.getByText(/first 2 of 101 users/)).toBeInTheDocument();
  });

  it('says nothing about a partial list when it holds every user', () => {
    queryMock.mockReturnValue(loaded([owner, operator]));
    render(<UsersPage />);
    expect(screen.queryByText(/sorting covers only these/)).toBeNull();
  });

  // #250: every column but none sorts on a header press — by number as a number.
  it('sorts the users by a pressed header', async () => {
    const third: AdminUser = { ...operator, id: 'u3', login: 'bohdan', display_name: 'Bohdan R.', number: 3 };
    queryMock.mockReturnValue(loaded([operator, owner, third]));
    render(<UsersPage />);
    const firstCells = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(firstCells()).toEqual(['3', '12', '1']); // by name first: Bohdan, Maria, Olena
    await userEvent.click(screen.getByRole('button', { name: 'No.' }));
    expect(firstCells()).toEqual(['1', '3', '12']);
    await userEvent.click(screen.getByRole('button', { name: 'No.' }));
    expect(firstCells()).toEqual(['12', '3', '1']);
    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(firstCells()).toEqual(['3', '12', '1']);
  });
});
