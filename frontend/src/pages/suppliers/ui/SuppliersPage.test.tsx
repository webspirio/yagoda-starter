import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import { SuppliersPage } from './SuppliersPage';
import type { Supplier } from '@/entities/supplier';
import type { Me } from '@/entities/user';

/** `SuppliersPage` now links each row to its card (`/suppliers/:id`), so it
 *  needs a real router context — a stub route stands in for the card page
 *  itself, which this test suite has no business depending on. */
function renderSuppliers() {
  const router = createMemoryRouter(
    [
      { path: '/suppliers', element: <SuppliersPage /> },
      { path: '/suppliers/:id', element: <div>Card stub</div> },
    ],
    { initialEntries: ['/suppliers'] },
  );
  return render(<RouterProvider router={router} />);
}

const { queryMock, createMock, updateMock, meMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  meMock: vi.fn(),
}));

vi.mock('@/entities/supplier', () => ({
  useSuppliersQuery: () => queryMock(),
}));

vi.mock('../api/suppliers', () => ({
  useCreateSupplierMutation: () => ({ mutateAsync: createMock }),
  useUpdateSupplierMutation: () => ({ mutateAsync: updateMock }),
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

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

const owner: Me = {
  id: 'u1',
  username: 'owner',
  display_name: 'Olena H.',
  avatar_url: null,
  language_code: null,
  role: 'network_owner',
  collection_point_id: null,
};

const operator: Me = {
  id: 'u2',
  username: 'maria',
  display_name: 'Maria S.',
  avatar_url: null,
  language_code: null,
  role: 'point_operator',
  collection_point_id: 'p1',
};

const ivan: Supplier = {
  id: 's1',
  collection_point_id: 'p1',
  first_name: 'Ivan',
  last_name: 'Koval',
  phone: '+380671234567',
  note: null,
  kind: 'farmer',
  is_active: true,
  created_at: '2026-08-01',
};

const petro: Supplier = {
  id: 's2',
  collection_point_id: 'p2',
  first_name: 'Petro',
  last_name: 'Melnyk',
  phone: null,
  note: null,
  kind: 'none',
  is_active: false,
  created_at: '2026-08-01',
};

const loaded = (rows: Supplier[]) => ({
  data: { data: rows, total: rows.length, page: 1, limit: 20 },
  isPending: false,
  isError: false,
});

beforeEach(() => {
  queryMock.mockReset();
  createMock.mockReset().mockResolvedValue(ivan);
  updateMock.mockReset().mockResolvedValue(ivan);
  meMock.mockReset().mockReturnValue({ data: owner });
});

describe('SuppliersPage', () => {
  it('shows a spinner while loading', () => {
    queryMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderSuppliers();
    expect(screen.queryByText('Ivan Koval')).toBeNull();
  });

  it('renders suppliers and the New action when loaded', async () => {
    queryMock.mockReturnValue(loaded([ivan, petro]));
    const { container } = renderSuppliers();
    expect(screen.getByRole('heading', { level: 1, name: 'Suppliers' })).toBeInTheDocument();
    expect(screen.getByText('Ivan Koval')).toBeInTheDocument();
    expect(screen.getByText('Petro Melnyk')).toBeInTheDocument();
    expect(screen.getByText('+380671234567')).toBeInTheDocument();
    expect(screen.getByText('Farmer')).toBeInTheDocument();
    expect(screen.getByText('Shypynky')).toBeInTheDocument();
    expect(screen.getByText('Haiove')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New supplier' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('shows the point select in the New dialog for a network owner', async () => {
    meMock.mockReturnValue({ data: owner });
    queryMock.mockReturnValue(loaded([]));
    renderSuppliers();
    await userEvent.click(screen.getByRole('button', { name: 'New supplier' }));
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.getByLabelText('Collection point')).toBeInTheDocument();
  });

  it('hides the point select in the New dialog for a point operator', async () => {
    meMock.mockReturnValue({ data: operator });
    queryMock.mockReturnValue(loaded([]));
    renderSuppliers();
    await userEvent.click(screen.getByRole('button', { name: 'New supplier' }));
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Collection point')).toBeNull();
  });

  it('the "no phone" toggle clears the phone and submits null', async () => {
    meMock.mockReturnValue({ data: operator });
    queryMock.mockReturnValue(loaded([]));
    renderSuppliers();
    await userEvent.click(screen.getByRole('button', { name: 'New supplier' }));

    await userEvent.type(screen.getByLabelText('First name'), 'Ivan');
    await userEvent.type(screen.getByLabelText('Last name'), 'Koval');
    await userEvent.type(screen.getByLabelText('Phone'), '0671234567');
    expect(screen.getByLabelText('Phone')).toHaveValue('0671234567');

    await userEvent.click(screen.getByRole('switch', { name: 'No phone' }));
    expect(screen.getByLabelText('Phone')).toBeDisabled();
    expect(screen.getByLabelText('Phone')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock).toHaveBeenCalledWith({
      first_name: 'Ivan',
      last_name: 'Koval',
      phone: null,
      note: null,
      kind: 'none',
    });
  });

  it('links each row to its supplier card', () => {
    queryMock.mockReturnValue(loaded([ivan, petro]));
    renderSuppliers();

    const row = screen.getByText('Ivan Koval').closest('tr') as HTMLElement;
    expect(within(row).getByRole('link', { name: 'Card' })).toHaveAttribute(
      'href',
      '/suppliers/s1',
    );
  });

  it('clicking the row still opens the edit dialog with the card link in place', async () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers();

    await userEvent.click(screen.getByText('Ivan Koval'));

    expect(screen.getByLabelText('First name')).toHaveValue('Ivan');
  });

  it('the card link does not also open the edit dialog', async () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers();

    const row = screen.getByText('Ivan Koval').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByRole('link', { name: 'Card' }));

    expect(screen.queryByLabelText('First name')).toBeNull();
    expect(screen.getByText('Card stub')).toBeInTheDocument();
  });
});
