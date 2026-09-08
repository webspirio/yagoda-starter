import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { PriceHistoryDialog } from './PriceHistoryDialog';
import type { GradeCatalogItem } from '@/entities/product-grade';
import type { GradePrice } from '../model/gradePrice';

const { historyMock } = vi.hoisted(() => ({ historyMock: vi.fn() }));

vi.mock('../api/gradePrices', () => ({
  usePriceHistoryQuery: (pointId: string | null, gradeId: string | null) =>
    historyMock(pointId, gradeId),
}));

const grade: GradeCatalogItem = {
  id: 'g1',
  name: 'Grade 1',
  productId: 'pr1',
  productName: 'Raspberry',
};

const row = (over: Partial<GradePrice> & Pick<GradePrice, 'id' | 'created_at'>): GradePrice => ({
  collection_point_id: 'p1',
  product_grade_id: 'g1',
  base_price: '50.00',
  max_markup: '5.00',
  max_discount: '3.00',
  created_by_user_id: 'u1',
  reason: null,
  ...over,
});

beforeEach(() => {
  historyMock.mockReset().mockReturnValue({ data: undefined, isPending: false, isError: false });
});

describe('PriceHistoryDialog', () => {
  it('asks for the point and grade ids, newest first as returned by the API', () => {
    historyMock.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<PriceHistoryDialog pointId="p1" grade={grade} open onClose={() => {}} />);
    expect(historyMock).toHaveBeenCalledWith('p1', 'g1');
  });

  it('titles the dialog with the grade', () => {
    historyMock.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<PriceHistoryDialog pointId="p1" grade={grade} open onClose={() => {}} />);
    expect(
      screen.getByRole('heading', { name: 'Raspberry · Grade 1 · history' }),
    ).toBeInTheDocument();
  });

  it('lists rows in the order the API returned them (newest first), with the reason', async () => {
    historyMock.mockReturnValue({
      data: [
        row({
          id: 'gp2',
          base_price: '55.00',
          max_markup: '6.00',
          max_discount: '4.00',
          reason: 'Season peak',
          created_at: '2026-09-08T07:10:00Z',
        }),
        row({
          id: 'gp1',
          base_price: '50.00',
          created_at: '2026-09-01T07:10:00Z',
        }),
      ],
      isPending: false,
      isError: false,
    });
    const { container } = render(
      <PriceHistoryDialog pointId="p1" grade={grade} open onClose={() => {}} />,
    );

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1); // drop the header row
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Season peak')).toBeInTheDocument();
    expect(within(rows[0]).getByText('55.00')).toBeInTheDocument();
    // The null-reason row shows a muted dash, never a bare empty cell.
    expect(within(rows[1]).getByText('—')).toBeInTheDocument();
    expect(within(rows[1]).getByText('50.00')).toBeInTheDocument();

    await expectNoAxeViolations(container);
  });

  it('formats the date and time from the SAME local clock reading, so they never disagree by a day', () => {
    // 22:30 UTC on the 8th is already 01:30 on the 9th in Kyiv (UTC+3) — a
    // date sliced from the UTC string and a time formatted from the local
    // one would show "09/08" next to "01:30 AM", a day apart.
    historyMock.mockReturnValue({
      data: [row({ id: 'gp1', created_at: '2026-09-08T22:30:00Z' })],
      isPending: false,
      isError: false,
    });
    render(<PriceHistoryDialog pointId="p1" grade={grade} open onClose={() => {}} />);

    const table = screen.getByRole('table');
    const dataRow = within(table).getAllByRole('row')[1];
    expect(within(dataRow).getByText('09/09, 01:30 AM')).toBeInTheDocument();
  });

  it('shows the empty state when the grade has never been priced', () => {
    historyMock.mockReturnValue({ data: [], isPending: false, isError: false });
    render(<PriceHistoryDialog pointId="p1" grade={grade} open onClose={() => {}} />);
    expect(screen.getByText('The price has not changed yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a loading state while the history is in flight', () => {
    historyMock.mockReturnValue({ data: undefined, isPending: true, isError: false });
    render(<PriceHistoryDialog pointId="p1" grade={grade} open onClose={() => {}} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows an error state when the history read fails', () => {
    historyMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<PriceHistoryDialog pointId="p1" grade={grade} open onClose={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByRole('table')).toBeNull();
  });
});
