# Supplier Settlement Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer «за що саме винні» on the supplier card — open balance per receipt / top-up, the oldest open debt, and what each payout closed — as a read-time projection, with no new table.

**Architecture:** A pure `settle()` function over `money.ts` (bound-first, then FIFO) in `backend/src/supplier-balance/`, fed by three ordered reads in a new `settlementFor()` and exposed as `GET /suppliers/:id/settlement`. The card adds a fourth query and renders a new «Відкриті залишки» section, a tile hint and two history captions; the rule documents get dated edits. Nothing is written or stored; voiding is untouched.

**Tech Stack:** NestJS 11 + TypeORM (raw SQL via `dataSource.manager.query`), `money.ts` bigint decimals, Jest (+ `fast-check` for properties, real Postgres for `*.db-spec.ts`), React 19 + TanStack Query + react-i18next, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-25-yagoda-supplier-settlement-slice.md`

## Global Constraints

- **No schema change.** No migration, no table, no column. Twenty-two tables stay twenty-two (`grep -c "^Table " 28-db-schema.dbml`).
- **Money only through `backend/src/common/money.ts`.** `src/supplier-balance/**/*.ts` is already in the money `files` array of `backend/eslint.config.mjs`: `*`, `/`, `Number()`, `toFixed`, `parseInt`, `parseFloat` are banned there. `min` is `cmp`, not a new helper. Every amount is a scale-2 string end to end; SQL projects `::text`.
- **Every read carries the four `voided_at IS NULL` filters** of `debtSql`: `i.voided_at`, `t.voided_at`, `ti.voided_at` (parent of a top-up), `p.voided_at`.
- **Queue order is `(business_date, created_at, id)`** for all three sources; a top-up's `business_date` is its parent receipt's (spec §3.4, §3.5).
- **Voiding is unchanged** (spec §3.11). No task touches `intakes.service.ts`, `payouts.service.ts` or any void route.
- **Import forms in backend tests:** `import * as fc from 'fast-check'` — never the default form (`allowSyntheticDefaultImports` without `esModuleInterop`; see `money.properties.spec.ts`).
- **Frontend tests assert English** — test setup pins `en` (`frontend-tests-pin-english`). Every new i18n key goes into BOTH `uk.json` and `en.json`; `locales.test.ts` fails on a key present in one and not the other.
- **`tsc -b` separately after every frontend task** — Vitest does not typecheck.
- **Verification:** `npm run verify` after each task; `npm run verify:full` is the slice verdict (money code + real SQL). Name any `SKIPPED` row aloud. Never widen a baseline.
- **Commits** end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A bound payout larger than its receipt** (`intake_id` → R of 300, payout 500): 300 covers R, 200 must fall to FIFO — never a negative `open`, never lost. → Task 1 test «bound payout excess falls through to FIFO».
2. **Two payouts bound to the same receipt** (R 1000; P1 600 and P2 600 both `intake_id = R`): P1 covers 600, P2 covers 400 and 200 falls through — the second must see the first's coverage. → Task 1 test «two payouts bound to one receipt».
3. **A payout whose `intake_id` points at a VOIDED receipt**: it must not be dropped and must not throw — it goes whole into FIFO. → Task 1 test «payout bound to a voided receipt» and Task 3 db test «voided parent, bound payout».
4. **Overpayment with nothing open** (payouts exceed every line): `unallocated` equals the excess, every line `open = 0.00`, and the balance identity holds with a negative debt. → Task 1 property test + example «overpaid supplier».
5. **A receipt in the settlement that is beyond the card's `limit: 100` page**: `OpenBalances` must render the row from settlement data alone, without the kg sub-caption, and must not crash on the missing `Intake`. → Task 7 test «row without a loaded receipt».

---

### Task 1: `settle()` — the rule, as a pure function

**Files:**
- Create: `backend/src/supplier-balance/settlement.ts`
- Test: `backend/src/supplier-balance/settlement.spec.ts`

**Interfaces:**
- Consumes: `add`, `sub`, `cmp`, `sum`, `isZero` from `../common/money`.
- Produces (used by Tasks 2, 3, 4):

```ts
export type DebtKind = 'intake' | 'top_up';
export interface DebtLine {
  id: string;
  kind: DebtKind;
  code: string;
  intake_id: string;
  business_date: string;
  created_at: string;
  amount: string;
}
export interface PayoutLine {
  id: string;
  code: string;
  business_date: string;
  created_at: string;
  amount: string;
  intake_id: string | null;
}
export interface Coverage { payout_id: string; amount: string }
export interface Cover { line_id: string; kind: DebtKind; amount: string }
export interface SettledLine extends DebtLine { paid: string; open: string; covered_by: Coverage[] }
export interface SettledPayout extends PayoutLine { covers: Cover[]; unallocated: string }
export interface Settlement { unallocated: string; lines: SettledLine[]; payouts: SettledPayout[] }
export function settle(lines: DebtLine[], payouts: PayoutLine[]): Settlement;
```

- [ ] **Step 1: Write the failing example tests**

```ts
// backend/src/supplier-balance/settlement.spec.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npx jest src/supplier-balance/settlement.spec.ts`
Expected: FAIL — `Cannot find module './settlement'`.

- [ ] **Step 3: Write `settlement.ts`**

```ts
// backend/src/supplier-balance/settlement.ts
import { add, cmp, isZero, sub, sum } from '../common/money';

/**
 * «ЗА ЩО САМЕ ВИННІ» — THE RULE, AND NOTHING ELSE.
 *
 * Spec `docs/superpowers/specs/2026-09-25-yagoda-supplier-settlement-slice.md`
 * §3.2. Two queues, both already in `(business_date, created_at, id)` order
 * (this function does NOT sort — the order is the caller's contract, and the
 * db-spec holds it). Two passes:
 *
 *   1. BOUND — a payout with `intake_id` covers THAT receipt, up to what is
 *      still open on it.
 *   2. FIFO — every remaining amount (unbound payouts, bound excess, payouts
 *      whose receipt is voided and therefore absent from `lines`) closes open
 *      lines from the head of the debt queue.
 *
 * What is left after pass 2 is `unallocated` — the negative debt §3.5 says
 * «гаситься сам наступною здачею». It may land on a line YOUNGER than the
 * payout (spec §3.3); forbidding that would make this disagree with `debtFor`
 * after the next receipt, which is the one thing it must never do.
 *
 * NOTHING HERE IS STORED. The 04.09.2026 decision removed `payout_allocations`
 * because a stored breakdown drifts from the documents (124 breaks in the
 * client's workbook); a projection cannot drift. A void of any document simply
 * changes the input.
 *
 * Pure: no Nest, no database, no `Date`. Every amount is a scale-2 string and
 * every operation is `money.ts`'s — this module is in the eslint money list.
 */

export type DebtKind = 'intake' | 'top_up';

export interface DebtLine {
  id: string;
  kind: DebtKind;
  /** A top-up borrows its PARENT receipt's code, as the card already does. */
  code: string;
  /** Own id for an intake; the parent's for a top-up. */
  intake_id: string;
  /** The parent's for a top-up (spec §3.5). */
  business_date: string;
  created_at: string;
  amount: string;
}

export interface PayoutLine {
  id: string;
  code: string;
  business_date: string;
  created_at: string;
  amount: string;
  intake_id: string | null;
}

export interface Coverage {
  payout_id: string;
  amount: string;
}

export interface Cover {
  line_id: string;
  kind: DebtKind;
  amount: string;
}

export interface SettledLine extends DebtLine {
  paid: string;
  open: string;
  covered_by: Coverage[];
}

export interface SettledPayout extends PayoutLine {
  covers: Cover[];
  unallocated: string;
}

export interface Settlement {
  unallocated: string;
  lines: SettledLine[];
  payouts: SettledPayout[];
}

const min = (a: string, b: string): string => (cmp(a, b) <= 0 ? a : b);

export function settle(lines: DebtLine[], payouts: PayoutLine[]): Settlement {
  const settledLines: SettledLine[] = lines.map((l) => ({
    ...l,
    paid: '0.00',
    open: l.amount,
    covered_by: [],
  }));
  const settledPayouts: SettledPayout[] = payouts.map((p) => ({
    ...p,
    covers: [],
    unallocated: p.amount,
  }));

  // Receipts only: a top-up is never the target of a binding (spec §3.5).
  const byIntakeId = new Map<string, SettledLine>();
  for (const l of settledLines) if (l.kind === 'intake') byIntakeId.set(l.intake_id, l);

  const cover = (payout: SettledPayout, line: SettledLine, amount: string): void => {
    line.paid = add(line.paid, amount);
    line.open = sub(line.open, amount);
    line.covered_by.push({ payout_id: payout.id, amount });
    payout.unallocated = sub(payout.unallocated, amount);
    payout.covers.push({ line_id: line.id, kind: line.kind, amount });
  };

  // Pass 1 — bound.
  for (const p of settledPayouts) {
    if (p.intake_id === null) continue;
    const target = byIntakeId.get(p.intake_id);
    if (target === undefined) continue; // voided receipt: pass 2 takes the whole payout
    const take = min(p.unallocated, target.open);
    if (!isZero(take)) cover(p, target, take);
  }

  // Pass 2 — FIFO. The cursor only advances: a closed line stays closed, so
  // this is O(lines + payouts) rather than a rescan per payout.
  let cursor = 0;
  for (const p of settledPayouts) {
    while (!isZero(p.unallocated) && cursor < settledLines.length) {
      const target = settledLines[cursor];
      if (isZero(target.open)) {
        cursor += 1;
        continue;
      }
      cover(p, target, min(p.unallocated, target.open));
    }
  }

  return {
    unallocated: sum(settledPayouts.map((p) => p.unallocated)),
    lines: settledLines,
    payouts: settledPayouts,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest src/supplier-balance/settlement.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Lint the money rule**

Run: `cd backend && npx eslint src/supplier-balance/settlement.ts src/supplier-balance/settlement.spec.ts`
Expected: no output (no banned operator reached the module).

- [ ] **Step 6: Commit**

```bash
git add backend/src/supplier-balance/settlement.ts backend/src/supplier-balance/settlement.spec.ts
git commit -m "feat(settlement): settle() — bound-first, then FIFO, as a pure projection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `settle()` — the law (property tests)

