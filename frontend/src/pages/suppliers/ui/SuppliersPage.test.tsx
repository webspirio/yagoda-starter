import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import { SuppliersPage } from './SuppliersPage';
import type { SupplierTotalsRow } from '@/entities/supplier';
import type { Me } from '@/entities/user';

function CardStub() {
  const { id } = useParams();
  return <div>{`Card stub ${id}`}</div>;
}

/** `SuppliersPage` now links each row to its card (`/suppliers/:id`), so it
 *  needs a real router context — a stub route stands in for the card page
 *  itself, which this test suite has no business depending on. */
function renderSuppliers(initial = '/suppliers') {
  const router = createMemoryRouter(
    [
      { path: '/suppliers', element: <SuppliersPage /> },
      { path: '/suppliers/:id', element: <CardStub /> },
    ],
    { initialEntries: [initial] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

const { queryMock, createMock, updateMock, meMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
  meMock: vi.fn(),
}));

vi.mock('@/entities/supplier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/supplier')>()),
  useSupplierTotalsQuery: (args: unknown) => queryMock(args),
}));

vi.mock('@/features/edit-supplier/api/suppliers', () => ({
  useCreateSupplierMutation: () => ({ mutateAsync: createMock }),
  useUpdateSupplierMutation: () => ({ mutateAsync: updateMock }),
}));

// The page no longer reads points, but SupplierFormDialog (the owner's point select) does.
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
  number: 1,
  avatar_url: null,
  language_code: null,
  role: 'network_owner',
  collection_point_id: null,
};

const operator: Me = {
  id: 'u2',
  username: 'maria',
  display_name: 'Maria S.',
  number: 2,
  avatar_url: null,
  language_code: null,
  role: 'point_operator',
  collection_point_id: 'p1',
};

const ivan: SupplierTotalsRow = {
  id: 's1',
  collection_point_id: 'p1',
  first_name: 'Ivan',
  last_name: 'Koval',
  phone: '+380671234567',
  note: null,
  kind: 'farmer',
  is_active: true,
  created_at: '2026-08-01',
  kg_total: '3603.99',
  accrued: '466180.00',
  main_product_name: 'Raspberry',
};

const petro: SupplierTotalsRow = {
  id: 's2',
  collection_point_id: 'p2',
  first_name: 'Petro',
  last_name: 'Melnyk',
  phone: null,
  note: null,
  kind: 'none',
  is_active: true,
  created_at: '2026-08-01',
  kg_total: '0.00',
  accrued: '0.00',
  main_product_name: null,
};

