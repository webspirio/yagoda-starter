import { Decimal } from 'decimal.js';
import * as fc from 'fast-check';

import * as moneyModule from './money';
import { add, allocate, div, mul, sub, sum, lt, lte, isZero } from './money';
import { canonicalizeDecimalString } from './dto/canonical-decimal';

/**
 * `money.spec.ts` is the EXAMPLE TABLE. This file is the LAW.
 *
 * Every number a supplier signs for is produced by these four functions, and §2.7 freezes a
 * wrong one forever, so the seam is checked here against an INDEPENDENT second
 * implementation over random input rather than against hand-picked rows. A systematic error
 * in `parse`/`format` that the author also made while writing the expected values survives
 * an example table; it does not survive an oracle.
 *
 * WHY decimal.js IS HERE AND WHY IT DOES NOT REVERSE ANYTHING. The root CLAUDE.md's
 * «decimal.js is deliberately not a dependency yet» and money.ts's own header are about the
 * RUNTIME seam — what money.ts's internals are built on. This is a devDependency used only
 * as a test oracle, which is the opposite of that deferral: it is how we find out whether
 * the bigint internals are right BEFORE anything depends on swapping them.
 *
 * Import forms are load-bearing. backend/tsconfig.json sets `allowSyntheticDefaultImports`
 * WITHOUT `esModuleInterop` under `module: commonjs`, so a default import of a CJS module
 * type-checks and resolves to `undefined` at runtime — the trap this repo already documents
 * for supertest. `import * as fc` and `import { Decimal }`, never the default forms.
 */

/**
 * Precision raised from decimal.js's default of 20 significant digits: a
 * `9999999999.99 × 9999999999.99` product needs 22, and silently losing the tail would make
 * the oracle agree with a bug.
 */
const D = Decimal.clone({ precision: 60 });

/** Deterministic: a property suite that varies run to run is a flake generator. */
const RUNS = { seed: 20260918, numRuns: 500 } as const;

/**
 * THE ONE PLACE THE TWO IMPLEMENTATIONS GENUINELY DISAGREE, normalised here so the
 * disagreement can be asserted as a rule of its own below. decimal.js produces `'-0.00'` for
 * `-0.01 × 0.10`; money.ts structurally cannot, because bigint has no `-0n`.
 */
const oracle = (d: Decimal): string => {
  const fixed = d.toFixed(2, Decimal.ROUND_HALF_UP);
  return fixed === '-0.00' ? '0.00' : fixed;
};

