import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import { formatUah } from '@/shared/lib/money';
import { ApiError } from '@/shared/api';
import type { CashCount } from '@/entities/cash-count';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import type { PointCashRow } from '@/entities/point-cash';
import type { Shift } from '@/entities/shift';
import { PointCashPage } from './PointCashPage';

const {
  meMock,
  pointScopeMock,
  pointOptionsMock,
  pointCashMock,
  pointCashOneMock,
  intakesMock,
  payoutsMock,
  cashCountsMock,
  shiftMock,
  currentShiftMock,
  openShiftMock,
  closeShiftMock,
  noteMock,
  suppliersMock,
  reopenMock,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  pointScopeMock: vi.fn(),
  pointOptionsMock: vi.fn(),
  pointCashMock: vi.fn(),
  pointCashOneMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  cashCountsMock: vi.fn(),
  shiftMock: vi.fn(),
  currentShiftMock: vi.fn(),
  openShiftMock: vi.fn(),
  closeShiftMock: vi.fn(),
  noteMock: vi.fn(),
  suppliersMock: vi.fn(),
  reopenMock: vi.fn(),
}));

// #221 — the day's feed names each row's supplier, the owner can reopen a
// closed shift, and rows open a receipt: none of it needs a QueryClient here.
vi.mock('@/entities/supplier', () => ({
  useSuppliersQuery: (search: string, pointId: string | null) => suppliersMock(search, pointId),
  supplierName: (s: { first_name: string; last_name: string }) =>
    `${s.first_name} ${s.last_name}`,
}));

vi.mock('../api/shiftActions', () => ({
  useReopenShiftMutation: () => ({ mutateAsync: reopenMock, isPending: false }),
}));

vi.mock('@/widgets/receipt', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/widgets/receipt')>()),
  ReceiptDialog: ({
    intakeId,
    open,
    startWithVoid,
  }: {
    intakeId: string | null;
    open: boolean;
    startWithVoid?: boolean;
  }) =>
    open ? (
      <div>
        Receipt for {intakeId}
        {startWithVoid ? ' (void)' : ''}
      </div>
    ) : null,
  PayoutReceiptDialog: ({ payoutId, open }: { payoutId: string | null; open: boolean }) =>
    open ? <div>Payout receipt for {payoutId}</div> : null,
}));

vi.mock('@/features/set-operator-note/api/useSetOperatorNote', () => ({
  useSetOperatorNoteMutation: () => ({ mutateAsync: noteMock }),
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
    usePointCashForPointQuery: (pointId: string | null, asOf?: string) =>
      pointCashOneMock(pointId, asOf),
  };
});

// The REAL module behind the one hook: «Документи дня» calls `canVoidIntake`.
vi.mock('@/entities/intake', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/intake')>()),
  useIntakesQuery: (filter: unknown) => intakesMock(filter),
}));

vi.mock('@/entities/payout', () => ({
  usePayoutsQuery: (filter: unknown) => payoutsMock(filter),
}));

vi.mock('@/entities/cash-count', () => ({
  useCashCountsQuery: (filter: unknown) => cashCountsMock(filter),
}));

vi.mock('@/entities/shift', () => ({
  useShiftOnDateQuery: (pointId: string | null, date: string) => shiftMock(pointId, date),
  // `GET /shifts/current` — the point's open shift whatever its date (#114),
  // which gates the panel's «Open shift».
  useCurrentShiftQuery: (pointId: string | null) => currentShiftMock(pointId),
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
    // Its own suite (`OpenShiftAlert.test.tsx`) covers what it shows and its
    // in-place close, which needs a real `QueryClient`. Here only the wiring
    // matters: that it is mounted, for which point and which viewed date.
    OpenShiftAlert: ({
      pointId,
      viewedDate,
      onClosed,
    }: {
      pointId: string | null;
      viewedDate: string;
      onClosed?: (shiftId: string) => void;
    }) => (
      <div data-testid="open-shift-alert-stub">
        {pointId} {viewedDate}
        <button onClick={() => onClosed?.('s-old')}>Stale closed</button>
      </div>
    ),
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
  operator_note: null,
  operator_note_editable: false,
  explainable: false,
  ...over,
  explained: over.explained ?? over.explanation != null,
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
  broken_crates: null,
  ...over,
});

/** The StatTile that carries `label`. */
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
  pointCashMock
    .mockReset()
    .mockImplementation((opts: { asOf?: string } = {}) =>
      'asOf' in opts ? list([pointRow()]) : list([]),
    );
  pointCashOneMock.mockReset().mockReturnValue({
    data: {
      collection_point_id: 'p1',
      cash: '1000.00',
      crate_deposits: '0.00',
      crate_deposit_units: 0,
      breakdown: {
        kind: 'open',
        anchor_date: '2026-09-08',
        opening: '1000.00',
        transfers_in: '0.00',
        payouts: '0.00',
        returns: '0.00',
        closing: null,
      },
    },
    isPending: false,
    isError: false,
  });
  intakesMock.mockReset().mockReturnValue(list([]));
  payoutsMock.mockReset().mockReturnValue(list([]));
  cashCountsMock.mockReset().mockReturnValue(list([cashCount()]));
  shiftMock.mockReset().mockReturnValue({ data: null, isPending: false, isError: false });
  // The same world `shiftMock` describes by default: nothing open anywhere.
  currentShiftMock.mockReset().mockReturnValue({ data: null, isPending: false, isError: false });
  openShiftMock.mockReset().mockResolvedValue({ id: 's-new' });
  closeShiftMock.mockReset().mockResolvedValue({});
  noteMock.mockReset().mockResolvedValue({ id: 's5' });
  suppliersMock.mockReset().mockReturnValue({
    data: {
      data: [{ id: 'sup1', first_name: 'Iryna', last_name: 'Kovalenko' }],
      total: 1,
      page: 1,
      limit: 100,
    },
    isPending: false,
    isError: false,
  });
  reopenMock.mockReset().mockResolvedValue(shift({ status: 'open' }));
});

