import * as fc from 'fast-check';
import { settle, DebtLine, PayoutLine } from './settlement';
import { add, cmp, isNegative, sub, sum } from '../common/money';

/**
 * `settlement.spec.ts` is the EXAMPLE TABLE. This file is the LAW.
 *
 * The one thing the projection must never do is disagree with `debtFor`:
 * `Σ open − unallocated` must equal `Σ lines − Σ payouts` for EVERY queue,
 * including ones with bindings to receipts that no longer exist, several
 * payouts on one receipt, and payouts larger than everything. A rounding or
 * bookkeeping slip in `settle` is not guessable by example; it is found here.
 *
 * `import * as fc`, never the default form — see `money.properties.spec.ts`.
 */
const RUNS = { seed: 20260925, numRuns: 500 } as const;

/**
 * Scale-2 positive amount as a string, 0.01 … 99999.99. Built from two
 * naturals, not from an integer divided by 100, because amounts must be
 * exact scale-2 strings that a double cannot guarantee. (Spec files are
 * outside the eslint money ban; eslint.config.mjs ignores *.spec.ts.)
 */
const amount = fc
  .tuple(fc.nat({ max: 99_999 }), fc.nat({ max: 99 }))
  .filter(([whole, cents]) => whole + cents > 0)
  .map(([whole, cents]) => `${whole}.${String(cents).padStart(2, '0')}`);

const queue = fc
  .record({
    receipts: fc.array(amount, { minLength: 0, maxLength: 8 }),
    topUps: fc.array(fc.tuple(fc.nat({ max: 7 }), amount), { minLength: 0, maxLength: 4 }),
    payouts: fc.array(
      // bindTo: index into receipts, or -1 for unbound, or -2 for «voided receipt»
      fc.tuple(fc.integer({ min: -2, max: 7 }), amount),
      { minLength: 0, maxLength: 8 },
    ),
  })
  .map(({ receipts, topUps, payouts }) => {
    const lines: DebtLine[] = receipts.map((a, i) => ({
      id: `r${i}`,
      kind: 'intake' as const,
      code: `R${i}`,
      intake_id: `r${i}`,
      business_date: `2026-07-${String(10 + i).padStart(2, '0')}`,
      created_at: `2026-07-${String(10 + i).padStart(2, '0')}T08:00:00.000Z`,
      amount: a,
    }));
    for (const [parent, a] of topUps) {
      if (parent >= receipts.length) continue;
      lines.push({
        id: `t${lines.length}`,
        kind: 'top_up',
        code: `R${parent}`,
        intake_id: `r${parent}`,
        business_date: lines[parent].business_date,
        created_at: '2026-08-01T12:00:00.000Z',
        amount: a,
      });
    }
    // Keep the caller's contract: (business_date, created_at, id) order.
    lines.sort((x, y) =>
      x.business_date === y.business_date
        ? x.created_at === y.created_at
          ? x.id < y.id ? -1 : 1
          : x.created_at < y.created_at ? -1 : 1
        : x.business_date < y.business_date ? -1 : 1,
    );
    const pays: PayoutLine[] = payouts.map(([bind, a], i) => ({
      id: `p${i}`,
      code: `P${i}`,
      business_date: '2026-08-04',
      created_at: `2026-08-04T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
      amount: a,
      intake_id: bind === -1 ? null : bind === -2 ? 'voided' : bind < receipts.length ? `r${bind}` : null,
    }));
    return { lines, pays };
  });

describe('settle — properties', () => {
  it('Σ open − unallocated = Σ lines − Σ payouts (agrees with debtFor)', () => {
    fc.assert(
      fc.property(queue, ({ lines, pays }) => {
        const s = settle(lines, pays);
        const lhs = sub(sum(s.lines.map((l) => l.open)), s.unallocated);
        const rhs = sub(sum(lines.map((l) => l.amount)), sum(pays.map((p) => p.amount)));
        expect(lhs).toBe(rhs);
      }),
      RUNS,
    );
  });

  it('no amount is ever negative', () => {
    fc.assert(
      fc.property(queue, ({ lines, pays }) => {
        const s = settle(lines, pays);
        for (const l of s.lines) {
          expect(isNegative(l.open)).toBe(false);
          expect(isNegative(l.paid)).toBe(false);
          for (const c of l.covered_by) expect(cmp(c.amount, '0.00')).toBe(1);
        }
        for (const p of s.payouts) {
          expect(isNegative(p.unallocated)).toBe(false);
          for (const c of p.covers) expect(cmp(c.amount, '0.00')).toBe(1);
        }
        expect(isNegative(s.unallocated)).toBe(false);
      }),
      RUNS,
    );
  });

  it('paid + open = amount on every line; Σ covers + unallocated = amount on every payout', () => {
    fc.assert(
      fc.property(queue, ({ lines, pays }) => {
        const s = settle(lines, pays);
        for (const l of s.lines) {
          expect(add(l.paid, l.open)).toBe(l.amount);
          expect(sum(l.covered_by.map((c) => c.amount))).toBe(l.paid);
        }
        for (const p of s.payouts) {
          expect(add(sum(p.covers.map((c) => c.amount)), p.unallocated)).toBe(p.amount);
        }
      }),
      RUNS,
    );
  });

  it('covered_by and covers are the same set of triples seen from both sides', () => {
    fc.assert(
      fc.property(queue, ({ lines, pays }) => {
        const s = settle(lines, pays);
        const fromLines = s.lines
          .flatMap((l) => l.covered_by.map((c) => `${c.payout_id}|${l.id}|${c.amount}`))
          .sort();
        const fromPayouts = s.payouts
          .flatMap((p) => p.covers.map((c) => `${p.id}|${c.line_id}|${c.amount}`))
          .sort();
        expect(fromLines).toEqual(fromPayouts);
      }),
      RUNS,
    );
  });

  it('with no bindings, open equals clamp(cum − paid_total, 0, amount) on every line', () => {
    fc.assert(
      fc.property(queue, ({ lines, pays }) => {
        const unbound = pays.map((p) => ({ ...p, intake_id: null }));
        const s = settle(lines, unbound);
        const paidTotal = sum(unbound.map((p) => p.amount));
        let cum = '0.00';
        for (const l of s.lines) {
          cum = add(cum, l.amount);
          const over = sub(cum, paidTotal); // how much of the cumulative debt is past the money
          const expected =
            cmp(over, '0.00') <= 0 ? '0.00' : cmp(over, l.amount) >= 0 ? l.amount : over;
          expect(l.open).toBe(expected);
        }
      }),
      RUNS,
    );
  });

  it('is deterministic and does not mutate its inputs', () => {
    fc.assert(
      fc.property(queue, ({ lines, pays }) => {
        const snapshot = JSON.stringify({ lines, pays });
        const a = settle(lines, pays);
        const b = settle(lines, pays);
        expect(a).toEqual(b);
        expect(JSON.stringify({ lines, pays })).toBe(snapshot);
      }),
      RUNS,
    );
  });
});
