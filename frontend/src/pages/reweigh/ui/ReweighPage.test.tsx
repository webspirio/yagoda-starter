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
}));

// A REAL `useState`, not a static return: test 5 needs the picked point to
// actually flow back through the component so the (date, point) clearing
// effect sees it change. `setPointMock` still records every call, which is
// what the "date only" test asserts against.
vi.mock('@/features/point-scope', () => ({
  useWorkingPoint: () => {
    workingPointMock();
    const [pointId, setPointIdState] = useState<string | null>('p1');
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
 *  a grade, then «another position». */
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
  await userEvent.click(screen.getByRole('button', { name: /another position|ще позиція/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-21T09:00:00') });

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
  dayReweighsMock.mockReturnValue({ lines: [], isPending: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReweighPage', () => {
  it('says the shift was never opened, and offers no form', () => {
    shiftMock.mockReturnValue({ data: null, isPending: false });
    render(<ReweighPage />);
    expect(screen.getByText(/never opened|не відкривали/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /another position|ще позиція/i })).toBeDisabled();
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

  it('clears the drafts when the point changes — they belonged to another day', async () => {
    render(<ReweighPage />);
    await addDraft({ gross: '100', grade: 'g1' });
    await userEvent.selectOptions(screen.getByLabelText(/point|пункт/i), 'p2');
    expect(screen.getByText(/no positions yet|позицій ще немає/i)).toBeInTheDocument();
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
   * pattern) — axe over the fully composed page surfaces ONE real violation
   * that pre-dates this task: `DayLines.tsx` (Task 11, reviewed and on this
   * branch already, out of this task's file list) renders an empty
   * `<TableHead scope="col" />` for its void-button column, and
   * `empty-table-header` (minor) fires on it regardless of anything this
   * page itself does. This task's brief is explicit that a violation
   * originating in an earlier task's component gets REPORTED, not silently
   * fixed here — so this test names the one known node instead of either
   * hiding it (a blanket rule-disable) or leaving the whole suite red for a
   * component this task does not own.
   *
   * The carve-out is NARROW and self-cancelling: it accepts exactly one
   * `empty-table-header` violation, on exactly one node. If DayLines gains a
   * label for that column, `known` becomes `[]` and `toHaveLength(1)` below
   * fails — forcing this comment and the filter to be deleted, not left to
   * rot. If a SECOND empty header appears anywhere else on the page, the
   * same assertion fails just as loudly. Every other rule, and every other
   * node, is held to zero violations exactly as `expectNoAxeViolations`
   * would. Recorded 2026-09-21.
   */
  it('has no accessibility violations beyond the one already on DayLines (Task 11)', async () => {
    const { container } = render(<ReweighPage />);
    const results = (await axe(container, {
      rules: { 'color-contrast': { enabled: false } },
    })) as AxeResults;

    const known = results.violations.filter((v) => v.id === 'empty-table-header');
    const other = results.violations.filter((v) => v.id !== 'empty-table-header');

    expect(known).toHaveLength(1);
    expect(known[0]?.nodes).toHaveLength(1);
    expect(
      other,
      other.map((v) => `[${v.impact}] ${v.id}: ${v.help}`).join('\n'),
    ).toEqual([]);
  });
});

