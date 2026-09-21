import { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@/shared/api';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Shift } from '@/entities/shift';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import { DayPage } from './DayPage';

// Matches the CountDrawerDialog's submit button whether i18n has resolved it
// yet (raw key), is showing the Ukrainian copy, or — the state once Task 5's
// strings land — the English one this suite's locale actually renders.
const SUBMIT_COUNT = /day\.count\.submit|Записати|Record/i;

const {
  meMock,
  pointScopeMock,
  shiftMock,
  intakesMock,
  payoutsMock,
  suppliersMock,
  openMock,
  closeMock,
  reopenMock,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  pointScopeMock: vi.fn(),
  shiftMock: vi.fn(),
  intakesMock: vi.fn(),
  payoutsMock: vi.fn(),
  suppliersMock: vi.fn(),
  openMock: vi.fn(),
  closeMock: vi.fn(),
  reopenMock: vi.fn(),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

vi.mock('@/features/point-scope', () => ({
  useWorkingPoint: () => pointScopeMock(),
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

vi.mock('@/entities/supplier', () => ({
  useSuppliersQuery: (search: string, pointId: string | null) => suppliersMock(search, pointId),
  supplierName: (s: { first_name: string; last_name: string }) =>
    `${s.first_name} ${s.last_name}`,
}));

vi.mock('@/widgets/receipt', () => ({
  ReceiptDialog: ({ intakeId, open }: { intakeId: string | null; open: boolean }) =>
    open ? <div>Receipt for {intakeId}</div> : null,
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
  useReopenShiftMutation: () => ({ mutateAsync: reopenMock, isPending: false }),
}));

// Only the two mutation hooks are stubbed — `CountDrawerDialog` (the real
// component, re-exported by this same module) still renders for real, since
// the open/close tests below drive it exactly as an operator would.
vi.mock('@/features/count-shift', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/count-shift')>();
  return {
    ...actual,
    useOpenShiftMutation: () => ({ mutateAsync: openMock, isPending: false }),
    useCloseShiftMutation: () => ({ mutateAsync: closeMock, isPending: false }),
  };
});

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
  explanation: null,
  broken_crates: null,
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

/** The close dialog's two fields. `getByRole('textbox')` is ambiguous there
 *  since #110 added §6.8's breakage beside the drawer count. */
const drawerBox = (dialog: HTMLElement) =>
  within(dialog).getByRole('textbox', { name: /drawer|amount/i });
const breakageBox = (dialog: HTMLElement) =>
  within(dialog).getByRole('textbox', { name: /broken/i });

function renderDay(entry = '/day') {
  const router = createMemoryRouter([{ path: '/day', element: <DayPage /> }], {
    initialEntries: [entry],
  });
  // The real `CountDrawerDialog` renders here (see the mock note above), and
  // since #110 it reads §6.8's «з ягодою» through TanStack Query. No adapter is
  // installed, so that read FAILS — deliberately: these tests assert the close
  // still works when it does.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    router,
  };
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

  it('closes the shift with the counted drawer amount, but only once it is recorded', async () => {
    const user = userEvent.setup();
    renderDay();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    const dialog = await screen.findByRole('dialog');
    expect(closeMock).not.toHaveBeenCalled();

    await user.type(drawerBox(dialog), '980.40');
    await user.type(breakageBox(dialog), '3');
    await user.click(within(dialog).getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() =>
      expect(closeMock).toHaveBeenCalledWith({
        id: 's1',
        counted_amount: '980.40',
        broken_crates: 3,
      }),
    );
  });

  it('opens the close dialog with the close copy', async () => {
    // CountDrawerDialog.test.tsx already covers the title switching on
    // `mode`; what belongs to THIS page is that its close click wires the
    // dialog to close mode at all — proven here by the body sentence that is
    // unique to close mode (day.count.closeBody), which also covers 1.4's
    // restored warning that the day locks and only the owner can reopen it.
    const user = userEvent.setup();
    renderDay();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/only the owner can reopen it/),
    ).toBeInTheDocument();
  });

  it('closes the count dialog once the close is recorded', async () => {
    const user = userEvent.setup();
    renderDay();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(drawerBox(dialog), '980.40');
    await user.type(breakageBox(dialog), '0');
    await user.click(within(dialog).getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes the shift it was opened for, even if the query has since gone empty', async () => {
    // Pins what ad72a39 actually changed: the close click now captures the
    // shift id into `countTarget` on click, not read back off `shift.data`
    // at submit time — so a refetch that lands under the still-open dialog
    // can't turn its submit into the old `if (!id) return` silent no-op.
    //
    // A same-URL `replace` navigation (rather than `rerender`) is what
    // actually pushes the new mocked shift value down to DayPage here:
    // react-router's RouterProvider memoizes its rendered route tree on its
    // own internal `state`, so re-passing the identical `router` object
    // with an unchanged location is a no-op for it — only a fresh
    // `state.location` (which `navigate` produces even for a same-path,
    // `replace: true` call) forces the remount-free re-render this test needs.
    const user = userEvent.setup();
    let current: Shift | null = openShift;
    shiftMock.mockImplementation(() => ({ data: current, isPending: false, isError: false }));

    const { router } = renderDay();
    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    const dialog = await screen.findByRole('dialog');

    current = null; // the shift query refetched to nothing
    await act(async () => {
      router.navigate(router.state.location.pathname + router.state.location.search, {
        replace: true,
      });
    }); // …and the page re-rendered under the still-open dialog

    await user.type(drawerBox(dialog), '980.40');
    await user.type(breakageBox(dialog), '0');
    await user.click(within(dialog).getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() =>
      expect(closeMock).toHaveBeenCalledWith({
        id: 's1',
        counted_amount: '980.40',
        broken_crates: 0,
      }),
    );
  });

  it('keeps its dialogs on distinct React keys, so a remount never strands the old one', async () => {
    // Both remount counters start at 0. A bare numeric key on each put two
    // siblings on key "0" — React reports it, and after the first bump the
    // closed count dialog was reconciled away without ever being unmounted,
    // leaving its form and i18n subscriptions alive.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    renderDay();

    await user.click(screen.getByRole('button', { name: 'Close shift' }));
    await screen.findByRole('dialog');

    const duplicateKey = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes('same key'),
    );
    consoleError.mockRestore();
    expect(duplicateKey).toEqual([]);
  });

  it('opens the receipt for an intake row, but a payout row stays non-clickable', async () => {
    const user = userEvent.setup();
    renderDay();

    expect(screen.queryByText('Receipt for i1')).toBeNull();
    await user.click(screen.getByRole('button', { name: /KV-0001/ }));
    expect(screen.getByText('Receipt for i1')).toBeInTheDocument();

    // The payout row carries no button at all — the spec has no document view for it.
    expect(screen.queryByRole('button', { name: /VD-0001/ })).toBeNull();
  });

  it("shows every feed row's supplier name, intake and payout alike", () => {
    renderDay();

    const intakeRow = screen.getByText('KV-0001').closest('li');
    const payoutRow = screen.getByText('VD-0001').closest('li');
    expect(within(intakeRow!).getByText('Iryna Kovalenko')).toBeInTheDocument();
    expect(within(payoutRow!).getByText('Iryna Kovalenko')).toBeInTheDocument();
  });

  it('renders a voided row\'s reason as visible text, not only a title attribute', () => {
    renderDay();

    expect(screen.getByText('Voided: Wrong supplier')).toBeInTheDocument();
  });
});