/** kopiykas -> decimal string. `numeric(12,2)` tops out at 9_999_999_999.99. */
const fromKopiyka = (k: bigint): string => {
  const negative = k < 0n;
  const magnitude = negative ? -k : k;
  return `${negative ? '-' : ''}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
};

const amount = fc.bigInt({ min: -999_999_999_999n, max: 999_999_999_999n }).map(fromKopiyka);
const negate = (v: string): string => (v.startsWith('-') ? v.slice(1) : `-${v}`);

describe('money — properties', () => {
  it('every output is a canonical scale-2 decimal, and never negative zero', () => {
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        for (const v of [add(a, b), sub(a, b), mul(a, b), sum([a, b])]) {
          expect(v).toMatch(/^-?\d+\.\d{2}$/);
          expect(v).not.toBe('-0.00');
        }
      }),
      RUNS,
    );
  });

  it('agrees with an independent Decimal oracle on add, sub, mul and sum', () => {
    fc.assert(
      fc.property(amount, amount, amount, (a, b, c) => {
        expect(add(a, b)).toBe(oracle(new D(a).plus(b)));
        expect(sub(a, b)).toBe(oracle(new D(a).minus(b)));
        expect(mul(a, b)).toBe(oracle(new D(a).times(b)));
        expect(sum([a, b, c])).toBe(oracle(new D(a).plus(b).plus(c)));
      }),
      RUNS,
    );
  });

  it('add is associative and commutative; sub is add of the negation', () => {
    fc.assert(
      fc.property(amount, amount, amount, (a, b, c) => {
        expect(add(add(a, b), c)).toBe(add(a, add(b, c)));
        expect(add(a, b)).toBe(add(b, a));
        expect(sub(a, b)).toBe(add(a, negate(b)));
      }),
      RUNS,
    );
  });

  it('mul is commutative, 1.00 is its identity and 0.00 its annihilator', () => {
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        expect(mul(a, b)).toBe(mul(b, a));
        expect(mul(a, '1.00')).toBe(add(a, '0'));
        expect(mul(a, '0.00')).toBe('0.00');
      }),
      RUNS,
    );
  });

  it('rounds a product that lands EXACTLY half a kopiyka from zero, away from zero', () => {
    // `x.xx × 0.50` lands on a fourth decimal of exactly 5 whenever the kopiyka count is
    // odd — the `.005` tie, GENERATED rather than hand-picked at four magnitudes.
    const oddKopiyka = fc
      .bigInt({ min: -499_999_999n, max: 499_999_999n })
      .map((k) => fromKopiyka(2n * k + 1n));
    fc.assert(
      fc.property(oddKopiyka, (a) => {
        expect(mul(a, '0.50')).toBe(oracle(new D(a).times('0.50')));
      }),
      RUNS,
    );
  });

  it('rounds PER LINE and then sums — never sums raw products and rounds once', () => {
    // The receipt prints the lines above the total, so which order we use is visible to a
    // supplier. The two differ on roughly a third of random line sets; money.spec.ts pins
    // ONE fixture of three identical lines, which is a third of a percent of that.
    fc.assert(
      fc.property(fc.array(amount, { minLength: 2, maxLength: 6 }), amount, (lines, rate) => {
        const perLine = sum(lines.map((l) => mul(l, rate)));
        const oracled = lines.reduce(
          (acc, l) => acc.plus(oracle(new D(l).times(rate))),
          new D(0),
        );
        expect(perLine).toBe(oracle(oracled));
      }),
      RUNS,
    );
  });

  it('rejects anything that is not a scale-<=2 decimal string', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^-?\d+(\.\d{1,2})?$/.test(s)),
        (bad) => {
          expect(() => add(bad, '0')).toThrow(/not a decimal/i);
        },
      ),
      RUNS,
    );
  });

  it('every money output is already canonical for the API boundary', () => {
    // money.ts's header calls itself «THE ONLY PLACE IN THE BACKEND WHERE A DECIMAL STRING
    // IS TAKEN APART». It is not: common/dto/canonical-decimal.ts has its own regex, its own
    // leading-zero strip, its own scale-2 pad and its own negative-zero rule, and it runs on
    // every inbound DTO. The two MUST agree or a value the API accepts differs from the
    // value money.ts produces. Nothing tested that until now.
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        for (const v of [add(a, b), sub(a, b), mul(a, b), sum([a, b])]) {
          expect(canonicalizeDecimalString(v)).toBe(v);
        }
      }),
      RUNS,
    );
  });

  it('lt, lte and isZero agree with cmp — the three exports nothing covered', () => {
    // Exported, live at four production call sites (crates.service.ts, intake-lines.ts x2,
    // transfers/payouts), and never once imported by money.spec.ts: function coverage of
    // money.ts was 78.57% for exactly these three. intake-lines.ts's
    // `lte(net_kg, '0.00')` guard — «a receipt whose net weight is not positive is refused»
    // — rested on an untested wrapper.
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        expect(lt(a, b)).toBe(new D(a).lessThan(b));
        expect(lte(a, b)).toBe(new D(a).lessThanOrEqualTo(b));
        expect(isZero(a)).toBe(new D(a).isZero());
      }),
      RUNS,
    );
  });

  it('div agrees with the oracle, rounding half-up away from zero at scale 2', () => {
    // Added for §8.4 cost-per-kilogram. money.ts divides on the MAGNITUDE and reapplies the
    // sign, so -0.005 must round to -0.01, not to 0.00 — the direction an oracle with the
    // wrong mode would silently disagree about in exactly half the cases.
    const nonZero = amount.filter((a) => !isZero(a));
    fc.assert(
      fc.property(amount, nonZero, (a, b) => {
        expect(div(a, b)).toBe(
          new D(a).div(b).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
        );
      }),
      RUNS,
    );
  });

  it('div by zero throws rather than returning anything', () => {
    fc.assert(
      fc.property(amount, (a) => {
        expect(() => div(a, '0.00')).toThrow(/divide by zero/);
      }),
      RUNS,
    );
  });

  it('allocate parts ALWAYS sum back to the total, exactly', () => {
    // THE INVARIANT THE WHOLE FUNCTION EXISTS FOR. A proportional split that loses or gains
    // a kopiyka is how a §8.5 top-up stops reconciling, and the failure is one kopiyka on
    // some inputs and not others — the shape an example table finds by luck and an oracle
    // finds by construction.
    fc.assert(
      fc.property(amount, fc.array(amount, { minLength: 1, maxLength: 12 }), (total, ws) => {
        const parts = allocate(total, ws);
        expect(parts).toHaveLength(ws.length);
        expect(sum(parts)).toBe(total);
      }),
      RUNS,
    );
  });

  it('allocate gives each part its proportional share, to within one kopiyka', () => {
    // Sum-to-total alone is satisfied by "give it all to the first part", so this is the
    // discriminator: largest-remainder means nobody is off by more than one unit.
    const positive = amount.filter((a) => !isZero(a) && a[0] !== '-');
    fc.assert(
      fc.property(positive, fc.array(positive, { minLength: 1, maxLength: 12 }), (total, ws) => {
        const parts = allocate(total, ws);
        const weightTotal = sum(ws);
        for (let i = 0; i < ws.length; i += 1) {
          const exact = new D(total).times(ws[i]).div(weightTotal);
          expect(new D(parts[i]).minus(exact).abs().lessThanOrEqualTo('0.01')).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('allocate splits evenly when every weight is zero, and still sums to the total', () => {
    fc.assert(
      fc.property(amount, fc.integer({ min: 1, max: 12 }), (total, n) => {
        const parts = allocate(total, Array.from({ length: n }, () => '0.00'));
        expect(sum(parts)).toBe(total);
        const spread = parts.map((p) => new D(p));
        const min = spread.reduce((a, b) => (a.lessThan(b) ? a : b));
        const max = spread.reduce((a, b) => (a.greaterThan(b) ? a : b));
        expect(max.minus(min).lessThanOrEqualTo('0.01')).toBe(true);
      }),
      RUNS,
    );
  });

  it('does NOT implement §12.1 payout rounding, and pins the surface that would carry it', () => {
    // §12.1 defines a SECOND rounding — to whole hryvnia, with exactly 0.50 going DOWN —
    // unresolved at the source («-> Правка: точно???») and deliberately absent here. It is
    // guarded today by ONE comment in ONE file and nothing else. If someone implements it,
    // this export list is where they must say so.
    expect(add('120.50', '0.00')).toBe('120.50');
    expect(mul('120.50', '1.00')).toBe('120.50');
    expect(Object.keys(moneyModule).sort()).toEqual([
      'add',
      'allocate',
      'cmp',
      'div',
      'gt',
      'gte',
      'isNegative',
      'isZero',
      'lt',
      'lte',
      'mul',
      'sub',
      'sum',
    ]);
  });
});