**Files:**
- Test: `backend/src/supplier-balance/settlement.properties.spec.ts`

**Interfaces:**
- Consumes: `settle`, `DebtLine`, `PayoutLine` from `./settlement` (Task 1); `add`, `sub`, `sum`, `cmp`, `isNegative` from `../common/money`.

- [ ] **Step 1: Write the property suite**

```ts
// backend/src/supplier-balance/settlement.properties.spec.ts
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
 * naturals, not from an integer divided by 100: this file is inside the
 * eslint money list, where `/` is banned even in a fixture generator.
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
```

- [ ] **Step 2: Run the suite**

Run: `cd backend && npx jest src/supplier-balance/settlement.properties.spec.ts`
Expected: PASS, 6 properties × 500 runs. If the first property fails, the counterexample `fast-check` prints is a real bug in Task 1 — fix `settle`, not the property.

- [ ] **Step 3: Lint**

Run: `cd backend && npx eslint src/supplier-balance/settlement.properties.spec.ts`
Expected: clean — the generator uses only `+` on naturals, and every money operation is `money.ts`'s.

- [ ] **Step 4: Commit**

```bash
git add backend/src/supplier-balance/settlement.properties.spec.ts
git commit -m "test(settlement): the balance identity and friends as properties over random queues

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `SupplierBalanceService.settlementFor()` — three ordered reads

**Files:**
- Modify: `backend/src/supplier-balance/supplier-balance.service.ts` (append a method after `list`)
- Test: `backend/src/supplier-balance/supplier-balance.service.spec.ts` (append a `describe`)
- Test: `backend/src/supplier-balance/settlement.db-spec.ts` (new)

**Interfaces:**
- Consumes: `settle`, `DebtLine`, `PayoutLine`, `Settlement` from `./settlement`.
- Produces: `settlementFor(supplierId: string): Promise<Settlement & { debt: string }>` — used by Task 4.

- [ ] **Step 1: Write the failing unit tests (SQL shape, mocked driver)**

Append to `backend/src/supplier-balance/supplier-balance.service.spec.ts`, inside the top-level `describe('SupplierBalanceService', …)` block, after the existing tests:

```ts
  /**
   * `settlementFor` is three reads plus `debtFor`. The unit spec holds the
   * SHAPE of each read — the four `voided_at` filters and the order key — the
   * same way the tests above hold `debtFor`'s; `settlement.db-spec.ts` holds
   * the values against a real Postgres.
   */
  describe('settlementFor', () => {
    const calls = () => query.mock.calls as [string, unknown[]][];

    beforeEach(() => {
      // `settlementFor` runs inside `dataSource.transaction`, which the file's
      // shared mock does not have: rebuild the service over a mock that hands
      // the same `query` to the transaction callback.
      service = new SupplierBalanceService({
        manager: { query },
        transaction: (_level: string, fn: (m: { query: jest.Mock }) => unknown) => fn({ query }),
      } as never);
      query.mockReset();
      query
        .mockResolvedValueOnce([]) // receipts
        .mockResolvedValueOnce([]) // top-ups
        .mockResolvedValueOnce([]) // payouts
        .mockResolvedValueOnce([{ debt: '0.00' }]); // debtFor
    });

    it('reads receipts, top-ups and payouts, then the debt, all for the one supplier', async () => {
      const s = await service.settlementFor(SUPPLIER);
      expect(s).toEqual({ debt: '0.00', unallocated: '0.00', lines: [], payouts: [] });
      expect(calls()).toHaveLength(4);
      for (const [, params] of calls()) expect(params).toEqual([SUPPLIER]);
    });

    it('EXCLUDES voided receipts and orders them by (business_date, created_at, id)', async () => {
      await service.settlementFor(SUPPLIER);
      const [sql] = calls()[0];
      expect(sql).toMatch(/FROM intakes i[\s\S]*JOIN shifts s ON s\.id = i\.shift_id/);
      expect(sql).toMatch(/i\.voided_at IS NULL/);
      expect(sql).toMatch(/ORDER BY s\.business_date, i\.created_at, i\.id/);
    });

    it('EXCLUDES voided top-ups AND top-ups of voided receipts, dated by the parent', async () => {
      await service.settlementFor(SUPPLIER);
      const [sql] = calls()[1];
      expect(sql).toMatch(/FROM intake_top_ups t[\s\S]*JOIN intakes ti ON ti\.id = t\.intake_id/);
      expect(sql).toMatch(/JOIN shifts s ON s\.id = ti\.shift_id/);
      expect(sql).toMatch(/t\.voided_at IS NULL/);
      expect(sql).toMatch(/ti\.voided_at IS NULL/);
      expect(sql).toMatch(/s\.business_date::text AS business_date/);
    });

    it('EXCLUDES voided payouts and orders them by (business_date, created_at, id)', async () => {
      await service.settlementFor(SUPPLIER);
      const [sql] = calls()[2];
      expect(sql).toMatch(/FROM payouts p[\s\S]*JOIN shifts s ON s\.id = p\.shift_id/);
      expect(sql).toMatch(/p\.voided_at IS NULL/);
      expect(sql).toMatch(/ORDER BY s\.business_date, p\.created_at, p\.id/);
    });

    it('merges receipts and top-ups by the same key before settling', async () => {
      query.mockReset();
      query
        .mockResolvedValueOnce([
          { id: 'r1', code: 'R1', business_date: '2026-07-12', created_at: '2026-07-12T08:00:00.000Z', amount: '1000.00' },
          { id: 'r2', code: 'R2', business_date: '2026-07-15', created_at: '2026-07-15T08:00:00.000Z', amount: '500.00' },
        ])
        .mockResolvedValueOnce([
          { id: 't1', code: 'R1', intake_id: 'r1', business_date: '2026-07-12', created_at: '2026-07-20T12:00:00.000Z', amount: '200.00' },
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ debt: '1700.00' }]);

      const s = await service.settlementFor(SUPPLIER);
      expect(s.lines.map((l) => l.id)).toEqual(['r1', 't1', 'r2']);
      expect(s.lines[1]).toMatchObject({ kind: 'top_up', intake_id: 'r1', code: 'R1' });
      expect(s.debt).toBe('1700.00');
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx jest src/supplier-balance/supplier-balance.service.spec.ts -t settlementFor`
Expected: FAIL — `service.settlementFor is not a function`.

- [ ] **Step 3: Implement `settlementFor`**

In `backend/src/supplier-balance/supplier-balance.service.ts`, add to the imports:

```ts
import { settle, DebtLine, PayoutLine, Settlement } from './settlement';
```

Append inside the class, after `list`:

```ts
  /**
   * «За що саме винні» for one supplier — spec §4.2.
   *
   * THREE READS, THE SAME FOUR FILTERS AS `debtSql`. Receipts (`i.voided_at`),
   * top-ups (`t.voided_at` AND the parent's `ti.voided_at`), payouts
   * (`p.voided_at`). Drop any one and the projection disagrees with the
   * balance tile beside it, which is the one visible bug this slice can ship.
   *
   * ORDER IS THE CALLER'S CONTRACT with `settle`: each read is ordered by
   * `(business_date, created_at, id)` in Postgres, and receipts and top-ups
   * are merged here on that same key. A top-up has no shift of its own; its
   * `business_date` is its PARENT's (spec §3.5), which is why the second read
   * joins `shifts` through `intakes`.
   *
   * `::text` on every amount and on `business_date` (a `date` would otherwise
   * arrive as a JS `Date` from the driver, local-time-shifted).
   *
   * ONE TRANSACTION, `REPEATABLE READ`: the three reads and `debtFor` must see
   * one snapshot, or a payout landing between two of them makes `debt` and
   * `Σ open − unallocated` disagree for that one response.
   */
  async settlementFor(supplierId: string): Promise<Settlement & { debt: string }> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      type IntakeRow = { id: string; code: string; business_date: string; created_at: string; amount: string };
      type TopUpRow = IntakeRow & { intake_id: string };
      type PayoutRow = IntakeRow & { intake_id: string | null };

      const intakes = (await manager.query(
        `SELECT i.id, i.code, s.business_date::text AS business_date,
                i.created_at::text AS created_at, i.amount::text AS amount
           FROM intakes i
           JOIN shifts s ON s.id = i.shift_id
          WHERE i.supplier_id = $1 AND i.voided_at IS NULL
          ORDER BY s.business_date, i.created_at, i.id`,
        [supplierId],
      )) as IntakeRow[];

      const topUps = (await manager.query(
        `SELECT t.id, ti.code, t.intake_id, s.business_date::text AS business_date,
                t.created_at::text AS created_at, t.amount::text AS amount
           FROM intake_top_ups t
           JOIN intakes ti ON ti.id = t.intake_id
           JOIN shifts s ON s.id = ti.shift_id
          WHERE ti.supplier_id = $1
            AND ti.voided_at IS NULL
            AND t.voided_at  IS NULL
          ORDER BY s.business_date, t.created_at, t.id`,
        [supplierId],
      )) as TopUpRow[];

      const payouts = (await manager.query(
        `SELECT p.id, p.code, p.intake_id, s.business_date::text AS business_date,
                p.created_at::text AS created_at, p.amount::text AS amount
           FROM payouts p
           JOIN shifts s ON s.id = p.shift_id
          WHERE p.supplier_id = $1 AND p.voided_at IS NULL
          ORDER BY s.business_date, p.created_at, p.id`,
        [supplierId],
      )) as PayoutRow[];

      const lines: DebtLine[] = [
        ...intakes.map((r): DebtLine => ({ ...r, kind: 'intake', intake_id: r.id })),
        ...topUps.map((r): DebtLine => ({ ...r, kind: 'top_up' })),
      ].sort(byQueueKey);
      const payoutLines: PayoutLine[] = payouts;

      const debt = await this.debtFor(supplierId, manager);
      return { debt, ...settle(lines, payoutLines) };
    });
  }
