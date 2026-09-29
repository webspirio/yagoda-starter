import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DraftLines } from './DraftLines';
import type { Draft } from '../model/draft';

const { tareMock } = vi.hoisted(() => ({
  tareMock: vi.fn(),
}));

vi.mock('@/entities/tare-type', () => ({
  useTareTypeOptionsQuery: () => tareMock(),
}));

const draft = (over: Partial<Draft> = {}): Draft => ({
  key: 'rwl_1',
  product_grade_id: 'g1',
  product_grade_name: '1 сорт',
  product_id: 'p1',
  product_name: 'Малина',
  gross_kg: '120.50',
  pallet_kg: '0.00',
  tare: [],
  tare_weight_kg: '0.00',
  net_kg: '120.50',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  tareMock.mockReturnValue({ data: [], isPending: false });
});

describe('DraftLines', () => {
  /**
   * Same defect as `DayLines.tsx` — «Стандарт» alone is the grade of eight
   * different products in the seed catalogue, so the strip has to name the
   * product too. `Draft.product_name` is a required string here (unlike the
   * optional relation `DayLines` degrades against), so both halves are
   * always available.
   */
  it('names the product alongside the grade, not the grade alone', () => {
    render(<DraftLines drafts={[draft()]} onRemove={vi.fn()} />);
    expect(screen.getByText('Малина — 1 сорт')).toBeInTheDocument();
  });

  /**
   * The finding in one assertion: two drafts from DIFFERENT products that
   * happen to share the grade name «Стандарт» must read differently. Before
   * the fix both draft lines print «Стандарт» and this assertion fails.
   */
  it('tells apart two products that share the same grade name', () => {
    const strawberry = draft({
      key: 'rwl_1',
      product_id: 'p1',
      product_name: 'Полуниця',
      product_grade_name: 'Стандарт',
    });
    const currant = draft({
      key: 'rwl_2',
      product_id: 'p2',
      product_name: 'Порічка',
      product_grade_name: 'Стандарт',
    });
    render(<DraftLines drafts={[strawberry, currant]} onRemove={vi.fn()} />);

    const list = screen.getByRole('list');
    const [firstItem, secondItem] = within(list).getAllByRole('listitem');
    expect(firstItem.textContent).not.toBe(secondItem.textContent);
    expect(within(firstItem).getByText('Полуниця — Стандарт')).toBeInTheDocument();
    expect(within(secondItem).getByText('Порічка — Стандарт')).toBeInTheDocument();
  });
});
