import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TraceScope } from '@/shared/ui/trace';
import type { ComponentProps } from 'react';
import { Reconciliation } from './Reconciliation';
import type { ReconciliationGrade, ReconciliationProduct } from '@/entities/reweigh';

const NO_CRATES = { point: 0, base: 0, by_type: [] };

const weighed = (over: Partial<ReconciliationProduct> = {}): ReconciliationProduct => ({
  product_id: 'p1',
  product_name: 'Малина',
  intake_net_kg: '341.00',
  reweigh_net_kg: '338.50',
  state: 'weighed' as const,
  missing_kg: '2.50',
  missing_amount: '175.00',
  rate: '70.00',
  accrued: '23870.00',
  top_ups: '0.00',
  crates: NO_CRATES,
  ...over,
});

const grade = (over: Partial<ReconciliationGrade> = {}): ReconciliationGrade => ({
  product_grade_id: 'g1',
  product_grade_name: '1 сорт',
  product_id: 'p1',
  product_name: 'Малина',
  intake_net_kg: '333.70',
  reweigh_net_kg: '227.40',
  crates: NO_CRATES,
  ...over,
});

type Props = ComponentProps<typeof Reconciliation>;
/** A formula's text as one string — its figures are `TraceTerm`s, split across elements. */
const flat = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ');

const view = (over: Partial<Props> = {}) =>
  render(
    <TraceScope>
      <Reconciliation
        products={[weighed()]}
        grades={[]}
        missingTotalKg="2.50"
        missingTotalAmount="175.00"
        drafts={[]}
        shiftClosed
        acceptedAnything
        pointName="Шипинки"
        {...over}
      />
    </TraceScope>,
  );