describe('DayPage — the operator before the shift is open', () => {
  beforeEach(() => {
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
  });

  it('says the shift is not opened yet and opens it with the counted drawer amount', async () => {
    const user = userEvent.setup();
    const { container } = renderDay();

    expect(container.querySelector('[data-slot="badge"]')).toHaveTextContent(
      'Shift not opened yet',
    );

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), '1500.00');
    await user.click(within(dialog).getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith({ counted_amount: '1500.00' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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

describe('DayPage — a failed read', () => {
  it('shows the error state and hides the Open action when the shift query fails', () => {
    shiftMock.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderDay();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });
});

describe('DayPage — the To-balance tile tone', () => {
  it('stays the default tone when nothing is owed', () => {
    renderDay();

    const value = within(tile('To balance')).getByText('0.00 ₴');
    expect(value.className).not.toContain('amber');
  });

  it('turns amber once a balance is owed', () => {
    intakesMock.mockReturnValue(
      page<Intake>([intake({ id: 'i1', code: 'KV-0001', amount: '10.00' })]),
    );

    renderDay();

    const value = within(tile('To balance')).getByText('10.00 ₴');
    expect(value.className).toContain('amber');
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

// §6.8's «бій» is recorded at close and, until #110, was readable nowhere in the
// product — a mistyped 30-for-3 survived only in audit_log. These four pin the
// NULL/0 distinction on the READ side, where it is easiest to lose: `??` or a
// falsy check here would render «нічого не побилось» as «не записано».
describe("DayPage — §6.8's recorded breakage on a closed shift", () => {
  it('shows the number that was recorded at close', () => {
    shiftMock.mockReturnValue({
      data: { ...closedShift, broken_crates: 3 },
      isPending: false,
      isError: false,
    });

    renderDay('/day?point=p1&date=2026-09-07');

    expect(screen.getByText('Broken: 3')).toBeInTheDocument();
  });

  it('shows a recorded 0 as 0, never as a dash', () => {
    shiftMock.mockReturnValue({
      data: { ...closedShift, broken_crates: 0 },
      isPending: false,
      isError: false,
    });

    renderDay('/day?point=p1&date=2026-09-07');

    expect(screen.getByText('Broken: 0')).toBeInTheDocument();
  });

  it('shows a dash when the close predates the column', () => {
    shiftMock.mockReturnValue({
      data: { ...closedShift, broken_crates: null },
      isPending: false,
      isError: false,
    });

    renderDay('/day?point=p1&date=2026-09-07');

    expect(screen.getByText('Broken: —')).toBeInTheDocument();
  });

  it('shows nothing while the shift is still open', () => {
    renderDay('/day?point=p1');

    expect(screen.queryByText(/^Broken:/)).toBeNull();
  });
});
