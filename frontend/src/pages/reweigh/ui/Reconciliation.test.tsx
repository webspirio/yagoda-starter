import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Reconciliation } from './Reconciliation';
import type { ReconciliationProduct } from '@/entities/reweigh';

const weighed = (over: Partial<ReconciliationProduct> = {}): ReconciliationProduct => ({
  product_id: 'p1',
  product_name: 'Малина',
  intake_net_kg: '341.00',
  reweigh_net_kg: '338.50',
  state: 'weighed' as const,
  missing_kg: '2.50',
  missing_amount: '175.00',
  ...over,
});

describe('Reconciliation', () => {
  it('shows the point, ours, the difference and the money when the shift is closed', () => {
    render(<Reconciliation products={[weighed()]} drafts={[]} shiftClosed acceptedAnything pointName="Шипинки" />);
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('341.00 kg')).toBeInTheDocument();
    expect(within(row).getByText('338.50 kg')).toBeInTheDocument();
    expect(within(row).getByText(/2\.50/)).toBeInTheDocument();
  });

  it('holds the claim back while the shift is open — a dash, and it says why', () => {
    render(
      <Reconciliation
        products={[weighed({ missing_kg: null, missing_amount: null })]}
        drafts={[]}
        shiftClosed={false}
        acceptedAnything
        pointName="Шипинки"
      />,
    );
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getAllByText('—')).toHaveLength(2);
    expect(screen.getByText(/still open|ще відкрита/i)).toBeInTheDocument();
  });

  it('renders «не перезважено» as a state and NEVER as a zero', () => {
    render(
      <Reconciliation
        products={[
          weighed({ state: 'not_reweighed', reweigh_net_kg: '0.00', missing_kg: null, missing_amount: null }),
        ]}
        drafts={[]}
        shiftClosed
        acceptedAnything
        pointName="Шипинки"
      />,
    );
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText(/not reweighed|не перезважено/i)).toBeInTheDocument();
    expect(within(row).queryByText('0.00 kg')).not.toBeInTheDocument();
  });

  it('counts the products still without a line', () => {
    render(
      <Reconciliation
        products={[
          weighed(),
          weighed({ product_id: 'p2', product_name: 'Порічка', state: 'not_reweighed', missing_kg: null, missing_amount: null }),
        ]}
        drafts={[]}
        shiftClosed
        acceptedAnything
        pointName="Шипинки"
      />,
    );
    // A bare /1/ would also match "341.00 kg" (both rows share that default
    // intake value) and "175.00 ₴", so it is scoped to the interpolated
    // count inside the note itself — still fails if the count is wrong or
    // the note goes missing.
    expect(screen.getByText(/without a line:\s*1\b|без позиції:\s*1\b/i)).toBeInTheDocument();
  });

  it('reports unposted drafts on their own line and leaves «Наша» untouched', () => {
    render(
      <Reconciliation
        products={[weighed()]}
        drafts={[
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
        ]}
        shiftClosed
        acceptedAnything
        pointName="Шипинки"
      />,
    );
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('338.50 kg')).toBeInTheDocument(); // NOT 350.50
    expect(screen.getByText(/12\.00/)).toBeInTheDocument();
    expect(screen.getByText(/not recorded yet|не проведено/i)).toBeInTheDocument();
  });

  it('says there is nothing to compare when the day accepted nothing', () => {
    render(<Reconciliation products={[]} drafts={[]} shiftClosed acceptedAnything={false} pointName="Шипинки" />);
    expect(screen.getByText(/nothing to compare|порівнювати ні з чим/i)).toBeInTheDocument();
  });

  it('shows a surplus as a surplus, not as a negative shortfall', () => {
    render(
      <Reconciliation
        products={[weighed({ missing_kg: '-4.00', missing_amount: '-280.00' })]}
        drafts={[]}
        shiftClosed
        acceptedAnything
        pointName="Шипинки"
      />,
    );
    expect(screen.getByText(/surplus|надлишок/i)).toBeInTheDocument();
    // Row-level: the SIGNED Diff cell itself must read as a surplus (a
    // leading `+` on the absolute value), never as a bare minus in front of
    // what would look like a shortfall — the totals-row label alone does not
    // cover this cell.
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('+4.00 kg')).toBeInTheDocument();
  });
});