describe('Reconciliation', () => {
  it('shows the point, the base, the difference and the money when the shift is closed', () => {
    view();
    const row = screen.getByRole('row', { name: /Малина/ });
    // Units live in the headers (audit E9); the column names follow the
    // glossary «Пункт · База · Різниця» (E6).
    expect(within(row).getByText('341.00')).toBeInTheDocument();
    expect(within(row).getByText('338.50')).toBeInTheDocument();
    expect(within(row).getByText('−2.50')).toBeInTheDocument();
    for (const name of ['Point, kg', 'Base, kg', 'Difference, kg', 'Shortfall, ₴']) {
      expect(screen.getByRole('columnheader', { name })).toBeInTheDocument();
    }
  });

  it('explains the rate as the division it is, доплати named — audit E5', () => {
    view({
      products: [
        weighed({
          intake_net_kg: '596.80',
          reweigh_net_kg: '595.40',
          missing_kg: '1.40',
          rate: '189.42',
          missing_amount: '265.19',
          accrued: '113044.20',
          top_ups: '15000.00',
        }),
        weighed({ product_id: 'p2', product_name: 'Кизил', missing_kg: '0.00', missing_amount: '0.00' }),
      ],
      missingTotalKg: '1.40',
      missingTotalAmount: '265.19',
    });
    // The numerator says what it is made of (top-ups review, 24.10): receipts = accrued − top-ups.
    expect(screen.getAllByTestId('rate-line').map(flat)).toEqual([
      'Малина: average purchase price incl. top-ups — (receipts 98,044.20 ₴ + top-ups 15,000.00 ₴) ÷ 596.80 kg = 189.42 ₴/kg',
    ]);
    // Only a product with a shortfall has a rate to explain.
    expect(screen.queryByText(/^Кизил: average/)).not.toBeInTheDocument();
  });

  it('says plainly «average purchase price» when there are no доплати', () => {
    view();
    expect(flat(screen.getByTestId('rate-line'))).toBe(
      'Малина: average purchase price — 23,870.00 ₴ ÷ 341.00 kg = 70.00 ₴/kg',
    );
  });

  it('prints the shortfall money as a formula a calculator re-checks, in amber — W3', () => {
    view({
      products: [weighed({ missing_kg: '1.40', rate: '189.42', missing_amount: '265.19' })],
      missingTotalKg: '1.40',
      missingTotalAmount: '265.19',
    });
    const row = screen.getByRole('row', { name: /Малина/ });
    const money = within(row).getByText('265.19 ₴').closest('td');
    expect(flat(money)).toBe('1.40 kg × 189.42 ₴/kg = 265.19 ₴');
    expect(money).toHaveClass('text-amber');
    expect(within(row).getByText('−1.40')).toHaveClass('text-amber');
  });

  it('prints the day total from the SERVER, never a browser sum of the rows — W2', () => {
    // Malina short 1.40, Kizil 2.00 over: a browser sum would print 0.60 surplus.
    view({
      products: [
        weighed({ missing_kg: '1.40', rate: '189.42', missing_amount: '265.19' }),
        weighed({ product_id: 'p2', product_name: 'Кизил', missing_kg: '-2.00', missing_amount: '-80.00' }),
      ],
      missingTotalKg: '1.40',
      missingTotalAmount: '265.19',
    });
    // Under the label «Shortfall total» the figure carries no sign (audit E11).
    expect(screen.getByTestId('missing-total')).toHaveTextContent(/^1\.40 kg · 265\.19 ₴$/);
  });

  it('holds the claim back while the shift is open — a dash, and it says why', () => {
    view({
      products: [weighed({ missing_kg: null, missing_amount: null })],
      missingTotalKg: null,
      missingTotalAmount: null,
      shiftClosed: false,
    });
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(screen.getByTestId('missing-total')).toHaveTextContent('—');
    expect(screen.getByText(/still open|ще відкрита/i)).toBeInTheDocument();
  });

  it('renders «не перезважено» as a state and NEVER as a zero', () => {
    view({
      products: [
        weighed({ state: 'not_reweighed', reweigh_net_kg: '0.00', missing_kg: null, missing_amount: null }),
      ],
      missingTotalKg: null,
      missingTotalAmount: null,
    });
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText(/not reweighed|не перезважено/i)).toBeInTheDocument();
    expect(within(row).queryByText('0.00')).not.toBeInTheDocument();
  });

  it('counts the products still without a line', () => {
    view({
      products: [
        weighed(),
        weighed({ product_id: 'p2', product_name: 'Порічка', state: 'not_reweighed', missing_kg: null, missing_amount: null }),
      ],
    });
    expect(screen.getByText(/not reweighed:\s*1\b|не перезважено товарів:\s*1\b/i)).toBeInTheDocument();
  });

  it('reports unposted drafts on their own line and leaves «База» untouched', () => {
    view({
      drafts: [
        {
          key: 'k',
          product_grade_id: 'g',
          product_grade_name: 'Малина 1',
          product_id: 'p1',
          product_name: 'Малина',
          gross_kg: '12.00',
          pallet_kg: '0.00',
          tare: [],
          tare_weight_kg: '0.00',
          net_kg: '12.00',
        },
      ],
    });
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('338.50')).toBeInTheDocument(); // NOT 350.50
    expect(screen.getByText(/12\.00/)).toBeInTheDocument();
    expect(screen.getByText(/not recorded yet|не проведено/i)).toBeInTheDocument();
  });

  it('says there is nothing to compare when the day accepted nothing', () => {
    view({ products: [], acceptedAnything: false, missingTotalKg: null, missingTotalAmount: null });
    expect(screen.getByText(/nothing to compare|порівнювати ні з чим/i)).toBeInTheDocument();
  });

  it('shows a surplus as «+x», muted, with no money claim — §8.2 правка', () => {
    view({
      products: [weighed({ missing_kg: '-4.00', missing_amount: '-280.00' })],
      missingTotalKg: '0.00',
      missingTotalAmount: '0.00',
    });
    const row = screen.getByRole('row', { name: /Малина/ });
    const diff = within(row).getByText('+4.00');
    expect(diff).toHaveClass('text-muted-foreground');
    expect(within(row).queryByText(/280/)).not.toBeInTheDocument();
    expect(screen.queryByText(/surplus|надлишок/i)).not.toBeInTheDocument();
  });

  it('shows tare units point → base under the product, amber when they differ — W5', () => {
    view({
      products: [
        weighed({
          crates: {
            point: 140,
            base: 139,
            by_type: [
              { tare_type_id: 't1', tare_type_name: 'Ящик', point: 136, base: 136 },
              { tare_type_id: 't2', tare_type_name: 'Лубянка', point: 4, base: 3 },
            ],
          },
        }),
      ],
    });
    const line = screen.getByTestId('crates-line');
    expect(line).toHaveTextContent('Ящик 136 → 136 · Лубянка 4 → 3');
    expect(line).toHaveClass('text-amber');
  });

  it('keeps an equal crate count muted, and prints nothing when no unit was counted', () => {
    view({
      products: [
        weighed({
          crates: {
            point: 136,
            base: 136,
            by_type: [{ tare_type_id: 't1', tare_type_name: 'Ящик', point: 136, base: 136 }],
          },
        }),
        weighed({ product_id: 'p2', product_name: 'Кизил' }),
      ],
    });
    const lines = screen.getAllByTestId('crates-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveClass('text-muted-foreground');
  });

  it('lists the grades under a product with more than one, point kg next to base kg — пересорт', () => {
    view({
      grades: [
        grade(),
        grade({ product_grade_id: 'g2', product_grade_name: '2 сорт', intake_net_kg: '263.10', reweigh_net_kg: '368.00' }),
      ],
    });
    const second = screen.getByRole('row', { name: /2 сорт/ });
    expect(within(second).getByText('263.10')).toBeInTheDocument();
    expect(within(second).getByText('368.00')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /1 сорт/ })).toBeInTheDocument();
  });

  it('adds no grade rows for a single-grade product', () => {
    view({ grades: [grade()] });
    expect(screen.queryByRole('row', { name: /1 сорт/ })).not.toBeInTheDocument();
  });
});

