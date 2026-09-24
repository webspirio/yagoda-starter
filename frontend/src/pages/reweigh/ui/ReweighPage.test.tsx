import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { AxeResults } from 'axe-core';
import { ApiError } from '@/shared/api';
import type { PointOption } from '@/entities/collection-point';
import type { ReconciliationGrade } from '@/entities/reweigh';
import { ReweighPage } from './ReweighPage';

const {
  workingPointMock,
  pointsMock,
  shiftMock,
  reweighMock,
  addMock,
  voidMock,
  tareMock,
  staffMock,
  dayReweighsMock,
  setDateMock,
  setPointMock,
  initialPointIdRef,
  toastErrorMock,
} = vi.hoisted(() => ({
  workingPointMock: vi.fn(),
  pointsMock: vi.fn(),
  shiftMock: vi.fn(),
  reweighMock: vi.fn(),
  addMock: vi.fn(),
  voidMock: vi.fn(),
  tareMock: vi.fn(),
  staffMock: vi.fn(),
  dayReweighsMock: vi.fn(),
  setDateMock: vi.fn(),
  setPointMock: vi.fn(),
  // What `useWorkingPoint()` resolves to on a component's FIRST render, as
  // if nothing had ever been picked or remembered — `'p1'` (a reception
  // point) by default, overridden per-test (e.g. to a base point's id) to
  // simulate a genuinely fresh owner session. Read once, at mount, by the
  // `useState` initializer below — changing it mid-test does nothing, same
  // as the real hook.
  initialPointIdRef: { current: 'p1' as string | null },
  toastErrorMock: vi.fn(),
}));

