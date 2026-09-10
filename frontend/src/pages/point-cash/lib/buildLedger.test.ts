import { describe, it, expect } from 'vitest';
import { buildLedger } from './buildLedger';

describe('buildLedger', () => {
  it("splits payouts into today's berry and past debts", () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [{ business_date: '2026-09-10', amount: '1000.00', voided_at: null }],
      payouts: [
        { business_date: '2026-09-10', amount: '600.00', voided_at: null },
        { business_date: '2026-09-09', amount: '400.00', voided_at: null },
      ],
      transfers: [],
    });
    expect(rows.find((r) => r.key === 'paidToday')?.value).toBe('600.00');
    expect(rows.find((r) => r.key === 'paidPast')?.value).toBe('400.00');
  });

  it('ignores voided documents — a void is not a movement', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [{ business_date: '2026-09-10', amount: '999.00', voided_at: '2026-09-10T10:00:00Z' }],
      transfers: [],
    });
    expect(rows.find((r) => r.key === 'paidToday')?.value).toBe('0.00');
  });

  it('counts a transfer at what was actually credited, not what was sent', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [],
      transfers: [
        {
          accepted_date: '2026-09-10', status: 'disputed', voided_at: null,
          cash: '50000.00', reported_cash: '49500.00', resolved_cash: null,
        },
      ],
    });
    // §7.9 (ред. 09.09.2026): неврегульований спір зараховує ЧИСЛО ТОЧКИ.
    expect(rows.find((r) => r.key === 'cashIn')?.value).toBe('49500.00');
  });

  it('sums today\'s live intakes into an informational "accrued" row', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [
        { business_date: '2026-09-10', amount: '1200.00', voided_at: null },
        { business_date: '2026-09-10', amount: '300.00', voided_at: '2026-09-10T09:00:00Z' },
        { business_date: '2026-09-09', amount: '5000.00', voided_at: null },
      ],
      payouts: [],
      transfers: [],
    });
    expect(rows.find((r) => r.key === 'accruedToday')?.value).toBe('1200.00');
  });

  it('excludes a transfer accepted on a different date', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [],
      transfers: [
        {
          accepted_date: '2026-09-09', status: 'accepted', voided_at: null,
          cash: '1000.00', reported_cash: null, resolved_cash: null,
        },
      ],
    });
    expect(rows.find((r) => r.key === 'cashIn')?.value).toBe('0.00');
  });

  it('excludes a transfer still in transit — no accepted_date yet', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [],
      transfers: [
        {
          accepted_date: null, status: 'sent', voided_at: null,
          cash: '1000.00', reported_cash: null, resolved_cash: null,
        },
      ],
    });
    expect(rows.find((r) => r.key === 'cashIn')?.value).toBe('0.00');
  });

  it('excludes a voided transfer even when it was accepted today — §9.3', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [],
      transfers: [
        {
          accepted_date: '2026-09-10', status: 'accepted', voided_at: '2026-09-10T12:00:00Z',
          cash: '1000.00', reported_cash: null, resolved_cash: null,
        },
      ],
    });
    expect(rows.find((r) => r.key === 'cashIn')?.value).toBe('0.00');
  });

  it('prefers resolved_cash once the owner has settled the dispute', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [],
      transfers: [
        {
          accepted_date: '2026-09-10', status: 'disputed', voided_at: null,
          cash: '50000.00', reported_cash: '49500.00', resolved_cash: '49800.00',
        },
      ],
    });
    expect(rows.find((r) => r.key === 'cashIn')?.value).toBe('49800.00');
  });

  it('falls back to the sent amount for a plain accepted transfer', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [],
      transfers: [
        {
          accepted_date: '2026-09-10', status: 'accepted', voided_at: null,
          cash: '2500.00', reported_cash: null, resolved_cash: null,
        },
      ],
    });
    expect(rows.find((r) => r.key === 'cashIn')?.value).toBe('2500.00');
  });

  it('returns every bucket at 0.00 for a point with no documents at all', () => {
    const rows = buildLedger({ date: '2026-09-10', intakes: [], payouts: [], transfers: [] });
    expect(rows.map((r) => r.value)).toEqual(['0.00', '0.00', '0.00', '0.00']);
  });
});
