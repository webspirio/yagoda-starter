import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { CashLedger } from './CashLedger';

describe('CashLedger', () => {
  it('shows the backend cash figure as the total, not the sum of the rows', () => {
    // paidToday alone comes to 600.00 (its business_date matches `date`);
    // every other row is 0.00. Naively summing buildLedger's own (unsigned)
    // row values would read 600.00 — a different, and wrong, number from
    // the server's 1,000.00.
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

    const total = screen.getByText('Berry cash').closest('div');
    expect(total).toHaveTextContent('1,000.00 ₴');
    // Never the naive row-sum. 600.00 (unsigned) would only appear if the
    // total were computed by adding buildLedger's raw magnitudes instead of
    // reading the `cash` prop — paidToday's own row always shows it signed
    // (−600.00 ₴), never bare, so a bare "600.00 ₴" anywhere is the tell.
    expect(screen.queryByText('600.00 ₴')).toBeNull();
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

    expect(screen.getByText('Paid out today')).toBeInTheDocument();
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

  it("sets paid-for-past-days visibly apart too — it explains no term of the server's formula", () => {
    // review round 2, finding 2: `paidPast` maps onto nothing in
    // `movementsSql` (an earlier day's payout is already folded into an
    // earlier drawer count), so it gets the SAME informational treatment
    // `accruedToday` already has, not the treatment of a row that actually
    // moves today's cash.
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[]}
        payouts={[
          { business_date: '2026-09-09', amount: '400.00', voided_at: null, return_settled_at: null },
        ]}
        transfers={[]}
      />,
    );

    const pastLabel = screen.getByText('Paid for past days');
    expect(screen.getByText("not part of today's figure")).toBeInTheDocument();
    expect(pastLabel.closest('div')?.className).toContain('opacity-70');
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

    const pastRow = screen.getByText('Paid for past days').closest('div');
    expect(pastRow?.nextElementSibling?.tagName).toBe('P');
    expect(pastRow?.nextElementSibling).toHaveTextContent(
      /Showing recent payouts only — older ones may be missing/,
    );
  });

  it('warns under «returned to the drawer» too — it reads the same truncated payouts array', () => {
    // `returnedToday` sums `payouts.filter(p => p.return_settled_at !== null
    // …)` over the SAME array `paidPast` reads — fix round 1's minor
    // finding: a settled return whose payout fell outside the fetched page
    // vanishes with no caveat unless this row carries one too. The row
    // renders (at 0.00) even with an empty `payouts` array, so this reuses
    // the exact fixture the sibling «paid for past days» truncation test
    // uses — the only change is which row's sibling `<p>` is asserted on.
    render(
      <CashLedger date="2026-09-10" cash="0.00" intakes={[]} payouts={[]} transfers={[]} payoutsTruncated />,
    );

    const returnedRow = screen.getByText('Returned to the drawer').closest('div');
    expect(returnedRow?.nextElementSibling?.tagName).toBe('P');
    expect(returnedRow?.nextElementSibling).toHaveTextContent(
      /Showing recent payouts only — older ones may be missing/,
    );
  });

  it('warns under «received by transfer today» when the transfers read was truncated', () => {
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[]}
        payouts={[]}
        transfers={[]}
        transfersTruncated
      />,
    );

    const cashInRow = screen.getByText('Received by transfer today').closest('div');
    expect(cashInRow?.nextElementSibling?.tagName).toBe('P');
    // Named for what is actually missing: a row fed by the transfers page
    // must not tell the reader that older PAYOUTS may be missing from it.
    expect(cashInRow?.nextElementSibling).toHaveTextContent(
      /Showing recent transfers only — older ones may be missing/,
    );
    expect(screen.queryByText(/recent payouts only/)).toBeNull();
  });

  it('warns under «accrued today» when the intakes read was truncated', () => {
    render(
      <CashLedger
        date="2026-09-10"
        cash="0.00"
        intakes={[]}
        payouts={[]}
        transfers={[]}
        intakesTruncated
      />,
    );

    const accruedRow = screen.getByText('Accrued today').closest('div');
    expect(accruedRow?.nextElementSibling?.tagName).toBe('P');
    expect(accruedRow?.nextElementSibling).toHaveTextContent(
      /Showing recent receipts only — older ones may be missing/,
    );
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

  describe('opening row — R6', () => {
    it('shows the opening row only when an opening count was passed', () => {
      render(
        <CashLedger
          date="2026-09-10"
          cash="0.00"
          intakes={[]}
          payouts={[]}
          transfers={[]}
          openingCount="1500.00"
        />,
      );

      expect(screen.getByText('Opening count')).toBeInTheDocument();
      expect(screen.getByText('1,500.00 ₴')).toBeInTheDocument();
    });

    it('shows no opening row at all without one', () => {
      render(
        <CashLedger date="2026-09-10" cash="0.00" intakes={[]} payouts={[]} transfers={[]} />,
      );

      expect(screen.queryByText('Opening count')).toBeNull();
    });

    it('shows the target hint only when a target is assigned', () => {
      render(
        <CashLedger
          date="2026-09-10"
          cash="0.00"
          intakes={[]}
          payouts={[]}
          transfers={[]}
          openingCount="1500.00"
          target="5000.00"
        />,
      );

      expect(screen.getByText('target 5,000.00 ₴')).toBeInTheDocument();
    });

    it('shows the opening row with no hint at all when the point has no target', () => {
      render(
        <CashLedger
          date="2026-09-10"
          cash="0.00"
          intakes={[]}
          payouts={[]}
          transfers={[]}
          openingCount="1500.00"
        />,
      );

      expect(screen.getByText('Opening count')).toBeInTheDocument();
      expect(screen.queryByText(/^target /)).toBeNull();
    });

    it('still prints the server cash as the total, not the opening count plus the rows', () => {
      // Rule 1 must survive the new row: `cash` alone is the total, whatever
      // `openingCount` says.
      render(
        <CashLedger
          date="2026-09-10"
          cash="1000.00"
          intakes={[]}
          payouts={[]}
          transfers={[]}
          openingCount="1500.00"
        />,
      );

      const total = screen.getByText('Berry cash').closest('div');
      expect(total).toHaveTextContent('1,000.00 ₴');
    });
  });

  describe('negative-cash notice — R6', () => {
    it('shows the notice when the total has gone negative', () => {
      render(
        <CashLedger date="2026-09-10" cash="-100.00" intakes={[]} payouts={[]} transfers={[]} />,
      );

      expect(screen.getByText(/Berry cash has gone negative/)).toBeInTheDocument();
    });

    it('says nothing when the total is not negative', () => {
      render(
        <CashLedger date="2026-09-10" cash="0.00" intakes={[]} payouts={[]} transfers={[]} />,
      );

      expect(screen.queryByText(/Berry cash has gone negative/)).toBeNull();
    });
  });

  it('prints the two-rows footnote, unconditionally', () => {
    render(<CashLedger date="2026-09-10" cash="0.00" intakes={[]} payouts={[]} transfers={[]} />);

    expect(screen.getByText(/Payouts show as two rows on purpose/)).toBeInTheDocument();
  });
});
