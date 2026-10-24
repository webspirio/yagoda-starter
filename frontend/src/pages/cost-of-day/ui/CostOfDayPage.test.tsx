import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import { CostOfDayPage } from './CostOfDayPage';

// Every assertion below is the Ukrainian copy the page's own t() calls
// produce, but `test-setup.ts` defaults the active i18n language to 'en' for
// the whole suite (same convention as every sibling test file). Set it
// here for this file only, and reset it afterwards so it never leaks into a
// later file's "runs in ENGLISH" assumption.
beforeAll(async () => {
  await i18n.changeLanguage('uk');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

const {
  workingPointMock,
  pointsMock,
  shiftMock,
  dayMock,
  expensesMock,
  networkMock,
  pointParamMock,
  setPointParamMock,
  setDateMock,
} = vi.hoisted(() => ({
  workingPointMock: vi.fn(),
  pointsMock: vi.fn(),
  shiftMock: vi.fn(),
  dayMock: vi.fn(),
  expensesMock: vi.fn(),
  networkMock: vi.fn(),
  pointParamMock: vi.fn(),
  setPointParamMock: vi.fn(),
  setDateMock: vi.fn(),
}));

// `useUrlParam` reads react-router's search params, so without this stub the
// page cannot mount outside a Router at all. `null` means «no ?date=», which
// the page clamps to today — the date stepper is not what these tests drive.
// `?point=` is the raw param «Усі точки» lives in.
vi.mock('@/shared/lib/url-state', () => ({
  useUrlParam: (name: string) =>
    name === 'point' ? [pointParamMock(), setPointParamMock] : [null, setDateMock],
}));
vi.mock('@/features/point-scope', () => ({ useWorkingPoint: () => workingPointMock() }));
vi.mock('@/entities/collection-point', () => ({ usePointOptionsQuery: () => pointsMock() }));
vi.mock('@/entities/shift', () => ({ useShiftOnDateQuery: () => shiftMock() }));
vi.mock('@/entities/cost-of-day', () => ({
  useCostOfDayQuery: () => dayMock(),
  useNetworkCostOfDayQuery: (date: string | null) => networkMock(date),
}));
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
  weighed: {
    intake_kg: '800.00',
    shortfall_kg: '10.00',
    accrued: '128000.00',
    shortfall: '1600.00',
  },
  full_cost: '133460.00',
  price_cost_avg: '168.94',
  unweighed: { intake_kg: '0.00', accrued: '0.00' },
  checks: { shares_ok: true, total_ok: true } as { shares_ok: boolean; total_ok: boolean } | null,
  top_ups_included: true as const,
  top_ups_latest_at: null,
  top_ups_total: '0.00',
  products: [
    {
      product_id: 'p-rasp',
      product_name: 'Малина',
      accrued: '128000.00',
      top_ups: '0.00',
      intake_net_kg: '800.00',
      reweigh_net_kg: '790.00',
      shortfall: '1600.00',
      shortfall_kg: '10.00',
      shortfall_share: '1660.00',
      expenses_share: '3800.00',
      basket_share: '5460.00',
      full_cost: '133460.00',
      price_was: '160.00',
      price_cost: '166.39',
      complete: true,
      grades: [],
    },
  ],
};

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false });
const pending = { data: undefined, isPending: true, isError: false };
const failed = { data: undefined, isPending: false, isError: true };

const network = {
  date: '2026-10-22',
  points: [
    {
      point_id: 'p1',
      point_name: 'Шипинки',
      shift_id: 's1',
      provisional: false,
      expenses_amount: '3800.00',
      weighed: true,
    },
    {
      point_id: 'p2',
      point_name: 'Гайове',
      shift_id: 's2',
      provisional: true,
      expenses_amount: '1050.00',
      weighed: true,
    },
  ],
  provisional: true,
  accrued: '160550.00',
  expenses_amount: '4850.00',
  expenses_weighed: '4850.00',
  reweighed_kg: '1000.00',
  shortfall_amount: '1600.00',
  top_ups_total: '0.00',
  weighed: {
    intake_kg: '1010.00',
    shortfall_kg: '10.00',
    accrued: '160550.00',
    shortfall: '1600.00',
    shortfall_share: '1600.00',
    expenses_share: '4850.00',
    full_cost: '165400.00',
  },
  price_cost_avg: '165.40',
  unweighed: { intake_kg: '0.00', accrued: '0.00' },
  checks: { points_ok: true, total_ok: true },
  products: [],
};

beforeEach(() => {
  workingPointMock.mockReturnValue({ pointId: 'p1', canPick: true, setPointId: vi.fn() });
  pointParamMock.mockReturnValue(null);
  networkMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
  pointsMock.mockReturnValue(ok([{ id: 'p1', name: 'Шипинки', kind: 'reception' }]));
  shiftMock.mockReturnValue(ok({ id: 's1', status: 'open' }));
  dayMock.mockReturnValue(ok(day));
  expensesMock.mockReturnValue(ok([]));
});

