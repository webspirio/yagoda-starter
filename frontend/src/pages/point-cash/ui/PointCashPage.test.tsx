import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import { formatUah } from '@/shared/lib/money';
import type { CashCount } from '@/entities/cash-count';
import type { Payout } from '@/entities/payout';
import type { PointCashRow } from '@/entities/point-cash';
import type { Shift } from '@/entities/shift';
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
  shiftMock,
  openShiftMock,
  closeShiftMock,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  pointScopeMock: vi.fn(),
  pointOptionsMock: vi.fn(),
  pointCashMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  ledgerTransfersMock: vi.fn(),
  cashCountsMock: vi.fn(),
  shiftMock: vi.fn(),
  openShiftMock: vi.fn(),
  closeShiftMock: vi.fn(),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

vi.mock('@/features/point-scope', () => ({
  useWorkingPoint: () => pointScopeMock(),
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

vi.mock('@/entities/shift', () => ({
  useShiftOnDateQuery: (pointId: string | null, date: string) => shiftMock(pointId, date),
}));

// `CountDrawerDialog`/`RecountDrawerDialog` each have their own full suite
// already (`CountDrawerDialog.test.tsx`, `RecountDrawerDialog.test.tsx`);
// `RecountDrawerDialog` additionally needs a real `QueryClient`
// (`useRecountMutation`) that this page's test has no other reason to wire
// up — same reasoning as the `SetTargetCashDialog` stub below. The
// `CountDrawerDialog` stub exposes a «Confirm» button that calls `onConfirm`
// with a fixed amount, so a test can drive this page's OWN result-view
// wiring (`resultFor`) without re-testing the dialog's own form.
vi.mock('@/features/count-shift', async (importOriginal) => {
  // `CountResultView` and `discrepancyTone` are the REAL feature exports —
  // this page renders the actual shared result view (its own suite lives in
  // `features/count-shift/ui/CountResultView.test.tsx`), and
  // `ShiftCountPanel`'s own discrepancy pill needs the real tone function.
  // Only the mutations and the two dialogs that need a `QueryClient` this
  // suite has no other reason to wire up are stubbed.
  const actual = await importOriginal<typeof import('@/features/count-shift')>();
  return {
    ...actual,
    useOpenShiftMutation: () => ({ mutateAsync: openShiftMock, isPending: false }),
    useCloseShiftMutation: () => ({ mutateAsync: closeShiftMock, isPending: false }),
    CountDrawerDialog: ({
      open,
      mode,
      onConfirm,
    }: {
      open: boolean;
      mode: 'open' | 'close';
      onConfirm: (amount: string, broken: number | null) => Promise<unknown>;
    }) =>
      open ? (
        <div role="dialog">
          Count dialog — {mode}
          <button onClick={() => onConfirm('1000.00', mode === 'close' ? 0 : null)}>
            Confirm {mode}
          </button>
        </div>
      ) : null,
    RecountDrawerDialog: ({ open }: { open: boolean }) =>
      open ? <div role="dialog">Recount dialog</div> : null,
  };
});

// «Прийняв»/«Не сходиться» pull in `useAcceptTransferMutation`, which calls
// `useQueryClient()` for real — `IncomingTransfers` already has its own full
// suite (`IncomingTransfers.test.tsx`), so this page's suite stubs it rather
// than wiring up a QueryClientProvider it does not otherwise need.
// R10 — the marker element (rather than `null`) is what lets the composition-
// order tests below locate this section in the DOM without re-testing its
// own content (`IncomingTransfers.test.tsx` already does that).
vi.mock('./IncomingTransfers', () => ({
  IncomingTransfers: () => <div data-testid="incoming-transfers-stub" />,
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
  crate_deposits: '0.00',
  crate_deposit_units: 0,
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
  counted_by_name: 'Olha',
  counted_at: '2026-09-08T07:00:00Z',
  explanation: null,
  ...over,
});

const shift = (over: Partial<Shift> = {}): Shift => ({
  id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  status: 'open',
  opened_by_user_id: 'u1',
  opened_by_name: 'Olha',
  closed_by_user_id: null,
  closed_by_name: null,
  closed_at: null,
  created_at: '2026-09-08T07:00:00Z',
  explanation: null,
  broken_crates: null,
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
  // The scoped read (carries `asOf`) answers with this point's row; the
  // owner-only grouping read (Task 2 — carries neither `asOf` nor `pointId`)
  // defaults to an empty page so it never bleeds a duplicate name into a
  // test that is only pinning the scoped row's own figures. Tests that
  // actually exercise the grouped `<select>` override this explicitly.
  pointCashMock.mockReset().mockImplementation((opts: { asOf?: string } = {}) =>
    'asOf' in opts ? list([pointRow()]) : list([]),
  );
  intakesMock.mockReset().mockReturnValue(list([]));
  payoutsMock.mockReset().mockReturnValue(list([]));
  ledgerTransfersMock.mockReset().mockReturnValue(list([]));
  cashCountsMock.mockReset().mockReturnValue(list([cashCount()]));
  shiftMock.mockReset().mockReturnValue({ data: null, isPending: false, isError: false });
  openShiftMock.mockReset().mockResolvedValue({});
  closeShiftMock.mockReset().mockResolvedValue({});
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

describe('PointCashPage — Task 2: header, hints and the amber cash tile', () => {
  it('names the eyebrow «point · long date, weekday»', () => {
    renderPointCash();
    expect(screen.getByText('Shypynky · September 8, 2026, Tuesday')).toBeInTheDocument();
  });

  // Folded in from the Task 2 review — the date now lives in the eyebrow
  // alone; the title is the bare «Каса точки» / "Point cash", with no
  // `{{date}}` interpolation left in either locale.
  it('titles the page with the bare «Point cash» — the date lives in the eyebrow only', () => {
    renderPointCash();
    expect(screen.getByRole('heading', { name: 'Point cash' })).toBeInTheDocument();
  });

  it('prints the mock’s description', () => {
    renderPointCash();
    expect(
      screen.getByText(
        'How much cash the point should have on hand right now, and how much is missing from its target. Berry cash and crate deposits are two separate books — neither borrows from the other.',
      ),
    ).toBeInTheDocument();
  });

  it('hints that this point has no target assigned yet', () => {
    pointCashMock.mockReturnValue(list([pointRow({ target_cash: null })]));
    renderPointCash();
    expect(tile('Target')).toHaveTextContent('no target assigned to this point yet');
  });

  it('hints that a cash shortfall has nothing to compare against without a target', () => {
    pointCashMock.mockReturnValue(list([pointRow({ shortfall: null })]));
    renderPointCash();
    expect(tile('Short of target')).toHaveTextContent('no target to compare against');
  });

  it('hints that the base has not transferred the shortfall yet (shortfall > 0)', () => {
    pointCashMock.mockReturnValue(list([pointRow({ shortfall: '250.00' })]));
    renderPointCash();
    expect(tile('Short of target')).toHaveTextContent('the base has not transferred it yet');
  });

  // NEW branch (Task 2) — a negative shortfall means the drawer holds more
  // than the target calls for, which reads differently from «settled at
  // exactly zero» even though both get the leaf tone.
  it('hints that the drawer holds more than the target when shortfall is negative', () => {
    pointCashMock.mockReturnValue(list([pointRow({ shortfall: '-50.00' })]));
    renderPointCash();
    expect(tile('Short of target')).toHaveTextContent(
      'there is more in the drawer than the target',
    );
  });

  it('hints that the target is covered when shortfall is exactly zero', () => {
    pointCashMock.mockReturnValue(list([pointRow({ shortfall: '0.00' })]));
    renderPointCash();
    expect(tile('Short of target')).toHaveTextContent('the target is covered');
  });

  it('tones the cash tile amber when the drawer reads negative', () => {
    pointCashMock.mockReturnValue(list([pointRow({ cash: '-100.00' })]));
    renderPointCash();
    // «Berry cash» also labels the ledger's own total row (`CashLedger`), so
    // `tile()`/`tileValue()` (built for a unique label) cannot be used here —
    // filter to the match that actually sits inside a stat tile.
    const cashTile = screen
      .getAllByText('Berry cash')
      .map((el) => el.closest('[data-slot="stat-tile"]'))
      .find((el): el is HTMLElement => el !== null);
    if (!cashTile) throw new Error('No stat tile labelled "Berry cash"');
    expect(within(cashTile).getByText('−100.00 ₴').className).toContain('text-[var(--amber)]');
  });
});

describe('PointCashPage — Task 2: the owner’s grouped point select', () => {
  it('splits the owner’s select into «with a target» / «no target» optgroups', () => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    // Same mocked hook backs both the scoped row (carries `asOf`) and the
    // owner-only unscoped grouping read (carries neither `asOf` nor
    // `pointId`) — distinguish them by shape, the way `ReceptionPage.test.tsx`
    // already does for a hook reused with two different filters.
    pointCashMock.mockImplementation((opts: { asOf?: string }) =>
      'asOf' in opts
        ? list([pointRow()])
        : list([
            pointRow({ collection_point_id: 'p1', name: 'Shypynky', target_cash: '5000.00' }),
            pointRow({ collection_point_id: 'p2', name: 'Haiove', target_cash: null }),
          ]),
    );

    renderPointCash();

    const select = screen.getByLabelText('Select a point');
    const withTarget = select.querySelector('optgroup[label="With a target"]');
    const withoutTarget = select.querySelector('optgroup[label="No target"]');
    expect(withTarget).not.toBeNull();
    expect(withoutTarget).not.toBeNull();
    expect(within(withTarget as HTMLElement).getByText('Shypynky')).toBeInTheDocument();
    expect(within(withoutTarget as HTMLElement).getByText('Haiove')).toBeInTheDocument();
    // Never grouped into the wrong bucket.
    expect(within(withTarget as HTMLElement).queryByText('Haiove')).toBeNull();
  });

  it('renders no select at all for an operator — grouping never reaches someone who cannot pick', () => {
    renderPointCash();
    expect(screen.queryByLabelText('Select a point')).toBeNull();
  });

  // Folded in from the Task 2 review — the grouped select intersects the
  // unscoped `/point-cash` rows with `usePointOptionsQuery()`'s ACTIVE
  // points; a point absent from that active list (deactivated since) is not
  // listed in either optgroup, even though it still has a cash row. It stays
  // reachable via `?point=` — see «names a deactivated point…» below.
  it('leaves an unscoped row for a point outside the active options out of both optgroups', () => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    // `pointOptionsMock` (beforeEach) lists only p1/p2 as active — p3 has a
    // cash row but is not among them.
    pointCashMock.mockImplementation((opts: { asOf?: string }) =>
      'asOf' in opts
        ? list([pointRow()])
        : list([
            pointRow({ collection_point_id: 'p1', name: 'Shypynky', target_cash: '5000.00' }),
            pointRow({ collection_point_id: 'p3', name: 'Zombie Point', target_cash: null }),
          ]),
    );

    renderPointCash();

    const select = screen.getByLabelText('Select a point');
    expect(within(select).queryByText('Zombie Point')).toBeNull();
    expect(within(select).getByText('Shypynky')).toBeInTheDocument();
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
    // The owner-only grouping read (Task 2) stays MOUNTED but DISABLED for an
    // operator — Rules of Hooks forbid skipping the call itself, so `enabled`
    // is the only thing that keeps it from ever actually fetching here.
    expect(pointCashMock).toHaveBeenCalledWith({ enabled: false });
    expect(pointCashMock).toHaveBeenCalledTimes(2);
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

describe('PointCashPage — R6: the ledger’s opening row', () => {
  it('asks for THIS point’s THIS date’s opening count, separately from the unbounded history read', () => {
    renderPointCash();

    expect(cashCountsMock).toHaveBeenCalledWith({
      pointId: 'p1',
      from: '2026-09-08',
      to: '2026-09-08',
    });
  });

  it('picks the opening BERRY count out of a mixed day, ignoring midday and crates rows', () => {
    // `cashCountsMock` backs three different call sites in this render
    // (this page's own unbounded `neverCounted` read, the R6 day-scoped
    // read, and `CashCountHistory`'s own read) — distinguish the day-scoped
    // one by shape, the way `pointCashMock` above already distinguishes its
    // two call sites by `'asOf' in opts`.
    cashCountsMock.mockImplementation((filter: { from?: string }) =>
      'from' in filter
        ? list([
            cashCount({ kind: 'midday', book: 'berry', counted_amount: '400.00' }),
            cashCount({ kind: 'opening', book: 'crates', counted_amount: '999.00' }),
            cashCount({ kind: 'opening', book: 'berry', counted_amount: '750.00' }),
          ])
        : list([cashCount()]),
    );

    renderPointCash();

    expect(screen.getByText('Opening count')).toBeInTheDocument();
    expect(screen.getByText('750.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText('999.00 ₴')).toBeNull();
    expect(screen.queryByText('400.00 ₴')).toBeNull();
  });

  it('shows no opening row when this date has no opening count yet, even with older history elsewhere', () => {
    cashCountsMock.mockImplementation((filter: { from?: string }) =>
      'from' in filter ? list([]) : list([cashCount()]),
    );

    renderPointCash();

    expect(screen.queryByText('Opening count')).toBeNull();
  });

  it('captions the opening row with the point’s target — read from the same scoped `point-cash` row as every other figure', () => {
    pointCashMock.mockImplementation((opts: { asOf?: string } = {}) =>
      'asOf' in opts ? list([pointRow({ target_cash: '5000.00' })]) : list([]),
    );

    renderPointCash();

    expect(screen.getByText('target 5,000.00 ₴')).toBeInTheDocument();
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

describe('PointCashPage — R1: the crates book beside the berry book, never a combined figure', () => {
  it('shows the crates book from the row', () => {
    pointCashMock.mockImplementation((opts: { asOf?: string } = {}) =>
      'asOf' in opts
        ? list([pointRow({ crate_deposits: '250.00', crate_deposit_units: 3 })])
        : list([]),
    );

    renderPointCash();

    expect(screen.getByText('Crate cash')).toBeInTheDocument();
    expect(screen.getByText('250.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('deposits for 3 crates')).toBeInTheDocument();
  });

  it('never shows a combined drawer figure — the mock’s dark block is not ported', () => {
    // Berry cash 1,000.00 + crate deposits 250.00 = 1,250.00 — that sum must
    // never appear anywhere on the page. The client's «Правка» says the two
    // books do not lie in one drawer, and `point-cash.service.ts` already
    // refuses to add them.
    pointCashMock.mockImplementation((opts: { asOf?: string } = {}) =>
      'asOf' in opts
        ? list([pointRow({ cash: '1000.00', crate_deposits: '250.00', crate_deposit_units: 3 })])
        : list([]),
    );

    renderPointCash();

    expect(screen.queryByText('Should be in the drawer')).toBeNull();
    expect(screen.queryByText(/1,250\.00/)).toBeNull();
  });
});

describe('PointCashPage — R10: composition order', () => {
  /** `a` comes before `b` in document order — the same test either role's
   *  markup must pass, since R10 asks for one order, not a per-role one. */
  function precedes(a: Element, b: Element): void {
    const position = a.compareDocumentPosition(b);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  }

  /**
   * Stats → `IncomingTransfers` (full width) → the grid (`CashLedger` left,
   * right column `CratesBookCard` then `ShiftCountPanel`) → the history
   * toggle. Asserted on DOM order alone — the grid's `lg:grid-cols-[…]`
   * class only ever adds COLUMNS at that breakpoint; nothing here reorders
   * children, so this same order is what renders in one column below `lg`
   * (the brief's "DOM order = mobile order").
   */
  function assertCompositionOrder() {
    const targetTile = tile('Target');
    const transfers = screen.getByTestId('incoming-transfers-stub');
    const ledgerCard = screen.getByText('Where this number comes from').closest('.rounded-xl');
    if (!ledgerCard) throw new Error('CashLedger’s SectionCard root not found');
    const cratesEyebrow = screen.getByText('Crate cash');
    const panelEyebrow = screen.getByText('Shift and recount');
    const historyToggle = screen.getByRole('button', { name: 'Full recount history' });

    precedes(targetTile, transfers);
    precedes(transfers, ledgerCard);
    precedes(ledgerCard, cratesEyebrow);
    precedes(cratesEyebrow, panelEyebrow);
    precedes(panelEyebrow, historyToggle);

    // The grid itself: `CashLedger`'s card is the FIRST child (left column);
    // `CratesBookCard` and `ShiftCountPanel` both live inside the SECOND
    // child (the right column) — so below `lg`, where the grid falls back
    // to a single column, the right column still renders after the ledger
    // because nothing reorders it, not because of any breakpoint-specific
    // class.
    const grid = ledgerCard.parentElement;
    if (!grid) throw new Error('grid container not found');
    expect(grid.className).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]');
    expect(grid.className).not.toMatch(/\border-/); // no order-* utility undoing source order
    expect(grid.children[0]).toBe(ledgerCard);
    const rightColumn = grid.children[1];
    if (!rightColumn) throw new Error('right column not found');
    expect(rightColumn).toContainElement(cratesEyebrow);
    expect(rightColumn).toContainElement(panelEyebrow);
  }

  it('stats → transfers → ledger|[crates, panel] → history toggle, for an operator', () => {
    renderPointCash();
    assertCompositionOrder();
  });

  it('keeps the same composition order for the owner', () => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });

    renderPointCash();
    assertCompositionOrder();
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
    // R6's day-scoped opening-count read gates the same way `intakes` does
    // just above — an empty object, not `{ from: date, to: date }` with no
    // point, which `useCashCountsQuery`'s own `isScoped` would treat as
    // scope enough to fire network-wide.
    expect(cashCountsMock).toHaveBeenCalledWith({});
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
    // The unscoped grouping read (Task 2) must stay out of this: it is not
    // under test here, and letting it echo the same row would put «Fresh Row
    // Name» on screen twice (the eyebrow AND a `<select>` option), which
    // breaks the single-match `getByText` below for a reason that has
    // nothing to do with what this test is pinning.
    pointCashMock.mockImplementation((opts: { asOf?: string }) =>
      'asOf' in opts ? list([pointRow({ name: 'Fresh Row Name' })]) : list([]),
    );

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

describe('PointCashPage — R4: the count history toggle', () => {
  it('keeps the whole-point history off the screen until the toggle is pressed', async () => {
    const user = userEvent.setup();
    renderPointCash();

    // `CashCountHistory` is not even mounted yet — not merely hidden — so
    // its own eyebrow title cannot be on screen.
    expect(screen.queryByText('Cash counts')).toBeNull();
    expect(screen.getByRole('button', { name: 'Full recount history' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await user.click(screen.getByRole('button', { name: 'Full recount history' }));

    expect(screen.getByText('Cash counts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full recount history' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('hides the history again on a second press of the same toggle', async () => {
    const user = userEvent.setup();
    renderPointCash();

    const toggle = screen.getByRole('button', { name: 'Full recount history' });
    await user.click(toggle);
    expect(screen.getByText('Cash counts')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.queryByText('Cash counts')).toBeNull();
  });
});

describe('PointCashPage — R4: the open/close result view', () => {
  it('shows «Shift opened» and the counted figure after Open shift is confirmed', async () => {
    const user = userEvent.setup();
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? list([cashCount({ kind: 'opening', counted_amount: '2500.00' })])
        : list([cashCount()]),
    );

    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Count dialog — open');
    await user.click(screen.getByRole('button', { name: 'Confirm open' }));

    expect(openShiftMock).toHaveBeenCalledWith({ counted_amount: '1000.00' });
    expect(await screen.findByRole('heading', { name: 'Shift opened' })).toBeInTheDocument();
    expect(screen.getByText('2,500.00 ₴')).toBeInTheDocument();
    // Opening never carries a discrepancy pill (§7.3 — nothing to compare
    // the first count against yet).
    expect(screen.queryByText('Discrepancy')).toBeNull();
  });

  it('shows «The day matched» and a leaf pill after Close shift is confirmed with no discrepancy', async () => {
    const user = userEvent.setup();
    shiftMock.mockReturnValue({
      data: shift({ id: 's5', status: 'open' }),
      isPending: false,
      isError: false,
    });
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? list([
            cashCount({
              id: 'cl',
              kind: 'closing',
              counted_amount: '3000.00',
              discrepancy: '0.00',
            }),
          ])
        : list([cashCount()]),
    );

    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));

    expect(closeShiftMock).toHaveBeenCalledWith({
      id: 's5',
      counted_amount: '1000.00',
      broken_crates: 0,
    });
    expect(
      await screen.findByRole('heading', { name: 'Shift closed. The day matched.' }),
    ).toBeInTheDocument();
  });

  it('names the discrepancy and warns the owner will see it, after a Close shift that does not match', async () => {
    const user = userEvent.setup();
    shiftMock.mockReturnValue({
      data: shift({ id: 's5', status: 'open' }),
      isPending: false,
      isError: false,
    });
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? list([
            cashCount({
              id: 'cl',
              kind: 'closing',
              counted_amount: '2950.00',
              discrepancy: '-50.00',
            }),
          ])
        : list([cashCount()]),
    );

    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));

    const title = `Shift closed. Discrepancy ${formatUah('-50.00', 'en')} — the owner will see it on their own list.`;
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
  });
});

describe('PointCashPage — R4 review fix: a failed shift/counts read reaches the panel as an error, not «no shift»', () => {
  it('tells ShiftCountPanel the shift read failed — no «Open shift» offered over an unconfirmed absence', () => {
    shiftMock.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The shift could not be read — reload the page',
    );
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });

  it('tells ShiftCountPanel the shift-scoped counts read failed too', () => {
    shiftMock.mockReturnValue({
      data: shift({ id: 's5', status: 'open' }),
      isPending: false,
      isError: false,
    });
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? { data: undefined, isPending: false, isError: true }
        : list([cashCount()]),
    );

    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The shift could not be read — reload the page',
    );
    expect(screen.queryByRole('button', { name: 'Close shift' })).toBeNull();
  });

  it('shows the same failure to an owner, who never had an action to lose', () => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    shiftMock.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The shift could not be read — reload the page',
    );
  });
});
