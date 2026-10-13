import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import type { PointCashBreakdown } from '@/entities/point-cash';
import { CashLedger } from './CashLedger';

const open = (over: Partial<PointCashBreakdown> = {}): PointCashBreakdown => ({
  kind: 'open',
  anchor_date: '2026-09-23',
  opening: '43730.00',
  transfers_in: '15000.00',
  payouts: '4000.00',
  returns: '0.00',
  closing: null,
  ...over,
});

const closed = (
  closing: Partial<NonNullable<PointCashBreakdown['closing']>> = {},
): PointCashBreakdown => ({
  kind: 'closed',
  anchor_date: '2026-09-22',
  opening: '21820.00',
  transfers_in: '35000.00',
  payouts: '13000.00',
  returns: '0.00',
  closing: {
    counted: '43730.00',
    expected: '43820.00',
    difference: '-90.00',
    late_change: '0.00',
    ...closing,
  },
});

const NONE: PointCashBreakdown = {
  kind: 'none',
  anchor_date: null,
  opening: null,
  transfers_in: null,
  payouts: null,
  returns: null,
  closing: null,
};

/** The `LedgerRow` labelled `label` — `getByText` reads the label's own text, not its hint. */
const row = (label: string) => screen.getByText(label).closest('div') as HTMLElement;
/** The printed figure of that row. */
const value = (label: string) => row(label).querySelector('.font-mono') as HTMLElement;

const ledger = (
  breakdown: PointCashBreakdown | undefined,
  cash: string | undefined,
  date = '2026-09-23',
  failed = false,
) =>
  render(
    <CashLedger
      date={date}
      cash={cash}
      breakdown={breakdown}
      failed={failed}
      intakes={[]}
      payouts={[]}
    />,
  );

