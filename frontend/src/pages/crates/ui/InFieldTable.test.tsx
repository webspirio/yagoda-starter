import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import { expectNoAxeViolations } from '../../../test-axe';
import { InFieldTable } from './InFieldTable';
import type { CrateBalanceRow, CrateStanding } from '@/entities/crate';

const standing: CrateStanding = {
  collection_point_id: 'p1', allotment: 800, received: 808, on_hand: 341, in_field: 195,
  deposit_units: 115, deposit_held: '13800.00', with_berry: 264, total: 800, shortfall: 0,
};
const row = (over: Partial<CrateBalanceRow> & Pick<CrateBalanceRow, 'supplier_id'>): CrateBalanceRow => ({
  first_name: 'Василь', last_name: 'Яремчук', is_active: true, collection_point_id: 'p1',
  outstanding_units: 90, deposit_held: '2400.00', has_receipt: true,
  deposit_units: 20, receipt_units: 70, ...over,
});
const props = (rows: CrateBalanceRow[], over = {}) => ({
  rows, holders: rows.length, standing, truncated: false,
  renderDocs: (id: string) => <div data-testid={`docs-${id}`} />, ...over,
});

// The Ukrainian-plurals test below switches language — reset unconditionally
// (even on a failed assertion) so it never leaks into a later file's "runs in
// ENGLISH" assumption. Mirrors `WeighingForm.test.tsx`'s own convention.
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('InFieldTable', () => {
  it('shows both counts for a person holding both kinds', () => {
    render(<InFieldTable {...props([row({ supplier_id: 's1' })])} />);
    expect(screen.getByText('Deposit 20 · receipt 70')).toBeInTheDocument();
  });

  it('prints «—» in the deposit column for a receipt-only holder, never a zero', () => {
    render(<InFieldTable {...props([row({ supplier_id: 's2', deposit_units: 0, receipt_units: 90, deposit_held: '0.00' })])} />);
    const cells = within(screen.getByRole('row', { name: /Яремчук/ })).getAllByRole('cell');
    expect(cells[cells.length - 1]).toHaveTextContent('—');
  });

  /** The TOTAL row reads the server, never the (paginated) page. */
  it('takes the totals from the standing, not from the rows', () => {
    render(<InFieldTable {...props([row({ supplier_id: 's1' })], { holders: 11, truncated: true })} />);
    const total = screen.getByRole('row', { name: /total/i });
    expect(total).toHaveTextContent('195');
    expect(total).toHaveTextContent('of which 115 on a deposit');
    expect(total).toHaveTextContent('13,800.00');
    expect(screen.getByText(/showing the first 1 of 11/i)).toBeInTheDocument();
  });

  it('expands a row to show that person\'s documents', async () => {
    render(<InFieldTable {...props([row({ supplier_id: 's1' })])} />);
    const toggle = screen.getByRole('button', { name: /Василь Яремчук/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('docs-s1')).toBeInTheDocument();
  });

  it('declines «особа» in Ukrainian', async () => {
    await i18n.changeLanguage('uk');
    render(<InFieldTable {...props([row({ supplier_id: 's1' })], { holders: 11 })} />);
    expect(screen.getByText('195 ящ. · 11 осіб')).toBeInTheDocument();
  });

  /** #1 — a person who returned everything must stay reachable so their
   *  documents can still be voided. */
  it('shows a zero row with «—» for how/deposit, units 0, and still expands', async () => {
    render(
      <InFieldTable
        {...props([
          row({ supplier_id: 's3', outstanding_units: 0, deposit_units: 0, receipt_units: 0, deposit_held: '0.00' }),
        ])}
      />,
    );
    const dataRow = screen.getByRole('row', { name: /Яремчук/ });
    const cells = within(dataRow).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('0');
    expect(cells[1]).toHaveTextContent('—');
    expect(cells[2]).toHaveTextContent('—');

    const toggle = within(dataRow).getByRole('button', { name: /Василь Яремчук/ });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('docs-s3')).toBeInTheDocument();
  });

  it('is accessible', async () => {
    const { container } = render(<InFieldTable {...props([row({ supplier_id: 's1' })])} />);
    await expectNoAxeViolations(container);
  });
});
