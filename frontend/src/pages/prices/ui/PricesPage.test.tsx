import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { PricesPage } from './PricesPage';
import type { PriceSheet } from '../model/gradePrice';

const { sheetMock, setPriceMock, bulkMock, meMock } = vi.hoisted(() => ({
  sheetMock: vi.fn(),
  setPriceMock: vi.fn(),
  bulkMock: vi.fn(),
  meMock: vi.fn(),
}));

vi.mock('../api/priceSheet', () => ({
  usePriceSheetQuery: () => sheetMock(),
  useBulkSetPriceMutation: () => ({ mutateAsync: bulkMock }),
}));

vi.mock('../api/gradePrices', () => ({
  useSetPriceMutation: () => ({ mutateAsync: setPriceMock }),
  usePriceHistoryQuery: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock('../api/priceChanges', () => ({
  usePriceChangesQuery: () => ({
    data: { date: '2026-09-23', changes: [] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

const OWNER = { id: 'u1', role: 'network_owner', collection_point_id: null };
const OPERATOR = { id: 'u2', role: 'point_operator', collection_point_id: 'p1' };

const cell = (base_price: string) => ({
  base_price,
  max_markup: '30.00',
  max_discount: '20.00',
});

/**
 * Two reception points and the warehouse. «Вищий сорт» is the AGREEMENT case —
 * both reception points at 150, the warehouse on its own 145. «1 сорт» is the
 * disagreement. «2 сорт» has no price anywhere.
 */
const SHEET: PriceSheet = {
  points: [
    { id: 'p1', name: 'Шипинки', kind: 'reception' },
    { id: 'p2', name: 'Гайове', kind: 'reception' },
    { id: 'w1', name: 'Склад', kind: 'base' },
  ],
  rows: [
    {
      product_grade_id: 'g1',
      grade_name: 'Вищий сорт',
      product_name: 'Малина',
      prices: { p1: cell('150.00'), p2: cell('150.00'), w1: cell('145.00') },
    },
    {
      product_grade_id: 'g2',
      grade_name: '1 сорт',
      product_name: 'Малина',
      prices: { p1: cell('135.00'), p2: cell('127.00') },
    },
    { product_grade_id: 'g3', grade_name: '2 сорт', product_name: 'Малина', prices: {} },
  ],
};

/**
 * The suite runs in ENGLISH (`test-setup.ts` calls `changeLanguage('en')`), so
 * every matcher here reads the en.json string. Matching Ukrainian would pass
 * only by accident, on keys that happen to be untranslated.
 */
const rowFor = (name: string) =>
  screen.getByRole('row', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });

beforeEach(() => {
  vi.clearAllMocks();
  meMock.mockReturnValue({ data: OWNER });
  sheetMock.mockReturnValue({ data: SHEET, isPending: false, isError: false });
  setPriceMock.mockResolvedValue({});
  bulkMock.mockResolvedValue({ created: 2 });
});

describe('PricesPage — the sheet', () => {
  it('renders a column per point, warehouse included', () => {
    render(<PricesPage />);
    for (const name of ['Шипинки', 'Гайове', 'Склад']) {
      expect(screen.getByRole('columnheader', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it('shows a bare number in «загальна» when every reception point agrees', () => {
    render(<PricesPage />);
    const row = rowFor('Вищий сорт');
    // 150.00 appears in both reception cells AND in the common column.
    expect(within(row).getAllByText('150.00').length).toBeGreaterThanOrEqual(3);
    expect(within(row).queryByText('mixed')).not.toBeInTheDocument();
  });

  it('shows «mixed» with the span when the points disagree', () => {
    render(<PricesPage />);
    const row = rowFor('1 сорт');
    expect(within(row).getByText('mixed')).toBeInTheDocument();
    // The two ends are separate text nodes, so this reads the cell's whole text.
    expect(row.textContent).toContain('127.00');
    expect(row.textContent).toContain('135.00');
  });

  /**
   * §4.8 — the warehouse's dearer price must not drag the common column, or
   * every row would read «різні» for the one reason that is never news.
   */
  it('keeps the warehouse OUT of «загальна» even though it is a column', () => {
    render(<PricesPage />);
    const row = rowFor('Вищий сорт');
    expect(within(row).getByText('145.00')).toBeInTheDocument();
    expect(within(row).queryByText('mixed')).not.toBeInTheDocument();
  });

  it('shows a dash, never a zero, for a grade nobody has priced', () => {
    render(<PricesPage />);
    const row = rowFor('2 сорт');
    expect(within(row).queryByText('0.00')).not.toBeInTheDocument();
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('sends ONLY the reception points to the bulk write', async () => {
    const user = userEvent.setup();
    render(<PricesPage />);

    const row = rowFor('Вищий сорт');
    await user.click(within(row).getByRole('button', { name: /set for all/i }));

    const dialog = await screen.findByRole('dialog');
    const base = within(dialog).getByLabelText(/base price/i);
    await user.clear(base);
    await user.type(base, '160.00');
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(bulkMock).toHaveBeenCalledTimes(1));
    expect(bulkMock.mock.calls[0][0].collection_point_ids).toEqual(['p1', 'p2']);
    expect(bulkMock.mock.calls[0][0].collection_point_ids).not.toContain('w1');
  });

  it('writes ONE point when a cell is edited', async () => {
    const user = userEvent.setup();
    render(<PricesPage />);

    const row = rowFor('Вищий сорт');
    await user.click(within(row).getByRole('button', { name: /Малина · Вищий сорт.*Гайове/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(setPriceMock).toHaveBeenCalledTimes(1));
    expect(setPriceMock.mock.calls[0][0].collection_point_id).toBe('p2');
    expect(bulkMock).not.toHaveBeenCalled();
  });

  it("shows today's price changes under the sheet (#151)", () => {
    render(<PricesPage />);
    expect(screen.getByText('Changes today')).toBeInTheDocument();
  });

  it('has no date control — this sheet shows current prices, not a day', () => {
    render(<PricesPage />);
    expect(screen.queryByLabelText(/дата|date/i)).not.toBeInTheDocument();
  });

  it('is accessible', async () => {
    const { container } = render(<PricesPage />);
    await expectNoAxeViolations(container);
  });
});

describe('PricesPage — the operator', () => {
  beforeEach(() => {
    meMock.mockReturnValue({ data: OPERATOR });
    sheetMock.mockReturnValue({
      // The SERVER scopes them; this is the one-column response it returns.
      data: { points: [SHEET.points[0]], rows: SHEET.rows },
      isPending: false,
      isError: false,
    });
  });

  /**
   * §10.2 — a whole ACTION is ABSENT for the operator, never disabled:
   * «заблокована кнопка вчить шукати обхід, відсутня не вчить нічого».
   */
  it('is never offered «встановити всім»', () => {
    render(<PricesPage />);
    expect(screen.queryByRole('button', { name: /set for all/i })).not.toBeInTheDocument();
  });

  /**
   * Mock §5.4 — a FIELD read-only through role stays on screen with a lock and
   * a caption: «приховане поле породжує підозру й дзвінки; заблоковане з
   * підписом вчить правилу».
   */
  it('still SEES the price, with a lock and the caption', () => {
    render(<PricesPage />);
    expect(screen.getAllByText('150.00').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('img', { name: /view only/i }).length).toBeGreaterThan(0);
    expect(screen.getByText(/the owner sets the day/i)).toBeInTheDocument();
  });

  /**
   * The cell is a BUTTON for the operator too, and that is not a leak: it opens
   * §4.2's journal, which is open to both roles. What must never appear is the
   * set-price form. «Read-only» and «opaque» are different things.
   */
  it('opens the price JOURNAL from a cell, never the set-price form', async () => {
    const user = userEvent.setup();
    render(<PricesPage />);

    expect(
      screen.queryByRole('button', { name: /Малина · Вищий сорт at Шипинки$/i }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Малина · Вищий сорт at Шипинки — price history' }),
    );

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText(/base price/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
  });
});

describe('PricesPage — states', () => {
  it('shows a spinner while the sheet loads', () => {
    meMock.mockReturnValue({ data: OWNER });
    sheetMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<PricesPage />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('reports a failed read rather than rendering an empty sheet', () => {
    meMock.mockReturnValue({ data: OWNER });
    sheetMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<PricesPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an empty state when the catalogue has no grades', () => {
    meMock.mockReturnValue({ data: OWNER });
    sheetMock.mockReturnValue({
      data: { points: SHEET.points, rows: [] },
      isPending: false,
      isError: false,
    });
    render(<PricesPage />);
    expect(screen.getByText(/nothing to price/i)).toBeInTheDocument();
  });
});
