import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Intake } from '@/entities/intake';
import { PointStatePanel } from './PointStatePanel';

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

// A full `Intake` per literal — `PointStatePanel` reads only `amount`,
// `paid_amount` and `voided_at`, but a partial/`Pick`-typed fixture would
// hide a real `Intake` from ever being tested here (the project's own rule:
// any `Intake` literal carries `net_kg`, `lines_count`, `supplier_name` and
// `paid_amount`, not just the fields one caller happens to read).
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
  created_at: '2026-09-21T09:00:00Z',
  net_kg: '120.40',
  lines_count: 1,
  supplier_name: 'Ніна Ільчук',
  amount: '0.00',
  paid_amount: '0.00',
  ...over,
});

const INTAKES: Intake[] = [
  intake({ id: 'i1', amount: '1204.00', paid_amount: '204.00', voided_at: null }),
  intake({
    id: 'i2',
    supplier_name: 'Petro Kotyk',
    net_kg: '250.00',
    lines_count: 3,
    amount: '5000.00',
    paid_amount: '0.00',
    voided_at: '2026-09-21T10:00:00Z',
  }),
];

const BALANCES = [
  { supplier_id: 's1', outstanding_units: 5 },
  { supplier_id: 's2', outstanding_units: 7 },
];

function renderPanel(over: Partial<Parameters<typeof PointStatePanel>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PointStatePanel pointId="p1" shiftId="s1" isOwner={false} targetCrates={40} {...over} />
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

describe('PointStatePanel — the six figures', () => {
  it('reads the berry drawer, the morning count, payouts, new balance, allotment and crates out', () => {
    renderPanel();

    expect(screen.getByText('In the berry drawer now')).toBeInTheDocument();
    expect(screen.getByText('4,500.00 ₴')).toBeInTheDocument();

    // Only the BERRY book's opening row, never the crates one (999.00).
    expect(screen.getByText('Counted this morning')).toBeInTheDocument();
    expect(screen.getByText('1,500.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText('999.00 ₴')).not.toBeInTheDocument();

    // Only the LIVE payout (800.00) counts — the voided 500.00 is excluded.
    expect(screen.getByText('Paid out for berries')).toBeInTheDocument();
    expect(screen.getByText('800.00 ₴')).toBeInTheDocument();

    // Only the LIVE intake's remainder (1204.00 − 204.00 = 1000.00) counts.
    expect(screen.getByText('New balance created')).toBeInTheDocument();
    const newDebt = screen.getByText('1,000.00 ₴');
    expect(newDebt).toBeInTheDocument();
    expect(newDebt).toHaveClass('text-amber');

    expect(screen.getByText('Allotment')).toBeInTheDocument();
    expect(screen.getByText('40 crates')).toBeInTheDocument();

    expect(screen.getByText('Out with people')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows a dash for the morning count when there is no opening berry row', () => {
    cashCountsMock.mockReturnValue(page([]));
    renderPanel();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('does not tone the new-balance figure amber when nothing is outstanding', () => {
    intakesMock.mockReturnValue(
      page([{ id: 'i1', amount: '1000.00', paid_amount: '1000.00', voided_at: null }]),
    );
    renderPanel();
    const zero = screen.getByText('0.00 ₴');
    expect(zero).not.toHaveClass('text-amber');
  });

  it('reads «наділу цій точці ще не призначали» when the point has no target', () => {
    renderPanel({ targetCrates: null });
    expect(screen.getByText('no allotment set for this point yet')).toBeInTheDocument();
  });
});

describe('PointStatePanel — the two «Open» links', () => {
  it('points at /point-cash and /crates for an operator, with no ?point=', () => {
    renderPanel({ isOwner: false });
    const links = screen.getAllByRole('link', { name: 'Open' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/point-cash', '/crates']);
  });

  it('appends ?point= for the owner', () => {
    renderPanel({ isOwner: true, pointId: 'p9' });
    const links = screen.getAllByRole('link', { name: 'Open' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/point-cash?point=p9', '/crates?point=p9']);
  });
});
