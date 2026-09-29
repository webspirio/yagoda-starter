import { describe, it, expect } from 'vitest';
import { buildDaySummary, type SummaryIntake, type SummaryPayout } from './daySummary';

const intake = (amount: string, net_kg: string, voided = false): SummaryIntake => ({
  amount,
  net_kg,
  voided_at: voided ? '2026-09-08T10:00:00Z' : null,
});

const payout = (
  amount: string,
  over: Partial<Omit<SummaryPayout, 'amount'>> = {},
): SummaryPayout => ({
  amount,
  intake_id: null,
  voided_at: null,
  return_settled_at: null,
  returned_on_void: false,
  ...over,
});

describe('buildDaySummary', () => {
  it('totals kilograms, receipts and accrued over the live intakes only', () => {
    const s = buildDaySummary(
      [intake('100.00', '10.50'), intake('50.25', '4.25'), intake('999.00', '99.00', true)],
      [],
    );
    expect(s.netKg).toBe('14.75');
    expect(s.receipts).toBe(2);
    expect(s.accrued).toBe('150.25');
  });

  it('splits the cash by whether it left with a receipt or without one', () => {
    const s = buildDaySummary(
      [intake('1000.00', '10.00')],
      [payout('600.00', { intake_id: 'i1' }), payout('150.00')],
    );
    expect(s.paidAtReception).toBe('600.00');
    expect(s.paidWithoutBerry).toBe('150.00');
    expect(s.cashOut).toBe('750.00');
  });

  it('leaves the rest of the accrued sum as the growth of what we owe', () => {
    const s = buildDaySummary(
      [intake('1000.00', '10.00')],
      [payout('600.00', { intake_id: 'i1' }), payout('150.00')],
    );
    // §«Інваріант дня», as corrected: Σ квитанцій дня − Σ виплат дня.
    expect(s.debtGrowth).toBe('250.00');
  });

  it('lets the growth go negative when old balances were paid down', () => {
    const s = buildDaySummary([intake('100.00', '1.00')], [payout('300.00')]);
    expect(s.debtGrowth).toBe('-200.00');
  });

  it('drops a payout whose cash came back at void time — the screenshot of #170', () => {
    // Everything voided in an OPEN shift: the cash went straight back into this
    // shift's drawer (`returned_on_void`, 2026-09-28), so nothing left it.
    const back = {
      voided_at: '2026-09-08T12:00:00Z',
      return_settled_at: '2026-09-08T12:00:00Z',
      returned_on_void: true,
    };
    const s = buildDaySummary(
      [intake('510.00', '5.00', true)],
      [payout('510.00', { intake_id: 'i1', ...back }), payout('4930.00', back)],
    );
    expect(s.cashOut).toBe('0.00');
    expect(s.voidedOut).toBe('0.00');
  });

  it('keeps a closed-shift void in the cash until its return is confirmed', () => {
    // `movementsSql`: a payout left the drawer; a pending return has not come
    // back, and an owner-confirmed one is credited on ITS OWN date.
    const s = buildDaySummary(
      [intake('100.00', '1.00')],
      [
        payout('60.00', { intake_id: 'i1' }),
        payout('40.00', { intake_id: 'i1', voided_at: '2026-09-08T12:00:00Z' }),
        payout('25.00', {
          voided_at: '2026-09-08T12:00:00Z',
          return_settled_at: '2026-09-10T09:00:00Z',
        }),
      ],
    );
    expect(s.paidAtReception).toBe('60.00');
    expect(s.debtGrowth).toBe('40.00');
    expect(s.cashOut).toBe('125.00');
    expect(s.voidedOut).toBe('65.00');
    expect(s.voidedNotReturned).toBe('40.00');
  });

  it('flags a negative growth once, so no consumer re-derives it', () => {
    expect(buildDaySummary([intake('100.00', '1.00')], [payout('300.00')]).paidDown).toBe(true);
    expect(buildDaySummary([intake('100.00', '1.00')], []).paidDown).toBe(false);
  });

  it('names the cash of voided payouts that has not come back to the drawer yet', () => {
    const s = buildDaySummary(
      [],
      [
        payout('40.00', { voided_at: '2026-09-08T12:00:00Z' }),
        payout('25.00', {
          voided_at: '2026-09-08T12:00:00Z',
          return_settled_at: '2026-09-08T13:00:00Z',
        }),
      ],
    );
    expect(s.voidedNotReturned).toBe('40.00');
  });

  it('is all zeros for an empty day', () => {
    expect(buildDaySummary([], [])).toEqual({
      netKg: '0.00',
      receipts: 0,
      accrued: '0.00',
      paidAtReception: '0.00',
      paidWithoutBerry: '0.00',
      cashOut: '0.00',
      debtGrowth: '0.00',
      paidDown: false,
      voidedOut: '0.00',
      voidedNotReturned: '0.00',
    });
  });
});
