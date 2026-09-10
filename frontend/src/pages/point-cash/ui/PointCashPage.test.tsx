import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import type { CashCount } from '@/entities/cash-count';
import type { Payout } from '@/entities/payout';
import type { PointCashRow } from '@/entities/point-cash';
import { PointCashPage } from './PointCashPage';

const {
  meMock,
  pointScopeMock,
  pointOptionsMock,
  pointCashMock,
  intakesMock,
  payoutsMock,
  ledgerTransfersMock,
  cashCountsMock,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  pointScopeMock: vi.fn(),
  pointOptionsMock: vi.fn(),
  pointCashMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  ledgerTransfersMock: vi.fn(),
  cashCountsMock: vi.fn(),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
  usePointScope: () => pointScopeMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointOptionsMock(),
}));

vi.mock('@/entities/point-cash', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/point-cash')>();
  return {
    ...actual,
    usePointCashQuery: (opts: unknown) => pointCashMock(opts),
  };
});

vi.mock('@/entities/intake', () => ({
  useIntakesQuery: (filter: unknown) => intakesMock(filter),
}));

vi.mock('@/entities/payout', () => ({
  usePayoutsQuery: (filter: unknown) => payoutsMock(filter),
}));

vi.mock('@/entities/transfer', () => ({
  useTransfersQuery: (filter: unknown) => ledgerTransfersMock(filter),
}));

vi.mock('@/entities/cash-count', () => ({
  useCashCountsQuery: (filter: unknown) => cashCountsMock(filter),
}));

// «Прийняв»/«Не сходиться» pull in `useAcceptTransferMutation`, which calls
// `useQueryClient()` for real — `IncomingTransfers` already has its own full
// suite (`IncomingTransfers.test.tsx`), so this page's suite stubs it rather
// than wiring up a QueryClientProvider it does not otherwise need.
vi.mock('./IncomingTransfers', () => ({
  IncomingTransfers: () => null,
}));

// Same reasoning as above — `useSetPointTargetMutation` needs a real
// QueryClient, and `SetTargetCashDialog` has its own suite already. This
// page only needs to know THAT it opens and with which point.
vi.mock('@/features/set-point-target', () => ({
  SetTargetCashDialog: ({ open, pointName }: { open: boolean; pointName: string }) =>
    open ? <div role="dialog">Target dialog — {pointName}</div> : null,
}));

const OPERATOR = {
  id: 'u1',
  username: 'operator',
  display_name: 'Olha',
  role: 'point_operator',
  collection_point_id: 'p1',
};
const OWNER = {
  id: 'u2',
  username: 'owner',
  display_name: 'Petro',
  role: 'network_owner',
  collection_point_id: null,
};

const list = <T,>(data: T[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

const pointRow = (over: Partial<PointCashRow> = {}): PointCashRow => ({
  collection_point_id: 'p1',
  name: 'Shypynky',
  target_cash: '5000.00',
  cash: '1000.00',
  shortfall: null,
  unexplained_difference: '0.00',
  latest_transfer: null,
  ...over,
});

const payout = (over: Partial<Payout> & Pick<Payout, 'amount'>): Payout => ({
  id: 'y1',
  code: 'VD-0001',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 'sup1',
  paid_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  return_settled_at: null,
  return_settled_by_user_id: null,
  return_note: null,
  created_at: '2026-09-08T11:00:00Z',
  ...over,
});

const cashCount = (over: Partial<CashCount> = {}): CashCount => ({
  id: 'c1',
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  book: 'berry',
  kind: 'opening',
  counted_amount: '1000.00',
  expected_amount: '1000.00',
  discrepancy: '0.00',
  is_open: false,
  counted_by_user_id: 'u1',
  counted_at: '2026-09-08T07:00:00Z',
  explanation: null,
  ...over,
});

/** The StatTile that carries `label` — same helper `DayPage.test.tsx` uses. */
function tile(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-slot="stat-tile"]');
  if (!el) throw new Error(`No stat tile labelled "${label}"`);
  return el as HTMLElement;
}

/**
 * The element carrying a stat tile's printed value — `StatTile` renders tone
 * (`stat-tile.tsx`) as a CSS class on that node (`text-[var(--leaf)]` /
 * `text-[var(--amber)]` / `text-foreground`), not as a separate attribute, so
 * pinning the shortfall tone rule means reading this node's own class list.
 */
function tileValue(label: string, valueText: string): HTMLElement {
  return within(tile(label)).getByText(valueText);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-08T09:00:00') });
  meMock.mockReset().mockReturnValue({ data: OPERATOR });
  pointScopeMock
    .mockReset()
    .mockReturnValue({ pointId: 'p1', canPick: false, setPointId: vi.fn(), isLoading: false });
  pointOptionsMock.mockReset().mockReturnValue({
    data: [
      { id: 'p1', name: 'Shypynky' },
      { id: 'p2', name: 'Haiove' },
    ],
    isPending: false,
    isError: false,
  });
  pointCashMock.mockReset().mockReturnValue(list([pointRow()]));
  intakesMock.mockReset().mockReturnValue(list([]));
  payoutsMock.mockReset().mockReturnValue(list([]));
  ledgerTransfersMock.mockReset().mockReturnValue(list([]));
  cashCountsMock.mockReset().mockReturnValue(list([cashCount()]));
});

