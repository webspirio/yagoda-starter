import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { CashLedger } from './CashLedger';

describe('CashLedger', () => {
  it('shows the backend cash figure as the total, not the sum of the rows', () => {
    // Rows sum to 900.00 (600 paid − nothing else), but the server says 1000.00.
    render(
      <CashLedger
        date="2026-09-10"
        cash="1000.00"
        intakes={[]}
        payouts={[{ business_date: '2026-09-10', amount: '600.00', voided_at: null }]}
        transfers={[]}
      />,
    );

    expect(screen.getByText('1,000.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText('900.00 ₴')).toBeNull();
    expect(screen.queryByText('-900.00 ₴')).toBeNull();
  });

  it('shows an outflow row with a minus sign', () => {
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[]}
        payouts={[{ business_date: '2026-09-10', amount: '600.00', voided_at: null }]}
        transfers={[]}
      />,
    );

    expect(screen.getByText("Paid for today's berries")).toBeInTheDocument();
    expect(screen.getByText('−600.00 ₴')).toBeInTheDocument();
  });

  it('shows an inflow row without a minus sign', () => {
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[]}
        payouts={[]}
        transfers={[
          {
            accepted_date: '2026-09-10',
            status: 'accepted',
            voided_at: null,
            cash: '500.00',
            reported_cash: null,
            resolved_cash: null,
          },
        ]}
      />,
    );

    expect(screen.getByText('500.00 ₴')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <CashLedger date="2026-09-10" cash="0.00" intakes={[]} payouts={[]} transfers={[]} />,
    );
    await expectNoAxeViolations(container);
  });
});
