import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Intake } from '@/entities/intake';
import type { Shift } from '@/entities/shift';
import { formatTime } from '@/shared/lib/date';
import { PointStrip } from './PointStrip';

const { pointCashMock, cashCountsMock, payoutsMock, intakesMock, crateBalancesMock } = vi.hoisted(
  () => ({
    pointCashMock: vi.fn(),
    cashCountsMock: vi.fn(),
    payoutsMock: vi.fn(),
    intakesMock: vi.fn(),
    crateBalancesMock: vi.fn(),
  }),
);

vi.mock('@/entities/point-cash', () => ({
  usePointCashForPointQuery: (...args: unknown[]) => pointCashMock(...args),
}));
vi.mock('@/entities/cash-count', () => ({
  useCashCountsQuery: (...args: unknown[]) => cashCountsMock(...args),
}));
vi.mock('@/entities/payout', () => ({
  usePayoutsQuery: (...args: unknown[]) => payoutsMock(...args),
}));
vi.mock('@/entities/intake', () => ({
  useIntakesQuery: (...args: unknown[]) => intakesMock(...args),
}));
vi.mock('@/entities/crate', () => ({
  useCrateBalancesQuery: (...args: unknown[]) => crateBalancesMock(...args),
}));

const page = <T,>(data: T[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

const CASH_COUNTS = [
  {
    id: 'c-crates',
    shift_id: 's1',
    collection_point_id: 'p1',
    business_date: '2026-09-21',
    book: 'crates',
    kind: 'opening',
    counted_amount: '999.00',
    expected_amount: '999.00',
    discrepancy: '0.00',
    is_open: false,
    counted_by_user_id: 'u1',
    counted_at: '2026-09-21T06:00:00Z',
    explanation: null,
  },
  {
    id: 'c-berry',
    shift_id: 's1',
    collection_point_id: 'p1',
    business_date: '2026-09-21',
    book: 'berry',
    kind: 'opening',
    counted_amount: '1500.00',
    expected_amount: '1500.00',
    discrepancy: '0.00',
    is_open: false,
    counted_by_user_id: 'u1',
    counted_at: '2026-09-21T06:00:00Z',
    explanation: null,
  },
];

const PAYOUTS = [
  { id: 'po1', amount: '800.00', voided_at: null },
  { id: 'po2', amount: '500.00', voided_at: '2026-09-21T10:00:00Z' },
];

// A full `Intake` per literal — `PointStrip` reads only `open_amount`
// and `voided_at`, but a partial/`Pick`-typed fixture would
// hide a real `Intake` from ever being tested here (the project's own rule:
// any `Intake` literal carries `net_kg`, `lines_count`, `supplier_name` and
// `paid_amount` and `open_amount`, not just the fields one caller happens to read).
const intake = (over: Partial<Intake> & Pick<Intake, 'id'>): Intake => ({
  code: 'SHP-IN-20260921-00001',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-21',
  supplier_id: 's1',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  shift_closed: false,
  created_at: '2026-09-21T09:00:00Z',
  net_kg: '120.40',
  lines_count: 1,
  supplier_name: 'Ніна Ільчук',
  amount: '0.00',
  paid_amount: '0.00',
  open_amount: '0.00',
  ...over,
});

const INTAKES: Intake[] = [
  // open_amount 700.00, not amount − paid_amount (1000.00): a later payout closed 300 more.
  intake({ id: 'i1', amount: '1204.00', paid_amount: '204.00', open_amount: '700.00', voided_at: null }),
  intake({
    id: 'i2',
    supplier_name: 'Petro Kotyk',
    net_kg: '250.00',
    lines_count: 3,
    amount: '5000.00',
    paid_amount: '0.00',
    open_amount: '5000.00',
    voided_at: '2026-09-21T10:00:00Z',
  }),
];

const BALANCES = [
  { supplier_id: 's1', outstanding_units: 5 },
  { supplier_id: 's2', outstanding_units: 7 },
];

const SHIFT = {
  id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-21',
  status: 'open',
  opened_by_user_id: 'u1',
  opened_by_name: null,
  closed_by_user_id: null,
  closed_by_name: null,
  closed_at: null,
  created_at: '2026-09-21T04:12:00Z',
  broken_crates: null,
} satisfies Shift;

type Props = Parameters<typeof PointStrip>[0];

function renderStrip(over: Partial<Props> = {}) {
  return render(
    <MemoryRouter>
      <PointStrip
        pointId="p1"
        shift={{ status: 'open', shift: SHIFT }}
        isOwner={false}
        canOpen
        isOpening={false}
        onOpenShift={vi.fn()}
        targetCrates={40}
        onOpenReceipt={vi.fn()}
        {...over}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pointCashMock.mockReset().mockReturnValue({ data: { collection_point_id: 'p1', cash: '4500.00' } });
  cashCountsMock.mockReset().mockReturnValue(page(CASH_COUNTS));
  payoutsMock.mockReset().mockReturnValue(page(PAYOUTS));
  intakesMock.mockReset().mockReturnValue(page(INTAKES));
  crateBalancesMock.mockReset().mockReturnValue(page(BALANCES));
});

describe('PointStrip — the figures', () => {
  it('reads the berry drawer, the morning count, payouts, open on today, crates and today’s receipts', () => {
    renderStrip();

    expect(screen.getByText('In the berry drawer now')).toBeInTheDocument();
    expect(screen.getByText('4,500.00 ₴')).toBeInTheDocument();

    // Only the BERRY book's opening row, never the crates one (999.00).
    expect(screen.getByText('Counted this morning')).toBeInTheDocument();
    expect(screen.getByText('1,500.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText('999.00 ₴')).not.toBeInTheDocument();

    // Only the LIVE payout (800.00) counts — the voided 500.00 is excluded.
    expect(screen.getByText('Paid out for berries')).toBeInTheDocument();
    expect(screen.getByText('800.00 ₴')).toBeInTheDocument();

    // Only the LIVE intake counts: one receipt, 700.00 still open.
    expect(screen.getByText(/^1 rcpt\. · /)).toBeInTheDocument();
    const openToday = screen.getByText('open 700.00 ₴');
    expect(openToday).toHaveClass('text-amber');

    expect(screen.getByText('Crates out with people / allotment')).toBeInTheDocument();
    expect(screen.getByText('12 / 40')).toBeInTheDocument();
  });

  it('shows a dash for the morning count when there is no opening berry row', () => {
    cashCountsMock.mockReturnValue(page([]));
    renderStrip();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows no amber «open» figure when nothing is outstanding', () => {
    intakesMock.mockReturnValue(
      page([intake({ id: 'i1', amount: '1000.00', paid_amount: '1000.00', open_amount: '0.00' })]),
    );
    renderStrip();
    expect(screen.queryByText(/^open /)).toBeNull();
  });

  it('never goes negative when cash handed over with a receipt also closed older debt', () => {
    intakesMock.mockReturnValue(
      page([
        intake({ id: 'i1', amount: '500.00', paid_amount: '1200.00', open_amount: '0.00' }),
        intake({ id: 'i2', amount: '300.00', paid_amount: '0.00', open_amount: '300.00' }),
      ]),
    );
    renderStrip();
    // amount − paid_amount would read −400.00; the open figures sum to 300.00.
    expect(screen.getByText('open 300.00 ₴')).toBeInTheDocument();
  });

  it('reads «… / —» when the point has no target', () => {
    renderStrip({ targetCrates: null });
    expect(screen.getByText('12 / —')).toBeInTheDocument();
  });
});

describe('PointStrip — a truncated page (100+ documents in one shift)', () => {
  it('captions «Paid out for berries» with «first 100 documents» when the payouts page is truncated', () => {
    payoutsMock.mockReturnValue({
      data: { data: PAYOUTS, total: PAYOUTS.length + 50, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });
    renderStrip();

    // Scoped to the cell: an unscoped `getByText` would be ambiguous the
    // moment a SECOND cell also carries the caption.
    const cell = screen.getByText('Paid out for berries').parentElement;
    expect(cell).toHaveTextContent('first 100 documents');
  });

  it('captions the today cell when only the intakes page is truncated, and leaves «Paid out for berries» alone', () => {
    intakesMock.mockReturnValue({
      data: { data: INTAKES, total: INTAKES.length + 50, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });
    renderStrip();

    expect(screen.getAllByText('first 100 documents')).toHaveLength(1);
    const todayCell = screen.getByRole('button', { name: /Today/ });
    expect(todayCell).toHaveTextContent('first 100 documents');
    const paidOutCell = screen.getByText('Paid out for berries').parentElement;
    expect(paidOutCell).not.toHaveTextContent('first 100 documents');
  });

  it('shows no caption at all when neither page is truncated', () => {
    renderStrip();
    expect(screen.queryByText('first 100 documents')).toBeNull();
  });
});

describe('PointStrip — the cash and crates links', () => {
  it('points at /point-cash and /crates for an operator, with no ?point=', () => {
    renderStrip({ isOwner: false });
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/point-cash',
      '/point-cash',
      '/point-cash',
      '/crates',
    ]);
  });

  it('appends ?point= for the owner', () => {
    renderStrip({ isOwner: true, pointId: 'p9' });
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/point-cash?point=p9',
      '/point-cash?point=p9',
      '/point-cash?point=p9',
      '/crates?point=p9',
    ]);
  });
});

describe('PointStrip — the shift status', () => {
  it('offers the operator «Open shift» when there is no shift, and calls onOpenShift', async () => {
    const onOpenShift = vi.fn();
    renderStrip({ shift: { status: 'none' }, onOpenShift });

    expect(screen.getByText('Shift not opened yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(onOpenShift).toHaveBeenCalledTimes(1);
  });

  it('tells the owner the operator opens the shift, with no button', () => {
    renderStrip({ shift: { status: 'none' }, canOpen: false, isOwner: true });

    expect(screen.getByText('Shift not opened yet — the operator opens it')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });

  it('shows the error, not the open button, when the shift read failed', () => {
    renderStrip({ shift: { status: 'error' } });

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Shift not opened yet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });

  it('shows neither the open button nor the error while the shift is still loading', () => {
    renderStrip({ shift: { status: 'pending' } });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });

  it('reads the opening time from the shift’s created_at', () => {
    renderStrip();
    expect(
      screen.getByText(`Shift open since ${formatTime(SHIFT.created_at, 'en')}`),
    ).toBeInTheDocument();
  });
});

describe('PointStrip — today’s receipts', () => {
  const LIVE_A = intake({ id: 'a', supplier_name: 'Ніна Ільчук', net_kg: '36.90', created_at: '2026-09-21T09:15:00Z' });
  const LIVE_B = intake({ id: 'b', supplier_name: 'Oleh Marchuk', net_kg: '10.10', created_at: '2026-09-21T07:30:00Z' });
  const VOIDED = intake({
    id: 'c',
    supplier_name: 'Petro Kotyk',
    net_kg: '20.00',
    created_at: '2026-09-21T08:00:00Z',
    voided_at: '2026-09-21T10:00:00Z',
  });

  it('summarises live receipts only in the today cell and opens the list in a popover', async () => {
    intakesMock.mockReturnValue(page([LIVE_A, VOIDED, LIVE_B]));
    renderStrip();

    expect(screen.getByText(/^2 rcpt\. · /)).toBeInTheDocument();
    expect(screen.queryByText('Ніна Ільчук')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Today/ }));

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Petro Kotyk').closest('button')).toHaveClass('line-through');
    expect(within(list).getByText('Ніна Ільчук').closest('button')).not.toHaveClass('line-through');
  });

  it('a row click in the popover calls onOpenReceipt and nothing else', async () => {
    const onOpenReceipt = vi.fn();
    const onOpenShift = vi.fn();
    intakesMock.mockReturnValue(page([LIVE_A]));
    renderStrip({ onOpenReceipt, onOpenShift });

    await userEvent.click(screen.getByRole('button', { name: /Today/ }));
    await userEvent.click(await screen.findByText('Ніна Ільчук'));

    expect(onOpenReceipt).toHaveBeenCalledTimes(1);
    expect(onOpenReceipt).toHaveBeenCalledWith('a');
    expect(onOpenShift).not.toHaveBeenCalled();
  });
});
