import { settle, DebtLine, PayoutLine } from './settlement';

/**
 * THE RULE AS EXAMPLES. Spec §3.2: a payout first covers the receipt it was
 * handed over with (`intake_id`), then whatever is left goes to the oldest
 * open line. `settlement.properties.spec.ts` is the law over random input;
 * this file is the table a reader checks against §3.3's worked numbers.
 */
const line = (over: Partial<DebtLine> & Pick<DebtLine, 'id' | 'amount'>): DebtLine => ({
  kind: 'intake',
  code: over.id.toUpperCase(),
  intake_id: over.id,
  business_date: '2026-07-12',
  created_at: '2026-07-12T08:00:00.000Z',
  ...over,
});
const payout = (over: Partial<PayoutLine> & Pick<PayoutLine, 'id' | 'amount'>): PayoutLine => ({
  code: over.id.toUpperCase(),
  business_date: '2026-08-04',
  created_at: '2026-08-04T10:00:00.000Z',
  intake_id: null,
  ...over,
});

describe('settle', () => {
  it('returns empty arrays and 0.00 for a supplier with no documents', () => {
    expect(settle([], [])).toEqual({ unallocated: '0.00', lines: [], payouts: [] });
  });

  it('pure FIFO without bindings: oldest line first (§3.3, the client example)', () => {
    const s = settle(
      [
        line({ id: 'r1', amount: '4200.00', business_date: '2026-07-12' }),
        line({ id: 'r2', amount: '1800.00', business_date: '2026-07-15' }),
        line({ id: 'r3', amount: '900.00', business_date: '2026-07-20' }),
        line({ id: 'r4', amount: '5460.00', business_date: '2026-08-04' }),
      ],
      [payout({ id: 'p1', amount: '8000.00' })],
    );
    expect(s.lines.map((l) => [l.id, l.paid, l.open])).toEqual([
      ['r1', '4200.00', '0.00'],
      ['r2', '1800.00', '0.00'],
      ['r3', '900.00', '0.00'],
      ['r4', '1100.00', '4360.00'],
    ]);
    expect(s.payouts[0].covers).toEqual([
      { line_id: 'r1', kind: 'intake', amount: '4200.00' },
      { line_id: 'r2', kind: 'intake', amount: '1800.00' },
      { line_id: 'r3', kind: 'intake', amount: '900.00' },
      { line_id: 'r4', kind: 'intake', amount: '1100.00' },
    ]);
    expect(s.payouts[0].unallocated).toBe('0.00');
    expect(s.unallocated).toBe('0.00');
  });

  it('a bound payout covers its own receipt before older debt (the 1000 + 500 case)', () => {
    const s = settle(
      [
        line({ id: 'r1', amount: '1000.00', business_date: '2026-07-12' }),
        line({ id: 'r2', amount: '500.00', business_date: '2026-08-04' }),
      ],
      [payout({ id: 'p1', amount: '500.00', intake_id: 'r2' })],
    );
    expect(s.lines.map((l) => [l.id, l.open])).toEqual([
      ['r1', '1000.00'],
      ['r2', '0.00'],
    ]);
    expect(s.lines[1].covered_by).toEqual([{ payout_id: 'p1', amount: '500.00' }]);
    expect(s.lines[0].covered_by).toEqual([]);
  });

  it('bound payout excess falls through to FIFO', () => {
    const s = settle(
      [
        line({ id: 'r1', amount: '1000.00', business_date: '2026-07-12' }),
        line({ id: 'r2', amount: '300.00', business_date: '2026-08-04' }),
      ],
      [payout({ id: 'p1', amount: '500.00', intake_id: 'r2' })],
    );
    expect(s.lines.map((l) => [l.id, l.paid, l.open])).toEqual([
      ['r1', '200.00', '800.00'],
      ['r2', '300.00', '0.00'],
    ]);
    // Bound coverage is listed first on the payout, then the FIFO remainder.
    expect(s.payouts[0].covers).toEqual([
      { line_id: 'r2', kind: 'intake', amount: '300.00' },
      { line_id: 'r1', kind: 'intake', amount: '200.00' },
    ]);
  });

  it('two payouts bound to one receipt: the second sees the first', () => {
    const s = settle(
      [line({ id: 'r1', amount: '1000.00' })],
      [
        payout({ id: 'p1', amount: '600.00', intake_id: 'r1', created_at: '2026-07-12T09:00:00.000Z' }),
        payout({ id: 'p2', amount: '600.00', intake_id: 'r1', created_at: '2026-07-12T10:00:00.000Z' }),
      ],
    );
    expect(s.lines[0].covered_by).toEqual([
      { payout_id: 'p1', amount: '600.00' },
      { payout_id: 'p2', amount: '400.00' },
    ]);
    expect(s.payouts[1].unallocated).toBe('200.00');
    expect(s.unallocated).toBe('200.00');
  });

  it('a payout bound to a voided receipt (absent from lines) goes whole into FIFO', () => {
    // Spec §3.3: R1 1000, R2 300 voided, P1 1300 bound to R2, R2' 250 written later.
    const s = settle(
      [
        line({ id: 'r1', amount: '1000.00', business_date: '2026-07-12' }),
        line({ id: 'r2b', amount: '250.00', business_date: '2026-08-05' }),
      ],
      [payout({ id: 'p1', amount: '1300.00', intake_id: 'r2-voided' })],
    );
    expect(s.lines.map((l) => [l.id, l.open])).toEqual([
      ['r1', '0.00'],
      ['r2b', '0.00'],
    ]);
    expect(s.payouts[0].unallocated).toBe('50.00');
    expect(s.unallocated).toBe('50.00');
  });

  it('a top-up is its own line in queue order and is not covered by its parent binding', () => {
    const s = settle(
      [
        line({ id: 'r1', amount: '1000.00', business_date: '2026-07-12' }),
        line({
          id: 't1',
          kind: 'top_up',
          code: 'R1',
          intake_id: 'r1',
          amount: '200.00',
          business_date: '2026-07-12',
          created_at: '2026-07-20T12:00:00.000Z',
        }),
        line({ id: 'r2', amount: '500.00', business_date: '2026-07-15' }),
      ],
      [payout({ id: 'p1', amount: '1100.00', intake_id: 'r1' })],
    );
    // 1000 bound to r1; the 100 excess goes FIFO → t1 (it sits right behind r1), not r2.
    expect(s.lines.map((l) => [l.id, l.kind, l.open])).toEqual([
      ['r1', 'intake', '0.00'],
      ['t1', 'top_up', '100.00'],
      ['r2', 'intake', '500.00'],
    ]);
    expect(s.payouts[0].covers).toEqual([
      { line_id: 'r1', kind: 'intake', amount: '1000.00' },
      { line_id: 't1', kind: 'top_up', amount: '100.00' },
    ]);
  });

  it('overpaid supplier: every line closed, unallocated is the excess', () => {
    const s = settle([line({ id: 'r1', amount: '100.00' })], [payout({ id: 'p1', amount: '150.00' })]);
    expect(s.lines[0].open).toBe('0.00');
    expect(s.payouts[0].unallocated).toBe('50.00');
    expect(s.unallocated).toBe('50.00');
  });

  it('does not reorder its inputs', () => {
    const lines = [line({ id: 'b', amount: '1.00' }), line({ id: 'a', amount: '1.00' })];
    const s = settle(lines, []);
    expect(s.lines.map((l) => l.id)).toEqual(['b', 'a']);
  });
});
