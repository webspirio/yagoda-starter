import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Intake } from '@/entities/intake';
import type { Shift } from '@/entities/shift';
import type { CrateStanding } from '@/entities/crate';
import type { PointCashBreakdown } from '@/entities/point-cash';
import { expectNoAxeViolations } from '../../../test-axe';
import { PointStrip } from './PointStrip';

const { pointCashMock, intakesMock, crateStandingMock } = vi.hoisted(() => ({
  pointCashMock: vi.fn(),
  intakesMock: vi.fn(),
  crateStandingMock: vi.fn(),
}));

vi.mock('@/entities/point-cash', () => ({
  usePointCashForPointQuery: (...args: unknown[]) => pointCashMock(...args),
}));
vi.mock('@/entities/intake', () => ({
  useIntakesQuery: (...args: unknown[]) => intakesMock(...args),
}));
vi.mock('@/entities/crate', () => ({
  useCrateStandingQuery: (...args: unknown[]) => crateStandingMock(...args),
}));

const page = <T,>(data: T[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

/** `GET /point-cash/:id` for an open day: 1 500 counted this morning + 4 000
 *  transferred in − 1 300 paid out + 300 returned on a void = 4 500 in the
 *  drawer — every term the server's `breakdown` (#73). */
const BREAKDOWN: PointCashBreakdown = {
  kind: 'open',
  anchor_date: '2026-09-21',
  opening: '1500.00',
  transfers_in: '4000.00',
  payouts: '1300.00',
  returns: '300.00',
  closing: null,
};
const pointCash = (over: Partial<PointCashBreakdown> = {}, cash = '4500.00') => ({
  data: { collection_point_id: 'p1', cash, breakdown: { ...BREAKDOWN, ...over } },
  isPending: false,
  isError: false,
});

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
  intake({
    id: 'i1',
    amount: '1204.00',
    paid_amount: '204.00',
    open_amount: '700.00',
    voided_at: null,
  }),
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

const STANDING: CrateStanding = {
  collection_point_id: 'p1',
  allotment: 40,
  received: 40,
  on_hand: 25,
  in_transit: 0,
  in_field: 12,
  with_berry: 2,
  total: 39,
  shortfall: 1,
  deposit_units: 0,
  deposit_held: '0.00',
  holders: 2,
};
const standing = (over: Partial<CrateStanding> = {}) => ({
  data: { ...STANDING, ...over },
  isPending: false,
  isError: false,
});

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
        onShowToday={vi.fn()}
        {...over}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  pointCashMock.mockReset().mockReturnValue(pointCash());
  intakesMock.mockReset().mockReturnValue(page(INTAKES));
  crateStandingMock.mockReset().mockReturnValue(standing());
});

describe('PointStrip — the figures', () => {
  it('reads the berry drawer as the sum of its named terms, unpaid on today, crates and today’s receipts', () => {
    renderStrip();

    expect(screen.getByText('Berry cash')).toBeInTheDocument();
    expect(screen.getByText('4,500.00 ₴')).toBeInTheDocument();

    // B4 — every term of the drawer, so the line adds up to the figure:
    // 1 500 + 4 000 − 1 300 + 300 = 4 500.
    expect(
      screen.getByTitle(
        'this morning 1,500.00 ₴ · + cash in 4,000.00 ₴ · − paid out 1,300.00 ₴ · + returned 300.00 ₴',
      ),
    ).toBeInTheDocument();
    // The bar carries both figures for a screen reader: what is left, and
    // what went out net of the returns.
    expect(
      screen.getByRole('img', { name: '4,500.00 ₴ in the drawer, 1,000.00 ₴ paid out' }),
    ).toBeInTheDocument();

    // Only the LIVE intake counts: one receipt, 700.00 still unpaid.
    expect(screen.getByText(/^1 rcpt\. · /)).toBeInTheDocument();
    const openToday = screen.getByText('unpaid 700.00 ₴');
    expect(openToday).toHaveClass('text-amber');

    // Every crate of the point against the allotment, in one bar.
    expect(screen.getByText('Crates')).toBeInTheDocument();
    expect(screen.getByText('39 cr. of 40')).toBeInTheDocument();
    expect(
      screen.getByTitle('at the point 25 cr. · with people 12 cr. · with berries 2 cr.'),
    ).toBeInTheDocument();
  });

  it('leaves out a zero transfer or return, keeping the terms that add up', () => {
    pointCashMock.mockReturnValue(
      pointCash({ transfers_in: '0.00', payouts: '800.00', returns: '0.00' }, '700.00'),
    );
    renderStrip();
    expect(screen.getByTitle('this morning 1,500.00 ₴ · − paid out 800.00 ₴')).toBeInTheDocument();
  });

  it('names no terms when the drawer is not an open day, and never a zero while it loads', () => {
    pointCashMock.mockReturnValue(pointCash({ kind: 'none', opening: null, payouts: null }));
    const { unmount } = renderStrip();
    expect(screen.queryByText(/this morning/)).toBeNull();
    unmount();

    pointCashMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderStrip();
    expect(screen.getByTitle('…')).toBeInTheDocument();
    expect(screen.queryByText(/this morning/)).toBeNull();
  });

  it('shows no amber «open» figure when nothing is outstanding', () => {
    intakesMock.mockReturnValue(
      page([intake({ id: 'i1', amount: '1000.00', paid_amount: '1000.00', open_amount: '0.00' })]),
    );
    renderStrip();
    expect(screen.queryByText(/^unpaid /)).toBeNull();
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
    expect(screen.getByText('unpaid 300.00 ₴')).toBeInTheDocument();
  });

  it('reads «… of —» when the point has no allotment — never a zero', () => {
    crateStandingMock.mockReturnValue(standing({ allotment: null, shortfall: null }));
    renderStrip();
    expect(screen.getByText('39 cr. of —')).toBeInTheDocument();
  });

  it('draws the three parts against the allotment, the rest of the track empty', () => {
    const { container } = renderStrip();
    const width = (key: string) =>
      (container.querySelector(`[data-segment="${key}"]`) as HTMLElement).style.width;
    // 25 + 12 + 2 = 39 of 40 — one crate short, so the track is not full.
    expect(width('onHand')).toBe(`${(25 / 40) * 100}%`);
    expect(width('inField')).toBe(`${(12 / 40) * 100}%`);
    expect(width('withBerry')).toBe(`${(2 / 40) * 100}%`);
  });

  it('scales to the point’s own total when it holds more than the allotment', () => {
    crateStandingMock.mockReturnValue(
      standing({ allotment: 10, on_hand: 20, in_field: 20, with_berry: 0, total: 40 }),
    );
    const { container } = renderStrip();
    const onHand = container.querySelector('[data-segment="onHand"]') as HTMLElement;
    expect(onHand.style.width).toBe('50%');
  });
});