afterEach(() => vi.useRealTimers());

function renderPointCash(entry = '/point-cash') {
  const router = createMemoryRouter([{ path: '/point-cash', element: <PointCashPage /> }], {
    initialEntries: [entry],
  });
  return render(<RouterProvider router={router} />);
}

describe('PointCashPage — honesty rule 1: the total is the server’s, not the sum of the rows', () => {
  it('takes today’s movement rows from the server breakdown, never from the payouts page (#73)', () => {
    // A 900.00 payout on the page, but the breakdown says 0.00 went out —
    // the ledger prints the server's term, not a client re-sum.
    payoutsMock.mockReturnValue(list([payout({ amount: '900.00' })]));

    renderPointCash();

    expect(screen.getAllByText('1,000.00 ₴').length).toBeGreaterThan(0);
    expect(screen.queryByText('−900.00 ₴')).toBeNull();
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

    // Only `paidPast` still reads the payouts page — the movement rows come
    // from the server's breakdown (#73), so the caveat appears once.
    expect(await screen.findAllByText(/older ones may be missing/i)).toHaveLength(1);
  });

  it('carries the same caveat to the row fed by intakes', () => {
    const truncated = <T,>(data: T[]) => ({
      data: { data, total: 250, page: 1, limit: 100 },
      isPending: false,
      isError: false,
    });
    intakesMock.mockReturnValue(truncated([]));

    renderPointCash();

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
    // Only real points to pick from — no «Select a point» entry.
    expect(select.querySelector('option[value=""]')).toBeNull();
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

  // Review, minor 7 — the old shape filtered `pointCashAll`'s own (capped)
  // page down to the active points, which dropped an active point ENTIRELY
  // the moment its row fell outside that page, not merely its target. Now
  // the select is built FROM the active `points` list, so a point still
  // offered here but missing a row reads as «Без наділу»/"No target" — the
  // same honest default a point that genuinely has no target gets.
  it('still offers an active point whose row is missing from the unscoped page, under «No target»', () => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    // `pointOptionsMock` (beforeEach) lists p1 AND p2 as active — the
    // unscoped grouping read here carries only p1's row.
    pointCashMock.mockImplementation((opts: { asOf?: string }) =>
      'asOf' in opts
        ? list([pointRow()])
        : list([pointRow({ collection_point_id: 'p1', name: 'Shypynky', target_cash: '5000.00' })]),
    );

    renderPointCash();

    const select = screen.getByLabelText('Select a point');
    const withoutTarget = select.querySelector('optgroup[label="No target"]');
    expect(withoutTarget).not.toBeNull();
    expect(within(withoutTarget as HTMLElement).getByText('Haiove')).toBeInTheDocument();
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
    // The stat tile prints the row's `cash`; the ledger total is the detail
    // read's (#73), which here still says 1,000.00.
    expect(screen.getAllByText('1,234.00 ₴')).toHaveLength(1);
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

describe('PointCashPage — the ledger reads the server breakdown (#73)', () => {
  it('asks the detail read for THIS point and THIS date', () => {
    renderPointCash();
    expect(pointCashOneMock).toHaveBeenCalledWith('p1', '2026-09-08');
  });

  it('reads the receipts from the day a still-open shift began (#114, PR #242 review)', () => {
    const one = pointCashOneMock();
    pointCashOneMock.mockReturnValue({
      ...one,
      data: { ...one.data, breakdown: { ...one.data.breakdown, anchor_date: '2026-09-07' } },
    });
    renderPointCash();
    // `CalledWith`, not `LastCalledWith`: the page also reads the shift's own
    // receipts by `shiftId` for «Документи дня» (#221).
    expect(intakesMock).toHaveBeenCalledWith({
      pointId: 'p1',
      from: '2026-09-07',
      to: '2026-09-08',
      limit: 100,
    });
  });

  it('no longer reads a day-scoped opening count of its own', () => {
    renderPointCash();
    expect(cashCountsMock).not.toHaveBeenCalledWith({
      pointId: 'p1',
      from: '2026-09-08',
      to: '2026-09-08',
    });
  });

  it('shows the breakdown’s opening row, captioned with the point’s target', () => {
    pointCashMock.mockImplementation((opts: { asOf?: string } = {}) =>
      'asOf' in opts ? list([pointRow({ target_cash: '5000.00' })]) : list([]),
    );
    renderPointCash();
    expect(screen.getByText('Opening count')).toBeInTheDocument();
    expect(screen.getByText('target 5,000.00 ₴')).toBeInTheDocument();
  });

  it('a failed detail read stays inside the ledger card — the stats still render', () => {
    pointCashOneMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderPointCash();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(tile('Target')).toBeInTheDocument();
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

    // Its own tile in the header row (#221), beside berry cash.
    expect(tile('Crate cash')).toHaveTextContent('250.00 ₴');
    expect(tile('Crate cash')).toHaveTextContent('deposits for 3 crates');
    // What the old card's footnote said, and the tile still has to: a crate
    // handed out against a signed receipt carries no deposit, so the count
    // here can be smaller than the crates out in the field.
    expect(tile('Crate cash')).toHaveTextContent('signed-receipt crates not counted');
  });

  it('counts one crate in the singular, and says no deposits rather than «for 0 crates»', () => {
    pointCashMock.mockImplementation((opts: { asOf?: string } = {}) =>
      'asOf' in opts ? list([pointRow({ crate_deposits: '50.00', crate_deposit_units: 1 })]) : list([]),
    );
    const { unmount } = renderPointCash();
    expect(tile('Crate cash')).toHaveTextContent('deposits for 1 crate');
    unmount();

    pointCashMock.mockImplementation((opts: { asOf?: string } = {}) =>
      'asOf' in opts ? list([pointRow({ crate_deposits: '0.00', crate_deposit_units: 0 })]) : list([]),
    );
    renderPointCash();
    expect(tile('Crate cash')).toHaveTextContent('no crate deposits held');
    expect(screen.queryByText(/deposits for 0/)).toBeNull();
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
   * Stats (crates the fourth tile, #221) → `IncomingTransfers` → the grid
   * (`CashLedger`, then `ShiftCountPanel`) → «Звірка каси» → the feed/history
   * tabs. Asserted on DOM order alone — the grid's `lg:grid-cols-[…]`
   * class only ever adds COLUMNS at that breakpoint; nothing here reorders
   * children, so this same order is what renders in one column below `lg`
   * (the brief's "DOM order = mobile order").
   */
  function assertCompositionOrder() {
    const cratesTile = tile('Crate cash');
    const transfers = screen.getByTestId('incoming-transfers-stub');
    const ledgerCard = screen.getByText('Where this number comes from');
    const panelEyebrow = screen.getByText('Shift and recount');
    const historyTab = screen.getByRole('tab', { name: 'Recount history' });

    // DOM order is the phone's reading order: the grid only adds columns at
    // `lg`, so this is also what one column below it shows.
    precedes(tile('Target'), cratesTile);
    precedes(cratesTile, transfers);
    precedes(transfers, ledgerCard);
    precedes(ledgerCard, panelEyebrow);
    precedes(panelEyebrow, historyTab);
  }

  it('stats → transfers → ledger → panel → history tab, for an operator', () => {
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
  it('reads nothing about the PICKED point until the owner picks one — the unscoped grouping read is the one exception', () => {
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
    expect(intakesMock).toHaveBeenCalledWith({});
    expect(payoutsMock).toHaveBeenCalledWith({
      pointId: undefined,
      to: '2026-09-08',
      limit: 100,
    });
    expect(cashCountsMock).toHaveBeenCalledWith({ pointId: undefined });
    expect(pointCashOneMock).toHaveBeenCalledWith(null, '2026-09-08');
    // THE EXCEPTION (review, minor 8): the owner's OWN unscoped `/point-cash`
    // read (Task 2 — the grouping for this very `<select>`) is not gated on
    // `pointId` at all, only on `isOwner` — it has to fire before a point is
    // picked, since picking the point is exactly what it exists to inform.
    // It never names figures for the picked point, so it does not violate
    // this test's own claim about that.
    expect(pointCashMock).toHaveBeenCalledWith({ enabled: true });
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

    expect(screen.getByText(/^Shypynky ·/)).toBeInTheDocument();
    // The select names the point on screen too, rather than showing Haiove
    // as picked while Shypynky's figures sit under it.
    const select = screen.getByLabelText('Select a point') as HTMLSelectElement;
    expect(select.value).toBe('p1');
    expect(select.selectedOptions[0]).toHaveTextContent('Shypynky');
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

describe('PointCashPage — the feed and the recount history share one card (#221)', () => {
  it('opens on the day feed, with the whole-point history not even mounted', () => {
    renderPointCash();

    expect(screen.getByRole('tab', { name: 'Day feed' })).toHaveAttribute('aria-selected', 'true');
    // Not merely hidden — Radix unmounts the inactive tab, so
    // `CashCountHistory` (and its own whole-point read) is not in the tree.
    expect(screen.queryByRole('columnheader', { name: 'When' })).toBeNull();
  });

  it('shows the history on its tab and the feed again on the other', async () => {
    const user = userEvent.setup();
    renderPointCash();

    await user.click(screen.getByRole('tab', { name: 'Recount history' }));
    expect(screen.getByRole('tab', { name: 'Recount history' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('columnheader', { name: 'When' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Day feed' }));
    expect(screen.queryByRole('columnheader', { name: 'When' })).toBeNull();
  });

  it('keeps the history one click away on a failed shift read, the alert said once', async () => {
    const user = userEvent.setup();
    shiftMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderPointCash();

    // The panel's alert is the only one; the feed tab says it quietly.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await user.click(screen.getByRole('tab', { name: 'Recount history' }));
    expect(screen.getByRole('columnheader', { name: 'When' })).toBeInTheDocument();
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
    // Since 09.09 the opening is compared with the last close, so it carries
    // the same pill a close does (spec 2026-10-08, decision 5).
    expect(screen.getByText('Discrepancy')).toBeInTheDocument();
  });

  it('dismisses via «Done» rather than hard-popping, without leaking stale content into the next result (minor 14)', async () => {
    // The result dialog is now ALWAYS mounted, with `open` the only gate
    // (review) — a dismiss animates closed like every other dialog instead
    // of the whole component vanishing from the tree the instant `resultFor`
    // clears. Nothing to show before the first count of the day ever lands.
    const user = userEvent.setup();
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? list([cashCount({ kind: 'opening', counted_amount: '2500.00' })])
        : list([cashCount()]),
    );

    renderPointCash();
    expect(screen.queryByRole('heading', { name: 'Shift opened' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    await user.click(screen.getByRole('button', { name: 'Confirm open' }));
    expect(await screen.findByRole('heading', { name: 'Shift opened' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('heading', { name: 'Shift opened' })).toBeNull();
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

  it('keeps describing the shift it was about after the date changes — never the new day’s count (minor 6)', async () => {
    // The result reads counts by ITS OWN shift (`s5`), so a date change can
    // neither blank it nor make it describe the new day's shift (`s9`, which
    // carries a different count). The dialog is modal, so the URL is driven
    // through the router, as the browser's back button would.
    const user = userEvent.setup();
    shiftMock.mockImplementation((_pointId: string | null, date: string) =>
      date === '2026-09-08'
        ? { data: shift({ id: 's5', status: 'open' }), isPending: false, isError: false }
        : {
            data: shift({
              id: 's9',
              status: 'closed',
              closed_by_name: 'Petro',
              business_date: date,
            }),
            isPending: false,
            isError: false,
          },
    );
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? list(
            filter.shiftId === 's9'
              ? [cashCount({ id: 'c9', shift_id: 's9', kind: 'closing', discrepancy: '-10.00' })]
              : filter.shiftId === 's5'
                ? [
                    cashCount({
                      id: 'cl',
                      shift_id: 's5',
                      kind: 'closing',
                      counted_amount: '3000.00',
                      discrepancy: '0.00',
                    }),
                  ]
                : [],
          )
        : list([cashCount()]),
    );

    const router = createMemoryRouter([{ path: '/point-cash', element: <PointCashPage /> }], {
      initialEntries: ['/point-cash'],
    });
    render(<RouterProvider router={router} />);

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    expect(
      await screen.findByRole('heading', { name: 'Shift closed. The day matched.' }),
    ).toBeInTheDocument();

    await router.navigate('/point-cash?date=2026-09-07');

    expect(
      screen.getByRole('heading', { name: 'Shift closed. The day matched.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Discrepancy .*10\.00/)).toBeNull();
  });

  const closeWith = (row: Partial<CashCount>) => {
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
              shift_id: 's5',
              kind: 'closing',
              counted_amount: '2950.00',
              discrepancy: '-50.00',
              ...row,
            }),
          ])
        : list([cashCount()]),
    );
  };

  it('opens the form by itself in the same dialog when the closer may explain a discrepancy', async () => {
    const user = userEvent.setup();
    closeWith({ operator_note_editable: true });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));

    expect(
      await screen.findByRole('heading', {
        name: `What happened? Closing discrepancy ${formatUah('-50.00', 'en')}`,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('Cancel falls back to the result, which still offers the form, and the form does not reopen on its own', async () => {
    const user = userEvent.setup();
    closeWith({ operator_note_editable: true });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(
      await screen.findByRole('button', { name: 'Explain the discrepancy' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Your explanation')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Explain the discrepancy' }));
    expect(screen.getByLabelText('Your explanation')).toBeInTheDocument();
  });

  it('every close the closer may explain opens the form again — once per close, not once per visit', async () => {
    const user = userEvent.setup();
    closeWith({ operator_note_editable: true });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Done' }));

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    expect(await screen.findByLabelText('Your explanation')).toBeInTheDocument();
  });

  it('saving closes the whole dialog, and the next close shows a fresh result, not the old form', async () => {
    const user = userEvent.setup();
    closeWith({ operator_note_editable: true });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    await user.type(await screen.findByLabelText('Your explanation'), 'віддав решту');
    await user.click(screen.getByRole('button', { name: 'Save explanation' }));

    expect(noteMock).toHaveBeenCalledWith({ countId: 'cl', operatorNote: 'віддав решту' });
    await waitFor(() => expect(screen.queryByLabelText('Your explanation')).toBeNull());

    closeWith({ operator_note_editable: false });
    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    expect(await screen.findByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Your explanation')).toBeNull();
  });

  it('offers nothing when the server says the note is not editable (a matched close, or not the closer)', async () => {
    const user = userEvent.setup();
    closeWith({ operator_note_editable: false });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm close' }));
    await screen.findByRole('button', { name: 'Done' });
    expect(screen.queryByRole('button', { name: 'Explain the discrepancy' })).toBeNull();
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

/**
 * #114 — «Відкрити зміну» on this panel answers the same date-blind question
 * `/reception` does: is ANY shift open at the point? A shift stranded
 * on 2026-09-03 is invisible to today's `useShiftOnDateQuery`, and the server
 * refuses a second one (SHIFT_ALREADY_OPEN, #113).
 */
describe('PointCashPage — count explanations: the opening note (S4) and a banner close (S2)', () => {
  const openWith = (row: Partial<CashCount>) =>
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? list(
            filter.shiftId === 's-new'
              ? [cashCount({ id: 'op', shift_id: 's-new', kind: 'opening', ...row })]
              : [],
          )
        : list([cashCount()]),
    );

  it('S4: after opening with a discrepancy the opener sees it and the note form opens', async () => {
    const user = userEvent.setup();
    openWith({ discrepancy: '-20.00', counted_amount: '980.00', operator_note_editable: true });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm open' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(/Opening discrepancy/);
    expect(await screen.findByLabelText('Your explanation')).toBeInTheDocument();
  });

  it('S4: the open result names the discrepancy in its title', async () => {
    const user = userEvent.setup();
    openWith({ discrepancy: '-20.00', operator_note_editable: false });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm open' }));

    expect(
      await screen.findByRole('heading', {
        name: `Shift opened. ${formatUah('-20.00', 'en')} off the previous close — the owner will see it in their list.`,
      }),
    ).toBeInTheDocument();
  });

  it('first-ever count (discrepancy 0): plain «Shift opened», no form', async () => {
    const user = userEvent.setup();
    openWith({ discrepancy: '0.00', operator_note_editable: false });
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm open' }));

    expect(await screen.findByRole('heading', { name: 'Shift opened' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('S2: closing a stale shift from the banner shows THAT shift result and the note form', async () => {
    const user = userEvent.setup();
    cashCountsMock.mockImplementation((filter: { shiftId?: string }) =>
      'shiftId' in filter
        ? list(
            filter.shiftId === 's-old'
              ? [
                  cashCount({
                    id: 'old-cl',
                    shift_id: 's-old',
                    kind: 'closing',
                    counted_amount: '950.00',
                    discrepancy: '-50.00',
                    operator_note_editable: true,
                  }),
                ]
              : [],
          )
        : list([cashCount()]),
    );
    renderPointCash();

    await user.click(screen.getByRole('button', { name: 'Stale closed' }));

    expect(await screen.findByRole('dialog')).toHaveTextContent(/Closing discrepancy/);
    expect(await screen.findByLabelText('Your explanation')).toBeInTheDocument();
  });

  it('reads no result counts before any result exists', () => {
    renderPointCash();
    expect(cashCountsMock).toHaveBeenCalledWith({ shiftId: undefined });
  });
});

describe('PointCashPage — an open shift left behind on another day (#114)', () => {
  const stranded = shift({ id: 's-stranded', business_date: '2026-09-03' });

  it('mounts the stale-shift alert for the point and the viewed date', () => {
    renderPointCash('/point-cash?date=2026-09-07');

    expect(screen.getByTestId('open-shift-alert-stub')).toHaveTextContent('p1 2026-09-07');
    expect(currentShiftMock).toHaveBeenCalledWith('p1');
  });

  it('withholds «Open shift» today while a shift from another day is still open', () => {
    currentShiftMock.mockReturnValue({ data: stranded, isPending: false, isError: false });

    renderPointCash();

    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
    expect(
      screen.getByText(
        'A shift from another day is still open — close it before opening a new one',
      ),
    ).toBeInTheDocument();
  });

  it('withholds it while that is still unknown', () => {
    currentShiftMock.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderPointCash();

    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });

  it('withholds it when the check failed, and says so', () => {
    currentShiftMock.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderPointCash();

    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
    expect(
      screen.getByText('Could not check whether a shift is already open — reload the page'),
    ).toBeInTheDocument();
  });

  it('closes the stranded shift from its own day', async () => {
    const user = userEvent.setup();
    shiftMock.mockReturnValue({ data: stranded, isPending: false, isError: false });
    currentShiftMock.mockReturnValue({ data: stranded, isPending: false, isError: false });

    renderPointCash('/point-cash?date=2026-09-03');

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Count dialog — close');
    await user.click(screen.getByRole('button', { name: 'Confirm close' }));

    expect(closeShiftMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's-stranded', counted_amount: '1000.00' }),
    );
  });
});

// ─── #221: «Каса за день» folded into this page ─────────────────────────────
// Ported from the deleted `pages/day/ui/DayPage.test.tsx`: the day's tiles,
// «Документи дня», «Звірка каси» and the owner's reopen. The toolbar cases
// (open/close, the `?date=` clamp, the owner's point pick, a failed shift
// read, the stale-shift alert) were NOT ported — this suite already pins
// each of them for this page.

const intake = (over: Partial<Intake> & Pick<Intake, 'id' | 'code' | 'amount'>): Intake => ({
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 'sup1',
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

/** `total` defaults to what was returned; pass a bigger one to stand for a
 *  journal the server truncated at the 100-row limit. */
const page = <T,>(data: T[], total = data.length) => ({
  data: { data, total, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

/**
 * Feeds the SHIFT-scoped reads (`{ shiftId }`, «Документи дня») and leaves
 * the ledger's own point+date reads empty, so a figure on screen can only
 * have come from the day's documents.
 */
function dayDocs(
  intakes: ReturnType<typeof page<Intake>> | { data: undefined; isPending: boolean; isError: boolean },
  payouts: ReturnType<typeof page<Payout>> | { data: undefined; isPending: boolean; isError: boolean },
) {
  intakesMock.mockImplementation((f: object) => ('shiftId' in f ? intakes : list([])));
  payoutsMock.mockImplementation((f: object) => ('shiftId' in f ? payouts : list([])));
}

const openToday = shift({ id: 's1', status: 'open' });
const closedYesterday = shift({
  id: 's0',
  business_date: '2026-09-07',
  status: 'closed',
  closed_by_user_id: 'u1',
  closed_by_name: 'Olha',
  closed_at: '2026-09-07T18:00:00Z',
  created_at: '2026-09-07T05:00:00Z',
});

describe('PointCashPage — the day’s tiles and documents (#221)', () => {
  beforeEach(() => {
    shiftMock.mockReturnValue({ data: openToday, isPending: false, isError: false });
    currentShiftMock.mockReturnValue({ data: openToday, isPending: false, isError: false });
    dayDocs(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '10944.00' }),
        intake({ id: 'i2', code: 'KV-0002', amount: '1827.00', created_at: '2026-09-08T09:20:00Z' }),
        intake({
          id: 'i3',
          code: 'KV-0003',
          amount: '99.00',
          created_at: '2026-09-08T10:00:00Z',
          voided_at: '2026-09-08T10:05:00Z',
          void_reason: 'Wrong supplier',
        }),
      ]),
      page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '4000.00' })]),
    );
  });

  it('reads the documents by the shift on screen', () => {
    renderPointCash();
    expect(intakesMock).toHaveBeenCalledWith({ shiftId: 's1' });
    expect(payoutsMock).toHaveBeenCalledWith({ shiftId: 's1' });
  });

  it('totals the live documents in four tiles, the voided receipt out of every total', () => {
    renderPointCash();

    expect(tile('Berry received')).toHaveTextContent('73.80 kg');
    expect(tile('Berry received')).toHaveTextContent('2 receipts');
    expect(tile('Accrued')).toHaveTextContent('12,771.00 ₴');
    expect(tile('Cash out')).toHaveTextContent('4,000.00 ₴');
    expect(tile('Balances created')).toHaveTextContent('8,771.00 ₴');
    // Still on the feed, struck through.
    expect(screen.getByText('KV-0003')).toBeInTheDocument();
    expect(screen.getByText('voided')).toBeInTheDocument();
  });

  it('warns that the totals are partial when the server truncated a journal', () => {
    const hundred = Array.from({ length: 100 }, (_, n) =>
      intake({ id: `i${n}`, code: `KV-${n}`, amount: '1.00' }),
    );
    dayDocs(page<Intake>(hundred, 150), page<Payout>([]));

    renderPointCash();

    expect(screen.getByText('Showing the first 100 documents — totals are partial')).toBeInTheDocument();
    // A partial total is still the truth about what was read.
    expect(tile('Accrued')).toHaveTextContent('100.00 ₴');
  });

  it('says nothing about truncation when both journals came back whole', () => {
    renderPointCash();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it('opens the receipt for an intake row', async () => {
    const user = userEvent.setup();
    renderPointCash();

    expect(screen.queryByText('Receipt for i1')).toBeNull();
    await user.click(screen.getByText('KV-0001'));
    expect(screen.getByText('Receipt for i1')).toBeInTheDocument();
  });

  it('opens the payout receipt for a standalone payout row', async () => {
    const user = userEvent.setup();
    renderPointCash();

    await user.click(screen.getByRole('button', { name: /VD-0001/ }));
    expect(screen.getByText('Payout receipt for y1')).toBeInTheDocument();
    expect(screen.queryByText(/^Receipt for/)).toBeNull();
  });

  it('leaves a payout row that belongs to a receipt non-clickable', () => {
    dayDocs(
      page<Intake>([]),
      page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '4000.00', intake_id: 'i1' })]),
    );
    renderPointCash();

    expect(screen.getByText('VD-0001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /VD-0001/ })).toBeNull();
  });

  it("shows every feed row's supplier name, intake and payout alike", () => {
    renderPointCash();

    const intakeRow = screen.getByText('KV-0001').closest('li');
    const payoutRow = screen.getByText('VD-0001').closest('li');
    expect(within(intakeRow!).getByText('Iryna Kovalenko')).toBeInTheDocument();
    expect(within(payoutRow!).getByText('Iryna Kovalenko')).toBeInTheDocument();
  });

  it("renders a voided row's reason as visible text", () => {
    renderPointCash();
    expect(screen.getByText('Voided: Wrong supplier')).toBeInTheDocument();
  });

  it('shows no day tiles and no reconciliation on a date without a shift, but still the cash figures', () => {
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
    renderPointCash();

    expect(screen.queryByText('Berry received')).toBeNull();
    expect(screen.queryByText('Cash reconciliation')).toBeNull();
    expect(tile('Short of target')).toBeInTheDocument();
    expect(screen.getByText('Day feed')).toBeInTheDocument();
  });

  it('shows neither tiles nor the reconciliation while the documents are still loading', () => {
    const pending = { data: undefined, isPending: true, isError: false };
    dayDocs(pending, pending);
    renderPointCash();

    expect(screen.queryByText('Berry received')).toBeNull();
    expect(screen.queryByText('Cash reconciliation')).toBeNull();
  });

  it('a failed journal stays inside the feed card — the cash figures still render', () => {
    dayDocs(page<Intake>([]), { data: undefined, isPending: false, isError: true });
    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Berry received')).toBeNull();
    expect(screen.queryByText('Cash reconciliation')).toBeNull();
    expect(tile('Short of target')).toBeInTheDocument();
  });

  it('keeps the day on screen when a read the day does not need fails (#221 review)', () => {
    // The ledger's point+date payouts read fails; the shift's own documents
    // came back. The cash figures go, the day does not.
    payoutsMock.mockImplementation((f: object) =>
      'shiftId' in f
        ? page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '4000.00' })])
        : { data: undefined, isPending: false, isError: true },
    );
    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Short of target')).toBeNull();
    expect(tile('Accrued')).toHaveTextContent('12,771.00 ₴');
    expect(screen.getByText('Cash reconciliation')).toBeInTheDocument();
    expect(screen.getByText('KV-0001')).toBeInTheDocument();
  });

  it('keeps the day on screen when the point-wide counts read fails', () => {
    cashCountsMock.mockImplementation((f: { pointId?: string; shiftId?: string }) =>
      f.pointId ? { data: undefined, isPending: false, isError: true } : list([cashCount()]),
    );
    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByText('KV-0001')).toBeInTheDocument();
  });

  it('keeps «Close shift» reachable when a ledger read fails — no other screen closes today’s shift', () => {
    cashCountsMock.mockImplementation((f: { pointId?: string; shiftId?: string }) =>
      f.pointId ? { data: undefined, isPending: false, isError: true } : list([cashCount()]),
    );
    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: 'Close shift' })).toBeInTheDocument();
  });

  it('shows no day for a point that does not exist — only the message', () => {
    pointCashMock.mockReturnValue(list([]));
    renderPointCash();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Day feed')).toBeNull();
    expect(screen.queryByText('KV-0001')).toBeNull();
  });

  it('puts the reconciliation and then the feed after the ledger grid — the feed grows, the reconciliation does not', () => {
    renderPointCash();
    const ledgerCard = screen.getByText('Cash reconciliation');
    const feed = screen.getByText('Day feed');
    const panel = screen.getByText('Shift and recount');
    expect(panel.compareDocumentPosition(ledgerCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ledgerCard.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('PointCashPage — «Void» on the day’s feed (§9.4)', () => {
  const voidButton = (code: string) => screen.queryByRole('button', { name: `Void ${code}` });

  beforeEach(() => {
    shiftMock.mockReturnValue({ data: openToday, isPending: false, isError: false });
    currentShiftMock.mockReturnValue({ data: openToday, isPending: false, isError: false });
    dayDocs(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '10.00' }),
        intake({ id: 'i2', code: 'KV-0002', amount: '20.00', received_by_user_id: 'u9' }),
        intake({ id: 'i3', code: 'KV-0003', amount: '30.00', voided_at: '2026-09-08T10:05:00Z' }),
      ]),
      page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '5.00' })]),
    );
  });

  it('shows the author their own receipt on an open shift, never another’s or a voided one', () => {
    renderPointCash();
    expect(voidButton('KV-0001')).toBeInTheDocument();
    expect(voidButton('KV-0002')).toBeNull();
    expect(voidButton('KV-0003')).toBeNull();
    expect(voidButton('VD-0001')).toBeNull();
  });

  it('hides it from the author once the shift is closed', () => {
    dayDocs(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '10.00', shift_closed: true })]),
      page<Payout>([]),
    );
    renderPointCash();
    expect(voidButton('KV-0001')).toBeNull();
  });

  it('shows the owner every live receipt', () => {
    meMock.mockReturnValue({ data: OWNER });
    renderPointCash();
    expect(voidButton('KV-0001')).toBeInTheDocument();
    expect(voidButton('KV-0002')).toBeInTheDocument();
    expect(voidButton('KV-0003')).toBeNull();
  });

  it('opens the receipt straight into its void', async () => {
    const user = userEvent.setup();
    renderPointCash();
    await user.click(voidButton('KV-0001')!);
    expect(screen.getByText('Receipt for i1 (void)')).toBeInTheDocument();
  });
});

describe('PointCashPage — the balances-created tile tone', () => {
  beforeEach(() => {
    shiftMock.mockReturnValue({ data: openToday, isPending: false, isError: false });
  });

  it('stays the default tone when nothing is owed', () => {
    dayDocs(page<Intake>([]), page<Payout>([]));
    renderPointCash();
    expect(within(tile('Balances created')).getByText('0.00 ₴').className).not.toContain('amber');
  });

  it('turns amber once a balance is owed', () => {
    dayDocs(page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '10.00' })]), page<Payout>([]));
    renderPointCash();
    expect(within(tile('Balances created')).getByText('10.00 ₴').className).toContain('amber');
  });
});

describe('PointCashPage — «Звірка каси» (#221, from «Каса за день»)', () => {
  const ledger = () =>
    screen.getByText('Cash reconciliation').closest('div.rounded-xl') as HTMLElement;
  const row = (label: string) => {
    const el = within(ledger()).getByText(label).closest('div');
    if (!el) throw new Error(`No ledger row "${label}"`);
    return el as HTMLElement;
  };
  const voided = { voided_at: '2026-09-08T12:00:00Z', voided_by_user_id: 'u1', void_reason: 'typo' };

  beforeEach(() => {
    shiftMock.mockReturnValue({ data: openToday, isPending: false, isError: false });
  });

  it('breaks the accrued sum into cash with a receipt, cash without one and the rest owed', () => {
    dayDocs(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '1000.00' })]),
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '600.00', intake_id: 'i1' }),
        payout({ id: 'y2', code: 'VD-0002', amount: '150.00' }),
      ]),
    );
    renderPointCash();

    expect(row("Accrued for this day's berry")).toHaveTextContent('1,000.00 ₴');
    expect(row('Paid in cash on the spot')).toHaveTextContent('−600.00 ₴');
    expect(row('Paid without berry')).toHaveTextContent('−150.00 ₴');
    expect(row('Left on balance for us')).toHaveTextContent('−250.00 ₴');
    expect(row('Total cash out')).toHaveTextContent('750.00 ₴');
  });

  it('hides the without-berry row on a day with no such payout', () => {
    dayDocs(page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '100.00' })]), page<Payout>([]));
    renderPointCash();
    expect(within(ledger()).queryByText('Paid without berry')).toBeNull();
    expect(row('Paid in cash on the spot')).toHaveTextContent(
      /^Paid in cash on the spotwith a receipt0\.00 ₴$/,
    );
  });

  it('says more was paid out than accrued, without claiming which debt it settled', () => {
    dayDocs(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '100.00' })]),
      page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '300.00' })]),
    );
    renderPointCash();

    expect(tile('Paid beyond accrued')).toHaveTextContent('200.00 ₴');
    expect(screen.queryByText('Balances created')).toBeNull();
    expect(row('Paid out beyond accrued')).toHaveTextContent('+200.00 ₴');
    // Scoped to «Звірка каси»: `CashLedger`'s own two-rows note on this page
    // legitimately mentions old balances.
    expect(within(ledger()).queryByText(/old balances/i)).toBeNull();
  });

  it('shows nothing out when every payout was voided in the open shift (#170 review)', () => {
    dayDocs(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '510.00', voided_at: '2026-09-08T12:00:00Z', void_reason: 'x' }),
      ]),
      page<Payout>([
        payout({
          id: 'y1',
          code: 'VD-0001',
          amount: '4930.00',
          voided_at: '2026-09-09T00:10:00',
          voided_by_user_id: 'u1',
          void_reason: 'typo',
          return_settled_at: '2026-09-09T00:10:00',
          return_settled_by_user_id: 'u1',
          returned_on_void: true,
        }),
      ]),
    );
    renderPointCash();

    expect(tile('Cash out')).toHaveTextContent('0.00 ₴');
    expect(row('Total cash out')).toHaveTextContent('0.00 ₴');
    expect(screen.queryByText(/on voided payouts/)).toBeNull();
  });

  it('counts a closed-shift void as cash out while its return is pending', () => {
    dayDocs(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '500.00' })]),
      page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '40.00', ...voided })]),
    );
    renderPointCash();

    expect(tile('Cash out')).toHaveTextContent('40.00 ₴');
    expect(row('Total cash out')).toHaveTextContent('40.00 ₴');
    expect(
      screen.getByText('of which 40.00 ₴ on voided payouts still waiting to come back to the drawer'),
    ).toBeInTheDocument();
    expect(row('Left on balance for us')).toHaveTextContent('−500.00 ₴');
  });

  it('counts nothing out for a closed-shift void returned the same day', () => {
    dayDocs(
      page<Intake>([]),
      page<Payout>([
        payout({
          id: 'y1',
          code: 'VD-0001',
          amount: '25.00',
          voided_at: '2026-09-08T16:30:00',
          voided_by_user_id: 'u2',
          void_reason: 'typo',
          return_settled_at: '2026-09-08T16:40:00',
          return_settled_by_user_id: 'u2',
        }),
      ]),
    );
    renderPointCash();
    expect(tile('Cash out')).toHaveTextContent('0.00 ₴');
    expect(screen.queryByText(/on voided payouts/)).toBeNull();
  });

  it('names a partial return with both figures', () => {
    dayDocs(
      page<Intake>([]),
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '40.00', ...voided }),
        payout({
          id: 'y2',
          code: 'VD-0002',
          amount: '25.00',
          ...voided,
          return_settled_at: '2026-09-10T09:00:00',
          return_settled_by_user_id: 'u1',
        }),
      ]),
    );
    renderPointCash();
    expect(
      screen.getByText('of which 65.00 ₴ on voided payouts, 40.00 ₴ of it still waiting to come back to the drawer'),
    ).toBeInTheDocument();
  });

  it('says so when every voided payout came back', () => {
    dayDocs(
      page<Intake>([]),
      page<Payout>([
        payout({
          id: 'y1',
          code: 'VD-0001',
          amount: '25.00',
          ...voided,
          return_settled_at: '2026-09-10T09:00:00',
          return_settled_by_user_id: 'u1',
        }),
      ]),
    );
    renderPointCash();
    expect(
      screen.getByText('of which 25.00 ₴ on voided payouts returned later, on the day of the return'),
    ).toBeInTheDocument();
  });

  it('puts the voided-payout line between the rows and the plaque it explains', () => {
    dayDocs(page<Intake>([]), page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '40.00', ...voided })]));
    renderPointCash();
    const line = screen.getByText(/on voided payouts/);
    const plaque = screen.getByText('Total cash out');
    const lastRow = screen.getByText('Left on balance for us');
    expect(lastRow.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(plaque) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('warns inside the reconciliation when a journal was truncated', () => {
    const hundred = Array.from({ length: 100 }, (_, n) =>
      intake({ id: `i${n}`, code: `KV-${n}`, amount: '1.00' }),
    );
    dayDocs(page<Intake>(hundred, 150), page<Payout>([]));
    renderPointCash();
    expect(
      within(ledger()).getByText('Showing only the first documents — totals are partial'),
    ).toBeInTheDocument();
  });
});

