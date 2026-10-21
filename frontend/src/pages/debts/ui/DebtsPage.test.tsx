import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import type { SupplierBalanceRow } from '@/entities/supplier';
import { DebtsPage } from './DebtsPage';

const { pointScopeMock, balancesMock, payoutDialogMock, payoutReceiptMock } = vi.hoisted(() => ({
  pointScopeMock: vi.fn(),
  balancesMock: vi.fn(),
  payoutDialogMock: vi.fn(),
  payoutReceiptMock: vi.fn(),
}));

vi.mock('@/entities/user', () => ({
  usePointScope: (options: unknown) => pointScopeMock(options),
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
  supplierName: (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`,
}));

vi.mock('@/features/settle-payout', () => ({
  PayoutDialog: (props: Record<string, unknown>) => {
    payoutDialogMock(props);
    return props.open ? <div data-testid="payout-dialog-mock" /> : null;
  },
}));

vi.mock('@/widgets/receipt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/widgets/receipt')>()),
  PayoutReceiptDialog: (props: { payoutId: string | null; open: boolean }) => {
    payoutReceiptMock(props);
    return props.open ? <div data-testid="payout-receipt-mock">{props.payoutId}</div> : null;
  },
}));

const rowA: SupplierBalanceRow = {
  supplier_id: 's1',
  first_name: 'Оксана',
  last_name: 'Кушнірук',
  is_active: true,
  collection_point_id: 'p1',
  debt: '15000.00',
  oldest_open_date: '2026-07-01',
};
const rowB: SupplierBalanceRow = {
  supplier_id: 's2',
  first_name: 'Петро',
  last_name: 'Іваненко',
  is_active: false,
  collection_point_id: 'p1',
  debt: '3670.40',
  oldest_open_date: '2026-07-12',
};
const rowC: SupplierBalanceRow = {
  supplier_id: 's3',
  first_name: 'Марія',
  last_name: 'Бондар',
  is_active: true,
  collection_point_id: 'p1',
  debt: '-500.00',
  oldest_open_date: null,
};

const page = (
  data: SupplierBalanceRow[],
  total = data.length,
  oldest_open_date: string | null = '2026-07-01',
  total_owed = '18670.40',
) => ({
  data: { data, total, page: 1, limit: 100, oldest_open_date, total_owed },
  isPending: false,
  isError: false,
});

function tableRow(name: string): HTMLElement {
  const el = screen.getByText(name).closest('tr');
  if (!el) throw new Error(`No table row containing "${name}"`);
  return el as HTMLElement;
}

/** The row's cell under «Age» — the badge also rides beside the name for a phone. */
function ageCell(name: string): HTMLElement {
  const col = screen.getAllByRole('columnheader').findIndex((h) => h.textContent === 'Age');
  return within(tableRow(name)).getAllByRole('cell')[col];
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
  payoutReceiptMock.mockReset();
});

describe('DebtsPage — the operator', () => {
  it('titles the page, totals only the positive balances and counts every supplier from the envelope', async () => {
    const { container } = renderDebts();

    expect(screen.getByRole('heading', { level: 1, name: 'Balances owed' })).toBeInTheDocument();
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

  it('opens the payout receipt once the payout is recorded', async () => {
    const user = userEvent.setup();
    renderDebts();
    expect(screen.queryByTestId('payout-receipt-mock')).toBeNull();

    await user.click(
      within(tableRow('Оксана Кушнірук')).getByRole('button', {
        name: 'Pay out without berries',
      }),
    );
    const { onPaid } = payoutDialogMock.mock.lastCall![0] as {
      onPaid: (p: { id: string }) => void;
    };
    act(() => onPaid({ id: 'pay-1' }));

    expect(screen.getByTestId('payout-receipt-mock')).toHaveTextContent('pay-1');
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

  it("reads «Total owed» off the server's envelope, so a truncated list still shows the whole sum (#229)", () => {
    balancesMock.mockReturnValue(page([rowA, rowB, rowC], 150, '2026-07-01', '250000.00'));
    renderDebts();

    expect(screen.getByText('Total owed').closest('[data-slot="stat-tile"]')).toHaveTextContent(
      '250,000.00 ₴',
    );
    expect(screen.queryByText('on this page')).toBeNull();
  });
});

describe('DebtsPage — how old the balances are (#101)', () => {
  beforeEach(() => {
    // Only `Date` is faked: «today» is 16.07, and userEvent keeps its real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 16, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const oldestTile = () =>
    screen.getByText('Oldest balance').closest('[data-slot="stat-tile"]') as HTMLElement;

  it("shows the oldest open balance's age in days, dated by the drop-off", () => {
    renderDebts();

    expect(oldestTile()).toHaveTextContent('15 days');
    expect(oldestTile()).toHaveTextContent(/since the drop-off on/);
  });

  it("reads the tile off the server's envelope, not the loaded rows", () => {
    // The server saw an older balance past the loaded page — the tile must say so.
    balancesMock.mockReturnValue(page([rowA, rowB, rowC], 150, '2026-06-16'));
    renderDebts();

    expect(oldestTile()).toHaveTextContent('30 days');
  });

  it('shows a dash when nothing is open', () => {
    balancesMock.mockReturnValue(page([rowC], 1, null));
    renderDebts();

    expect(oldestTile()).toHaveTextContent('—');
  });

  it('counts the days per row, in red past a week, and none for a credit', () => {
    renderDebts();

    const stale = within(ageCell('Оксана Кушнірук')).getByText('15 days');
    expect(stale).toHaveAttribute('data-variant', 'destructive');
    const fresh = within(ageCell('Петро Іваненко')).getByText('4 days');
    expect(fresh).toHaveAttribute('data-variant', 'secondary');
    expect(within(tableRow('Марія Бондар')).queryByText(/days?$/)).toBeNull();
  });

  it('turns red only past seven days, and says «1 day» in the singular', () => {
    balancesMock.mockReturnValue(
      page([
        { ...rowA, oldest_open_date: '2026-07-09' }, // 7 days
        { ...rowB, is_active: true, oldest_open_date: '2026-07-08' }, // 8 days
        { ...rowC, debt: '10.00', oldest_open_date: '2026-07-15' }, // 1 day
      ]),
    );
    renderDebts();

    expect(within(ageCell('Оксана Кушнірук')).getByText('7 days')).toHaveAttribute(
      'data-variant',
      'secondary',
    );
    expect(within(ageCell('Петро Іваненко')).getByText('8 days')).toHaveAttribute(
      'data-variant',
      'destructive',
    );
    expect(within(ageCell('Марія Бондар')).getByText('1 day')).toBeInTheDocument();
  });

  it('repeats the badge beside the name, for a phone where the age column is hidden', () => {
    renderDebts();

    const nameCell = within(tableRow('Оксана Кушнірук')).getAllByRole('cell')[0];
    expect(within(nameCell).getByText('15 days')).toHaveClass('sm:hidden');
  });

  it('shows no badge for a row that owes nothing, even with a date — and none without a date', () => {
    balancesMock.mockReturnValue(
      page([
        // Each guard on its own: a dated credit, and an undated debt.
        { ...rowC, oldest_open_date: '2026-07-01' },
        { ...rowA, oldest_open_date: null },
      ]),
    );
    renderDebts();

    expect(within(tableRow('Марія Бондар')).queryByText(/days?$/)).toBeNull();
    expect(within(tableRow('Оксана Кушнірук')).queryByText(/days?$/)).toBeNull();
  });

  it('never prints a negative age for a business date after today', () => {
    balancesMock.mockReturnValue(
      page([{ ...rowA, oldest_open_date: '2026-07-17' }], 1, '2026-07-17'),
    );
    renderDebts();

    expect(within(ageCell('Оксана Кушнірук')).getByText('0 days')).toBeInTheDocument();
    expect(oldestTile()).toHaveTextContent('0 days');
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
    expect(
      within(tableRow('Оксана Кушнірук')).getByText('Shypynky', { selector: 'td' }),
    ).toBeInTheDocument();
    expect(balancesMock).toHaveBeenCalledWith({ pointId: null });

    await expectNoAxeViolations(container);
  });

  it('ignores the point remembered from other screens — the whole network is the default (#229)', () => {
    renderDebts();

    expect(pointScopeMock).toHaveBeenCalledWith({ remembered: false });
  });

  it('names the point under the supplier on a phone, where the point column is hidden (#229)', () => {
    renderDebts();

    const cell = within(tableRow('Оксана Кушнірук')).getByRole('link', {
      name: 'Оксана Кушнірук',
    }).parentElement as HTMLElement;
    expect(within(cell).getByText('Shypynky')).toHaveClass('sm:hidden');
  });

  it('names no point under the supplier once a point is chosen', () => {
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    renderDebts();

    expect(within(tableRow('Оксана Кушнірук')).queryByText('Shypynky')).toBeNull();
  });

  it('clears the pick when the owner chooses «All points»', async () => {
    const user = userEvent.setup();
    const setPointId = vi.fn();
    pointScopeMock.mockReturnValue({ pointId: 'p1', canPick: true, setPointId, isLoading: false });
    renderDebts();

    await user.selectOptions(screen.getByLabelText('All points'), '');

    expect(setPointId).toHaveBeenCalledWith(null);
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

describe('DebtsPage — sorting by a column (#229)', () => {
  const names = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => within(r).getByRole('link').textContent);
  const rowD: SupplierBalanceRow = {
    ...rowA,
    supplier_id: 's4',
    first_name: 'Анна',
    last_name: 'Ткач',
    collection_point_id: 'p2',
    debt: '900.00',
    oldest_open_date: '2026-07-05',
  };

  beforeEach(() => {
    pointScopeMock.mockReturnValue({
      pointId: null,
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
  });

  it('opens on the biggest balance first, whatever order the rows arrive in', () => {
    balancesMock.mockReturnValue(page([rowC, rowD, rowB, rowA]));
    renderDebts();

    expect(names()).toEqual(['Оксана Кушнірук', 'Петро Іваненко', 'Анна Ткач', 'Марія Бондар']);
    expect(screen.getByRole('columnheader', { name: 'Balance' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('sorts by the supplier, the point and the balance on a header press', async () => {
    balancesMock.mockReturnValue(page([rowA, rowB, rowC, rowD]));
    const user = userEvent.setup();
    renderDebts();

    await user.click(screen.getByRole('button', { name: 'Supplier' }));
    expect(names()).toEqual(['Анна Ткач', 'Марія Бондар', 'Оксана Кушнірук', 'Петро Іваненко']);

    // Haiove before Shypynky; within a point the server's order holds.
    await user.click(screen.getByRole('button', { name: 'Point' }));
    expect(names()).toEqual(['Анна Ткач', 'Оксана Кушнірук', 'Петро Іваненко', 'Марія Бондар']);

    // A credit is the smallest balance, compared as a decimal, not as text.
    await user.click(screen.getByRole('button', { name: 'Balance' }));
    expect(names()).toEqual(['Марія Бондар', 'Анна Ткач', 'Петро Іваненко', 'Оксана Кушнірук']);
    await user.click(screen.getByRole('button', { name: 'Balance' }));
    expect(names()).toEqual(['Оксана Кушнірук', 'Петро Іваненко', 'Анна Ткач', 'Марія Бондар']);
  });

  it('sorts by how long the balance has waited, a credit last either way', async () => {
    balancesMock.mockReturnValue(page([rowA, rowB, rowC, rowD]));
    const user = userEvent.setup();
    renderDebts();

    await user.click(screen.getByRole('button', { name: 'Age' }));
    expect(names()).toEqual(['Петро Іваненко', 'Анна Ткач', 'Оксана Кушнірук', 'Марія Бондар']);
    await user.click(screen.getByRole('button', { name: 'Age' }));
    expect(names()).toEqual(['Оксана Кушнірук', 'Анна Ткач', 'Петро Іваненко', 'Марія Бондар']);
  });

  it('keeps the sort while a search narrows the rows', async () => {
    balancesMock.mockReturnValue(page([rowA, rowB, rowC, rowD]));
    const user = userEvent.setup();
    renderDebts();

    await user.click(screen.getByRole('button', { name: 'Supplier' }));
    await user.type(screen.getByLabelText('Find a supplier'), 'к');
    expect(names()).toEqual(['Анна Ткач', 'Оксана Кушнірук', 'Петро Іваненко']);
  });

  it('says the sort covers only the loaded rows when the server holds more', () => {
    balancesMock.mockReturnValue(page([rowA, rowB], 150));
    renderDebts();

    expect(screen.getByText(/first 2 of 150 suppliers/)).toBeInTheDocument();
  });

  it('says nothing about a partial list when it holds every row', () => {
    renderDebts();

    expect(screen.queryByText(/sorting covers only these/)).toBeNull();
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
