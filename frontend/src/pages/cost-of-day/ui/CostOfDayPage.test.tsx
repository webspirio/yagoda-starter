import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '@/shared/lib/i18n';
import { CostOfDayPage } from './CostOfDayPage';

// Every assertion below is the Ukrainian copy the page's own t() calls
// produce, but `test-setup.ts` defaults the active i18n language to 'en' for
// the whole suite (see `BerryTable.test.tsx` for the same convention). Set it
// here for this file only, and reset it afterwards so it never leaks into a
// later file's "runs in ENGLISH" assumption.
beforeAll(async () => {
  await i18n.changeLanguage('uk');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

const { workingPointMock, pointsMock, shiftMock, dayMock, expensesMock, setDateMock } =
  vi.hoisted(() => ({
    workingPointMock: vi.fn(),
    pointsMock: vi.fn(),
    shiftMock: vi.fn(),
    dayMock: vi.fn(),
    expensesMock: vi.fn(),
    setDateMock: vi.fn(),
  }));

// `useUrlParam` reads react-router's search params, so without this stub the
// page cannot mount outside a Router at all. `null` means «no ?date=», which
// the page clamps to today — the date stepper is not what these tests drive.
vi.mock('@/shared/lib/url-state', () => ({ useUrlParam: () => [null, setDateMock] }));
vi.mock('@/features/point-scope', () => ({ useWorkingPoint: () => workingPointMock() }));
vi.mock('@/entities/collection-point', () => ({ usePointOptionsQuery: () => pointsMock() }));
vi.mock('@/entities/shift', () => ({ useShiftOnDateQuery: () => shiftMock() }));
vi.mock('@/entities/cost-of-day', () => ({ useCostOfDayQuery: () => dayMock() }));
vi.mock('@/entities/day-expense', () => ({
  useDayExpensesQuery: () => expensesMock(),
  useCreateDayExpenseMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDayExpenseMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDayExpenseMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const day = {
  shift_id: 's1',
  closed_at: null,
  provisional: true,
  accrued: '131900.00',
  reweighed_kg: '854.00',
  shortfall_amount: '1660.00',
  expenses_amount: '3800.00',
  basket: '5460.00',
  per_kg: '6.39',
  shortfall_per_kg: '1.94',
  expenses_per_kg: '4.45',
  total_check: '135700.00',
  top_ups_included: true as const,
  top_ups_latest_at: null,
  products: [
    {
      product_id: 'p-rasp',
      product_name: 'Малина',
      accrued: '128000.00',
      intake_net_kg: '800.00',
      reweigh_net_kg: '790.00',
      shortfall: '1600.00',
      basket_share: '5460.00',
      price_was: '160.00',
      price_cost: '166.39',
      price_by_our_weight: '162.03',
      complete: true,
    },
  ],
};

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false });
const pending = { data: undefined, isPending: true, isError: false };
const failed = { data: undefined, isPending: false, isError: true };

beforeEach(() => {
  workingPointMock.mockReturnValue({ pointId: 'p1', canPick: true, setPointId: vi.fn() });
  pointsMock.mockReturnValue(ok([{ id: 'p1', name: 'Шипинки', kind: 'reception' }]));
  shiftMock.mockReturnValue(ok({ id: 's1', status: 'open' }));
  dayMock.mockReturnValue(ok(day));
  expensesMock.mockReturnValue(ok([]));
});

describe('CostOfDayPage', () => {
  it('renders the day — both halves and the final table', () => {
    render(<CostOfDayPage />);

    expect(screen.getByRole('heading', { name: 'Собівартість дня' })).toBeInTheDocument();
    expect(screen.getByText('Ягода')).toBeInTheDocument();
    expect(screen.getByText('Витрати за день')).toBeInTheDocument();
    expect(screen.getByText('Середня ціна після витрат')).toBeInTheDocument();
  });

  it('marks an open shift as still moving', () => {
    render(<CostOfDayPage />);
    expect(screen.getByText('Зміна ще відкрита — цифри рухаються')).toBeInTheDocument();
  });

  it('reports a failed read as a failure, never as an empty day', () => {
    // The whole point of the three-state split: a dead /collection-points must
    // not be reported to the owner as a business fact about their own shift.
    pointsMock.mockReturnValue(failed);
    render(<CostOfDayPage />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Ягода')).not.toBeInTheDocument();
  });

  it('shows a spinner while the reads are in flight', () => {
    dayMock.mockReturnValue(pending);
    render(<CostOfDayPage />);

    expect(screen.queryByText('Ягода')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the shift was never opened, distinctly from an empty day', () => {
    shiftMock.mockReturnValue(ok(null));
    dayMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    render(<CostOfDayPage />);

    expect(screen.getByText(/Зміну .* не відкривали/)).toBeInTheDocument();
  });

  it('says nothing was taken in when the shift exists but has no products', () => {
    dayMock.mockReturnValue(ok({ ...day, products: [] }));
    render(<CostOfDayPage />);

    expect(screen.getByText('Цього дня на цьому пункті прийомки не було.')).toBeInTheDocument();
  });

  // ExpensesPanel is the application's ONLY write path to `day_expenses`.
  // A day with no products still needs it reachable: either nothing has
  // come in yet and the owner still wants to log «пальне 1 000,00», or
  // every intake was voided under §9.3 while the server still counts
  // existing expense lines in expenses_amount/basket/per_kg — money that
  // moves the собівартість must never become invisible and unreachable.
  it('keeps the expenses panel reachable on an empty day, beside the empty-day message', () => {
    dayMock.mockReturnValue(ok({ ...day, products: [] }));
    render(<CostOfDayPage />);

    expect(screen.getByText('Цього дня на цьому пункті прийомки не було.')).toBeInTheDocument();
    expect(screen.getByText('Витрати за день')).toBeInTheDocument();
  });

  it('offers every active point, base included — this screen does not filter by kind', () => {
    pointsMock.mockReturnValue(
      ok([
        { id: 'p1', name: 'Шипинки', kind: 'reception' },
        { id: 'p2', name: 'Склад', kind: 'base' },
      ]),
    );
    render(<CostOfDayPage />);

    // «Склад тоже считається як одна прийомка» — filtering it out here showed
    // the same day two different ways on two screens.
    expect(screen.getByRole('option', { name: 'Склад' })).toBeInTheDocument();
  });

  // FinalPrices casts `day.per_kg as string` and sums `basket_share` into its
  // «Σ із пулу» check — on a day where nothing was weighed, every share is
  // null and that sum would print 0,00 ₴, a basket total no kilogram backs.
  // CostOfDayPage's `per_kg === null` gate is the component's whole safety
  // contract, and nothing else enforces it — pin it here.
  it('never mounts FinalPrices when per_kg is null, and shows the awaiting-reweigh panel instead', () => {
    dayMock.mockReturnValue(
      ok({
        ...day,
        per_kg: null,
        shortfall_per_kg: null,
        expenses_per_kg: null,
        products: day.products.map((p) => ({ ...p, basket_share: null })),
      }),
    );
    render(<CostOfDayPage />);

    expect(screen.queryByText('Середня ціна після витрат')).not.toBeInTheDocument();
    expect(screen.getByText('Очікує переважування')).toBeInTheDocument();
  });
});