describe('CostOfDayPage', () => {
  it('drops a half-typed expense when the shift underneath it changes', async () => {
    // ExpensesStrip keeps `label`/`amount`/`editing` in its own useState, and
    // the page re-RENDERS rather than remounts when the owner steps to another
    // date whose queries are already cached (gcTime is 24h, so `isPending`
    // never goes true and the pending branch never unmounts the tree). Without
    // a key tied to the shift, the words typed against 22.09 are still in the
    // form after stepping back to 21.09 — and `Додати` would then record them
    // against the wrong business day, moving that day's basket, per_kg and
    // every product's basket_share with nothing on screen saying so.
    const user = userEvent.setup();
    const { rerender } = render(<CostOfDayPage />);

    await user.type(screen.getByPlaceholderText('Підпис витрати'), 'пальне');
    expect(screen.getByPlaceholderText('Підпис витрати')).toHaveValue('пальне');

    shiftMock.mockReturnValue(ok({ id: 's2', status: 'open' }));
    dayMock.mockReturnValue(ok({ ...day, shift_id: 's2' }));
    rerender(<CostOfDayPage />);

    expect(screen.getByPlaceholderText('Підпис витрати')).toHaveValue('');
  });

  it('renders chips, the strip, the table and the checks in that order', () => {
    render(<CostOfDayPage />);

    expect(screen.getByRole('heading', { name: 'Собівартість дня' })).toBeInTheDocument();
    const strip = screen.getByText('Витрати дня');
    const table = screen.getByText('Товар');
    // «Звірено» is both a chip and the disclosure's summary; the summary is last.
    const summaries = screen.getAllByText('Звірено', { exact: false });
    const checks = summaries[summaries.length - 1];
    const before = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(strip.compareDocumentPosition(table) & before).toBeTruthy();
    expect(table.compareDocumentPosition(checks) & before).toBeTruthy();
  });

  it('opens the checks when they fail', () => {
    dayMock.mockReturnValue(ok({ ...day, checks: { shares_ok: true, total_ok: false } }));
    const { container } = render(<CostOfDayPage />);

    expect(container.querySelector('details#cost-checks')).toHaveAttribute('open');
    expect(screen.getAllByText('Не сходиться', { exact: false }).length).toBeGreaterThan(0);
  });

  it('keeps the checks closed when they pass', () => {
    const { container } = render(<CostOfDayPage />);
    expect(container.querySelector('details#cost-checks')).not.toHaveAttribute('open');
  });

  it('prints the disclosure body and the «нараховано» footnote', () => {
    const { container } = render(<CostOfDayPage />);

    // The body is in the DOM even while the <details> is closed, and the
    // footnote carries `print-only` — the print stylesheet shows both. The
    // day's average needs no footnote: its formula is printed under the table.
    expect(container.querySelector('details#cost-checks')).toHaveTextContent('Частки товарів');
    expect(container.querySelectorAll('.print-only')).not.toHaveLength(0);
    expect(container.querySelector('p.print-only')).toHaveTextContent(/разом із доплатами/);
  });

  it('names the point and the date on paper only — the header already shows both on screen', () => {
    const { container } = render(<CostOfDayPage />);
    const sheet = container.querySelector('.printable') as HTMLElement;

    expect(sheet.querySelector('.print-only')).toHaveTextContent(/Шипинки/);
    const onScreen = Array.from(sheet.querySelectorAll('span')).filter(
      (el) => el.textContent === 'Шипинки' && !el.closest('.print-only'),
    );
    expect(onScreen).toHaveLength(0);
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

    expect(screen.getByText('Цього дня на цій точці прийомки не було.')).toBeInTheDocument();
  });

  // The strip is the application's ONLY write path to `day_expenses`.
  // A day with no products still needs it reachable: either nothing has
  // come in yet and the owner still wants to log «пальне 1 000,00», or
  // every intake was voided under §9.3 while the server still counts
  // existing expense lines in expenses_amount/basket/per_kg — money that
  // moves the собівартість must never become invisible and unreachable.
  it('keeps the expenses strip reachable on an empty day, beside the empty-day message', () => {
    dayMock.mockReturnValue(ok({ ...day, products: [] }));
    render(<CostOfDayPage />);

    expect(screen.getByText('Цього дня на цій точці прийомки не було.')).toBeInTheDocument();
    expect(screen.getByText('Витрати дня')).toBeInTheDocument();
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

  // On a day where nothing was weighed `per_kg` and every share are null; the
  // table must dash the result and say so, and the strip must stay usable.
  it('keeps the strip and dashes the result when nothing is weighed', () => {
    dayMock.mockReturnValue(
      ok({
        ...day,
        per_kg: null,
        shortfall_per_kg: null,
        expenses_per_kg: null,
        weighed: null,
        full_cost: null,
        price_cost_avg: null,
        checks: null,
        unweighed: { intake_kg: '800.00', accrued: '128000.00' },
        products: day.products.map((p) => ({
          ...p,
          basket_share: null,
          shortfall_share: null,
          expenses_share: null,
          full_cost: null,
          price_cost: null,
          reweigh_net_kg: null,
          complete: false,
        })),
      }),
    );
    const { container } = render(<CostOfDayPage />);

    expect(screen.getByText('Витрати дня')).toBeInTheDocument();
    expect(container.querySelector('[data-awaiting]')).not.toBeNull();
    expect(container.querySelector('details#cost-checks')).toBeNull();
  });

  describe('«Усі точки»', () => {
    it('is the picker’s first option, and picking it writes ?point=all without remembering it', async () => {
      const setPointId = vi.fn();
      workingPointMock.mockReturnValue({ pointId: 'p1', canPick: true, setPointId });
      const user = userEvent.setup();
      render(<CostOfDayPage />);

      const picker = screen.getByRole('combobox', { name: 'Точка' });
      expect(screen.getAllByRole('option')[0]).toHaveTextContent('Усі точки');

      await user.selectOptions(picker, 'Усі точки');
      expect(setPointParamMock).toHaveBeenCalledWith('all');
      expect(setPointId).not.toHaveBeenCalled();
    });

    it('goes back to one point through the ordinary remembered pick', async () => {
      const setPointId = vi.fn();
      workingPointMock.mockReturnValue({ pointId: 'p1', canPick: true, setPointId });
      pointParamMock.mockReturnValue('all');
      networkMock.mockReturnValue(ok(network));
      const user = userEvent.setup();
      render(<CostOfDayPage />);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Точка' }), 'Шипинки');
      expect(setPointId).toHaveBeenCalledWith('p1');
    });

    it('reads the network for the page’s date, and nothing per point', () => {
      pointParamMock.mockReturnValue('all');
      networkMock.mockReturnValue(ok(network));
      render(<CostOfDayPage />);

      expect(networkMock).toHaveBeenLastCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
      expect(screen.getByRole('combobox', { name: 'Точка' })).toHaveValue('all');
    });

    it('has no expense entry — only each point’s expenses, read back', () => {
      pointParamMock.mockReturnValue('all');
      networkMock.mockReturnValue(ok(network));
      const { container } = render(<CostOfDayPage />);

      expect(screen.queryByPlaceholderText('Підпис витрати')).not.toBeInTheDocument();
      expect(container.querySelector('[data-network-expenses]')).toHaveTextContent(
        /Шипинки 3\s800,00.*Гайове 1\s050,00.*разом 4\s850,00/,
      );
      expect(screen.getByText('Зміна ще відкрита: Гайове')).toBeInTheDocument();
    });

    it('drops «разом» when only one point entered expenses — audit E11', () => {
      pointParamMock.mockReturnValue('all');
      networkMock.mockReturnValue(
        ok({
          ...network,
          points: [network.points[0], { ...network.points[1], expenses_amount: '0.00' }],
          expenses_amount: '3800.00',
        }),
      );
      const { container } = render(<CostOfDayPage />);

      const line = container.querySelector('[data-network-expenses]');
      expect(line).toHaveTextContent(/Витрати дня: Шипинки 3\s800,00/);
      expect(line).not.toHaveTextContent('разом');
    });

    it('prints as «Усі точки»', () => {
      pointParamMock.mockReturnValue('all');
      networkMock.mockReturnValue(ok(network));
      const { container } = render(<CostOfDayPage />);

      expect(container.querySelector('.print-only')).toHaveTextContent(/Усі точки/);
    });

    it('says no point opened a shift that day', () => {
      pointParamMock.mockReturnValue('all');
      networkMock.mockReturnValue(ok({ ...network, points: [] }));
      render(<CostOfDayPage />);

      expect(screen.getByText(/жодна точка не відкривала зміну/)).toBeInTheDocument();
    });

    it('reports a failed network read as a failure', () => {
      pointParamMock.mockReturnValue('all');
      networkMock.mockReturnValue(failed);
      render(<CostOfDayPage />);

      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('is not an operator’s: no picker, and ?point=all is ignored', () => {
      workingPointMock.mockReturnValue({ pointId: 'p1', canPick: false, setPointId: vi.fn() });
      pointParamMock.mockReturnValue('all');
      render(<CostOfDayPage />);

      expect(screen.queryByRole('combobox', { name: 'Точка' })).not.toBeInTheDocument();
      expect(networkMock).toHaveBeenLastCalledWith(null);
      expect(screen.getByText('Витрати дня')).toBeInTheDocument();
    });
  });
});
