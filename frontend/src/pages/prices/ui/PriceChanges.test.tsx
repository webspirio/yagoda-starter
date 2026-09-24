import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { PriceChanges } from './PriceChanges';
import type { PriceChange } from '../model/gradePrice';

const { changesMock } = vi.hoisted(() => ({ changesMock: vi.fn() }));

vi.mock('../api/priceChanges', () => ({
  usePriceChangesQuery: () => changesMock(),
}));

const change = (over: Partial<PriceChange>): PriceChange => ({
  id: 'c1',
  created_at: '2026-09-23T07:54:00.000Z',
  collection_point_id: 'p1',
  point_name: 'Шипинки',
  product_grade_id: 'g1',
  product_name: 'Малина',
  grade_name: '2 сорт',
  previous_base_price: '115.00',
  base_price: '184.00',
  reason: null,
  author_name: 'Керівник',
  ...over,
});

/** The expected clock reading, computed the way the component computes it —
 *  so the assertion holds in whatever zone the suite runs. */
const clock = (iso: string) =>
  new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const loaded = (changes: PriceChange[]) => ({
  data: { date: '2026-09-23', changes },
  isPending: false,
  isError: false,
});

describe('PriceChanges', () => {
  beforeEach(() => changesMock.mockReset());

  it('lists each move as time, point, grade, was → became and author', () => {
    changesMock.mockReturnValue(loaded([change({})]));
    render(<PriceChanges />);

    const [item] = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(item).toHaveTextContent(clock('2026-09-23T07:54:00.000Z'));
    expect(item).toHaveTextContent('Шипинки');
    expect(item).toHaveTextContent('Малина · 2 сорт');
    expect(item).toHaveTextContent('115.00 → 184.00 ₴');
    expect(item).toHaveTextContent('Керівник');
  });

  it('shows a first-ever price without a «was»', () => {
    changesMock.mockReturnValue(loaded([change({ previous_base_price: null })]));
    render(<PriceChanges />);

    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('184.00 ₴');
    expect(item).not.toHaveTextContent('→');
  });

  it('quotes the reason when there is one', () => {
    changesMock.mockReturnValue(loaded([change({ reason: 'конкуренти підняли' })]));
    render(<PriceChanges />);
    expect(screen.getByRole('listitem')).toHaveTextContent('«конкуренти підняли»');
  });

  it('keeps the server order — newest first — rather than re-sorting', () => {
    changesMock.mockReturnValue(
      loaded([
        change({ id: 'a', point_name: 'Конищів' }),
        change({ id: 'b', point_name: 'Гайове' }),
      ]),
    );
    render(<PriceChanges />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Конищів');
    expect(items[1]).toHaveTextContent('Гайове');
  });

  it('says so when nothing moved today', () => {
    changesMock.mockReturnValue(loaded([]));
    render(<PriceChanges />);
    expect(screen.getByText(/No price has changed today/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('reports a failed read instead of an empty day', () => {
    changesMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<PriceChanges />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/No price has changed today/)).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    changesMock.mockReturnValue(loaded([change({ reason: 'конкуренти підняли' })]));
    const { container } = render(<PriceChanges />);
    await expectNoAxeViolations(container);
  });
});
