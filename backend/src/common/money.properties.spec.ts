import { Decimal } from 'decimal.js';
import * as fc from 'fast-check';

import * as moneyModule from './money';
import { add, mul, sub, sum, lt, lte, isZero } from './money';
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

  it('does NOT implement §12.1 payout rounding, and pins the surface that would carry it', () => {
    // §12.1 defines a SECOND rounding — to whole hryvnia, with exactly 0.50 going DOWN —
    // unresolved at the source («-> Правка: точно???») and deliberately absent here. It is
    // guarded today by ONE comment in ONE file and nothing else. If someone implements it,
    // this export list is where they must say so.
    expect(add('120.50', '0.00')).toBe('120.50');
    expect(mul('120.50', '1.00')).toBe('120.50');
    expect(Object.keys(moneyModule).sort()).toEqual([
      'add',
      'cmp',
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
