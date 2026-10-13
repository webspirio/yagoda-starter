import { describe, it, expect } from 'vitest';
import { buildLedger } from './buildLedger';

describe('buildLedger', () => {
  it('returns only the two informational rows — the movement rows come from the server (#73)', () => {
    const rows = buildLedger({ date: '2026-09-10', intakes: [], payouts: [] });
    expect(rows.map((r) => r.key)).toEqual(['accruedToday', 'paidPast']);
    expect(rows.map((r) => r.value)).toEqual(['0.00', '0.00']);
  });

  it("sums today's live intakes into the accrued row", () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [
        { business_date: '2026-09-10', amount: '1200.00', voided_at: null },
        { business_date: '2026-09-10', amount: '300.00', voided_at: '2026-09-10T09:00:00Z' },
        { business_date: '2026-09-09', amount: '5000.00', voided_at: null },
      ],
      payouts: [],
    });
    expect(rows.find((r) => r.key === 'accruedToday')?.value).toBe('1200.00');
  });

  it('sums payouts of earlier days only into the past row, voided ones included (§9.3)', () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [],
      payouts: [
        { business_date: '2026-09-10', amount: '600.00' },
        { business_date: '2026-09-09', amount: '400.00' },
        { business_date: '2026-09-08', amount: '99.00' },
      ],
    });
    expect(rows.find((r) => r.key === 'paidPast')?.value).toBe('499.00');
  });

  describe('truncation — every row says when its own page was capped', () => {
    const capped = (over: Record<string, boolean>) =>
      buildLedger({ date: '2026-09-10', intakes: [], payouts: [], ...over })
        .filter((r) => r.truncated)
        .map((r) => r.key);

    it('marks the intakes-fed row when the intakes page was capped', () => {
      expect(capped({ intakesTruncated: true })).toEqual(['accruedToday']);
    });

    it('marks the payouts-fed row when the payouts page was capped', () => {
      expect(capped({ payoutsTruncated: true })).toEqual(['paidPast']);
    });

    it('marks nothing when every page came back whole', () => {
      expect(capped({})).toEqual([]);
    });
  });

  it('counts as «past» only payouts before the shift the total is made of (#114)', () => {
    const rows = buildLedger({
      date: '2026-09-23',
      shiftDate: '2026-09-20',
      intakes: [],
      payouts: [
        { business_date: '2026-09-23', amount: '1.00' },
        { business_date: '2026-09-20', amount: '300.00' },
        { business_date: '2026-09-19', amount: '99.00' },
      ],
    });
    expect(rows.find((r) => r.key === 'paidPast')?.value).toBe('99.00');
  });
});
