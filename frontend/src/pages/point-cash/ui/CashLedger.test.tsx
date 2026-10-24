import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import type { PointCashBreakdown } from '@/entities/point-cash';
import { sum } from '@/shared/lib/money';
import { TraceScope } from '@/shared/ui/trace';
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
/** That figure as a decimal string, sign included — for adding rows up. */
const amount = (label: string) =>
  (value(label).textContent ?? '')
    .replace('\u2212', '-')
    .replace(/[^\d.+-]/g, '')
    .replace('+', '');

const ledger = (
  breakdown: PointCashBreakdown | undefined,
  cash: string | undefined,
  date = '2026-09-23',
  failed = false,
) =>
  render(<CashLedger date={date} cash={cash} breakdown={breakdown} failed={failed} intakes={[]} />);

/** The named difference of a closed day (C7). */
const difference = () => row('Difference').querySelector('[data-discrepancy]') as HTMLElement;

describe('CashLedger', () => {
  it('open day — the rows add up to the total exactly (Shypynky 23.09: 43 730 − 4 000 + 0 + 15 000 = 54 730)', () => {
    ledger(open(), '54730.00');

    expect(value('Opening count')).toHaveTextContent('43,730.00 ₴');
    expect(value('Paid out for the day')).toHaveTextContent('−4,000.00 ₴');
    expect(value('Returned to the drawer')).toHaveTextContent('0.00 ₴');
    expect(value('Received by transfer for the day')).toHaveTextContent('15,000.00 ₴');
    expect(value('Berry cash')).toHaveTextContent('54,730.00 ₴');
    expect(screen.queryByText('Should be')).toBeNull();
  });

  it('closed day — expected, counted and the difference by number; the total under them is the closing count', () => {
    ledger(closed(), '43730.00', '2026-09-22');

    expect(value('Should be')).toHaveTextContent('43,820.00 ₴');
    expect(value('Counted')).toHaveTextContent('43,730.00 ₴');
    // Named, never a bare «−90.00» under «Discrepancy» (C7).
    expect(difference()).toHaveTextContent('Short 90.00 ₴');
    expect(value('Berry cash — counted at close')).toHaveTextContent('43,730.00 ₴');
    expect(screen.queryByText('Berry cash')).toBeNull();
    expect(screen.queryByText('Changed after the close')).toBeNull();
  });

  it('closed day — a shortage reads bad, a surplus amber, zero neither', () => {
    const shortage = ledger(closed(), '43730.00', '2026-09-22');
    expect(difference()).toHaveClass('text-destructive');
    shortage.unmount();

    const surplus = ledger(
      closed({ counted: '43900.00', difference: '80.00' }),
      '43900.00',
      '2026-09-22',
    );
    expect(difference()).toHaveClass('text-[var(--amber)]');
    // A surplus says so in words too, not by colour alone.
    expect(difference()).toHaveTextContent('Over 80.00 ₴');
    surplus.unmount();

    ledger(closed({ counted: '43820.00', difference: '0.00' }), '43820.00', '2026-09-22');
    expect(difference()).toHaveTextContent('Matched');
    expect(difference()).toHaveClass('text-[var(--leaf)]');
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

    // Exact, not a substring: «−1,000.00 ₴» contains «1,000.00 ₴».
    expect(amount('Changed after the close')).toBe('1000.00');
    const rows = [
      'Opening count',
      'Paid out for the day',
      'Returned to the drawer',
      'Received by transfer for the day',
      'Changed after the close',
    ];
    expect(sum(rows.map(amount))).toBe(amount('Should be'));
    expect(amount('Should be')).toBe('44820.00');
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

    expect(value('Counted at close on 09/22')).toHaveTextContent('43,730.00 ₴');
    expect(screen.getByText('No shift that day')).toBeInTheDocument();
    expect(screen.queryByText('Paid out for the day')).toBeNull();
    expect(value('Berry cash')).toHaveTextContent('43,730.00 ₴');
  });

  it('none — says the drawer was never counted', () => {
    ledger(NONE, '0.00');

    expect(screen.getByText('No cash counts recorded for this point yet.')).toBeInTheDocument();
    expect(screen.queryByText('Opening count')).toBeNull();
    expect(value('Berry cash')).toHaveTextContent('0.00 ₴');
  });

  it('open since an earlier day (#114) — the rows are labelled for the shift, not «today»', () => {
    render(
      <CashLedger
        date="2026-10-14"
        cash="20910.00"
        breakdown={open({ anchor_date: '2026-10-13' })}
        intakes={[{ business_date: '2026-10-13', amount: '23986.30', voided_at: null }]}
      />,
    );

    expect(value('Accrued this shift')).toHaveTextContent('23,986.30 ₴');
    expect(value('Opening count on 10/13')).toHaveTextContent('43,730.00 ₴');
    expect(value('Paid out this shift')).toHaveTextContent('−4,000.00 ₴');
    expect(value('Received by transfer this shift')).toHaveTextContent('15,000.00 ₴');
    expect(screen.queryByText(/today/i)).toBeNull();
  });

  // C6 — the page reads past dates too: no row ever says «today».
  it('labels the rows «for the day» when the shift opened on the date shown, never «today»', () => {
    ledger(open(), '54730.00', '2026-09-23');

    expect(screen.getByText('Paid out for the day')).toBeInTheDocument();
    expect(screen.queryByText(/this shift/i)).toBeNull();
    expect(screen.queryByText(/today/i)).toBeNull();
  });

  it('a failed detail read says so inside the card and prints no total', () => {
    ledger(undefined, undefined, '2026-09-23', true);

    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText('Berry cash')).toBeNull();
  });

  // C8 — the target is the tile's to say; the opening row carries no «target …».
  it('does not repeat the target under the opening row', () => {
    ledger(open(), '54730.00');
    expect(screen.queryByText(/target/i)).toBeNull();
  });

  it('keeps the informational rows apart from the sum', () => {
    render(
      <CashLedger
        date="2026-09-23"
        cash="54730.00"
        breakdown={open()}
        intakes={[{ business_date: '2026-09-23', amount: '700.00', voided_at: null }]}
      />,
    );

    expect(value('Accrued for the day')).toHaveTextContent('700.00 ₴');
    expect(row('Accrued for the day').className).toContain('opacity-70');
    // C1 — no season-long «paid for past days» running total any more.
    expect(screen.queryByText('Paid for past days')).toBeNull();
  });

  it('warns under an informational row whose page was capped', () => {
    render(
      <CashLedger
        date="2026-09-23"
        cash="54730.00"
        breakdown={open()}
        intakes={[]}
        intakesTruncated
      />,
    );

    expect(row('Accrued for the day').nextElementSibling).toHaveTextContent(
      /Showing recent receipts only/,
    );
  });

  describe('negative-cash notice', () => {
    it("shows the notice when the total has gone negative — amber, the tile's tone (C9)", () => {
      ledger(open(), '-50.00');
      expect(screen.getByText(/Berry cash has gone negative/)).toHaveClass('text-[var(--amber)]');
      expect(value('Berry cash')).toHaveClass('text-[var(--amber)]');
    });

    it('says nothing when the total is not negative', () => {
      ledger(open(), '54730.00');
      expect(screen.queryByText(/Berry cash has gone negative/)).toBeNull();
    });
  });

  // 24.10 — «звідки це число»: the rows, added up in boxed operands.
  describe('traced formula', () => {
    const formula = () => document.querySelector('[data-ledger-formula]') as HTMLElement;
    const terms = () => [...formula().querySelectorAll<HTMLElement>('[data-slot="trace-term"]')];

    it('open day — opening − paid + returned + transfers = the total, each operand a term', () => {
      ledger(open(), '54730.00');
      expect(formula()).toHaveTextContent('43,730.00 ₴−4,000.00 ₴+0.00 ₴+15,000.00 ₴=54,730.00 ₴');
      expect(terms().map((el) => el.dataset.trace)).toEqual([
        'ledger:opening',
        'ledger:paid',
        'ledger:returned',
        'ledger:transfersIn',
        'ledger:total cash:total',
      ]);
    });

    it('pointing at an operand lights its ledger row; the total lights the row and the tile', () => {
      render(
        <TraceScope>
          <span data-trace="cash:total">tile</span>
          <CashLedger date="2026-09-23" cash="54730.00" breakdown={open()} intakes={[]} />
        </TraceScope>,
      );
      const paidSource = value('Paid out for the day').querySelector('[data-trace]') as HTMLElement;
      fireEvent.pointerEnter(terms()[1]);
      expect(paidSource).toHaveAttribute('data-trace-hit', 'neutral');
      fireEvent.pointerLeave(terms()[1]);
      expect(paidSource).not.toHaveAttribute('data-trace-hit');

      fireEvent.pointerEnter(terms()[4]);
      expect(screen.getByText('tile')).toHaveAttribute('data-trace-hit', 'neutral');
      expect(value('Berry cash').querySelector('[data-trace]')).toHaveAttribute('data-trace-hit');
    });

    it('closed day — the rows add up to «Should be», a late change with its own operator', () => {
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
      expect(formula()).toHaveTextContent(
        '21,820.00 ₴−13,000.00 ₴+0.00 ₴+35,000.00 ₴+1,000.00 ₴=44,820.00 ₴',
      );
      expect(terms()[terms().length - 1].dataset.trace).toBe('ledger:expected');
    });

    it('no formula where nothing adds up on screen — carried, none, or a close with no expectation', () => {
      const carried = ledger(
        {
          ...NONE,
          kind: 'carried',
          anchor_date: '2026-09-22',
          closing: { counted: '43730.00', expected: null, difference: null, late_change: null },
        },
        '43730.00',
        '2026-09-24',
      );
      expect(formula()).toBeNull();
      carried.unmount();
      ledger(closed({ expected: null, difference: null }), '43730.00', '2026-09-22');
      expect(formula()).toBeNull();
    });
  });

  // Review 24.10 — a closed day with no stored expectation has no difference:
  // «—», never «Matched» read off a defaulted 0.00.
  it('closed day with no stored expectation — the difference and «Should be» read «—»', () => {
    ledger(closed({ expected: null, difference: null }), '43730.00', '2026-09-22');
    expect(difference()).toBeNull();
    expect(value('Difference')).toHaveTextContent(/^—$/);
    expect(value('Should be')).toHaveTextContent(/^—$/);
    expect(screen.queryByText('Matched')).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = ledger(closed(), '43730.00', '2026-09-22');
    await expectNoAxeViolations(container);
  });
});
