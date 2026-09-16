import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { UsersPage } from './UsersPage';
import type { AdminUser } from '../model/user';

const { queryMock, createMock, updateMock, setPasswordMock, revealMock, revealResetMock } =
  vi.hoisted(() => ({
    queryMock: vi.fn(),
    createMock: vi.fn(),
    updateMock: vi.fn(),
    setPasswordMock: vi.fn(),
    revealMock: vi.fn(),
    revealResetMock: vi.fn(),
  }));

vi.mock('../api/users', () => ({
  useUsersQuery: () => queryMock(),
  useCreateUserMutation: () => ({ mutateAsync: createMock }),
  useUpdateUserMutation: () => ({ mutateAsync: updateMock }),
  useSetPasswordMutation: () => ({ mutateAsync: setPasswordMock }),
  // Mirrors the real mutation's surface: the cell calls `reset()` when its
  // row closes, which is how the plaintext leaves the mutation cache.
  useRevealPasswordMutation: () => ({
    mutateAsync: revealMock,
    reset: revealResetMock,
    isPending: false,
  }),
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
  revealMock.mockReset().mockResolvedValue({ password: 'operator', vault_enabled: true });
  revealResetMock.mockReset();
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

/**
 * Issue #11 asks for the owner to SEE a password, not only reissue it. The
 * value is fetched per press — it is never part of the list response — and one
 * row is shown at a time.
 */
describe('reading a password back', () => {
  const eyeIn = (row: HTMLElement) => within(row).getByRole('button', { name: 'Show password' });

  const rowFor = async (login: string) => {
    queryMock.mockReturnValue(loaded([owner, operator]));
    render(<UsersPage />);
    return (await screen.findByText(login)).closest('tr') as HTMLElement;
  };

  it('fetches the password on the eye and masks it again on a second press', async () => {
    const row = await rowFor('maria');

    await userEvent.click(eyeIn(row));

    expect(revealMock).toHaveBeenCalledWith('u2');
    expect(await within(row).findByText('operator')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Hide password' }));
    expect(within(row).queryByText('operator')).toBeNull();

    // Closed means FORGOTTEN, not hidden: re-opening asks the server again,
    // which is also what keeps every reading in the audit log.
    await userEvent.click(eyeIn(row));
    expect(revealMock).toHaveBeenCalledTimes(2);
  });

  // A failed read belongs to the press that failed. Without the reset it stays
  // beside a CLOSED eye — and beside the wrong row once another is opened.
  it('clears a failed read when the row is closed', async () => {
    revealMock.mockRejectedValue(new Error('offline'));
    const row = await rowFor('maria');

    await userEvent.click(eyeIn(row));
    expect(await within(row).findByText('Could not read the password')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Hide password' }));
    expect(within(row).queryByText('Could not read the password')).toBeNull();
  });

  it('shows one password at a time — revealing another row hides the first', async () => {
    queryMock.mockReturnValue(loaded([owner, operator]));
    render(<UsersPage />);
    const ownerRow = (await screen.findByText('owner')).closest('tr') as HTMLElement;
    const operatorRow = (await screen.findByText('maria')).closest('tr') as HTMLElement;

    revealMock.mockResolvedValueOnce({ password: 'admin', vault_enabled: true });
    await userEvent.click(eyeIn(ownerRow));
    expect(await within(ownerRow).findByText('admin')).toBeInTheDocument();

    await userEvent.click(eyeIn(operatorRow));
    expect(await within(operatorRow).findByText('operator')).toBeInTheDocument();
    expect(within(ownerRow).queryByText('admin')).toBeNull();
  });

  // A password issued before the vault existed cannot be recovered — say what
  // to do about it rather than showing an empty cell.
  it('asks the owner to reissue when nothing readable is stored', async () => {
    revealMock.mockResolvedValue({ password: null, vault_enabled: true });
    const row = await rowFor('maria');

    await userEvent.click(eyeIn(row));

    expect(await within(row).findByText('Reissue to see it')).toBeInTheDocument();
  });

  // Told apart from the case above: nothing the owner does in the UI fixes a
  // missing PASSWORD_VAULT_KEY.
  it('says the vault is off when the deployment has no key', async () => {
    revealMock.mockResolvedValue({ password: null, vault_enabled: false });
    const row = await rowFor('maria');

    await userEvent.click(eyeIn(row));

    expect(await within(row).findByText('Viewing is off')).toBeInTheDocument();
  });

  // The row opens the edit dialog on click; the eye must not.
  it('does not open the edit dialog', async () => {
    const row = await rowFor('maria');

    await userEvent.click(eyeIn(row));
    await within(row).findByText('operator');

    expect(screen.queryByText('Edit user')).toBeNull();
  });
});