```

And add the module-level comparator above the class (after `debtSql`):

```ts
/**
 * The queue key, `(business_date, created_at, id)`, for merging the receipt
 * and top-up reads — each is already in this order from Postgres. String
 * comparison is exact here: ISO dates and `timestamp::text` sort
 * lexicographically, and uuids only break ties.
 */
const byQueueKey = (a: DebtLine, b: DebtLine): number =>
  a.business_date < b.business_date
    ? -1
    : a.business_date > b.business_date
      ? 1
      : a.created_at < b.created_at
        ? -1
        : a.created_at > b.created_at
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;
```

- [ ] **Step 4: Run the unit tests**

Run: `cd backend && npx jest src/supplier-balance/supplier-balance.service.spec.ts`
Expected: PASS — the existing `debtFor`/`list` tests are untouched (they never reach `transaction`).

- [ ] **Step 5: Write the Postgres spec**

```ts
// backend/src/supplier-balance/settlement.db-spec.ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { SupplierBalanceService } from './supplier-balance.service';
import { sub, sum } from '../common/money';

/**
 * `settlementFor` against a real Postgres. What is under test is the SQL:
 * the four `voided_at` filters, the `(business_date, created_at, id)` order
 * across three sources, the parent's date on a top-up — and the one promise
 * of the slice, `debt === Σ open − unallocated`. Per-run uuid fixtures: the
 * throwaway database persists between runs and nothing here truncates.
 *
 * One supplier, Ніна, with:
 *   12.07  R1 1000.00
 *   12.07  top-up 200.00 on R1 (written 20.08 — must still queue behind R1)
 *   15.07  R2 300.00  VOIDED, with a top-up 50.00 (must count for nothing)
 *   15.07  R3 500.00
 *   04.08  P1 1300.00 bound to R2 (voided) → whole payout goes FIFO
 *   04.08  P2 100.00  VOIDED
 *   05.08  R4 250.00  (a reopened-shift receipt written AFTER P1 by the clock)
 */