const loaded = (rows: SupplierTotalsRow[], over: Record<string, unknown> = {}) => ({
  data: rows,
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
  ...over,
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
    expect(screen.queryByText('Koval Ivan')).toBeNull();
  });

  it('renders weight, main product, kind and accrued — and no phone, point or status', async () => {
    queryMock.mockReturnValue(loaded([ivan, petro]));
    const { container } = renderSuppliers();
    expect(screen.getByRole('heading', { level: 1, name: 'Suppliers' })).toBeInTheDocument();
    const ivanRow = screen.getByText('Koval Ivan').closest('tr') as HTMLElement;
    expect(within(ivanRow).getByText('3,603.99 kg')).toBeInTheDocument();
    expect(within(ivanRow).getByText('Raspberry')).toBeInTheDocument();
    expect(within(ivanRow).getByText('Farmer')).toBeInTheDocument();
    expect(within(ivanRow).getByText('466,180.00 ₴')).toBeInTheDocument();
    const petroRow = screen.getByText('Melnyk Petro').closest('tr') as HTMLElement;
    expect(within(petroRow).getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('+380671234567')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /phone|point|status/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'New supplier' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('asks for heaviest first by default and marks Total weight as the active sort', () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers();
    expect(queryMock).toHaveBeenLastCalledWith({
      search: '',
      sort: 'weight',
      order: 'desc',
      status: 'active',
    });
    expect(screen.getByRole('columnheader', { name: 'Total weight' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('a click on Accrued puts the sort in the URL and asks the server for it', async () => {
    queryMock.mockReturnValue(loaded([ivan]));
    const { router } = renderSuppliers();
    await userEvent.click(screen.getByRole('button', { name: 'Accrued' }));
    expect(router.state.location.search).toBe('?sort=amount&order=desc');
    expect(queryMock).toHaveBeenLastCalledWith({
      search: '',
      sort: 'amount',
      order: 'desc',
      status: 'active',
    });
  });

  it('keeps the table, the clicked header and the rows mounted while a new sort loads', async () => {
    // keepPreviousData: the old rows stay as placeholder data — status 'success',
    // so isPending is false — while the new sort is in flight.
    queryMock.mockImplementation((args: { sort: string }) =>
      args.sort === 'amount'
        ? loaded([ivan], { isFetching: true, isPlaceholderData: true })
        : loaded([ivan]),
    );
    renderSuppliers();
    const header = screen.getByRole('button', { name: 'Accrued' });
    await userEvent.click(header);
    expect(screen.getByRole('button', { name: 'Accrued' })).toBe(header);
    expect(header).toBeInTheDocument();
    expect(screen.getByText('Koval Ivan')).toBeInTheDocument();
  });

  it('restores the sort from the URL, e.g. after Back from a card', () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers('/suppliers?sort=name&order=desc');
    expect(queryMock).toHaveBeenLastCalledWith({
      search: '',
      sort: 'name',
      order: 'desc',
      status: 'active',
    });
  });

  it('shows the name last name first, so the A→Z order reads at a glance', () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers();
    expect(screen.getByRole('link', { name: 'Koval Ivan' })).toHaveAttribute(
      'href',
      '/suppliers/s1',
    );
  });

  it('keeps the loaded rows when a refetch fails, with the alert and a retry under them', async () => {
    const refetch = vi.fn();
    queryMock.mockReturnValue(loaded([ivan, petro], { isError: true, refetch }));
    renderSuppliers();
    expect(screen.getByText('Koval Ivan')).toBeInTheDocument();
    expect(screen.getByText('Melnyk Petro')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('replaces the table with the alert when the first load fails', () => {
    queryMock.mockReturnValue({ ...loaded([]), data: undefined, isError: true });
    renderSuppliers();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
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

  it('the name links to its card and opens it once, not the edit dialog', async () => {
    queryMock.mockReturnValue(loaded([ivan, petro]));
    const { router } = renderSuppliers();

    const row = screen.getByText('Koval Ivan').closest('tr') as HTMLElement;
    const link = within(row).getByRole('link', { name: 'Koval Ivan' });
    expect(link).toHaveAttribute('href', '/suppliers/s1');

    await userEvent.click(link);

    expect(await screen.findByText('Card stub s1')).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).toBeNull();
    // One click, one history entry: a single Back returns to the list. Were
    // the row's own navigation to fire too, Back would land on the card again.
    await act(() => router.navigate(-1));
    expect(await screen.findByRole('heading', { level: 1, name: 'Suppliers' })).toBeInTheDocument();
  });

  it("clicking the row opens that supplier's card, not the edit dialog", async () => {
    queryMock.mockReturnValue(loaded([ivan, petro]));
    renderSuppliers();

    const row = screen.getByText('Melnyk Petro').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByText('Regular'));

    expect(await screen.findByText('Card stub s2')).toBeInTheDocument();
    expect(screen.queryByLabelText('First name')).toBeNull();
  });

  it('every row has an Edit button, named for its supplier', () => {
    queryMock.mockReturnValue(loaded([ivan, petro]));
    renderSuppliers();

    for (const name of ['Koval Ivan', 'Melnyk Petro']) {
      const row = screen.getByText(name).closest('tr') as HTMLElement;
      expect(within(row).getByRole('button', { name: `Edit ${name}` })).toHaveTextContent('Edit');
    }
  });

  it("Edit opens the dialog with that supplier's data and never the card", async () => {
    queryMock.mockReturnValue(loaded([ivan, petro]));
    renderSuppliers();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Melnyk Petro' }));

    expect(screen.getByLabelText('First name')).toHaveValue('Petro');
    expect(screen.getByLabelText('Last name')).toHaveValue('Melnyk');
    expect(screen.queryByText(/Card stub/)).toBeNull();
    // Still on the list, under the modal (which hides it from the a11y tree).
    expect(
      screen.getByRole('heading', { level: 1, name: 'Suppliers', hidden: true }),
    ).toBeInTheDocument();
  });

  it('cancelling the edit leaves the user on the list', async () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Koval Ivan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByLabelText('First name')).toBeNull());
    expect(screen.queryByText(/Card stub/)).toBeNull();
    expect(screen.getByText('Koval Ivan')).toBeInTheDocument();
  });

  it('saving the edit leaves the user on the list', async () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers();

    await userEvent.click(screen.getByRole('button', { name: 'Edit Koval Ivan' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByLabelText('First name')).toBeNull());
    expect(screen.queryByText(/Card stub/)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Suppliers' })).toBeInTheDocument();
  });

  it('asks for active suppliers by default, with Active selected', () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers();
    expect(queryMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }));
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('active');
  });

  it('Inactive puts the status in the URL and keeps the sort', async () => {
    queryMock.mockReturnValue(loaded([ivan]));
    const { router } = renderSuppliers('/suppliers?sort=amount&order=desc');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Show' }), 'inactive');
    expect(router.state.location.search).toContain('status=inactive');
    expect(queryMock).toHaveBeenLastCalledWith({
      search: '',
      sort: 'amount',
      order: 'desc',
      status: 'inactive',
    });
  });

  it('restores status and sort from the URL', () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers('/suppliers?status=all&sort=amount');
    expect(queryMock).toHaveBeenLastCalledWith({
      search: '',
      sort: 'amount',
      order: 'desc',
      status: 'all',
    });
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('all');
  });

  it('reads an unknown status as Active', () => {
    queryMock.mockReturnValue(loaded([ivan]));
    renderSuppliers('/suppliers?status=archived');
    expect(queryMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }));
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveValue('active');
  });

  it('badges an inactive supplier by name and no active one', () => {
    queryMock.mockReturnValue(loaded([ivan, { ...petro, is_active: false }]));
    renderSuppliers('/suppliers?status=all');
    const petroRow = screen.getByText('Melnyk Petro').closest('tr') as HTMLElement;
    expect(within(petroRow).getByText('Inactive')).toBeInTheDocument();
    const ivanRow = screen.getByText('Koval Ivan').closest('tr') as HTMLElement;
    expect(within(ivanRow).queryByText('Inactive')).toBeNull();
  });

  it('an empty Inactive list says so, not that there are no suppliers', () => {
    queryMock.mockReturnValue(loaded([]));
    renderSuppliers('/suppliers?status=inactive');
    expect(screen.getByText('No deactivated suppliers')).toBeInTheDocument();
    expect(screen.queryByText('No suppliers yet')).toBeNull();
  });

  it('hands the list search to the card as router state, from the row and from the link', async () => {
    queryMock.mockReturnValue(loaded([ivan, petro]));
    const { router } = renderSuppliers('/suppliers?status=all');
    const row = screen.getByText('Melnyk Petro').closest('tr') as HTMLElement;
    await userEvent.click(within(row).getByText('Regular'));
    await screen.findByText('Card stub s2');
    expect(router.state.location.state).toEqual({ from: '?status=all' });

    await act(() => router.navigate(-1));
    await userEvent.click(await screen.findByRole('link', { name: 'Koval Ivan' }));
    await screen.findByText('Card stub s1');
    expect(router.state.location.state).toEqual({ from: '?status=all' });
  });
});
