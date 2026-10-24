import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import type { Supplier } from '@/entities/supplier';
import { PAGE_SIZE } from '../model/journalFilters';
import { JournalPage } from './JournalPage';

const { intakesMock, payoutsMock, suppliersMock, receiptMock, meMock, totalsMock } = vi.hoisted(() => ({
  meMock: vi.fn(),
  totalsMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  suppliersMock: vi.fn(),
  receiptMock: vi.fn(),
}));

vi.mock('@/entities/intake', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/intake')>()),
  useIntakesQuery: (filter: unknown) => intakesMock(filter),
}));

vi.mock('../api/journalTotals', () => ({
  useJournalTotalsQuery: (filter: unknown) => totalsMock(filter),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

const OWNER = { id: 'owner', role: 'network_owner' };
const AUTHOR = { id: 'u1', role: 'point_operator' };
const OTHER_OPERATOR = { id: 'u2', role: 'point_operator' };

vi.mock('@/entities/payout', () => ({
  usePayoutsQuery: (filter: unknown) => payoutsMock(filter),
}));

// ONE unpaged read names both the picker and the rows (audit D7): every
// supplier at the scope, inactive ones too, so no row past the 100th goes
// unnamed.
vi.mock('@/entities/supplier', () => ({
  useSupplierTotalsQuery: (filter: unknown) => suppliersMock(filter),
  supplierName: (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`,
}));

// Real UUID-shaped ids — the point/supplier filters round-trip through
// `keepUuids` (journalFilters' `parseFilters`), which drops anything that
// isn't shaped like one, same as the production ids from `/collection-points`
// and `/suppliers` are.
const P1 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const SUP1 = '11111111-1111-4111-8111-111111111111';

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => ({
    data: [
      { id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', name: 'Shypynky' },
      { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7', name: 'Haiove' },
    ],
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/widgets/receipt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/widgets/receipt')>()),
  ReceiptDialog: (props: {
    intakeId: string | null;
    open: boolean;
    onClose: () => void;
    startWithVoid?: boolean;
  }) => {
    receiptMock(props);
    return props.open ? <div data-testid="receipt-dialog">{props.intakeId}</div> : null;
  },
  PayoutReceiptDialog: (props: { payoutId: string | null; open: boolean }) =>
    props.open ? <div data-testid="payout-receipt-dialog">{props.payoutId}</div> : null,
}));

const intake = (over: Partial<Intake> & Pick<Intake, 'id' | 'code' | 'amount'>): Intake => ({
  shift_id: 's1',
  collection_point_id: P1,
  business_date: '2026-09-08',
  supplier_id: SUP1,
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  shift_closed: false,
  created_at: '2026-09-08T07:10:00Z',
  net_kg: '36.90',
  lines_count: 2,
  supplier_name: 'Ніна Ільчук',
  paid_amount: '0.00',
  open_amount: '0.00',
  ...over,
});

const payout = (over: Partial<Payout> & Pick<Payout, 'id' | 'code' | 'amount'>): Payout => ({
  shift_id: 's1',
  collection_point_id: P1,
  business_date: '2026-09-08',
  supplier_id: SUP1,
  paid_by_user_id: 'u1',
  intake_id: null,
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  shift_closed: false,
  return_settled_at: null,
  return_settled_by_user_id: null,
  return_note: null,
  returned_on_void: false,
  created_at: '2026-09-08T11:00:00Z',
  balance_after: '0.00',
  ...over,
});

const supplier = (over: Partial<Supplier> & Pick<Supplier, 'id' | 'first_name' | 'last_name'>): Supplier => ({
  collection_point_id: P1,
  phone: null,
  note: null,
  kind: 'none',
  is_active: true,
  created_at: '2026-01-01',
  ...over,
});

/** `total` defaults to what was returned; pass a bigger one to stand for a
 *  journal page the server truncated by pagination. */
const page = <T,>(data: T[], total = data.length) => ({
  data: { data, total, page: 1, limit: PAGE_SIZE },
  isPending: false,
  isError: false,
});

/** `/supplier-totals` is unpaged: a bare array. */
const list = <T,>(data: T[]) => ({ data, isPending: false, isError: false });

/** The StatTile that carries `label` — tiles and other page text share
 *  strings, so a bare getByText is ambiguous. */
function tile(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-slot="stat-tile"]');
  if (!el) throw new Error(`No stat tile labelled "${label}"`);
  return el as HTMLElement;
}

function renderJournal(entry = '/journal') {
  const router = createMemoryRouter([{ path: '/journal', element: <JournalPage /> }], {
    initialEntries: [entry],
  });
  return { ...render(<RouterProvider router={router} />), router };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-08T09:00:00') });
  intakesMock.mockReset().mockReturnValue(page<Intake>([]));
  payoutsMock.mockReset().mockReturnValue(page<Payout>([]));
  suppliersMock.mockReset().mockReturnValue(list<Supplier>([]));
  receiptMock.mockReset();
  totalsMock.mockReset().mockReturnValue({ data: { accrued: '0.00', paid: '0.00' }, isPending: false, isError: false });
  meMock.mockReset().mockReturnValue({ data: OWNER });
});

afterEach(() => vi.useRealTimers());

describe('JournalPage — the default view', () => {
  it('titles the page, defaults to the current month, and offers both kind tabs', async () => {
    const { container } = renderJournal();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Receipt journal' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Receipts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payouts' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('To')).toHaveValue('2026-09-30');

    expect(intakesMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: '2026-09-01', to: '2026-09-30' }),
    );

    await expectNoAxeViolations(container);
  });

  it('shows the server sums for the whole range, not one page', () => {
    totalsMock.mockReturnValue({ data: { accrued: '12500.00', paid: '8000.00' }, isPending: false, isError: false });
    intakesMock.mockReturnValue(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '100.00' })], 45),
    );

    const { container } = renderJournal();

    expect(container.querySelectorAll('[data-slot="stat-tile"]')).toHaveLength(2);
    expect(tile('Berries received')).toHaveTextContent('12,500.00 ₴');
    expect(tile('Cash paid out')).toHaveTextContent('8,000.00 ₴');
  });

  it('asks for the sums over the range, point and supplier — never the voided switch', () => {
    renderJournal(`/journal?from=2026-07-03&to=2026-08-14&point=${P1}&supplier=${SUP1}&voided=0`);
    expect(totalsMock).toHaveBeenLastCalledWith({
      from: '2026-07-03',
      to: '2026-08-14',
      pointId: P1,
      supplierId: SUP1,
    });
  });

  it('shows a dash while the sums load or fail', () => {
    totalsMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    const { unmount } = renderJournal();
    expect(tile('Berries received')).toHaveTextContent('—');
    unmount();

    totalsMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderJournal();
    expect(tile('Cash paid out')).toHaveTextContent('—');
  });

  it('says the berries tile leaves top-ups out (#102)', () => {
    renderJournal();
    expect(tile('Berries received')).toHaveTextContent('without top-ups');
  });

  it('puts the unit in the header, leaves live rows without a status, and strikes a voided sum (audit D9)', () => {
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '1200.00' }),
        intake({
          id: 'i2',
          code: 'KV-0002',
          amount: '300.00',
          voided_at: '2026-09-08T08:00:00Z',
          void_reason: 'Wrong',
        }),
      ]),
    );

    renderJournal();

    expect(screen.getByRole('columnheader', { name: 'Amount, ₴' })).toBeInTheDocument();
    const live = screen.getByText('KV-0001').closest('tr')!;
    const voided = screen.getByText('KV-0002').closest('tr')!;
    expect(within(live).getByText('1,200.00')).toBeInTheDocument();
    expect(live).not.toHaveTextContent('—');
    expect(live).not.toHaveTextContent('₴');
    expect(within(voided).getByText('300.00')).toHaveClass('line-through');
    expect(within(voided).getByText('Voided')).toBeInTheDocument();
  });

  it('heads the code column «Document» on the payouts tab, «Receipt» on receipts', () => {
    payoutsMock.mockReturnValue(page<Payout>([payout({ id: 'y1', code: 'VD-1', amount: '80.00' })]));
    const { unmount } = renderJournal('/journal?kind=payouts');
    expect(screen.getByRole('columnheader', { name: 'Document' })).toBeInTheDocument();
    unmount();

    intakesMock.mockReturnValue(page<Intake>([intake({ id: 'i1', code: 'KV-1', amount: '80.00' })]));
    renderJournal();
    expect(screen.getByRole('columnheader', { name: 'Receipt' })).toBeInTheDocument();
  });

  it('shows the empty state when nothing matches the period', () => {
    renderJournal();
    expect(screen.getByText('No records for this period.')).toBeInTheDocument();
  });

  it('shows an explicit error state when the read fails', () => {
    intakesMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderJournal();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});

describe('JournalPage — switching kind', () => {
  it('keeps the same tiles on both tabs and reads both lists over one range', async () => {
    const user = userEvent.setup();
    totalsMock.mockReturnValue({ data: { accrued: '100.00', paid: '80.00' }, isPending: false, isError: false });
    payoutsMock.mockReturnValue(page<Payout>([payout({ id: 'y1', code: 'VD-1', amount: '80.00' })]));

    renderJournal();
    await user.click(screen.getByRole('tab', { name: 'Payouts' }));

    expect(screen.getByText('VD-1')).toBeInTheDocument();
    expect(tile('Berries received')).toHaveTextContent('100.00 ₴');
    expect(tile('Cash paid out')).toHaveTextContent('80.00 ₴');

    const intakeArgs = intakesMock.mock.calls[intakesMock.mock.calls.length - 1][0];
    const payoutArgs = payoutsMock.mock.calls[payoutsMock.mock.calls.length - 1][0];
    expect(payoutArgs).toMatchObject({ from: intakeArgs.from, to: intakeArgs.to });
  });
});

describe('JournalPage — the date range', () => {
  /** A calendar pick: a `change` with no keystroke before it commits at once. */
  const pick = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('moves ?from and ?to independently, and resets the page', () => {
    const { router } = renderJournal('/journal?page=2');

    pick('From', '2026-09-05');
    let search = new URLSearchParams(router.state.location.search);
    expect(search.get('from')).toBe('2026-09-05');
    expect(search.get('to')).toBe('2026-09-30');
    expect(search.get('page')).toBeNull();

    pick('To', '2026-10-20');
    search = new URLSearchParams(router.state.location.search);
    expect(search.get('from')).toBe('2026-09-05');
    expect(search.get('to')).toBe('2026-10-20');
  });

  it('bounds each field by the other, so the range cannot be reversed', () => {
    renderJournal('/journal?from=2026-09-05&to=2026-09-20');
    expect(screen.getByLabelText('From')).toHaveAttribute('max', '2026-09-20');
    expect(screen.getByLabelText('To')).toHaveAttribute('min', '2026-09-05');
  });

  it('never commits a «from» past «to»', () => {
    const { router } = renderJournal('/journal?from=2026-09-05&to=2026-09-20');
    pick('From', '2026-09-21');
    expect(new URLSearchParams(router.state.location.search).get('from')).toBe('2026-09-05');
  });
});

describe('JournalPage — opening a receipt', () => {
  it('opens the receipt dialog for the intake behind a clicked row', async () => {
    const user = userEvent.setup();
    intakesMock.mockReturnValue(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '100.00' })]),
    );

    renderJournal();

    const row = screen.getByText('KV-0001').closest('tr');
    if (!row) throw new Error('row not found');
    await user.click(row);

    expect(receiptMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, intakeId: 'i1' }),
    );
  });
});

describe('JournalPage — «Void» on a receipt row (§9.4)', () => {
  const voidButton = (code: string) => screen.queryByRole('button', { name: `Void ${code}` });
  const LIVE = { id: 'i1', code: 'KV-0001', amount: '100.00' };

  it('is shown to the owner while the shift is open', () => {
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    renderJournal();
    expect(voidButton('KV-0001')).toBeInTheDocument();
  });

  it('is hidden even from the owner once the shift is closed', () => {
    intakesMock.mockReturnValue(page<Intake>([intake({ ...LIVE, shift_closed: true })]));
    renderJournal();
    expect(voidButton('KV-0001')).not.toBeInTheDocument();
  });

  it('is shown to the author while the shift is open', () => {
    meMock.mockReturnValue({ data: AUTHOR });
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    renderJournal();
    expect(voidButton('KV-0001')).toBeInTheDocument();
  });

  it('is hidden from another operator, from the author on a closed shift, and on a voided receipt', () => {
    meMock.mockReturnValue({ data: OTHER_OPERATOR });
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    const { unmount } = renderJournal();
    expect(voidButton('KV-0001')).toBeNull();
    unmount();

    meMock.mockReturnValue({ data: AUTHOR });
    intakesMock.mockReturnValue(page<Intake>([intake({ ...LIVE, shift_closed: true })]));
    const second = renderJournal();
    expect(voidButton('KV-0001')).toBeNull();
    second.unmount();

    meMock.mockReturnValue({ data: OWNER });
    intakesMock.mockReturnValue(
      page<Intake>([intake({ ...LIVE, voided_at: '2026-09-08T08:00:00Z' })]),
    );
    renderJournal();
    expect(voidButton('KV-0001')).toBeNull();
  });

  it('is never offered on the payouts tab', () => {
    payoutsMock.mockReturnValue(page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '5.00' })]));
    renderJournal('/journal?kind=payouts');
    expect(voidButton('VD-0001')).toBeNull();
  });

  it('opens the receipt straight into its void, without the row click firing too', async () => {
    const user = userEvent.setup();
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    renderJournal();

    await user.click(voidButton('KV-0001')!);

    expect(receiptMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, intakeId: 'i1', startWithVoid: true }),
    );
  });

  it('a plain row click opens the receipt without the void', async () => {
    const user = userEvent.setup();
    intakesMock.mockReturnValue(page<Intake>([intake(LIVE)]));
    renderJournal();

    await user.click(screen.getByText('KV-0001').closest('tr')!);

    expect(receiptMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true, intakeId: 'i1', startWithVoid: false }),
    );
  });
});

describe('JournalPage — pagination', () => {
  it('labels the range, and enables only the direction that has more', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: PAGE_SIZE }, (_, n) =>
      intake({ id: `i${n}`, code: `KV-${n}`, amount: '1.00' }),
    );
    intakesMock.mockReturnValue(page<Intake>(rows, 45));

    const { router } = renderJournal();

    expect(screen.getByText(`1–${PAGE_SIZE} of 45`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(new URLSearchParams(router.state.location.search).get('page')).toBe('2');
  });

  it('disables Next on the last page', () => {
    const rows = Array.from({ length: 5 }, (_, n) => intake({ id: `i${n}`, code: `KV-${n}`, amount: '1.00' }));
    intakesMock.mockReturnValue(page<Intake>(rows, 45));

    renderJournal('/journal?page=3');

    expect(screen.getByText(`41–45 of 45`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
  });
});

describe('JournalPage — the point and supplier filters', () => {
  it('scopes the supplier picker to the chosen point and resets the page', async () => {
    const user = userEvent.setup();
    suppliersMock.mockReturnValue(
      list<Supplier>([supplier({ id: SUP1, first_name: 'Olha', last_name: 'K.' })]),
    );

    const { router } = renderJournal('/journal?page=2');

    await user.selectOptions(screen.getByLabelText('Select a point'), P1);

    expect(new URLSearchParams(router.state.location.search).get('point')).toBe(P1);
    expect(new URLSearchParams(router.state.location.search).get('page')).toBeNull();
    expect(suppliersMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ pointId: P1, status: 'all', sort: 'name' }),
    );
    expect(screen.getByRole('option', { name: 'Olha K.' })).toBeInTheDocument();
  });

  it('names every row and offers every supplier, past the 100th and inactive ones too (audit D7)', () => {
    const many = Array.from({ length: 150 }, (_, n) =>
      supplier({
        id: `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`,
        first_name: `Name${n}`,
        last_name: 'X',
        is_active: n !== 120,
      }),
    );
    suppliersMock.mockReturnValue(list<Supplier>(many));
    intakesMock.mockReturnValue(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '100.00', supplier_id: many[120].id })]),
    );

    renderJournal();

    expect(screen.getByRole('cell', { name: 'Name120 X' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Select a supplier')).getAllByRole('option')).toHaveLength(151);
    expect(screen.getByRole('option', { name: 'Name120 X (inactive)' })).toBeInTheDocument();
  });

  it('clears a stale supplier filter when the point changes', async () => {
    const user = userEvent.setup();
    suppliersMock.mockReturnValue(
      list<Supplier>([supplier({ id: SUP1, first_name: 'Olha', last_name: 'K.' })]),
    );

    const { router } = renderJournal(`/journal?page=2&supplier=${SUP1}`);
    expect(new URLSearchParams(router.state.location.search).get('supplier')).toBe(SUP1);

    await user.selectOptions(screen.getByLabelText('Select a point'), P1);

    const search = new URLSearchParams(router.state.location.search);
    expect(search.get('point')).toBe(P1);
    expect(search.get('supplier')).toBeNull();
    expect(search.get('page')).toBeNull();
  });
});

describe('JournalPage — the voided switch', () => {
  it('resets the page when toggling «show voided»', async () => {
    const user = userEvent.setup();
    const { router } = renderJournal('/journal?page=3');

    await user.click(screen.getByRole('switch', { name: 'show voided' }));

    expect(new URLSearchParams(router.state.location.search).get('page')).toBeNull();
  });
});

describe('JournalPage — the payouts tab opens the payout receipt', () => {
  beforeEach(() => {
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '300.00' }),
        payout({ id: 'y2', code: 'VD-0002', amount: '150.00', intake_id: 'i1' }),
      ]),
    );
  });

  it('opens it from a standalone payout row', async () => {
    const user = userEvent.setup();
    renderJournal('/journal?kind=payouts');

    expect(screen.queryByTestId('payout-receipt-dialog')).toBeNull();
    await user.click(screen.getByText('VD-0001'));
    expect(screen.getByTestId('payout-receipt-dialog')).toHaveTextContent('y1');
    expect(screen.queryByTestId('receipt-dialog')).toBeNull();
  });

  it('leaves a payout row that belongs to a receipt non-clickable', async () => {
    const user = userEvent.setup();
    renderJournal('/journal?kind=payouts');

    await user.click(screen.getByText('VD-0002'));
    expect(screen.queryByTestId('payout-receipt-dialog')).toBeNull();
    expect(screen.getByText('VD-0002').closest('tr')).not.toHaveClass('cursor-pointer');
    expect(screen.getByText('VD-0001').closest('tr')).toHaveClass('cursor-pointer');
  });
});