// «Звідки це число» (client, 24.10): every figure of a formula points at its source.
describe('Reconciliation — traced formulas', () => {
  const short = () =>
    view({
      products: [
        weighed({
          intake_net_kg: '596.80',
          reweigh_net_kg: '595.40',
          missing_kg: '1.40',
          rate: '189.42',
          missing_amount: '265.19',
          accrued: '113044.20',
          top_ups: '15000.00',
        }),
      ],
      missingTotalKg: '1.40',
      missingTotalAmount: '265.19',
    });

  it('the shortfall’s kilograms light «Difference», the rate its own line', () => {
    short();
    const row = screen.getByRole('row', { name: /Малина/ });
    const diff = within(row).getByText('−1.40');
    const money = within(row).getByText('265.19 ₴').closest('td')!;

    fireEvent.pointerEnter(within(money).getByText('1.40 kg'));
    expect(diff).toHaveAttribute('data-trace-hit', 'amber');

    fireEvent.pointerEnter(within(money).getByText('189.42 ₴/kg'));
    expect(diff).not.toHaveAttribute('data-trace-hit');
    const line = screen.getByTestId('rate-line');
    expect(within(line).getByText('189.42 ₴/kg')).toHaveAttribute('data-trace-hit', 'sky');
  });

  it('the rate’s kilograms light «Point», and the total lights each product’s shortfall', () => {
    short();
    const row = screen.getByRole('row', { name: /Малина/ });
    fireEvent.pointerEnter(within(screen.getByTestId('rate-line')).getByText('596.80 kg'));
    expect(within(row).getByText('596.80')).toHaveAttribute('data-trace-hit', 'neutral');

    fireEvent.pointerEnter(within(screen.getByTestId('missing-total')).getByText('1.40 kg'));
    expect(within(row).getByText('−1.40')).toHaveAttribute('data-trace-hit', 'amber');
  });
});
