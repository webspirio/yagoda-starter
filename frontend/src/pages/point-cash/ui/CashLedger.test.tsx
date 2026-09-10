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
        payouts={[
          { business_date: '2026-09-10', amount: '600.00', voided_at: null, return_settled_at: null },
        ]}
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
        payouts={[
          { business_date: '2026-09-10', amount: '600.00', voided_at: null, return_settled_at: null },
        ]}
        transfers={[]}
      />,
    );

    expect(screen.getByText("Paid for today's berries")).toBeInTheDocument();
    expect(screen.getByText('−600.00 ₴')).toBeInTheDocument();
  });

  it('keeps a voided payout counted in the outflow row (§9.3 — voiding does not return the cash)', () => {
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[]}
        payouts={[
          {
            business_date: '2026-09-10',
            amount: '999.00',
            voided_at: '2026-09-10T10:00:00Z',
            return_settled_at: null,
          },
        ]}
        transfers={[]}
      />,
    );

    expect(screen.getByText('−999.00 ₴')).toBeInTheDocument();
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

  it('shows a settled return as an inflow, on the day it was returned', () => {
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[]}
        payouts={[
          {
            business_date: '2026-09-05',
            amount: '8000.00',
            voided_at: '2026-09-06T08:00:00Z',
            return_settled_at: '2026-09-10T12:00:00Z',
          },
        ]}
        transfers={[]}
      />,
    );

    expect(screen.getByText('Returned to the drawer')).toBeInTheDocument();
    expect(screen.getByText('8,000.00 ₴')).toBeInTheDocument();
  });

  it('sets the accrued-today row visibly apart, with a caption saying it moves no cash', () => {
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[{ business_date: '2026-09-10', amount: '1200.00', voided_at: null }]}
        payouts={[]}
        transfers={[]}
      />,
    );

    const accruedLabel = screen.getByText('Accrued today');
    expect(screen.getByText('does not move cash')).toBeInTheDocument();
    // The distinguishing treatment lives on the row, not just the caption text.
    expect(accruedLabel.closest('div')?.className).toContain('opacity-70');
  });

  it('warns under «paid for past days» when the payouts read was truncated', () => {
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[]}
        payouts={[]}
        transfers={[]}
        payoutsTruncated
      />,
    );

    expect(
      screen.getByText(/Showing recent payouts only — older ones may be missing/),
    ).toBeInTheDocument();
  });

  it('says nothing about truncation when the payouts read came back whole', () => {
    render(
      <CashLedger date="2026-09-10" cash="0.00" intakes={[]} payouts={[]} transfers={[]} />,
    );

    expect(screen.queryByText(/older ones may be missing/)).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <CashLedger date="2026-09-10" cash="0.00" intakes={[]} payouts={[]} transfers={[]} />,
    );
    await expectNoAxeViolations(container);
  });
});
