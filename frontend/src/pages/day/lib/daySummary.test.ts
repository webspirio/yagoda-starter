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

  it('keeps a voided payout out of the cash-out and the split', () => {
    const s = buildDaySummary(
      [intake('100.00', '1.00')],
      [payout('40.00', { intake_id: 'i1', voided_at: '2026-09-08T12:00:00Z' })],
    );
    expect(s.cashOut).toBe('0.00');
    expect(s.paidAtReception).toBe('0.00');
    expect(s.debtGrowth).toBe('100.00');
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
      voidedNotReturned: '0.00',
    });
  });
});