describe('CashLedger', () => {
  it('open day — the rows add up to the total exactly (Shypynky 23.09: 43 730 − 4 000 + 0 + 15 000 = 54 730)', () => {
    ledger(open(), '54730.00');

    expect(value('Opening count')).toHaveTextContent('43,730.00 ₴');
    expect(value('Paid out today')).toHaveTextContent('−4,000.00 ₴');
    expect(value('Returned to the drawer')).toHaveTextContent('0.00 ₴');
    expect(value('Received by transfer today')).toHaveTextContent('15,000.00 ₴');
    expect(value('Berry cash')).toHaveTextContent('54,730.00 ₴');
    expect(screen.queryByText('Expected')).toBeNull();
  });

  it('closed day — expected, counted and the difference by number; the total under them is the closing count', () => {
    ledger(closed(), '43730.00', '2026-09-22');

    expect(value('Expected')).toHaveTextContent('43,820.00 ₴');
    expect(value('Counted at close')).toHaveTextContent('43,730.00 ₴');
    expect(value('Discrepancy')).toHaveTextContent('−90.00 ₴');
    expect(value('Berry cash')).toHaveTextContent('43,730.00 ₴');
    expect(screen.queryByText('Changed after close')).toBeNull();
  });

  it('closed day — a shortage reads bad, a surplus amber, zero neither', () => {
    const shortage = ledger(closed(), '43730.00', '2026-09-22');
    expect(value('Discrepancy')).toHaveClass('text-destructive');
    shortage.unmount();

    const surplus = ledger(
      closed({ counted: '43900.00', difference: '80.00' }),
      '43900.00',
      '2026-09-22',
    );
    expect(value('Discrepancy')).toHaveClass('text-[var(--amber)]');
    surplus.unmount();

    ledger(closed({ counted: '43820.00', difference: '0.00' }), '43820.00', '2026-09-22');
    expect(value('Discrepancy')).toHaveClass('text-foreground');
  });

  it('closed day — a change after close is its own line, signed so the rows still reach Expected', () => {
    // A 1 000 transfer voided after close: late_change −1 000; the line adds it back.
    ledger(
      closed({
        expected: '44820.00',
        counted: '44820.00',
        difference: '0.00',
        late_change: '-1000.00',
      }),
      '44820.00',
      '2026-09-22',
    );

    expect(value('Changed after close')).toHaveTextContent('1,000.00 ₴');
    expect(value('Expected')).toHaveTextContent('44,820.00 ₴');
  });

  it('carried — one line for the last close, no movement rows', () => {
    ledger(
      {
        ...NONE,
        kind: 'carried',
        anchor_date: '2026-09-22',
        closing: { counted: '43730.00', expected: null, difference: null, late_change: null },
      },
      '43730.00',
      '2026-09-24',
    );

    expect(value('Counted at close 09/22')).toHaveTextContent('43,730.00 ₴');
    expect(screen.getByText('No shift that day')).toBeInTheDocument();
    expect(screen.queryByText('Paid out today')).toBeNull();
    expect(value('Berry cash')).toHaveTextContent('43,730.00 ₴');
  });

  it('none — says the drawer was never counted', () => {
    ledger(NONE, '0.00');

    expect(screen.getByText('No cash counts recorded for this point yet.')).toBeInTheDocument();
    expect(screen.queryByText('Opening count')).toBeNull();
    expect(value('Berry cash')).toHaveTextContent('0.00 ₴');
  });

  it('open since an earlier day (#114) — says whose movements the rows are', () => {
    ledger(open({ anchor_date: '2026-09-20' }), '54730.00', '2026-09-23');

    expect(screen.getByText('Shift open since 09/20')).toBeInTheDocument();
  });

  it('says nothing about an earlier day when the shift opened on the date shown', () => {
    ledger(open(), '54730.00', '2026-09-23');

    expect(screen.queryByText(/open since/i)).toBeNull();
  });

  it('a failed detail read says so inside the card and prints no total', () => {
    ledger(undefined, undefined, '2026-09-23', true);

    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText('Berry cash')).toBeNull();
  });

  it('captions the opening row with the target when there is one', () => {
    render(
      <CashLedger
        date="2026-09-23"
        cash="54730.00"
        breakdown={open()}
        intakes={[]}
        payouts={[]}
        target="5000.00"
      />,
    );

    expect(screen.getByText('target 5,000.00 ₴')).toBeInTheDocument();
  });

  it('keeps the informational rows apart from the sum', () => {
    render(
      <CashLedger
        date="2026-09-23"
        cash="54730.00"
        breakdown={open()}
        intakes={[{ business_date: '2026-09-23', amount: '700.00', voided_at: null }]}
        payouts={[{ business_date: '2026-09-20', amount: '300.00' }]}
      />,
    );

    expect(value('Accrued today')).toHaveTextContent('700.00 ₴');
    expect(row('Accrued today').className).toContain('opacity-70');
    expect(value('Paid for past days')).toHaveTextContent('−300.00 ₴');
    expect(row('Paid for past days').className).toContain('opacity-70');
  });

  it('warns under an informational row whose page was capped', () => {
    render(
      <CashLedger
        date="2026-09-23"
        cash="54730.00"
        breakdown={open()}
        intakes={[]}
        payouts={[]}
        intakesTruncated
        payoutsTruncated
      />,
    );

    expect(row('Accrued today').nextElementSibling).toHaveTextContent(
      /Showing recent receipts only/,
    );
    expect(row('Paid for past days').nextElementSibling).toHaveTextContent(
      /Showing recent payouts only/,
    );
  });

  describe('negative-cash notice', () => {
    it('shows the notice when the total has gone negative', () => {
      ledger(open(), '-50.00');
      expect(screen.getByText(/Berry cash has gone negative/)).toBeInTheDocument();
    });

    it('says nothing when the total is not negative', () => {
      ledger(open(), '54730.00');
      expect(screen.queryByText(/Berry cash has gone negative/)).toBeNull();
    });
  });

  it('prints the two-rows footnote, unconditionally', () => {
    ledger(NONE, '0.00');
    expect(screen.getByText(/Payouts show as two rows on purpose/)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = ledger(closed(), '43730.00', '2026-09-22');
    await expectNoAxeViolations(container);
  });
});