// The post's failure toast is the ONLY place the refusal's cause reaches the
// owner — sonner renders into a portal no `<Toaster />` in this file mounts,
// so the sentence is unobservable unless the module is spied on.
vi.mock('@/shared/ui/toast', () => ({
  toast: {
    error: (message: unknown, options?: { description?: string }) =>
      toastErrorMock(message, options),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// A REAL `useState`, not a static return: test 5 needs the picked point to
// actually flow back through the component so the (date, point) clearing
// effect sees it change. `setPointMock` still records every call, which is
// what the "date only" test asserts against.
vi.mock('@/features/point-scope', () => ({
  useWorkingPoint: () => {
    workingPointMock();
    const [pointId, setPointIdState] = useState<string | null>(initialPointIdRef.current);
    return {
      pointId,
      canPick: true,
      setPointId: (id: string | null) => {
        setPointMock(id);
        setPointIdState(id);
      },
      isLoading: false,
    };
  },
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => pointsMock(),
}));

vi.mock('@/shared/lib/url-state', () => ({
  useUrlParam: () => [null, setDateMock],
}));

vi.mock('@/entities/shift', () => ({
  useShiftOnDateQuery: (pointId: string | null, date: string) => shiftMock(pointId, date),
}));

vi.mock('@/entities/reweigh', () => ({
  useReweighQuery: (shiftId: string | undefined) => reweighMock(shiftId),
  useAddReweighItemMutation: () => ({ mutateAsync: addMock, isPending: false }),
  useVoidReweighItemMutation: () => ({ mutateAsync: voidMock, isPending: false }),
}));

vi.mock('@/entities/tare-type', () => ({
  useTareTypeOptionsQuery: () => tareMock(),
}));

vi.mock('@/entities/user', () => ({
  useStaffQuery: (enabled: boolean) => staffMock(enabled),
}));

vi.mock('../api/useDayReweighs', () => ({
  useDayReweighs: (points: PointOption[], date: string) => dayReweighsMock(points, date),
}));

const POINTS: PointOption[] = [
  { id: 'p1', name: 'Шипинки', kind: 'reception', target_crates: null },
  { id: 'p2', name: 'Гайове', kind: 'reception', target_crates: null },
];

// §4.8's склад — `useWorkingPoint()`'s own first-visit default for a money
// screen in general, and NOT an option this screen's reception-only picker
// ever lists.
const BASE_POINT: PointOption = {
  id: 'base1',
  name: 'Байківці (база)',
  kind: 'base',
  target_crates: null,
};

const GRADES: ReconciliationGrade[] = [
  {
    product_grade_id: 'g1',
    product_grade_name: 'Малина 1',
    product_id: 'prod1',
    product_name: 'Малина',
    intake_net_kg: '200.00',
    reweigh_net_kg: '0.00',
  },
  {
    product_grade_id: 'g2',
    product_grade_name: 'Малина 3',
    product_id: 'prod1',
    product_name: 'Малина',
    intake_net_kg: '100.00',
    reweigh_net_kg: '0.00',
  },
];

const OPEN_SHIFT = {
  id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-09-21',
  status: 'open' as const,
  opened_by_user_id: 'u1',
  closed_by_user_id: null,
  closed_at: null,
  created_at: '2026-09-21T05:00:00Z',
  explanation: null,
  broken_crates: null,
};

/** Types the given decimal string, padding a bare integer to two places so a
 *  short test fixture like `'100'` matches the server's `'100.00'` exactly —
 *  `WeighingForm` never reformats the raw text itself, only the parsed value
 *  it computes from it. */
function toKgInput(value: string): string {
  return value.includes('.') ? value : `${value}.00`;
}

/** Drives `WeighingForm` exactly as the owner would: gross weight, an
 *  optional crate count (against the catalogue's default tare type, `t1`),
 *  a grade, then «Додати позицію». */
async function addDraft({
  gross,
  grade,
  crates,
}: {
  gross: string;
  grade: string;
  crates?: number;
}) {
  await userEvent.type(screen.getByLabelText(/gross|вага з ягодою/i), toKgInput(gross));
  if (crates !== undefined) {
    await userEvent.clear(screen.getByLabelText(/crates|кількість ящиків/i));
    await userEvent.type(screen.getByLabelText(/crates|кількість ящиків/i), String(crates));
  }
  await userEvent.selectOptions(screen.getByLabelText(/grade|сорт/i), grade);
  await userEvent.click(screen.getByRole('button', { name: /add position|додати позицію/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-21T09:00:00') });
  initialPointIdRef.current = 'p1';

  pointsMock.mockReturnValue({ data: POINTS, isPending: false, isError: false });
  shiftMock.mockReturnValue({ data: OPEN_SHIFT, isPending: false, isError: false });
  reweighMock.mockReturnValue({
    data: {
      shift_id: 's1',
      closed_at: null,
      accepted_anything: true,
      items: [],
      products: [],
      grades: GRADES,
    },
    isPending: false,
    isError: false,
  });
  addMock.mockResolvedValue({ id: 'ri1' });
  voidMock.mockResolvedValue({ id: 'ri1' });
  tareMock.mockReturnValue({
    data: [
      { id: 't1', name: 'Ящик', weight_kg: '1.20' },
      { id: 't2', name: 'Диб', weight_kg: '2.50' },
    ],
    isPending: false,
  });
  staffMock.mockReturnValue({ data: new Map(), isPending: false, isError: false });
  dayReweighsMock.mockReturnValue({ lines: [], isPending: false, isError: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReweighPage', () => {
  it('says the shift was never opened, and offers no form', () => {
    shiftMock.mockReturnValue({ data: null, isPending: false });
    render(<ReweighPage />);
    expect(screen.getByText(/never opened|не відкривали/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add position|додати позицію/i })).toBeDisabled();
  });

  /**
   * THE READ-FAILURE SPLIT. `shift.data` and `accepted_anything` are equally
   * undefined whether the server said "no shift" or never answered at all —
   * so before this branch existed, a 500 was reported to the owner as a
   * business fact about their own day: «зміну не відкривали», or «нічого не
   * приймали. Перевірте пункт і дату» — the screen telling them to check a
   * point and a date that were never the problem. `pages/day`, `pages/crates`
   * and `useNetworkToday` all already draw this line; the reweigh screen
   * dropped it in the port.
   */
  it('reports a failed shift read as a failure, not as a shift nobody opened', () => {
    shiftMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ReweighPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/never opened|не відкривали/i)).not.toBeInTheDocument();
  });

  it('reports a failed reconciliation read as a failure, not as a day nobody bought on', () => {
    reweighMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ReweighPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/nothing was accepted|нічого не приймали/i)).not.toBeInTheDocument();
  });

  /**
   * The same conflation one query EARLIER, and the nastiest of the set: the
   * points read feeds `pointId`, and a failed read leaves it `null`, which
   * DISABLES both reads below it. So `shift` and `reweigh` never run, never
   * error, and the screen answers §6.1 about a point it cannot even name —
   * «Зміну за 21.09.2026 на **** не відкривали» — permanently, because a
   * failed query does not retry itself into existence.
   */
  it('reports a failed points read as a failure, not as a shift nobody opened', () => {
    pointsMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<ReweighPage />);
    // `getAllBy`, not `getBy`: the main grid and the day table each own their
    // own alert and BOTH are meant to fire here — the table sits outside the
    // grid's failure branch, so a single-alert assertion would quietly pass
    // if only one of the two ever learned about the failure.
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.queryByText(/never opened|не відкривали/i)).not.toBeInTheDocument();
  });

  /**
   * And the day table, which sits outside the main grid's failure branch and
   * so has to be told separately. `useDayReweighs([])` fans out to no queries
   * at all and honestly reports "not pending, not failed, no lines" — which
   * `DayLines` renders as the empty-day sentence unless the points read's own
   * failure is passed down.
   */
  it('does not tell the owner the day was empty when the points read failed', () => {
    pointsMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    dayReweighsMock.mockReturnValue({ lines: [], isPending: false, isError: false });
    render(<ReweighPage />);
    expect(screen.queryByText(/no reweighs|переважувань за цей день ще немає/i)).not.toBeInTheDocument();
  });

  /**
   * The same conflation one step earlier: on first paint the shift read is
   * still in flight, and «зміну не відкривали» is an answer the server has
   * not given yet.
   */
  it('waits for the shift read rather than answering §6.1 from an empty cache', () => {
    shiftMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<ReweighPage />);
    expect(screen.queryByText(/never opened|не відкривали/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  /**
   * A DISABLED query reports `isPending: true` forever in TanStack — the
   * reconciliation read is `enabled: shiftId !== undefined`. Gating the
   * screen on it bare would park the genuine "no shift" case on a spinner
   * that never resolves, hiding §6.1's copy behind a permanent load.
   */
  it('still answers §6.1 when there is no shift, though the disabled read never settles', () => {
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
    reweighMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<ReweighPage />);
    expect(screen.getByText(/never opened|не відкривали/i)).toBeInTheDocument();
  });

  it('posts each draft as its own line, in the order they were entered', async () => {
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1' });
    await addDraft({ gross: '50', grade: 'g2' });
    await userEvent.click(screen.getByRole('button', { name: /post|провести/i }));

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(2));
    expect(addMock.mock.calls[0][0]).toMatchObject({
      shiftId: 's1',
      gross_kg: '100.00',
      product_grade_id: 'g1',
    });
    expect(addMock.mock.calls[1][0]).toMatchObject({
      shiftId: 's1',
      gross_kg: '50.00',
      product_grade_id: 'g2',
    });
  });

  it('never sends a net or tare weight it computed itself', async () => {
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1', crates: 10 });
    await userEvent.click(screen.getByRole('button', { name: /post|провести/i }));

    await waitFor(() => expect(addMock).toHaveBeenCalled());
    expect(addMock.mock.calls[0][0]).not.toHaveProperty('net_kg');
    expect(addMock.mock.calls[0][0]).not.toHaveProperty('tare_weight_kg');
    expect(addMock.mock.calls[0][0].tare).toEqual([{ tare_type_id: 't1', units: 10 }]);
  });

  /**
   * The brief's own reference mechanism (`getAllByRole('listitem')`
   * document-wide) is fragile — DayLines or Reconciliation could grow a list
   * of their own later and this would start counting the wrong rows without
   * a single assertion here changing. `DraftLines` renders the ONLY `<ul>`
   * on this page (DayLines and Reconciliation are both `<table>`s), so
   * scoping to `getByRole('list')` names the thing under test instead of
   * counting page-wide.
   */
  it('stops at the first refusal and keeps every unposted line on screen', async () => {
    addMock
      .mockResolvedValueOnce({ id: 'ri1' })
      .mockRejectedValueOnce(new ApiError(400, 'no', undefined, 'NET_NOT_POSITIVE'));
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1' });
    await addDraft({ gross: '50', grade: 'g2' });
    await addDraft({ gross: '25', grade: 'g1' });
    await userEvent.click(screen.getByRole('button', { name: /post|провести/i }));

    await waitFor(() => expect(addMock).toHaveBeenCalledTimes(2));
    // the posted one is gone, the refused one and the one behind it remain,
    // plus the "our total" row DraftLines always appends.
    const draftList = screen.getByRole('list');
    expect(within(draftList).getAllByRole('listitem')).toHaveLength(2 + 1);
  });

  /**
   * §6.4 promises the toast carries the backend's OWN code. Before the five
   * reweigh codes reached `CODE`, every refusal fell through to the post
   * path's then-fallback `reweigh.day.errors.failed` — «Позицію не
   * сторновано», *the line was not voided*: a failed WRITE described to the
   * owner as a failed STORNO, with no cause named. This matters most in the
   * §3.1 case the screen accepts the cost of — a refusal partway through a
   * batch — where the owner has to know WHICH rule refused before deciding
   * what to do with the lines still on screen.
   */
  it('names the rule that refused the post, and never calls it a failed storno', async () => {
    addMock.mockRejectedValueOnce(new ApiError(400, 'no', undefined, 'GRADE_NOT_ACCEPTED'));
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1' });
    await userEvent.click(screen.getByRole('button', { name: /post|провести/i }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    const description = toastErrorMock.mock.calls[0][1]?.description as string;
    expect(description).toMatch(/not accepted|не приймали/i);
    expect(description).not.toMatch(/сторновано|was not voided/i);
  });

  it('clears the drafts when the point changes — they belonged to another day', async () => {
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1' });
    await userEvent.selectOptions(screen.getByLabelText(/point|пункт/i), 'p2');
    expect(screen.getByText(/no positions yet|позицій ще немає/i)).toBeInTheDocument();
  });

  /**
   * §4.8 — `useWorkingPoint()`'s own default prefers the BASE, and it is the
   * first-visit answer, not an edge case: a genuinely fresh owner session
   * (no `?point=`, nothing remembered) lands there. This screen's picker
   * lists reception points only, so left uncorrected the `<select>` would
   * show no matching option while the shift/banner still read off the base
   * — a blank picker beside a status message naming a point the dropdown
   * never offered. `pointId` in `ReweighPage` corrects a resolved id absent
   * from `receptionPoints` to the network's first reception point instead.
   */
  it('falls back to a reception point when the default lands on the base', () => {
    initialPointIdRef.current = BASE_POINT.id;
    pointsMock.mockReturnValue({ data: [BASE_POINT, ...POINTS], isPending: false, isError: false });

    render(<ReweighPage />);

    expect(screen.queryByText(BASE_POINT.name)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/point|пункт/i)).toHaveValue('p1');
    // The shift query itself follows the correction — not just the label —
    // so the screen never fetches "the base's shift for today" behind a
    // picker that shows a reception point.
    expect(shiftMock).toHaveBeenCalledWith('p1', '2026-09-21');
  });

  it('keeps the date out of everyone else’s working day', async () => {
    render(<ReweighPage />);
    await userEvent.click(screen.getByRole('button', { name: /previous day|попередній день/i }));
    expect(setPointMock).not.toHaveBeenCalled();
    // the date moved in the URL only
    expect(setDateMock).toHaveBeenCalledWith('2026-09-20');
  });

  /**
   * NOT `expectNoAxeViolations` (the usual helper, `CratesPage.test.tsx`'s
   * pattern) — kept as a local, explicit axe call rather than switching
   * helpers in a fix round whose only authorised edit is this assertion.
   *
   * Previously carved out exactly one `empty-table-header` violation:
   * `DayLines.tsx`'s void-button column header rendered empty. Task 11's fix
   * round gave that header an `sr-only` label (`reweigh.day.actionHeader`),
   * so the carve-out's own condition — "if DayLines gains a label for that
   * column" — is now true, and the assertion tightens to zero violations,
   * exactly what `expectNoAxeViolations` would require. Recorded 2026-09-21.
   */
  it('has no accessibility violations', async () => {
    const { container } = render(<ReweighPage />);
    const results = (await axe(container, {
      rules: { 'color-contrast': { enabled: false } },
    })) as AxeResults;

    expect(
      results.violations,
      results.violations.map((v) => `[${v.impact}] ${v.id}: ${v.help}`).join('\n'),
    ).toEqual([]);
  });
});
