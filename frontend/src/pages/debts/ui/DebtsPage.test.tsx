import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import type { SupplierBalanceRow } from '@/entities/supplier';
import { DebtsPage } from './DebtsPage';

const { pointScopeMock, balancesMock, payoutDialogMock } = vi.hoisted(() => ({
  pointScopeMock: vi.fn(),
  balancesMock: vi.fn(),
  payoutDialogMock: vi.fn(),
}));

vi.mock('@/entities/user', () => ({
  usePointScope: () => pointScopeMock(),
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

vi.mock('@/entities/supplier', () => ({
  useSupplierBalancesQuery: (filter: unknown) => balancesMock(filter),
  supplierName: (s: { first_name: string; last_name: string }) =>
    `${s.first_name} ${s.last_name}`,
}));

vi.mock('@/features/settle-payout', () => ({
  PayoutDialog: (props: Record<string, unknown>) => {
    payoutDialogMock(props);
    return props.open ? <div data-testid="payout-dialog-mock" /> : null;
  },
}));

const rowA: SupplierBalanceRow = {
  supplier_id: 's1',
  first_name: 'Оксана',
  last_name: 'Кушнірук',
  is_active: true,
  collection_point_id: 'p1',
  debt: '15000.00',
};
const rowB: SupplierBalanceRow = {
  supplier_id: 's2',
  first_name: 'Петро',
  last_name: 'Іваненко',
  is_active: false,
  collection_point_id: 'p1',
  debt: '3670.40',
};
const rowC: SupplierBalanceRow = {
  supplier_id: 's3',
  first_name: 'Марія',
  last_name: 'Бондар',
  is_active: true,
  collection_point_id: 'p1',
  debt: '-500.00',
};

const page = (data: SupplierBalanceRow[], total = data.length) => ({
  data: { data, total, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

function tableRow(name: string): HTMLElement {
  const el = screen.getByText(name).closest('tr');
  if (!el) throw new Error(`No table row containing "${name}"`);
  return el as HTMLElement;
}

function renderDebts(entry = '/debts') {
  const router = createMemoryRouter(
    [
      { path: '/debts', element: <DebtsPage /> },
      { path: '/suppliers/:id', element: <div>Supplier card</div> },
    ],
    { initialEntries: [entry] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}

beforeEach(() => {
  pointScopeMock
    .mockReset()
    .mockReturnValue({ pointId: 'p1', canPick: false, setPointId: vi.fn(), isLoading: false });
  balancesMock.mockReset().mockReturnValue(page([rowA, rowB, rowC]));
  payoutDialogMock.mockReset();
});

describe('DebtsPage — the operator', () => {
  it('titles the page, totals only the positive balances and counts every supplier from the envelope', async () => {
    const { container } = renderDebts();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Balances owed' }),
    ).toBeInTheDocument();
    expect(screen.getByText('3 suppliers')).toBeInTheDocument();

    expect(screen.getByText('Total owed').closest('[data-slot="stat-tile"]')).toHaveTextContent(
      '18,670.40 ₴',
    );
    expect(
      screen.getByText('Suppliers with a balance').closest('[data-slot="stat-tile"]'),
    ).toHaveTextContent('3');

    await expectNoAxeViolations(container);
  });

  it('marks an inactive supplier and shows an overpaid balance as a credit, not a debt', () => {
    renderDebts();

    expect(within(tableRow('Петро Іваненко')).getByText('inactive')).toBeInTheDocument();
    expect(within(tableRow('Марія Бондар')).getByText('overpaid 500.00 ₴')).toBeInTheDocument();
  });

  it('disables "Pay out without berries" for a supplier who does not actually owe anything', () => {
    renderDebts();

    expect(
      within(tableRow('Марія Бондар')).getByRole('button', {
        name: 'Pay out without berries',
      }),
    ).toBeDisabled();
    expect(
      within(tableRow('Оксана Кушнірук')).getByRole('button', {
        name: 'Pay out without berries',
      }),
    ).toBeEnabled();
  });

  it('filters the loaded rows client-side by name as the operator types', async () => {
    const user = userEvent.setup();
    renderDebts();

    await user.type(screen.getByLabelText('Find a supplier'), 'Кушн');

    expect(screen.getByText('Оксана Кушнірук')).toBeInTheDocument();
    expect(screen.queryByText('Петро Іваненко')).toBeNull();
    expect(screen.queryByText('Марія Бондар')).toBeNull();
  });

  it('shows "nobody found", not the settled empty state, when a search matches nothing', async () => {
    const user = userEvent.setup();
    renderDebts();

    await user.type(screen.getByLabelText('Find a supplier'), 'zzzzz');

    expect(screen.getByText('Nobody found')).toBeInTheDocument();
    expect(screen.queryByText('No open balances')).toBeNull();
    expect(screen.getByText('Check the name.')).toBeInTheDocument();
  });

  it('mentions the loaded count in the no-match hint when the server truncated the list', async () => {
    const user = userEvent.setup();
    balancesMock.mockReturnValue(page([rowA, rowB, rowC], 150));
    renderDebts();

    await user.type(screen.getByLabelText('Find a supplier'), 'zzzzz');

    expect(screen.getByText('Nobody found')).toBeInTheDocument();
    expect(
      screen.getByText('Check the name. Only the first 3 balances are loaded.'),
    ).toBeInTheDocument();
  });

  it('opens the payout dialog for that row without navigating away', async () => {
    const user = userEvent.setup();
    const { router } = renderDebts();

    await user.click(
      within(tableRow('Оксана Кушнірук')).getByRole('button', {
        name: 'Pay out without berries',
      }),
    );

    expect(payoutDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supplier: { id: 's1', first_name: 'Оксана', last_name: 'Кушнірук' },
        pointId: 'p1',
        debt: '15000.00',
        open: true,
      }),
    );
    expect(router.state.location.pathname).toBe('/debts');
  });

  it('navigates to the supplier card when a row is clicked', async () => {
    const user = userEvent.setup();
    const { router } = renderDebts();

    await user.click(tableRow('Оксана Кушнірук'));

    expect(router.state.location.pathname).toBe('/suppliers/s1');
  });

  it('exposes the supplier name as a keyboard-reachable link to the card', () => {
    renderDebts();

    expect(
      within(tableRow('Оксана Кушнірук')).getByRole('link', { name: 'Оксана Кушнірук' }),
    ).toHaveAttribute('href', '/suppliers/s1');
  });

  it('hides the point column and the point picker for an operator', () => {
    renderDebts();

    expect(screen.queryByLabelText('All points')).toBeNull();
    expect(screen.queryByText('Point')).toBeNull();
  });

  it('does not warn about a partial total when the server returned every row', () => {
    renderDebts();
    expect(screen.queryByText('on this page')).toBeNull();
  });

  it('warns the total is partial when the server truncated the list', () => {
    balancesMock.mockReturnValue(page([rowA, rowB, rowC], 150));
    renderDebts();
    expect(screen.getByText('on this page')).toBeInTheDocument();
  });
});

describe('DebtsPage — the owner', () => {
  beforeEach(() => {
    pointScopeMock.mockReturnValue({
      pointId: null,
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
  });

  it('shows the point column and the point picker when no point is chosen', async () => {
    const { container } = renderDebts();

    expect(screen.getByLabelText('All points')).toBeInTheDocument();
    expect(within(tableRow('Оксана Кушнірук')).getByText('Shypynky')).toBeInTheDocument();
    expect(balancesMock).toHaveBeenCalledWith({ pointId: null });

    await expectNoAxeViolations(container);
  });

  it('asks the point scope to change when the owner picks a point', async () => {
    const user = userEvent.setup();
    const setPointId = vi.fn();
    pointScopeMock.mockReturnValue({
      pointId: null,
      canPick: true,
      setPointId,
      isLoading: false,
    });
    renderDebts();

    await user.selectOptions(screen.getByLabelText('All points'), 'p1');

    expect(setPointId).toHaveBeenCalledWith('p1');
  });
});

describe('DebtsPage — no suppliers owe anything', () => {
  it('shows the empty state', () => {
    balancesMock.mockReturnValue(page([]));
    renderDebts();

    expect(screen.getByText('No open balances')).toBeInTheDocument();
    expect(screen.getByText('Every drop-off has been settled in full.')).toBeInTheDocument();
  });
});

describe('DebtsPage — a failed read', () => {
  it('shows an explicit error state', () => {
    balancesMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderDebts();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