// «Звідки це число» (client, 24.10): each term points at the figure it adds up to.
describe('PointStrip — traced terms', () => {
  it('lights the drawer figure from a cash term, and the crates figure from a crate term', () => {
    renderStrip();
    const drawer = screen.getByText('4,500.00 ₴');
    const crates = screen.getByText('39 cr. of 40');

    fireEvent.pointerEnter(screen.getByText('1,500.00 ₴'));
    expect(drawer).toHaveAttribute('data-trace-hit', 'neutral');
    // No term lights another.
    expect(screen.getByText('1,300.00 ₴')).not.toHaveAttribute('data-trace-hit');
    expect(crates).not.toHaveAttribute('data-trace-hit');

    fireEvent.pointerEnter(screen.getByText('12 cr.'));
    expect(crates).toHaveAttribute('data-trace-hit', 'amber');
    expect(drawer).not.toHaveAttribute('data-trace-hit');
  });

  it('has no axe violations with its terms focusable inside the meters’ links', async () => {
    const { container } = renderStrip();
    await expectNoAxeViolations(container);
  });

  it('prints a negative count of empties with the typographic minus', () => {
    crateStandingMock.mockReturnValue(standing({ on_hand: -3, total: 11 }));
    renderStrip();
    expect(screen.getByText('−3 cr.')).toBeInTheDocument();
  });
});

describe('PointStrip — a truncated page (100+ documents in one shift)', () => {
  it('captions the today cell when the intakes page is truncated, and leaves the cash terms alone', () => {
    intakesMock.mockReturnValue({
      data: { data: INTAKES, total: INTAKES.length + 50, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });
    renderStrip();

    expect(screen.getAllByText('first 100 documents')).toHaveLength(1);
    const todayCell = screen.getByRole('button', { name: /Today/ });
    expect(todayCell).toHaveTextContent('first 100 documents');
    expect(screen.getByTitle(/^this morning 1,500\.00 ₴ · /)).toBeInTheDocument();
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
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/point-cash', '/crates']);
  });

  it('appends ?point= for the owner', () => {
    renderStrip({ isOwner: true, pointId: 'p9' });
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/point-cash?point=p9',
      '/crates?point=p9',
    ]);
  });
});

describe('PointStrip — today’s receipts', () => {
  const LIVE_A = intake({
    id: 'a',
    supplier_name: 'Ніна Ільчук',
    net_kg: '36.90',
    created_at: '2026-09-21T09:15:00Z',
  });
  const LIVE_B = intake({
    id: 'b',
    supplier_name: 'Oleh Marchuk',
    net_kg: '10.10',
    created_at: '2026-09-21T07:30:00Z',
  });
  const VOIDED = intake({
    id: 'c',
    supplier_name: 'Petro Kotyk',
    net_kg: '20.00',
    created_at: '2026-09-21T08:00:00Z',
    voided_at: '2026-09-21T10:00:00Z',
  });

  it('summarises live receipts only, and takes the operator to the list instead of repeating it (B6)', async () => {
    const onShowToday = vi.fn();
    intakesMock.mockReturnValue(page([LIVE_A, VOIDED, LIVE_B]));
    renderStrip({ onShowToday });

    expect(screen.getByText(/^2 rcpt\. · /)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Today/ }));

    expect(onShowToday).toHaveBeenCalledTimes(1);
    // The list is the card's under the form, never a second copy here.
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('Ніна Ільчук')).toBeNull();
  });

  it('is a plain summary, not a button, when there is no list to go to', () => {
    intakesMock.mockReturnValue(page([LIVE_A]));
    renderStrip({ onShowToday: undefined });
    expect(screen.queryByRole('button', { name: /Today/ })).toBeNull();
    expect(screen.getByText(/^1 rcpt\. · /)).toBeInTheDocument();
  });
});