describe('SupplierBalanceService.settlementFor (Postgres)', () => {
  let ds: DataSource;
  let service: SupplierBalanceService;
  let run: string;
  let userId: string;
  let supplierId: string;
  let ids: Record<string, string>;

  let seq = 0;
  const shift = async (point: string, date: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, $3) RETURNING id`,
      [point, userId, date],
    );
    return row.id as string;
  };
  const intake = async (shiftId: string, amount: string, voided = false): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6 THEN now() END, CASE WHEN $6 THEN $5::uuid END,
               CASE WHEN $6 THEN 'test' END) RETURNING id`,
      [`IN-${run}-${++seq}`, shiftId, supplierId, amount, userId, voided],
    );
    return row.id as string;
  };
  const topUp = async (intakeId: string, amount: string, createdAt: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id, created_at)
       VALUES ($1, $2, 'доплата', $3, $4) RETURNING id`,
      [intakeId, amount, userId, createdAt],
    );
    return row.id as string;
  };
  const payout = async (
    shiftId: string,
    amount: string,
    intakeId: string | null,
    voided = false,
  ): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, $4, $5, $6,
               CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN $5::uuid END,
               CASE WHEN $7 THEN 'test' END) RETURNING id`,
      [`PO-${run}-${++seq}`, shiftId, supplierId, amount, userId, intakeId, voided],
    );
    return row.id as string;
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new SupplierBalanceService(ds);
    run = randomUUID();
    const short = run.slice(0, 4).toUpperCase();

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Розрахунок-${run}`, `S${short}`],
    );
    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Ніна', 'Керівник', 'network_owner') RETURNING id`,
    );
    userId = user.id;
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ніна', $2, true) RETURNING id`,
      [point.id, `Ільчук-${run}`],
    );
    supplierId = supplier.id;

    const s0712 = await shift(point.id, '2026-07-12');
    const s0715 = await shift(point.id, '2026-07-15');
    const s0804 = await shift(point.id, '2026-08-04');
    const s0805 = await shift(point.id, '2026-08-05');

    const r1 = await intake(s0712, '1000.00');
    const t1 = await topUp(r1, '200.00', '2026-08-20T12:00:00Z');
    const r2 = await intake(s0715, '300.00', true);
    await topUp(r2, '50.00', '2026-08-20T12:05:00Z');
    const r3 = await intake(s0715, '500.00');
    const p1 = await payout(s0804, '1300.00', r2);
    await payout(s0804, '100.00', null, true);
    const r4 = await intake(s0805, '250.00');
    ids = { r1, t1, r3, p1, r4 };
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('queues live lines by (business_date, created_at, id) with the top-up behind its parent', async () => {
    const s = await service.settlementFor(supplierId);
    expect(s.lines.map((l) => l.id)).toEqual([ids.r1, ids.t1, ids.r3, ids.r4]);
    expect(s.lines[1]).toMatchObject({ kind: 'top_up', business_date: '2026-07-12', intake_id: ids.r1 });
  });

  it('excludes the voided receipt, its top-up and the voided payout', async () => {
    const s = await service.settlementFor(supplierId);
    expect(s.lines.map((l) => l.amount)).toEqual(['1000.00', '200.00', '500.00', '250.00']);
    expect(s.payouts.map((p) => p.id)).toEqual([ids.p1]);
  });

  it('a payout bound to a voided receipt goes whole into FIFO, and may reach a younger line', async () => {
    const s = await service.settlementFor(supplierId);
    // 1300 → R1 1000, top-up 200, R3 100 of 500. R4 is untouched.
    expect(s.lines.map((l) => [l.id, l.open])).toEqual([
      [ids.r1, '0.00'],
      [ids.t1, '0.00'],
      [ids.r3, '400.00'],
      [ids.r4, '250.00'],
    ]);
    expect(s.payouts[0].unallocated).toBe('0.00');
  });

  it('debt equals Σ open − unallocated, and equals debtFor', async () => {
    const s = await service.settlementFor(supplierId);
    expect(s.debt).toBe('650.00');
    expect(sub(sum(s.lines.map((l) => l.open)), s.unallocated)).toBe(s.debt);
    await expect(service.debtFor(supplierId)).resolves.toBe(s.debt);
  });

  it('a supplier with no documents settles to nothing', async () => {
    const [other] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       SELECT collection_point_id, 'Петро', $1, true FROM suppliers WHERE id = $2 RETURNING id`,
      [`Порожній-${run}`, supplierId],
    );
    await expect(service.settlementFor(other.id)).resolves.toEqual({
      debt: '0.00',
      unallocated: '0.00',
      lines: [],
      payouts: [],
    });
  });
});
```

- [ ] **Step 6: Run the Postgres spec**

Run: `docker compose up -d postgres && cd backend && npm run test:db -- src/supplier-balance/settlement.db-spec.ts`
Expected: PASS, 5 tests. If `intake_top_ups.created_at` rejects an explicit value, check the entity: it is `@CreateDateColumn`, which still accepts an INSERT value in raw SQL — if the column has a `DEFAULT now()` only, the explicit value is honoured.

- [ ] **Step 7: Commit**

```bash
git add backend/src/supplier-balance/supplier-balance.service.ts backend/src/supplier-balance/supplier-balance.service.spec.ts backend/src/supplier-balance/settlement.db-spec.ts
git commit -m "feat(settlement): settlementFor — three ordered reads with debtSql's four filters, one snapshot

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `GET /suppliers/:id/settlement`

**Files:**
- Modify: `backend/src/supplier-balance/supplier-balance.mapper.ts` (append)
- Modify: `backend/src/supplier-balance/supplier-balance.controller.ts` (add a route)
- Test: `backend/src/supplier-balance/supplier-balance.mapper.spec.ts` (new)
- Test: `backend/src/supplier-balance/supplier-balance.controller.spec.ts` (new)

**Interfaces:**
- Consumes: `settlementFor` (Task 3); `Settlement`, `SettledLine`, `SettledPayout` from `./settlement`.
- Produces (the wire contract Task 5's frontend type mirrors):

```ts
export interface SettlementLineResponse {
  kind: 'intake' | 'top_up'; id: string; code: string; intake_id: string;
  business_date: string; created_at: string;
  amount: string; paid: string; open: string;
  covered_by: { payout_id: string; payout_code: string; amount: string }[];
}
export interface SettlementPayoutResponse {
  id: string; code: string; business_date: string; created_at: string;
  amount: string; intake_id: string | null;
  covers: { line_id: string; kind: 'intake' | 'top_up'; amount: string }[];
  unallocated: string;
}
export interface SupplierSettlementResponse {
  supplier_id: string; debt: string; unallocated: string;
  lines: SettlementLineResponse[]; payouts: SettlementPayoutResponse[];
}
export function toSupplierSettlementResponse(supplier_id: string, s: Settlement & { debt: string }): SupplierSettlementResponse;
```

- [ ] **Step 1: Write the failing mapper test**

```ts
// backend/src/supplier-balance/supplier-balance.mapper.spec.ts
import { toSupplierSettlementResponse } from './supplier-balance.mapper';

describe('toSupplierSettlementResponse', () => {
  it('maps field by field and resolves payout codes onto covered_by', () => {
    const out = toSupplierSettlementResponse('sup', {
      debt: '-50.00',
      unallocated: '50.00',
      lines: [
        {
          id: 'r1', kind: 'intake', code: 'R1', intake_id: 'r1',
          business_date: '2026-07-12', created_at: '2026-07-12 08:00:00+00',
          amount: '100.00', paid: '100.00', open: '0.00',
          covered_by: [{ payout_id: 'p1', amount: '100.00' }],
          // a stray field a later SELECT might add must not leak
          ...({ supplier_secret: 'x' } as object),
        },
      ],
      payouts: [
        {
          id: 'p1', code: 'P1', business_date: '2026-08-04', created_at: '2026-08-04 10:00:00+00',
          amount: '150.00', intake_id: null,
          covers: [{ line_id: 'r1', kind: 'intake', amount: '100.00' }],
          unallocated: '50.00',
        },
      ],
    });

    expect(out).toEqual({
      supplier_id: 'sup',
      debt: '-50.00',
      unallocated: '50.00',
      lines: [
        {
          kind: 'intake', id: 'r1', code: 'R1', intake_id: 'r1',
          business_date: '2026-07-12', created_at: '2026-07-12 08:00:00+00',
          amount: '100.00', paid: '100.00', open: '0.00',
          covered_by: [{ payout_id: 'p1', payout_code: 'P1', amount: '100.00' }],
        },
      ],
      payouts: [
        {
          id: 'p1', code: 'P1', business_date: '2026-08-04', created_at: '2026-08-04 10:00:00+00',
          amount: '150.00', intake_id: null,
          covers: [{ line_id: 'r1', kind: 'intake', amount: '100.00' }],
          unallocated: '50.00',
        },
      ],
    });
    expect(out.lines[0]).not.toHaveProperty('supplier_secret');
  });
});
```

- [ ] **Step 2: Write the failing controller test**

```ts
// backend/src/supplier-balance/supplier-balance.controller.spec.ts
import { NotFoundException } from '@nestjs/common';
import { SupplierBalanceController } from './supplier-balance.controller';
import { UserRole } from '../users/user-role.enum';

/**
 * The route is thin on purpose: visibility is `SuppliersService.findOne`'s
 * (404, not 403, for another point's supplier — an operator must not learn
 * that a person exists elsewhere), and the body is the mapper's. Both are
 * asserted here through the controller, with the two services mocked.
 */
const SUPPLIER = '44444444-4444-4444-4444-444444444444';
const operator = {
  sub: 'u-oksana',
  username: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: '11111111-1111-1111-1111-111111111111',
};

describe('SupplierBalanceController', () => {
  const findOne = jest.fn();
  const debtFor = jest.fn();
  const settlementFor = jest.fn();
  const controller = new SupplierBalanceController(
    { debtFor, settlementFor } as never,
    { findOne } as never,
  );

  beforeEach(() => {
    findOne.mockReset();
    debtFor.mockReset();
    settlementFor.mockReset();
  });

  it('GET /suppliers/:id/settlement 404s through findOne before reading anything', async () => {
    findOne.mockRejectedValue(new NotFoundException());
    await expect(controller.settlement(operator as never, SUPPLIER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(settlementFor).not.toHaveBeenCalled();
  });

  it('GET /suppliers/:id/settlement returns the mapped settlement for a visible supplier', async () => {
    findOne.mockResolvedValue({ id: SUPPLIER });
    settlementFor.mockResolvedValue({
      debt: '0.00',
      unallocated: '0.00',
      lines: [],
      payouts: [],
    });
    await expect(controller.settlement(operator as never, SUPPLIER)).resolves.toEqual({
      supplier_id: SUPPLIER,
      debt: '0.00',
      unallocated: '0.00',
      lines: [],
      payouts: [],
    });
    expect(settlementFor).toHaveBeenCalledWith(SUPPLIER);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `cd backend && npx jest src/supplier-balance/supplier-balance.mapper.spec.ts src/supplier-balance/supplier-balance.controller.spec.ts`
Expected: FAIL — `toSupplierSettlementResponse is not a function`, `controller.settlement is not a function`.

- [ ] **Step 4: Append the mapper**

Append to `backend/src/supplier-balance/supplier-balance.mapper.ts`:

```ts
import type { DebtKind, Settlement } from './settlement';

/** One line of «Відкриті залишки» — spec §4.3. Every amount a scale-2 string. */
export interface SettlementLineResponse {
  kind: DebtKind;
  id: string;
  /** A top-up carries its PARENT receipt's code. */
  code: string;
  intake_id: string;
  business_date: string;
  created_at: string;
  amount: string;
  paid: string;
  open: string;
  covered_by: { payout_id: string; payout_code: string; amount: string }[];
}

export interface SettlementPayoutResponse {
  id: string;
  code: string;
  business_date: string;
  created_at: string;
  amount: string;
  intake_id: string | null;
  covers: { line_id: string; kind: DebtKind; amount: string }[];
  unallocated: string;
}

/**
 * `GET /suppliers/:id/settlement`. `debt` is the SAME number `/balance`
 * returns — the db-spec holds `debt === Σ open − unallocated`. `lines` is in
 * queue order, oldest first; no pagination, by design (spec §3.9).
 */
export interface SupplierSettlementResponse {
  supplier_id: string;
  debt: string;
  unallocated: string;
  lines: SettlementLineResponse[];
  payouts: SettlementPayoutResponse[];
}

/** Field by field, not `...row` — a raw projection must not reach the client. */
export function toSupplierSettlementResponse(
  supplier_id: string,
  s: Settlement & { debt: string },
): SupplierSettlementResponse {
  const payoutCode = new Map(s.payouts.map((p) => [p.id, p.code]));
  return {
    supplier_id,
    debt: s.debt,
    unallocated: s.unallocated,
    lines: s.lines.map((l) => ({
      kind: l.kind,
      id: l.id,
      code: l.code,
      intake_id: l.intake_id,
      business_date: l.business_date,
      created_at: l.created_at,
      amount: l.amount,
      paid: l.paid,
      open: l.open,
      covered_by: l.covered_by.map((c) => ({
        payout_id: c.payout_id,
        payout_code: payoutCode.get(c.payout_id) ?? '',
        amount: c.amount,
      })),
    })),
    payouts: s.payouts.map((p) => ({
      id: p.id,
      code: p.code,
      business_date: p.business_date,
      created_at: p.created_at,
      amount: p.amount,
      intake_id: p.intake_id,
      covers: p.covers.map((c) => ({ line_id: c.line_id, kind: c.kind, amount: c.amount })),
      unallocated: p.unallocated,
    })),
  };
}
```

(Move the `import type` line to the top of the file with the other imports.)

- [ ] **Step 5: Add the route**

In `backend/src/supplier-balance/supplier-balance.controller.ts`, extend the mapper import:

```ts
import { toSupplierBalanceResponse, toSupplierSettlementResponse } from './supplier-balance.mapper';
```

Append inside the class, after `findOne`:

```ts
  /**
   * «За що саме винні» — spec §4.3. SAME DEPTH AS `/balance`, so the class
   * comment's shadowing warning is honoured. Same visibility call: an
   * operator reading another point's supplier gets the same 404 `findOne`
   * gives everywhere. `/balance` stays a single number on purpose — the
   * payout ceiling reads it and must not pay for a breakdown.
   */
  @Get(':id/settlement')
  @Auth()
  async settlement(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const supplier = await this.suppliers.findOne(actor, id);
    return toSupplierSettlementResponse(supplier.id, await this.balance.settlementFor(supplier.id));
  }
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && npx jest src/supplier-balance`
Expected: PASS across `settlement.spec`, `settlement.properties.spec`, `supplier-balance.service.spec`, `supplier-balance.mapper.spec`, `supplier-balance.controller.spec`.

- [ ] **Step 7: Fast tier**

Run: `npm run verify`
Expected: green. If `dead-exports` (knip) flags `SettlementLineResponse` / `SettlementPayoutResponse` as unused exports, un-export them (keep them as local interfaces referenced by `SupplierSettlementResponse`) — do NOT add a knip ignore. If `document-immutability` or `audit` rows complain, read their message: this slice writes nothing, so a red there means a query string matched a write pattern and needs rephrasing, not an exception.

- [ ] **Step 8: Commit**

```bash
git add backend/src/supplier-balance
git commit -m "feat(settlement): GET /suppliers/:id/settlement — one supplier's open lines and what each payout closed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Frontend entity — `useSupplierSettlementQuery`

**Files:**
- Modify: `frontend/src/entities/supplier/model/supplier.ts` (append types)
- Modify: `frontend/src/entities/supplier/api/useSupplierBalances.ts` (append hook)
- Modify: `frontend/src/entities/supplier/index.ts` (export)
- Test: `frontend/src/entities/supplier/api/useSupplierBalances.test.tsx` (append)

**Interfaces:**
- Produces:

```ts
export interface SettlementLine { kind: 'intake' | 'top_up'; id: string; code: string; intake_id: string;
  business_date: string; created_at: string; amount: string; paid: string; open: string;
  covered_by: { payout_id: string; payout_code: string; amount: string }[] }
export interface SettlementPayout { id: string; code: string; business_date: string; created_at: string;
  amount: string; intake_id: string | null;
  covers: { line_id: string; kind: 'intake' | 'top_up'; amount: string }[]; unallocated: string }
export interface SupplierSettlement { supplier_id: string; debt: string; unallocated: string;
  lines: SettlementLine[]; payouts: SettlementPayout[] }
export function useSupplierSettlementQuery(id: string | null): UseQueryResult<SupplierSettlement>;
```

- [ ] **Step 1: Write the failing test**

`frontend/src/entities/supplier/api/useSupplierBalances.test.tsx` already sets up an `axios-mock-adapter` on the shared `httpClient` (`mock` in `beforeEach`) and a `QueryClientProvider` `wrapper`. Extend its import line to include `useSupplierSettlementQuery`, then append:

```tsx
describe('useSupplierSettlementQuery', () => {
  it('reads /suppliers/:id/settlement', async () => {
    mock
      .onGet('/suppliers/s1/settlement')
      .reply(200, { supplier_id: 's1', debt: '0.00', unallocated: '0.00', lines: [], payouts: [] });
    const { result } = renderHook(() => useSupplierSettlementQuery('s1'), { wrapper });
    await waitFor(() => expect(result.current.data?.debt).toBe('0.00'));
    expect(result.current.data?.lines).toEqual([]);
  });

  it('does not fire without an id', () => {
    const { result } = renderHook(() => useSupplierSettlementQuery(null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 2: (merged into Step 1)**

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/entities/supplier/api/useSupplierBalances.test.tsx`
Expected: FAIL — `useSupplierSettlementQuery is not defined`.

- [ ] **Step 4: Add the types and the hook**

Append to `frontend/src/entities/supplier/model/supplier.ts`:

```ts
/** One line of «Відкриті залишки» — `GET /suppliers/:id/settlement`. Every amount a string. */
export interface SettlementLine {
  kind: 'intake' | 'top_up';
  id: string;
  /** A top-up carries its PARENT receipt's code. */
  code: string;
  intake_id: string;
  business_date: string;
  created_at: string;
  amount: string;
  paid: string;
  open: string;
  covered_by: { payout_id: string; payout_code: string; amount: string }[];
}

export interface SettlementPayout {
  id: string;
  code: string;
  business_date: string;
  created_at: string;
  amount: string;
  intake_id: string | null;
  covers: { line_id: string; kind: 'intake' | 'top_up'; amount: string }[];
  unallocated: string;
}

/**
 * The card's «за що саме винні» — a projection the backend computes on every
 * read (spec 2026-09-25 §3.1); nothing here is stored. `debt` is the same
 * number `/balance` returns; `lines` is oldest first.
 */
export interface SupplierSettlement {
  supplier_id: string;
  debt: string;
  unallocated: string;
  lines: SettlementLine[];
  payouts: SettlementPayout[];
}
```

Append to `frontend/src/entities/supplier/api/useSupplierBalances.ts` (extend the model import to include `SupplierSettlement`):

```ts
/**
 * «Відкриті залишки» for one supplier. UNDER THE `supplierBalances` PREFIX on
 * purpose: every document write already invalidates that prefix (payout
 * create/void, receipt create/void, top-up create/void), so the breakdown
 * refreshes with the balance tile it sits beside — a stale breakdown under a
 * fresh tile is the one visible bug this read could introduce.
 */
export function useSupplierSettlementQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.supplierBalances, 'settlement', id],
    enabled: id !== null,
    queryFn: async (): Promise<SupplierSettlement> =>
      (await httpClient.get<SupplierSettlement>(`/suppliers/${id}/settlement`)).data,
    staleTime: 30_000,
  });
}
```

Update `frontend/src/entities/supplier/index.ts`:

```ts
export type {
  Supplier,
  SupplierKind,
  SupplierBalanceRow,
  Paginated,
  SupplierSettlement,
  SettlementLine,
  SettlementPayout,
} from './model/supplier';
export { supplierName } from './model/supplier';
export { useSuppliersQuery, useSupplierQuery } from './api/useSuppliers';
export {
  useSupplierBalanceQuery,
  useSupplierBalancesQuery,
  useSupplierSettlementQuery,
} from './api/useSupplierBalances';
export { KindBadge } from './ui/KindBadge';
export { kindHintKey } from './lib/kindHint';
```

- [ ] **Step 5: Run the test and typecheck**

Run: `cd frontend && npx vitest run src/entities/supplier && npm run typecheck`
Expected: PASS; `tsc -b` clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/entities/supplier
git commit -m "feat(supplier): useSupplierSettlementQuery under the supplier-balances prefix

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `daysBetween` in `shared/lib/date`

**Files:**
- Modify: `frontend/src/shared/lib/date/iso.ts` (append)
- Modify: `frontend/src/shared/lib/date/index.ts` (export)
- Test: `frontend/src/shared/lib/date/iso.test.ts` (append)

**Interfaces:**
- Produces: `daysBetween(fromIso: string, toIso: string): number` — whole calendar days, `to − from`, DST-immune (UTC noon arithmetic like `addDaysIso`).

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/shared/lib/date/iso.test.ts` (import `daysBetween` alongside the file's existing imports from `./iso`):

```ts
describe('daysBetween', () => {
  it('counts whole calendar days, to − from', () => {
    expect(daysBetween('2026-07-12', '2026-08-04')).toBe(23);
    expect(daysBetween('2026-08-04', '2026-08-04')).toBe(0);
    expect(daysBetween('2026-08-04', '2026-07-12')).toBe(-23);
  });

  it('is immune to the DST change (last Sunday of March / October)', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run src/shared/lib/date/iso.test.ts`
Expected: FAIL — `daysBetween` is not exported.

- [ ] **Step 3: Implement**

Append to `frontend/src/shared/lib/date/iso.ts`, after `addDaysIso`:

```ts
const DAY_MS = 86_400_000;

/**
 * Whole calendar days from `fromIso` to `toIso` (`to − from`; negative when
 * `to` is earlier). Built on the same UTC-noon anchor as `addDaysIso`, so a
 * DST change between the two dates cannot shave the count to 22.9 and floor
 * it wrong — the card's «найстаріший з 12.07 — 23 дні» is read by a person
 * who will count on a calendar.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((toUtcNoon(toIso).getTime() - toUtcNoon(fromIso).getTime()) / DAY_MS);
}
```

Add `daysBetween,` to the export list in `frontend/src/shared/lib/date/index.ts`.

- [ ] **Step 4: Run the test**

Run: `cd frontend && npx vitest run src/shared/lib/date/iso.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/lib/date
git commit -m "feat(date): daysBetween — whole calendar days, DST-immune

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `OpenBalances` section

**Files:**
- Create: `frontend/src/pages/supplier-card/ui/OpenBalances.tsx`
- Test: `frontend/src/pages/supplier-card/ui/OpenBalances.test.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json` (`supplierCard.open.*`)
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json` (`supplierCard.open.*`)

**Interfaces:**
- Consumes: `SettlementLine` from `@/entities/supplier`; `Intake` from `@/entities/intake`; `formatUah`, `formatKg` from `@/shared/lib/money`; `formatLongDate` from `@/shared/lib/date`; `SectionCard` from `@/shared/ui/section-card`; `cmp`, `isZero` from `@/shared/lib/money`.
- Produces: `OpenBalances({ lines, unallocated, intakesById, locale }: { lines: SettlementLine[]; unallocated: string; intakesById: Map<string, Intake>; locale: string })` — renders `null` when no line is open and `unallocated` is zero.

- [ ] **Step 1: Add the i18n keys**

In `frontend/src/shared/lib/i18n/locales/en.json`, inside `"supplierCard"`, after `"tiles"`:

```json
    "open": {
      "title": "Open balances — what exactly is owed",
      "topUp": "Top-up on {{code}}",
      "unallocated": "Overpayment — not allocated",
      "oldest_one": "oldest from {{date}} — {{count}} day",
      "oldest_other": "oldest from {{date}} — {{count}} days"
    },
```

In `frontend/src/shared/lib/i18n/locales/uk.json`, same place:

```json
    "open": {
      "title": "Відкриті залишки — за що саме винні",
      "topUp": "Доплата до {{code}}",
      "unallocated": "Переплата — не розподілено",
      "oldest_one": "найстаріший з {{date}} — {{count}} день",
      "oldest_few": "найстаріший з {{date}} — {{count}} дні",
      "oldest_many": "найстаріший з {{date}} — {{count}} днів",
      "oldest_other": "найстаріший з {{date}} — {{count}} дня"
    },
```

Run: `cd frontend && npx vitest run src/shared/lib/i18n`
Expected: PASS — `locales.test.ts` normalises plural suffixes to their base and requires `_one`/`_other` in both locales plus `_few`/`_many` in `uk`, which the two blocks above provide (same shape as `catalog.count_*`).

- [ ] **Step 2: Write the failing component test**

```tsx
// frontend/src/pages/supplier-card/ui/OpenBalances.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SettlementLine } from '@/entities/supplier';
import type { Intake } from '@/entities/intake';
import { OpenBalances } from './OpenBalances';

const line = (over: Partial<SettlementLine> & Pick<SettlementLine, 'id' | 'open'>): SettlementLine => ({
  kind: 'intake',
  code: over.id.toUpperCase(),
  intake_id: over.id,
  business_date: '2026-07-12',
  created_at: '2026-07-12T08:00:00.000Z',
  amount: over.open,
  paid: '0.00',
  covered_by: [],
  ...over,
});

const receipt = (id: string): Intake => ({
  id,
  code: id.toUpperCase(),
  shift_id: 's1',
  collection_point_id: 'p1',
  business_date: '2026-07-12',
  supplier_id: 'sup1',
  amount: '4200.00',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-07-12T08:00:00.000Z',
  net_kg: '41.20',
  lines_count: 1,
  supplier_name: 'Ніна Ільчук',
  paid_amount: '0.00',
});

describe('OpenBalances', () => {
  it('renders nothing when every line is closed and nothing is unallocated', () => {
    const { container } = render(
      <OpenBalances
        lines={[line({ id: 'r1', open: '0.00' })]}
        unallocated="0.00"
        intakesById={new Map()}
        locale="en"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists open lines oldest first with the receipt kilograms when the receipt is loaded', () => {
    render(
      <OpenBalances
        lines={[
          line({ id: 'r1', open: '4200.00', business_date: '2026-07-12' }),
          line({ id: 'r2', open: '0.00', business_date: '2026-07-15' }),
          line({ id: 'r3', open: '800.00', business_date: '2026-07-20' }),
        ]}
        unallocated="0.00"
        intakesById={new Map([['r1', receipt('r1')]])}
        locale="en"
      />,
    );
    expect(screen.getByText('Open balances — what exactly is owed')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('R1');
    expect(rows[0]).toHaveTextContent('41.20 kg');
    expect(rows[0]).toHaveTextContent('4,200.00 ₴');
    expect(rows[1]).toHaveTextContent('R3');
    expect(screen.queryByText('R2')).not.toBeInTheDocument();
  });

  it('renders a row without a loaded receipt and without crashing', () => {
    render(
      <OpenBalances
        lines={[line({ id: 'r9', open: '10.00' })]}
        unallocated="0.00"
        intakesById={new Map()}
        locale="en"
      />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('R9');
    expect(screen.getByRole('listitem')).not.toHaveTextContent('kg');
  });

  it('captions a top-up with its parent code', () => {
    render(
      <OpenBalances
        lines={[line({ id: 't1', kind: 'top_up', code: 'R1', intake_id: 'r1', open: '200.00' })]}
        unallocated="0.00"
        intakesById={new Map()}
        locale="en"
      />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Top-up on R1');
  });

  it('shows the overpayment as one row under the list, even with nothing open', () => {
    render(
      <OpenBalances lines={[]} unallocated="50.00" intakesById={new Map()} locale="en" />,
    );
    expect(screen.getByText('Overpayment — not allocated')).toBeInTheDocument();
    expect(screen.getByText('50.00 ₴')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/pages/supplier-card/ui/OpenBalances.test.tsx`
Expected: FAIL — cannot resolve `./OpenBalances`.

- [ ] **Step 4: Write the component**

```tsx
// frontend/src/pages/supplier-card/ui/OpenBalances.tsx
import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { formatLongDate } from '@/shared/lib/date';
import { formatUah, formatKg, isZero } from '@/shared/lib/money';
import type { SettlementLine } from '@/entities/supplier';
import type { Intake } from '@/entities/intake';

/**
 * §3.10's «Відкриті залишки — за що саме винні», back as a projection (spec
 * 2026-09-25 §3.10). The shape follows the reference SupplierPage: one row per
 * open line, oldest first, the open amount on the right. Rendered only when
 * there is something to say — a closed card shows no empty box.
 *
 * A top-up is ITS OWN ROW, captioned with its parent's code: folding it into
 * the receipt's row would print a number bigger than the «Разом» on the paper
 * (the 11.09.2026 note in the `suppliers` Note).
 *
 * The kilograms come from the card's already loaded receipts, found by id. A
 * receipt past the card's `limit: 100` page is still an open line here — the
 * settlement is over the whole season — and just lacks the sub-caption.
 *
 * Overpayment is ONE ROW under the list, never a line: it is money nothing is
 * open against, the `−debt` §3.5 says «гаситься сам наступною здачею».
 */
export function OpenBalances({
  lines,
  unallocated,
  intakesById,
  locale,
}: {
  lines: SettlementLine[];
  unallocated: string;
  intakesById: Map<string, Intake>;
  locale: string;
}) {
  const { t } = useTranslation();
  const open = lines.filter((l) => !isZero(l.open));
  const overpaid = !isZero(unallocated);

  if (open.length === 0 && !overpaid) return null;

  return (
    <SectionCard eyebrow={t('supplierCard.open.title')} className="mb-5">
      {open.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {open.map((l) => {
            const receipt = l.kind === 'intake' ? intakesById.get(l.intake_id) : undefined;
            return (
              <li
                key={`${l.kind}-${l.id}`}
                className="flex items-center gap-3 rounded-lg bg-[var(--amber)]/8 px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">{l.code}</span>
                <span>{formatLongDate(l.business_date, locale)}</span>
                {l.kind === 'top_up' ? (
                  <span className="text-xs text-muted-foreground">
                    {t('supplierCard.open.topUp', { code: l.code })}
                  </span>
                ) : receipt ? (
                  <span className="text-xs text-muted-foreground">
                    {formatKg(receipt.net_kg, locale)}
                  </span>
                ) : null}
                <span className="ml-auto font-mono font-semibold tabular-nums text-[var(--amber)]">
                  {formatUah(l.open, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {overpaid ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg bg-[var(--leaf)]/8 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t('supplierCard.open.unallocated')}</span>
          <span className="ml-auto font-mono font-semibold tabular-nums text-[var(--leaf)]">
            {formatUah(unallocated, locale)}
          </span>
        </div>
      ) : null}
    </SectionCard>
  );
}
```

`SectionCard` takes `className` (`shared/ui/section-card.tsx:20`); `formatKg(value, locale)` renders `41.20 kg` for `en` and `41,20 кг` for `uk` (`shared/lib/money/format.ts:45`).

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd frontend && npx vitest run src/pages/supplier-card/ui/OpenBalances.test.tsx && npm run typecheck`
Expected: PASS (5 tests); `tsc -b` clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/supplier-card/ui/OpenBalances.tsx frontend/src/pages/supplier-card/ui/OpenBalances.test.tsx frontend/src/shared/lib/i18n/locales
git commit -m "feat(supplier-card): «Відкриті залишки» section from the settlement projection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Wire the card — fourth query, tile hint, history captions

**Files:**
- Modify: `frontend/src/pages/supplier-card/ui/SupplierCardPage.tsx`
- Modify: `frontend/src/pages/supplier-card/ui/SupplierTimeline.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json` (`supplierCard.timeline.*`)
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json` (`supplierCard.timeline.*`)
- Test: `frontend/src/pages/supplier-card/ui/SupplierCardPage.test.tsx`

**Interfaces:**
- Consumes: `useSupplierSettlementQuery`, `SupplierSettlement`, `SettlementLine` (Task 5); `daysBetween`, `todayIso`, `formatShortDate` (Task 6 / existing); `OpenBalances` (Task 7).
- Produces: `SupplierTimeline` gains two optional props: `openByLineId?: Map<string, string>` (line id → `open`) and `coversByPayoutId?: Map<string, { dates: string[]; unallocated: string }>`.

- [ ] **Step 1: Add the timeline i18n keys**

`en.json`, inside `"supplierCard" → "timeline"`, after `"parentVoided"`:

```json
      "openLeft": "{{uah}} still open",
      "closed": "closed berries of {{dates}}",
      "unallocated": "{{uah}} not allocated"
```

`uk.json`, same place:

```json
      "openLeft": "у залишок {{uah}}",
      "closed": "закрито ягоду за {{dates}}",
      "unallocated": "не розподілено {{uah}}"
```

- [ ] **Step 2: Extend the page test's mocks and write the failing tests**

In `frontend/src/pages/supplier-card/ui/SupplierCardPage.test.tsx`:

Add `settlementMock: vi.fn()` to the `vi.hoisted` object, and to the `@/entities/supplier` mock:

```ts
  useSupplierSettlementQuery: (id: string | null) => settlementMock(id),
```

Add a default in `beforeEach`:

```ts
  settlementMock.mockReset().mockReturnValue({
    data: { supplier_id: 'sup1', debt: '500.00', unallocated: '0.00', lines: [], payouts: [] },
    isPending: false,
    isError: false,
  });
```

Add a settlement fixture helper next to `intake`/`payout`/`topUp`:

```ts
import type { SettlementLine } from '@/entities/supplier';

const settlementLine = (
  over: Partial<SettlementLine> & Pick<SettlementLine, 'id' | 'open'>,
): SettlementLine => ({
  kind: 'intake',
  code: over.id.toUpperCase(),
  intake_id: over.id,
  business_date: '2026-09-08',
  created_at: '2026-09-08T07:10:00Z',
  amount: over.open,
  paid: '0.00',
  covered_by: [],
  ...over,
});
```

Append tests inside `describe('SupplierCardPage', …)`:

```tsx
  it('shows the open-balances section and the oldest-debt hint from the settlement', () => {
    settlementMock.mockReturnValue({
      data: {
        supplier_id: 'sup1',
        debt: '500.00',
        unallocated: '0.00',
        lines: [settlementLine({ id: 'i1', open: '500.00', business_date: '2026-09-01' })],
        payouts: [],
      },
      isPending: false,
      isError: false,
    });
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '500.00', created_at: '2026-09-01T07:10:00Z' }),
      ]),
    );

    renderCard();

    expect(screen.getByText('Open balances — what exactly is owed')).toBeInTheDocument();
    // The short-date spelling is `formatShortDate`'s for `en`; the hint's shape is what matters.
    expect(tile('Balance')).toHaveTextContent(/oldest from .+ — \d+ days?/);
  });

  it('captions history rows with what is open and what a payout closed', () => {
    settlementMock.mockReturnValue({
      data: {
        supplier_id: 'sup1',
        debt: '200.00',
        unallocated: '0.00',
        lines: [
          settlementLine({ id: 'i1', open: '0.00', amount: '300.00', paid: '300.00', business_date: '2026-09-01' }),
          settlementLine({ id: 'i2', open: '200.00', amount: '200.00', business_date: '2026-09-08' }),
        ],
        payouts: [
          {
            id: 'y1', code: 'VD-0001', business_date: '2026-09-08', created_at: '2026-09-08T09:20:00Z',
            amount: '300.00', intake_id: null,
            covers: [{ line_id: 'i1', kind: 'intake', amount: '300.00' }],
            unallocated: '0.00',
          },
        ],
      },
      isPending: false,
      isError: false,
    });
    intakesMock.mockReturnValue(
      page<Intake>([
        intake({ id: 'i1', code: 'KV-0001', amount: '300.00', created_at: '2026-09-01T07:10:00Z', business_date: '2026-09-01' }),
        intake({ id: 'i2', code: 'KV-0002', amount: '200.00', created_at: '2026-09-08T07:10:00Z' }),
      ]),
    );
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '300.00', created_at: '2026-09-08T09:20:00Z' }),
      ]),
    );

    renderCard();

    const history = screen.getByText('History — receipts and payouts').closest('section, div')!;
    expect(within(history as HTMLElement).getByText('KV-0002').closest('li')).toHaveTextContent(
      '200.00 ₴ still open',
    );
    expect(within(history as HTMLElement).getByText('KV-0001').closest('li')).not.toHaveTextContent(
      'still open',
    );
    expect(screen.getByText('VD-0001').closest('li')).toHaveTextContent(/closed berries of .*01/);
  });

  it('captions an overpaid payout with the unallocated amount', () => {
    settlementMock.mockReturnValue({
      data: {
        supplier_id: 'sup1',
        debt: '-50.00',
        unallocated: '50.00',
        lines: [],
        payouts: [
          {
            id: 'y1', code: 'VD-0001', business_date: '2026-09-08', created_at: '2026-09-08T09:20:00Z',
            amount: '50.00', intake_id: null, covers: [], unallocated: '50.00',
          },
        ],
      },
      isPending: false,
      isError: false,
    });
    payoutsMock.mockReturnValue(
      page<Payout>([
        payout({ id: 'y1', code: 'VD-0001', amount: '50.00', created_at: '2026-09-08T09:20:00Z' }),
      ]),
    );

    renderCard();

    expect(screen.getByText('VD-0001').closest('li')).toHaveTextContent('50.00 ₴ not allocated');
    expect(screen.getByText('Overpayment — not allocated')).toBeInTheDocument();
  });

  it('shows the shared error banner when the settlement fails', () => {
    settlementMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderCard();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
```

- [ ] **Step 3: Run to verify they fail**

Run: `cd frontend && npx vitest run src/pages/supplier-card/ui/SupplierCardPage.test.tsx`
Expected: the four new tests FAIL (section/captions absent); the existing ones still PASS.

- [ ] **Step 4: Wire the page**

In `frontend/src/pages/supplier-card/ui/SupplierCardPage.tsx`:

Imports — extend the supplier import and add the rest:

```ts
import {
  useSupplierQuery,
  useSupplierBalanceQuery,
  useSupplierSettlementQuery,
  supplierName,
} from '@/entities/supplier';
import { daysBetween, todayIso, formatShortDate } from '@/shared/lib/date';
import { OpenBalances } from './OpenBalances';
```

Queries — after `const topUps = …`:

```ts
  // THE FOURTH QUERY — spec 2026-09-25 §3.8. The three lists stay for the
  // history (voided rows, reasons, authors); this one carries the arithmetic.
  const settlement = useSupplierSettlementQuery(id ?? null);
```

Error/pending — add `settlement.isError` to the error condition and `settlement.isPending || !settlement.data` to the pending condition.

Derived values — after `const payoutsTruncated = …`:

```ts
  const st = settlement.data;
  const intakesById = new Map(intakeRows.map((i) => [i.id, i]));
  const openByLineId = new Map(st.lines.map((l) => [l.id, l.open]));
  const lineDate = new Map(st.lines.map((l) => [l.id, l.business_date]));
  const coversByPayoutId = new Map(
    st.payouts.map((p) => {
      const dates = [...new Set(p.covers.map((c) => lineDate.get(c.line_id) ?? ''))]
        .filter((d) => d !== '')
        .sort();
      return [p.id, { dates, unallocated: p.unallocated }];
    }),
  );
  const oldestOpen = st.lines.find((l) => !isZero(l.open));
  const balanceHint = oldestOpen
    ? t('supplierCard.open.oldest', {
        date: formatShortDate(oldestOpen.business_date, i18n.language),
        count: daysBetween(oldestOpen.business_date, todayIso()),
      })
    : isZero(debt)
      ? t('supplierCard.tiles.balanceHint')
      : undefined;
```

Balance tile — replace its `hint` prop with `hint={balanceHint}`.

Section — immediately before `<SectionCard eyebrow={t('supplierCard.timeline.title')}>`:

```tsx
      <OpenBalances
        lines={st.lines}
        unallocated={st.unallocated}
        intakesById={intakesById}
        locale={i18n.language}
      />
```

Timeline — pass the two maps:

```tsx
        <SupplierTimeline
          intakes={intakeRows}
          payouts={payoutRows}
          topUps={topUpRows}
          me={me.data}
          openByLineId={openByLineId}
          coversByPayoutId={coversByPayoutId}
          onOpenReceipt={openReceipt}
          onVoidPayout={openVoidPayout}
          onAddTopUp={openTopUp}
          onVoidTopUp={openVoidTopUp}
        />
```

- [ ] **Step 5: Add the captions to the timeline**

In `frontend/src/pages/supplier-card/ui/SupplierTimeline.tsx`:

Props — add to the parameter type and destructuring:

```ts
  /** Line id → open amount, from the settlement. Absent on a voided row. */
  openByLineId?: Map<string, string>;
  /** Payout id → the business dates it closed and what it left unallocated. */
  coversByPayoutId?: Map<string, { dates: string[]; unallocated: string }>;
```

Import `isZero` from `@/shared/lib/money` alongside `formatUah`, and `formatShortDate` is already imported.

Intake row — replace the amount span inside the intake `<button>`:

```tsx
                <span className="ml-auto text-right">
                  <span className="block font-mono tabular-nums">{formatUah(row.amount, locale)}</span>
                  {!row.voided && openByLineId?.get(row.id) && !isZero(openByLineId.get(row.id)!) ? (
                    <span className="block font-mono text-[11px] text-[var(--amber)]">
                      {t('supplierCard.timeline.openLeft', {
                        uah: formatUah(openByLineId.get(row.id)!, locale),
                      })}
                    </span>
                  ) : null}
                </span>
```

Top-up row — the same block replaces its amount span (the key is the top-up's own id, `row.id`, which is what the settlement line carries).

Payout row — replace the amount span:

```tsx
              <span className="ml-auto text-right">
                <span
                  className={cn('block font-mono tabular-nums', !row.voided && 'text-[var(--leaf)]')}
                >
                  {formatUah(row.amount, locale)}
                </span>
                {!row.voided && coversByPayoutId?.get(row.id)?.dates.length ? (
                  <span className="block text-[11px] text-muted-foreground">
                    {t('supplierCard.timeline.closed', {
                      dates: coversByPayoutId
                        .get(row.id)!
                        .dates.map((d) => formatShortDate(d, locale))
                        .join(', '),
                    })}
                  </span>
                ) : null}
                {!row.voided &&
                coversByPayoutId?.get(row.id) &&
                !isZero(coversByPayoutId.get(row.id)!.unallocated) ? (
                  <span className="block font-mono text-[11px] text-[var(--leaf)]">
                    {t('supplierCard.timeline.unallocated', {
                      uah: formatUah(coversByPayoutId.get(row.id)!.unallocated, locale),
                    })}
                  </span>
                ) : null}
              </span>
```

Update the component doc comment: replace «no per-receipt balance breakdown (§3: a balance is ONE number)» with «the per-line breakdown arrives as two maps from the settlement projection (spec 2026-09-25) — this list never computes it», and replace the «THIS IS THE ONLY PLACE THE BALANCE IS EXPLAINED» paragraph with one sentence: «`OpenBalances` above explains the balance; the captions here point each row at it.»

- [ ] **Step 6: Run the page tests, the whole frontend suite, and typecheck**

Run: `cd frontend && npx vitest run src/pages/supplier-card && npm run typecheck && npx vitest run`
Expected: all PASS; `tsc -b` clean. If the `tile('Balance')` regex fails on the date, print the tile's text once and adjust the regex to the `en` short-date format `formatShortDate` actually produces.

- [ ] **Step 7: Fast tier**

Run: `npm run verify`
Expected: green. Paste the verdict line.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/supplier-card frontend/src/shared/lib/i18n/locales
git commit -m "feat(supplier-card): oldest-debt hint and history captions from the settlement

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Rule and schema edits

**Files:**
- Modify: `26-rules-by-example.md` — §3.3 (after line ~470, before `## 3.4`), §3.10 (after line ~597, before `# Частина 4`), §9.3 (after the «Примітка (схема, 03–04.09.2026)» paragraph, before `## 9.4`)
- Modify: `28-db-schema.dbml` — `suppliers` Note (after the «### Мінус» block's #61 edit, before «### Стартового боргу немає»), the «Розподілу і FIFO» bullet, `payouts` Note
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (append a section)

- [ ] **Step 1: §3.3 edit**

Insert before `## 3.4 Недоплата осідає на СЬОГОДНІШНІЙ квитанції`:

```markdown
→ **Правка (2026-09-25, слайс розрахунків):** розподіл **повертається — як обчислення, а не
як запис**. Таблиці розподілу немає й не буде; система рахує його щоразу з тих самих трьох
історій (квитанції, доплати, виплати, без сторнованих). Правило:

```
1. виплата, видана РАЗОМ із квитанцією (кнопка на прийомці), спершу закриває ЦЮ квитанцію
2. усе, що лишилось — і виплати «без ягоди», і надлишок з кроку 1 — закриває
   найстаріший відкритий рядок першим
3. доплата — окремий рядок черги, під датою СВОЄЇ квитанції, одразу за нею
4. гроші, яким нема що закривати, — переплата; наступна здача її погасить сама
```

Приклад вище під цим правилом, якщо 8 000 видано разом із сьогоднішньою квитанцією:
5 460 закриває сьогоднішню, 2 540 йде на 12.07 (лишається 1 660 з 12.07), 15.07 і 20.07
лишаються відкритими. Це **відхід** від дослівного «найстаріший першим» — обрано, бо
приймальник видав гроші «за цю ягоду», і саме так це записано на його чеку; потребує
підтвердження замовника. Підпис «з них … закриють попередні залишки» під полем виплати
**не повертається**. Після сторно будь-якого документа розкладка перераховується — папір
у руках людини про це не знає, як і раніше. `[ПР-24, ПР-25]` частково відновлені.
```

- [ ] **Step 2: §3.10 edit**

Insert before the `---` that precedes `# Частина 4 · Ціни`:

```markdown
→ **Правка (2026-09-25, слайс розрахунків):** секція «ВІДКРИТІ ЗАЛИШКИ — за що саме винні» і
рядок «найстаріший борг з 12.07 — 23 дні» **повертаються** — з тим самим застереженням, що в
§3.3: це обчислення, не запис. Доплата в списку — окремий рядок «Доплата до Ч-0412», а не
цифра поверх надрукованого «Разом». В історії кожна виплата підписана «закрито ягоду за 12.07,
15.07», кожен відкритий рядок — «у залишок N ₴», переплата — одним рядком під списком. Три
списки історії лишаються. `[ПС-30, ПС-31, ПС-32]` відновлені як показ, не як облік.
```

- [ ] **Step 3: §9.3 edit**

Insert before `## 9.4 Хто що сторнує`, after the existing «Примітка (схема, 03–04.09.2026)» paragraph:

```markdown
→ **Примітка (2026-09-25):** «сторно розкручує розподіл НАЗАД: залишки … повертаються з
ПОЧАТКОВИМИ датами» тепер справджується механічно й без коду: розподіл не зберігається
(§3.3), тому сторнований документ просто випадає з розрахунку, і розкладка перераховується
з початкових дат сама.
```

- [ ] **Step 4: DBML `suppliers` Note**

Insert a new `###` subsection immediately before `### Стартового боргу немає`:

```
### Розподіл є, але не зберігається (2026-09-25)

Таблиці `payout_allocations` як не було, так і немає, і додавати її не можна. «За що саме
винні» — залишок кожної квитанції й доплати, найстаріший відкритий борг, що закрила виплата —
рахує `backend/src/supplier-balance/settlement.ts` НА КОЖНЕ ЧИТАННЯ з тих самих трьох історій
і з тими самими чотирма фільтрами `voided_at IS NULL`, що й формула вище. Правило: спершу
виплата закриває квитанцію зі свого `payouts.intake_id`, решта — найстаріший відкритий рядок
першим; доплата стоїть у черзі під датою своєї квитанції. `debt` з `GET /suppliers/:id/balance`
і `Σ open − unallocated` з `GET /suppliers/:id/settlement` — ОДНЕ число, і db-spec це тримає.
Сторно будь-якого документа розкладку не «розкручує» — воно її просто змінює, бо змінює вхід.
Спека: `docs/superpowers/specs/2026-09-25-yagoda-supplier-settlement-slice.md`.
```

Edit the bullet `- **Розподілу і FIFO** (§3.3): жодна виплата не памʼятає, яку саме дату вона закрила.` to:

```
- **Розподілу і FIFO** (§3.3): жодна виплата не памʼятає, яку саме дату вона закрила.
  **ПРАВКА 2026-09-25:** «не памʼятає» лишається правдою — не зберігається; але
  ОБЧИСЛЮЄТЬСЯ на кожне читання, див. «Розподіл є, але не зберігається» нижче.
```

- [ ] **Step 5: DBML `payouts` Note**

In the `payouts` Note, replace the sentence `Виплата не «закриває» жодної конкретної квитанції: розподілу немає, і «Разом» дорівнює просто боргу людини на цю мить.` with:

```
Виплата не «закриває» жодної конкретної квитанції В ЗАПИСІ: збереженого розподілу немає, і «Разом» дорівнює просто боргу людини на цю мить. ПРАВКА 2026-09-25: обчислюваний розподіл читає intake_id як «спершу ця квитанція» — див. Note suppliers, «Розподіл є, але не зберігається».
```

And in the `intake_id` column comment, after `Додано 2026-09-21.`, append: ` З 2026-09-25 обчислюваний розподіл читає її як «спершу ця квитанція» (Note suppliers).`

- [ ] **Step 6: Follow-ups**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

```markdown
## Deferred from the supplier settlement slice (2026-09-25)

- **Slice 2 — voiding a receipt that has a bound payout (#125).** When the receipt being
  voided has a live payout with `intake_id` pointing at it, the void dialog shows it and
  requires one of three explicit choices, none preselected: leave the payout (the common
  case — a corrected receipt follows); void both, money already back in the drawer
  (`return_settled_*` set in the same transaction); void both, return expected. Both voids
  in one transaction with one reason; rights are the intersection of §9.4 for both
  documents. #125's stated consequence («каса не сходиться») comes from an unrecorded
  `return_settled`, not from a forgotten payout void — voiding a payout does not move cash
  (§9.3); the issue should be annotated to say so.
- **«Найстаріший борг» column on the «Залишки» list.** Separate slice, plain FIFO by date
  in SQL over `supplier-balances`; must not re-implement `settle()`.
- **Client confirmation of the §3.3 change.** The projection is «bound first, then FIFO».
  If the client insists on strict oldest-first, pass 1 of `settle()` is removed and nothing
  else changes.
```

- [ ] **Step 7: Schema conformance and the fast tier**

Run: `npm run schema:check && npm run verify`
Expected: green — the DBML changed only inside Notes and a column comment; `grep -c "^Table " 28-db-schema.dbml` still prints `22`.

- [ ] **Step 8: Commit**

```bash
git add 26-rules-by-example.md 28-db-schema.dbml docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "docs(rules): the breakdown returns as a computed projection — §3.3, §3.10, §9.3 and the suppliers/payouts Notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Slice verdict

**Files:** none new.

- [ ] **Step 1: Full tier**

Run: `docker compose up -d postgres redis && npm run verify:full`
Expected: green. Paste the verdict line and name every `SKIPPED` row aloud. `coverage` percentages, if quoted, are the runner's own — never a floor.

- [ ] **Step 2: Manual check against the seed**

Run: `docker compose up -d && npm run db:seed`, log in as the seeded owner, open a supplier card with several receipts and a payout. Confirm: the «Відкриті залишки» section lists open receipts oldest first; the «Залишок» tile reads «найстаріший з …»; a payout row says «закрито ягоду за …»; voiding a payout (existing dialog) makes the section grow and the captions move, with no page reload. Switch language to `uk` and confirm the copy.

- [ ] **Step 3: Request review**

Use `superpowers:requesting-code-review` for the whole branch `feat/supplier-settlement` against `main`. Point the reviewer at the Review Focus list at the top of this plan and at spec §3.2/§3.3 (the rule) as the thing to break.