describe('PointCashPage — the owner reopens a closed day (#221, from «Каса за день»)', () => {
  beforeEach(() => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({ pointId: 'p1', canPick: true, setPointId: vi.fn(), isLoading: false });
    shiftMock.mockReturnValue({ data: closedYesterday, isPending: false, isError: false });
    dayDocs(page<Intake>([]), page<Payout>([]));
  });

  it('reopens the shift on screen with the reason given', async () => {
    const user = userEvent.setup();
    renderPointCash('/point-cash?point=p1&date=2026-09-07');

    await user.click(screen.getByRole('button', { name: 'Reopen shift' }));
    await user.type(await screen.findByLabelText('Reason'), 'Closed by mistake');
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    await waitFor(() =>
      expect(reopenMock).toHaveBeenCalledWith({ id: 's0', reason: 'Closed by mistake' }),
    );
  });

  it('reopens the reopen dialog clean after a refusal and a cancel', async () => {
    const user = userEvent.setup();
    reopenMock.mockRejectedValue(new ApiError(409, 'nope', undefined, 'SHIFT_NOT_NEWEST'));
    renderPointCash('/point-cash?point=p1&date=2026-09-07');

    await user.click(screen.getByRole('button', { name: 'Reopen shift' }));
    await user.type(await screen.findByLabelText('Reason'), 'Closed by mistake');
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    const banner = "Only the point's most recent shift can be reopened";
    expect(await screen.findByText(banner)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Reason')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Reopen shift' }));
    expect(await screen.findByLabelText('Reason')).toHaveValue('');
    expect(screen.queryByText(banner)).toBeNull();
  });

  it('offers the operator no reopen on the same closed day', () => {
    meMock.mockReturnValue({ data: OPERATOR });
    pointScopeMock.mockReturnValue({ pointId: 'p1', canPick: false, setPointId: vi.fn(), isLoading: false });
    renderPointCash('/point-cash?date=2026-09-07');

    expect(screen.queryByRole('button', { name: 'Reopen shift' })).toBeNull();
  });
});
