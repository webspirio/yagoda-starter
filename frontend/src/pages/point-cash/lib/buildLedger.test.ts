import { describe, it, expect } from 'vitest';
import { buildLedger } from './buildLedger';

describe('buildLedger', () => {
  it('returns only the accrued row — no season-long «paid on earlier days» (C1); the movement rows come from the server (#73)', () => {
    const rows = buildLedger({ date: '2026-09-10', intakes: [] });
    expect(rows.map((r) => r.key)).toEqual(['accruedToday']);
    expect(rows.map((r) => r.value)).toEqual(['0.00']);
  });

  it("sums today's live intakes into the accrued row", () => {
    const rows = buildLedger({
      date: '2026-09-10',
      intakes: [
        { business_date: '2026-09-10', amount: '1200.00', voided_at: null },
        { business_date: '2026-09-10', amount: '300.00', voided_at: '2026-09-10T09:00:00Z' },
        { business_date: '2026-09-09', amount: '5000.00', voided_at: null },
      ],
    });
    expect(rows.find((r) => r.key === 'accruedToday')?.value).toBe('1200.00');
  });

  describe('truncation — every row says when its own page was capped', () => {
    const capped = (over: Record<string, boolean>) =>
      buildLedger({ date: '2026-09-10', intakes: [], ...over })
        .filter((r) => r.truncated)
        .map((r) => r.key);

    it('marks the intakes-fed row when the intakes page was capped', () => {
      expect(capped({ intakesTruncated: true })).toEqual(['accruedToday']);
    });

    it('marks nothing when every page came back whole', () => {
      expect(capped({})).toEqual([]);
    });
  });

  it('accrues the receipts of a shift left open since an earlier day (#114, PR #242 review)', () => {
    const rows = buildLedger({
      date: '2026-10-14',
      shiftDate: '2026-10-13',
      intakes: [
        { business_date: '2026-10-13', amount: '23986.30', voided_at: null },
        { business_date: '2026-10-12', amount: '500.00', voided_at: null },
      ],
    });
    expect(rows.find((r) => r.key === 'accruedToday')?.value).toBe('23986.30');
  });
});
