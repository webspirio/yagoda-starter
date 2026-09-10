import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import type { CashCount } from '@/entities/cash-count';
import type { Payout } from '@/entities/payout';
import type { PointCashRow, PointCashOne } from '@/entities/point-cash';
import { PointCashPage } from './PointCashPage';

const {
  meMock,
  pointScopeMock,
  pointCashOneMock,
  pointCashListMock,
  intakesMock,
  payoutsMock,
  ledgerTransfersMock,
  cashCountsMock,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  pointScopeMock: vi.fn(),
  pointCashOneMock: vi.fn(),
  pointCashListMock: vi.fn(),
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
  usePointOptionsQuery: () => ({
    data: [
      { id: 'p1', name: 'Shypynky' },
      { id: 'p2', name: 'Haiove' },
    ],
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/entities/point-cash', () => ({
  usePointCashForPointQuery: (pointId: string | null, asOf?: string) =>
    pointCashOneMock(pointId, asOf),
  usePointCashQuery: (opts: unknown) => pointCashListMock(opts),
}));

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

const single = (data: PointCashOne | undefined, over: Partial<{ isPending: boolean; isError: boolean }> = {}) => ({
  data,
  isPending: false,
  isError: false,
  ...over,
});

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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-08T09:00:00') });
  meMock.mockReset().mockReturnValue({ data: OPERATOR });
  pointScopeMock
    .mockReset()
    .mockReturnValue({ pointId: 'p1', canPick: false, setPointId: vi.fn(), isLoading: false });
  pointCashOneMock
    .mockReset()
    .mockReturnValue(single({ collection_point_id: 'p1', cash: '1000.00' }));
  pointCashListMock.mockReset().mockReturnValue(list([pointRow()]));
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

  it('says nothing when the payouts read came back whole', () => {
    renderPointCash();
    expect(screen.queryByText(/older ones may be missing/i)).toBeNull();
  });
});

describe('PointCashPage — honesty rule 2: zero counts read 0.00 and say so', () => {
  it('says the drawer was never counted instead of printing a bare 0.00', async () => {
    cashCountsMock.mockReturnValue(list([]));
    pointCashOneMock.mockReturnValue(single({ collection_point_id: 'p1', cash: '0.00' }));

    renderPointCash();

    expect(await screen.findByText(/ще не рахована|never counted/i)).toBeInTheDocument();
  });

  it('says nothing extra once the point has an actual count history', () => {
    renderPointCash();
    expect(screen.queryByText(/never counted/i)).toBeNull();
  });
});

describe('PointCashPage — honesty rule 3: null target/shortfall render «—», never 0', () => {
  it('shows «—» for a point with no target', () => {
    pointCashListMock.mockReturnValue(list([pointRow({ target_cash: null })]));
    renderPointCash();
    expect(tile('Target')).toHaveTextContent('—');
  });

  it('shows «—» for a point with no shortfall to compare against', () => {
    pointCashListMock.mockReturnValue(list([pointRow({ shortfall: null })]));
    renderPointCash();
    expect(tile('Short of target')).toHaveTextContent('—');
  });

  it('prints an actual shortfall amount when one exists', () => {
    pointCashListMock.mockReturnValue(list([pointRow({ shortfall: '250.00' })]));
    renderPointCash();
    expect(tile('Short of target')).toHaveTextContent('250.00 ₴');
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
  it('asks the owner to pick a point before reading anything', () => {
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
    expect(pointCashOneMock).toHaveBeenCalledWith(null, '2026-09-08');
  });

  it('shows the error state rather than a quiet zero when the cash read fails', () => {
    pointCashOneMock.mockReturnValue(single(undefined, { isError: true }));

    renderPointCash();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('0.00 ₴')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = renderPointCash();
    await expectNoAxeViolations(container);
  });
});
