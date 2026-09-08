import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ApiError } from '@/shared/api';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Shift } from '@/entities/shift';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import { DayPage } from './DayPage';

const {
  meMock,
  pointScopeMock,
  shiftMock,
  intakesMock,
  payoutsMock,
  openMock,
  closeMock,
  reopenMock,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  pointScopeMock: vi.fn(),
  shiftMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  openMock: vi.fn(),
  closeMock: vi.fn(),
  reopenMock: vi.fn(),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
  usePointScope: () => pointScopeMock(),
}));

vi.mock('@/entities/shift', () => ({
  useShiftOnDateQuery: (pointId: string | null, date: string) => shiftMock(pointId, date),
}));

vi.mock('@/entities/intake', () => ({
  useIntakesQuery: (filter: unknown) => intakesMock(filter),
}));

vi.mock('@/entities/payout', () => ({
  usePayoutsQuery: (filter: unknown) => payoutsMock(filter),
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

vi.mock('../api/shiftActions', () => ({
  useOpenShiftMutation: () => ({ mutateAsync: openMock, isPending: false }),
  useCloseShiftMutation: () => ({ mutateAsync: closeMock, isPending: false }),
  useReopenShiftMutation: () => ({ mutateAsync: reopenMock, isPending: false }),
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

const openShift: Shift = {
  id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  status: 'open',
  opened_by_user_id: 'u1',
  closed_by_user_id: null,
  closed_at: null,
  created_at: '2026-09-08T05:00:00Z',
};

const closedShift: Shift = {
  ...openShift,
  id: 's0',
  business_date: '2026-09-07',
  status: 'closed',
  closed_by_user_id: 'u1',
  closed_at: '2026-09-07T18:00:00Z',
  created_at: '2026-09-07T05:00:00Z',
};

const intake = (over: Partial<Intake> & Pick<Intake, 'id' | 'code' | 'amount'>): Intake => ({
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 'sup1',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-08T07:10:00Z',
  ...over,
});

const payout = (over: Partial<Payout> & Pick<Payout, 'id' | 'code' | 'amount'>): Payout => ({
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

/** `total` defaults to what was returned; pass a bigger one to stand for a
 *  journal the server truncated at the 100-row limit. */
const page = <T,>(data: T[], total = data.length) => ({
  data: { data, total, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

/** The StatTile that carries `label` — tiles and feed rows share money strings
 *  (the day's single payout IS the «Paid» total), so a bare getByText is ambiguous. */
function tile(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[data-slot="stat-tile"]');
  if (!el) throw new Error(`No stat tile labelled "${label}"`);
  return el as HTMLElement;
}

function renderDay(entry = '/day') {
  const router = createMemoryRouter([{ path: '/day', element: <DayPage /> }], {
    initialEntries: [entry],
  });
  return { ...render(<RouterProvider router={router} />), router };
}

beforeEach(() => {
  // Only Date is faked, so testing-library's waitFor and user-event keep their
  // real timers. «Today» is 2026-09-08 in LOCAL time, which is what todayIso reads.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-08T09:00:00') });
  meMock.mockReset().mockReturnValue({ data: OPERATOR });
  pointScopeMock
    .mockReset()
    .mockReturnValue({ pointId: 'p1', canPick: false, setPointId: vi.fn(), isLoading: false });
  shiftMock.mockReset().mockReturnValue({ data: openShift, isPending: false, isError: false });
  intakesMock.mockReset().mockReturnValue(page<Intake>([]));
  payoutsMock.mockReset().mockReturnValue(page<Payout>([]));
  openMock.mockReset().mockResolvedValue(openShift);
  closeMock.mockReset().mockResolvedValue({ ...openShift, status: 'closed' });
  reopenMock.mockReset().mockResolvedValue({ ...openShift, status: 'open' });
});

afterEach(() => vi.useRealTimers());

describe('DayPage — the operator on an open shift', () => {
  beforeEach(() => {
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '10944.00' }),
        intake({
          id: 'i2',
          code: 'KV-0002',
          amount: '1827.00',
          created_at: '2026-09-08T09:20:00Z',
        }),
        intake({
          id: 'i3',
          code: 'KV-0003',
          amount: '99.00',
          created_at: '2026-09-08T10:00:00Z',
          voided_at: '2026-09-08T10:05:00Z',
          void_reason: 'Wrong supplier',
        }),
      ]),
    );
    payoutsMock.mockReturnValue(
      page<Payout>([payout({ id: 'y1', code: 'VD-0001', amount: '4000.00' })]),
    );
  });

  it('titles the day, totals the live documents and offers only the close action', async () => {
    const { container } = renderDay();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Cash for September 8, 2026' }),
    ).toBeInTheDocument();

    // The voided receipt is out of every total but still on the feed.
    expect(tile('Receipts')).toHaveTextContent('2');
    expect(tile('Accrued')).toHaveTextContent('12,771.00 ₴');
    expect(tile('Paid')).toHaveTextContent('4,000.00 ₴');
    expect(tile('To balance')).toHaveTextContent('8,771.00 ₴');

    expect(screen.getByText('KV-0003')).toBeInTheDocument();
    expect(screen.getByText('voided')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Close shift' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();

    await expectNoAxeViolations(container);
  });

  it('warns that the totals are partial when the server truncated a journal', () => {
    const hundred = Array.from({ length: 100 }, (_, n) =>
      intake({ id: `i${n}`, code: `KV-${n}`, amount: '1.00' }),
    );
    intakesMock.mockReturnValue(page<Intake>(hundred, 150));
    payoutsMock.mockReturnValue(page<Payout>([]));

    renderDay();

    expect(
      screen.getByText('Showing the first 100 documents — totals are partial'),
    ).toBeInTheDocument();
    // The sums stand as they are — a partial total is still the truth about
    // what was read, and inventing the rest would be worse.
    expect(tile('Accrued')).toHaveTextContent('100.00 ₴');
  });

  it('says nothing about truncation when both journals came back whole', () => {
    // The outer describe's 3 intakes + 1 payout all fit under the 100 limit.
    renderDay();
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it('closes the shift by its id, but only after the confirmation', async () => {
    const user = userEvent.setup();
    renderDay();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Close the shift?')).toBeInTheDocument();
    expect(closeMock).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Close shift' }));
    await waitFor(() => expect(closeMock).toHaveBeenCalledWith('s1'));
  });
});

describe('DayPage — the operator before the shift is open', () => {
  beforeEach(() => {
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
  });

  it('says the shift is not opened yet and opens it on demand', async () => {
    const user = userEvent.setup();
    const { container } = renderDay();

    expect(container.querySelector('[data-slot="badge"]')).toHaveTextContent(
      'Shift not opened yet',
    );

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    await waitFor(() => expect(openMock).toHaveBeenCalledTimes(1));
  });

  it('offers nothing while the shift query is still in flight', () => {
    // «No shift» and «not asked yet» look identical in the data; only isPending
    // tells them apart, and an Open button shown on the second one lets an
    // operator open a shift that already exists.
    shiftMock.mockReturnValue({ data: undefined, isPending: true, isError: false });

    const { container } = renderDay();

    expect(container.querySelector('[data-slot="badge"]')).toHaveTextContent('Loading…');
    expect(screen.queryByText('Shift not opened yet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close shift' })).toBeNull();
  });
});

describe('DayPage — the date in the URL', () => {
  it('ignores a date that is shaped right but is not a real day', () => {
    // `isIsoDate` only checks the shape: 2026-02-31 would roll the title over to
    // 3 March while the query still asked for the 31st of February.
    renderDay('/day?date=2026-02-31');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Cash for September 8, 2026' }),
    ).toBeInTheDocument();
    expect(shiftMock).toHaveBeenCalledWith('p1', '2026-09-08');
  });

  it('ignores a date no calendar can even parse', () => {
    // These reach `Intl` as an Invalid Date and throw a RangeError into the
    // route error boundary — a blank screen from one hand-edited query param.
    renderDay('/day?date=2026-00-10');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Cash for September 8, 2026' }),
    ).toBeInTheDocument();
    expect(shiftMock).toHaveBeenCalledWith('p1', '2026-09-08');
  });
});

describe('DayPage — the owner', () => {
  beforeEach(() => {
    meMock.mockReturnValue({ data: OWNER });
  });

  it('asks for a point before reading anything, and picks one from the toolbar', () => {
    pointScopeMock.mockReturnValue({
      pointId: null,
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    shiftMock.mockReturnValue({ data: undefined, isPending: false, isError: false });

    renderDay();

    expect(screen.getByLabelText('Select a point')).toBeInTheDocument();
    // The empty state, not the select's own placeholder option.
    expect(screen.getByText('Select a point', { selector: 'div' })).toBeInTheDocument();
    // Nothing was asked for: no point on either journal filter, and no tiles.
    expect(shiftMock).toHaveBeenCalledWith(null, '2026-09-08');
    expect(intakesMock).toHaveBeenCalledWith({ shiftId: undefined });
    expect(screen.queryByText('Accrued')).toBeNull();
  });

  it('reopens a closed past day and can step back to today', async () => {
    const user = userEvent.setup();
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    shiftMock.mockReturnValue({ data: closedShift, isPending: false, isError: false });

    const { router, container } = renderDay('/day?point=p1&date=2026-09-07');

    expect(
      screen.getByRole('heading', { level: 1, name: 'Cash for September 7, 2026' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen shift' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close shift' })).toBeNull();
    // Yesterday, so stepping forward is allowed.
    expect(screen.getByRole('button', { name: 'Наступний день' })).toBeEnabled();

    // The owner's own toolbar — the point picker carries only an aria-label.
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('date')).toBeNull(),
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Cash for September 8, 2026' }),
    ).toBeInTheDocument();
    // The point survives the date reset — the URL is the shared link.
    expect(new URLSearchParams(router.state.location.search).get('point')).toBe('p1');
  });

  it('reopens the reopen dialog clean after a refusal and a cancel', async () => {
    const user = userEvent.setup();
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });
    shiftMock.mockReturnValue({ data: closedShift, isPending: false, isError: false });
    reopenMock.mockRejectedValue(new ApiError(409, 'nope', undefined, 'SHIFT_NOT_NEWEST'));

    renderDay('/day?point=p1&date=2026-09-07');

    await user.click(screen.getByRole('button', { name: 'Reopen shift' }));
    await user.type(await screen.findByLabelText('Reason'), 'Closed by mistake');
    await user.click(screen.getByRole('button', { name: 'Reopen' }));

    const banner = "Only the point's most recent shift can be reopened";
    expect(await screen.findByText(banner)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByLabelText('Reason')).toBeNull());

    // Second open: a fresh dialog, not the refused one with its text still in it.
    await user.click(screen.getByRole('button', { name: 'Reopen shift' }));
    expect(await screen.findByLabelText('Reason')).toHaveValue('');
    expect(screen.queryByText(banner)).toBeNull();
  });
});