afterEach(() => vi.useRealTimers());

function renderPointCash(entry = '/point-cash') {
  const router = createMemoryRouter([{ path: '/point-cash', element: <PointCashPage /> }], {
    initialEntries: [entry],
  });
  return render(<RouterProvider router={router} />);
}

describe('PointCashPage — honesty rule 1: the total is the server’s, not the sum of the rows', () => {
  it('prints the server’s 1,000.00 everywhere, never the 900.00 the rows alone would sum to', () => {
    payoutsMock.mockReturnValue(list([payout({ amount: '900.00' })]));

    renderPointCash();

    expect(screen.getAllByText('1,000.00 ₴').length).toBeGreaterThan(0);
    expect(screen.queryByText('900.00 ₴')).toBeNull();
    expect(screen.getByText('−900.00 ₴')).toBeInTheDocument();
  });
});

describe('PointCashPage — review round 1, finding 4: paidPast truncation', () => {
  it('shows the caveat when the payouts read is only a partial page', async () => {
    payoutsMock.mockReturnValue({
      data: { data: [payout({ amount: '900.00' })], total: 250, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });

    renderPointCash();

    // Two rows read the same possibly-truncated `payouts` array now
    // (`paidPast` and `returnedToday` — fix round 1's minor finding), so
    // the caveat legitimately appears twice.
    expect(await screen.findAllByText(/older ones may be missing/i)).toHaveLength(2);
  });

  it('carries the same caveat to the rows fed by transfers and by intakes', () => {
    const truncated = <T,>(data: T[]) => ({
      data: { data, total: 250, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });
    ledgerTransfersMock.mockReturnValue(truncated([]));
    intakesMock.mockReturnValue(truncated([]));

    renderPointCash();

    expect(screen.getByText(/Showing recent transfers only/)).toBeInTheDocument();
    expect(screen.getByText(/Showing recent receipts only/)).toBeInTheDocument();
  });

  it('says nothing when the payouts read came back whole', () => {
    renderPointCash();
    expect(screen.queryByText(/older ones may be missing/i)).toBeNull();
  });
});

describe('PointCashPage — honesty rule 2: zero counts read 0.00 and say so', () => {
  it('says the drawer was never counted instead of printing a bare 0.00', async () => {
    cashCountsMock.mockReturnValue(list([]));
    pointCashMock.mockReturnValue(list([pointRow({ cash: '0.00' })]));

    renderPointCash();

    expect(await screen.findByText(/ще не рахована|never counted/i)).toBeInTheDocument();
  });

  it('says nothing extra once the point has an actual count history', () => {
    renderPointCash();
    expect(screen.queryByText(/never counted/i)).toBeNull();
  });

  it('says it for a PAST date the point had not been counted on yet', async () => {
    // The point's first count is today's; on the 1st its drawer had never
    // been counted, and «0.00» there needs the same words it needs on a
    // point with no counts at all.
    cashCountsMock.mockReturnValue(list([cashCount({ business_date: '2026-09-08' })]));

    renderPointCash('/point-cash?date=2026-09-01');

    expect(await screen.findByText(/ще не рахована|never counted/i)).toBeInTheDocument();
  });

  it('makes no claim about a date older than the counts page it could fetch', () => {
    // Capped at 100, newest first (`cash-counts.service.ts` orders by
    // `business_date DESC`) — the counts that would settle a date this old
    // are exactly the ones that did not fit, so silence is the honest
    // answer, not «never counted».
    cashCountsMock.mockReturnValue({
      data: { data: [cashCount({ business_date: '2026-09-08' })], total: 250, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });

    renderPointCash('/point-cash?date=2026-09-01');

    expect(screen.queryByText(/ще не рахована|never counted/i)).toBeNull();
  });
});

describe('PointCashPage — honesty rule 3: null target/shortfall render «—», never 0', () => {
  it('shows «—» for a point with no target', () => {
    pointCashMock.mockReturnValue(list([pointRow({ target_cash: null })]));
    renderPointCash();
    expect(tile('Target')).toHaveTextContent('—');
  });

  it('shows «—» for a point with no shortfall to compare against', () => {
    pointCashMock.mockReturnValue(list([pointRow({ shortfall: null })]));
    renderPointCash();
    expect(tile('Short of target')).toHaveTextContent('—');
  });

  it('prints an actual shortfall amount when one exists', () => {
    pointCashMock.mockReturnValue(list([pointRow({ shortfall: '250.00' })]));
    renderPointCash();
    expect(tile('Short of target')).toHaveTextContent('250.00 ₴');
  });

  // shortfallTone (`entities/point-cash/lib/shortfall.ts`) says a `null`
  // shortfall gets NO tone at all — «no target assigned» is not a value to
  // colour-code, amber or leaf alike. Pinned from both sides: absent here,
  // present on the settled (<= 0) case right below, so a regression back to
  // defaulting null to 'leaf' (what this tile did before Task 5.7) fails
  // loudly instead of quietly reading as "on target".
  it('carries no leaf tone on the shortfall tile when no target is assigned', () => {
    pointCashMock.mockReturnValue(list([pointRow({ shortfall: null })]));
    renderPointCash();
    expect(tileValue('Short of target', '—').className).not.toContain('text-[var(--leaf)]');
  });

  it('colors the shortfall tile leaf when the point is settled (shortfall <= 0)', () => {
    pointCashMock.mockReturnValue(list([pointRow({ shortfall: '0.00' })]));
    renderPointCash();
    expect(tileValue('Short of target', '0.00 ₴').className).toContain('text-[var(--leaf)]');
  });
});

describe('PointCashPage — one scoped read, not the whole network', () => {
  it('asks for this point’s row only', () => {
    renderPointCash();
    expect(pointCashMock).toHaveBeenCalledWith({
      asOf: '2026-09-08',
      pointId: 'p1',
      enabled: true,
    });
    expect(pointCashMock).toHaveBeenCalledTimes(1);
  });

  it('takes every figure from that one row — target, cash and shortfall alike', () => {
    pointCashMock.mockReturnValue(
      list([pointRow({ target_cash: '5000.00', cash: '1234.00', shortfall: '3766.00' })]),
    );

    renderPointCash();

    expect(tile('Target')).toHaveTextContent('5,000.00 ₴');
    expect(tile('Short of target')).toHaveTextContent('3,766.00 ₴');
    // «Berry cash» labels both the stat tile and the ledger total, and the
    // row's `cash` is what both of them print.
    expect(screen.getAllByText('1,234.00 ₴').length).toBeGreaterThan(1);
  });

  it('claims nothing about the target while the read is still in flight', () => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    pointCashMock.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderPointCash();

    // «—» is a CLAIM (§6.9: no target assigned), not a placeholder — and the
    // button that opens `SetTargetCashDialog` with `currentTarget` would
    // waive §6.1's reason requirement if it opened off an unloaded row.
    expect(screen.queryByText('—')).toBeNull();
    expect(screen.queryByRole('button', { name: /наділ|target/i })).toBeNull();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('fails loudly, with a specific message, when the scoped read comes back with no row for the point', () => {
    // The backend selects the row `FROM collection_points WHERE id = $1`, so
    // an empty page means the id names no point at all (a stale `?point=`),
    // never a truncated list. Leaving a spinner spinning would hide that —
    // and folding it into the generic "something went wrong" banner would
    // hide WHAT went wrong, when the fix is simply picking a different point.
    pointCashMock.mockReturnValue(list([]));

    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This point does not exist — pick another one',
    );
  });
});

describe('PointCashPage — honesty rule 4: the target button does not exist for an operator', () => {
  it('does not render the target button for an operator AT ALL (§10.2)', () => {
    renderPointCash();
    expect(screen.queryByRole('button', { name: /наділ|target/i })).toBeNull();
  });

  it('shows the target button to the owner, labelled by whether a target already exists', async () => {
    const user = userEvent.setup();
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });

    renderPointCash();

    const button = screen.getByRole('button', { name: 'Change the target' });
    await user.click(button);
    expect(await screen.findByRole('dialog')).toHaveTextContent('Shypynky');
  });
});

describe('PointCashPage — the crates half has no backing tables', () => {
  it('reserves the crates section with a labelled placeholder', async () => {
    renderPointCash();
    expect(await screen.findByRole('note')).toBeInTheDocument();
  });

  it('shows the drawer tile as berry cash alone, captioned, never berry + an unknown crate figure', () => {
    renderPointCash();
    const drawer = screen.getByText('Should be in the drawer').closest('[data-slot="stat-tile"]');
    expect(drawer).toHaveTextContent('1,000.00 ₴');
    expect(drawer).toHaveTextContent(/berries only/i);
  });
});

describe('PointCashPage — scope and failure states', () => {
  it('reads NOTHING until the owner picks a point', () => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: null,
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });

    renderPointCash();

    expect(screen.getByLabelText('Select a point')).toBeInTheDocument();
    expect(screen.getByText('Select a point', { selector: 'div' })).toBeInTheDocument();
    // All three reads that would otherwise sweep the WHOLE network behind
    // this empty state. `payouts` and `cashCounts` gate themselves on scope
    // inside their own hooks (`payoutsQueryOptions`, `useCashCountsQuery`),
    // which is why an unscoped filter is all they are asserted on here.
    expect(pointCashMock).toHaveBeenCalledWith({
      asOf: '2026-09-08',
      pointId: undefined,
      enabled: false,
    });
    expect(ledgerTransfersMock).toHaveBeenCalledWith({
      pointId: undefined,
      limit: 100,
      enabled: false,
    });
    expect(intakesMock).toHaveBeenCalledWith({});
    expect(payoutsMock).toHaveBeenCalledWith({
      pointId: undefined,
      to: '2026-09-08',
      limit: 100,
    });
    expect(cashCountsMock).toHaveBeenCalledWith({ pointId: undefined });
  });

  it('names a deactivated point from its own cash row, not from the active-points list', async () => {
    const user = userEvent.setup();
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    // `usePointOptionsQuery` lists ACTIVE points only — p1 has been
    // deactivated since, and its drawer still holds money.
    pointOptionsMock.mockReturnValue({
      data: [{ id: 'p2', name: 'Haiove' }],
      isPending: false,
      isError: false,
    });

    renderPointCash();

    expect(screen.getByText(/Shypynky/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change the target' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Shypynky');
  });

  it('prefers the cash row’s own name over the active-points list when both know the point', async () => {
    // When BOTH sources have loaded, the row must win — it is the one
    // source guaranteed to describe the figures actually on screen. Fix
    // round: `pointName` used to try the options list first and only fall
    // back to the row, which the test above ('names a deactivated point…')
    // never caught because it leaves p1 out of the options list entirely —
    // this fixture puts p1 in BOTH, under different names.
    const user = userEvent.setup();
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    pointOptionsMock.mockReturnValue({
      data: [{ id: 'p1', name: 'Stale Picker Name' }],
      isPending: false,
      isError: false,
    });
    pointCashMock.mockReturnValue(list([pointRow({ name: 'Fresh Row Name' })]));

    renderPointCash();

    expect(screen.getByText(/Fresh Row Name/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change the target' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Fresh Row Name');
  });

  it('shows the error state rather than a quiet zero when the cash read fails', () => {
    pointCashMock.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('0.00 ₴')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = renderPointCash();
    await expectNoAxeViolations(container);
  });
});
