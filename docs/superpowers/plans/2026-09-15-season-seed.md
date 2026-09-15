# Season Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the dev seed from two days of history to a full season, so the journal, the supplier card, the dashboard sparklines and every paginated list have real data to render.

**Architecture:** The curated «today / yesterday» dataset is FROZEN — it carries every incident the screens are read against and every figure the db-spec asserts. History is ADDITIVE: a new `dev-seed.history.ts` generates 30 prior business days deterministically, and the runner gains exactly one new branch (`dateOf` learns numeric days). The generated history is made invisible to the curated cash chain by landing each point's last generated closing count exactly on that point's curated anchor.

**Tech Stack:** TypeScript, TypeORM `QueryRunner`, raw SQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-15-yagoda-mock-ui-catchup.md` (section 2)

## Global Constraints

- Money values are DECIMAL STRINGS, never numbers. Use `addMoney` from `dev-seed.ts`; never `Number()`, `*`, `/` or `toFixed`.
- The seed is IDEMPOTENT: every row is looked up by its natural key and inserted only when missing. Generated natural keys (receipt codes) must be a pure function of `(point, day, index)`.
- The generator takes NO randomness from the environment — same output on every run.
- `npm test -w backend` and `npm run lint` must stay green; `npm run test:db -w backend` must stay green on a FRESH `*_test` database (a stale `app_test` can make the seed spec pass falsely).
- Nothing in `SEED_SHIFTS`, `SEED_INTAKES`, `SEED_PAYOUTS`, `SEED_CASH_COUNTS`, `SEED_TRANSFERS` or `SEED_TOP_UPS` changes value. Rows may be APPENDED to `SEED_PRICE_CHANGES` and `SEED_TOP_UPS` only.

---

### Task 1: `SeedDay` learns numeric days

**Files:**
- Modify: `backend/src/seed/dev-seed.data.ts` (the `SeedDay` type, line ~453)
- Modify: `backend/src/seed/dev-seed.ts` (`dateOf`, line ~351)
- Test: `backend/src/seed/dev-seed.spec.ts`

**Interfaces:**
- Produces: `type SeedDay = 'today' | 'yesterday' | number` — a number is "N days before today", so `2` is the day before yesterday. `dateOf(day: SeedDay): string` returns an ISO `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing test**

In `backend/src/seed/dev-seed.spec.ts`, add:

```ts
import { daysBack } from './dev-seed.data';

describe('SeedDay', () => {
  it('maps a numeric day to that many days before today', () => {
    expect(daysBack('today')).toBe(0);
    expect(daysBack('yesterday')).toBe(1);
    expect(daysBack(30)).toBe(30);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w backend -- dev-seed.spec`
Expected: FAIL — `daysBack` is not exported from `./dev-seed.data`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/seed/dev-seed.data.ts`, replace the `SeedDay` type with:

```ts
/**
 * A business date, relative to the day the seed runs. `'today'` and
 * `'yesterday'` name the two CURATED days; a NUMBER is that many days before
 * today, and is what `dev-seed.history.ts` generates with. The two spellings of
 * day 1 (`'yesterday'` and `1`) are deliberate: the curated rows keep the word,
 * so a reader can tell curated data from generated data without opening the
 * other file.
 */
export type SeedDay = 'today' | 'yesterday' | number;

/** `SeedDay` as a count of days before today. The one place the encoding lives. */
export function daysBack(day: SeedDay): number {
  if (day === 'today') return 0;
  if (day === 'yesterday') return 1;
  return day;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w backend -- dev-seed.spec`
Expected: PASS

- [ ] **Step 5: Teach the runner the new branch**

In `backend/src/seed/dev-seed.ts`, the `days` query and `dateOf` become:

```ts
  const days = await one<{ today: string }>(
    qr,
    `SELECT (now() AT TIME ZONE $1)::date::text AS today`,
    [tz],
  );
  // One subtraction, in SQL's calendar rather than JavaScript's, so a DST
  // boundary inside the seeded window cannot shift a business date.
  const dateCache = new Map<number, string>();
  const dateOf = (day: SeedDay): string => {
    const n = daysBack(day);
    const hit = dateCache.get(n);
    if (hit !== undefined) return hit;
    const iso = isoDaysBefore(days!.today, n);
    dateCache.set(n, iso);
    return iso;
  };
```

Add the helper above `seedDocuments`:

```ts
/** `YYYY-MM-DD`, `n` days before `iso`. Pure date arithmetic in UTC, so no
 *  local timezone can move it across a boundary. */
export function isoDaysBefore(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
```

Import `daysBack` alongside the existing `type SeedDay` import.

- [ ] **Step 6: Test the helper**

Add to `backend/src/seed/dev-seed.spec.ts`:

```ts
import { isoDaysBefore } from './dev-seed';

describe('isoDaysBefore', () => {
  it('walks back across a month boundary', () => {
    expect(isoDaysBefore('2026-09-15', 0)).toBe('2026-09-15');
    expect(isoDaysBefore('2026-09-15', 1)).toBe('2026-09-14');
    expect(isoDaysBefore('2026-09-15', 30)).toBe('2026-08-16');
  });

  it('walks back across a leap day', () => {
    expect(isoDaysBefore('2028-03-01', 1)).toBe('2028-02-29');
  });
});
```

- [ ] **Step 7: Run the suite**

Run: `npm test -w backend -- dev-seed.spec` then `npm run lint -w backend`
Expected: PASS, lint clean.

- [ ] **Step 8: Commit**

```bash
git add backend/src/seed/dev-seed.data.ts backend/src/seed/dev-seed.ts backend/src/seed/dev-seed.spec.ts
git commit -m "feat(seed): SeedDay learns numeric days"
```

---

### Task 2: The deterministic history generator

**Files:**
- Create: `backend/src/seed/dev-seed.history.ts`
- Create: `backend/src/seed/dev-seed.history.spec.ts`

**Interfaces:**
- Consumes: `SeedDay`, `SeedShift`, `SeedIntake`, `SeedPayout`, `SeedCashCount`, `SEED_POINTS`, `SEED_GRADES`, `SEED_SUPPLIERS`, `SEED_OPERATORS` from `./dev-seed.data`.
- Produces:
  - `HISTORY_DAYS: number` (30)
  - `HISTORY_SHIFTS: readonly SeedShift[]`
  - `HISTORY_INTAKES: readonly SeedIntake[]`
  - `HISTORY_PAYOUTS: readonly SeedPayout[]`
  - `HISTORY_CASH_COUNTS: readonly SeedCashCount[]` — chronological, earliest first
  - `CURATED_ANCHOR: Readonly<Record<string, string>>` — point name to the opening figure the curated dataset anchors on

- [ ] **Step 1: Write the failing test**

Create `backend/src/seed/dev-seed.history.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CURATED_ANCHOR,
  HISTORY_CASH_COUNTS,
  HISTORY_DAYS,
  HISTORY_INTAKES,
  HISTORY_PAYOUTS,
  HISTORY_SHIFTS,
} from './dev-seed.history';
import { daysBack, SEED_SUPPLIERS } from './dev-seed.data';

const money = /^\d+\.\d{2}$/;

describe('generated history', () => {
  it('is deterministic — two imports agree', async () => {
    const again = await import('./dev-seed.history');
    expect(again.HISTORY_INTAKES).toEqual(HISTORY_INTAKES);
  });

  it('covers the days BEFORE the curated pair, never today or yesterday', () => {
    for (const s of HISTORY_SHIFTS) expect(daysBack(s.day)).toBeGreaterThanOrEqual(2);
    for (const i of HISTORY_INTAKES) expect(daysBack(i.day)).toBeGreaterThanOrEqual(2);
    const deepest = Math.max(...HISTORY_SHIFTS.map((s) => daysBack(s.day)));
    expect(deepest).toBe(HISTORY_DAYS + 1);
  });

  it('closes every generated shift — an open shift in the past is a bug', () => {
    for (const s of HISTORY_SHIFTS) expect(s.closed).toBe(true);
  });

  it('gives every generated receipt a supplier of its own point', () => {
    const roster = new Set(SEED_SUPPLIERS.map((s) => `${s.point}/${s.first_name} ${s.last_name}`));
    for (const i of HISTORY_INTAKES) expect(roster.has(`${i.point}/${i.supplier}`)).toBe(true);
  });

  it('never pays a supplier more than that supplier was received for', () => {
    const received = new Map<string, number>();
    for (const i of HISTORY_INTAKES) {
      const key = `${i.point}/${i.supplier}`;
      const kg = i.lines.reduce((n, l) => n + Number(l.gross_kg), 0);
      received.set(key, (received.get(key) ?? 0) + kg * 100);
    }
    const paid = new Map<string, number>();
    for (const p of HISTORY_PAYOUTS) {
      const key = `${p.point}/${p.supplier}`;
      paid.set(key, (paid.get(key) ?? 0) + Number(p.amount));
    }
    for (const [key, amount] of paid) expect(amount).toBeLessThan(received.get(key) ?? 0);
  });

  it('writes money as decimal strings', () => {
    for (const p of HISTORY_PAYOUTS) expect(p.amount).toMatch(money);
    for (const c of HISTORY_CASH_COUNTS) expect(c.drift).toMatch(/^-?\d+\.\d{2}$/);
  });

  it('is chronological, earliest first — each opening reads the previous count', () => {
    const order = HISTORY_CASH_COUNTS.map((c) => daysBack(c.day));
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  it('lands each point last generated closing on that point curated anchor', () => {
    for (const [point, anchor] of Object.entries(CURATED_ANCHOR)) {
      const closings = HISTORY_CASH_COUNTS.filter((c) => c.point === point && c.kind === 'closing');
      expect(closings.length).toBeGreaterThan(0);
      expect(closings[closings.length - 1].anchor).toBe(anchor);
    }
  });

  it('gives every generated receipt a unique code within its point and day', () => {
    const seen = new Set<string>();
    for (const i of HISTORY_INTAKES) {
      const key = `${i.point}/${daysBack(i.day)}/${i.typed}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w backend -- dev-seed.history.spec`
Expected: FAIL — cannot resolve `./dev-seed.history`.

- [ ] **Step 3: Write the generator**

Create `backend/src/seed/dev-seed.history.ts`:

```ts
import {
  SEED_GRADES,
  SEED_OPERATORS,
  SEED_POINTS,
  SEED_SUPPLIERS,
  type SeedCashCount,
  type SeedIntake,
  type SeedIntakeLine,
  type SeedPayout,
  type SeedShift,
} from './dev-seed.data';

/**
 * THE SEASON BEHIND THE CURATED DAY.
 *
 * `dev-seed.data.ts` is hand-written and stays that way: every row there is a
 * case some screen is read against, and `dev-seed.db-spec.ts` asserts exact
 * figures over it. This file is GENERATED data, and the split by file IS the
 * documentation — if a value is here, no test asserts it by hand.
 *
 * THREE PROPERTIES THIS FILE OWES THE REST OF THE SEED:
 *
 * 1. DETERMINISM. `mulberry32` below is seeded by a constant. Nothing reads the
 *    clock, the environment or `Math.random`. A seed whose output moved between
 *    runs could not be idempotent, because the receipt code — the natural key
 *    every insert is looked up by — is derived from the generated data.
 *
 * 2. INVISIBILITY TO THE CURATED CASH CHAIN. `dev-seed.db-spec.ts` asserts that
 *    Шипинки holds exactly 20 910.00, Конищів 12 800.00 and Гайове 500.00. Those
 *    figures flow from the anchors in `SEED_CASH_COUNTS`, and a naive backfill
 *    would move all three. It does not, because `anchor` OVERRIDES the computed
 *    expectation (`dev-seed.ts`: `c.anchor ?? ...`), and the last closing this
 *    file generates for each point carries that point's curated anchor as its
 *    own. The chain therefore arrives at the curated day holding exactly the
 *    figure the curated day expects — continuous for a reader, unchanged for
 *    the assertions.
 *
 * 3. NON-NEGATIVE BALANCES. `dev-seed.db-spec.ts` proves no seeded supplier
 *    balance is negative. Generated payouts are therefore a FRACTION of what the
 *    same supplier was received for, never a round number pulled from the air.
 */

/** Days of generated history, ending the day before `yesterday`. */
export const HISTORY_DAYS = 30;

/**
 * What `SEED_CASH_COUNTS` anchors each point on. Kept HERE rather than imported,
 * because this file must land on these figures and a silent drift between the
 * two would be invisible; `dev-seed.history.spec.ts` asserts the landing, and
 * `dev-seed.spec.ts` asserts these match the curated rows.
 */
export const CURATED_ANCHOR: Readonly<Record<string, string>> = {
  Шипинки: '5000.00',
  Конищів: '3000.00',
  Гайове: '2500.00',
};

/** The points that trade in the generated history: every active reception point. */
const WORKING = SEED_POINTS.filter((p) => p.is_active && p.kind === 'reception').map((p) => p.name);

/** A tiny deterministic PRNG. Not cryptography — reproducibility. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x59_41_47_4f); // "YAGO"

/** An integer in [lo, hi]. */
const between = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));

/** Kopiykas to a canonical decimal string. The only money formatter here. */
function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const operatorAt = new Map(SEED_OPERATORS.filter((o) => o.is_active !== false).map((o) => [o.point, o.login]));
const suppliersAt = new Map(
  WORKING.map((p) => [
    p,
    SEED_SUPPLIERS.filter((s) => s.point === p).map((s) => `${s.first_name} ${s.last_name}`),
  ]),
);
const activeGrades = SEED_GRADES.filter((g) => g.is_active);

const shifts: SeedShift[] = [];
const intakes: SeedIntake[] = [];
const payouts: SeedPayout[] = [];
const cashCounts: SeedCashCount[] = [];

// Received-per-supplier, in kopiykas of GROSS WEIGHT times a nominal rate, used
// only to keep a generated payout below what the supplier is owed. The real
// amount is the server's; this is a ceiling, not a claim.
const receivedCents = new Map<string, number>();

// Day 1 is `yesterday` and belongs to the curated dataset, so history runs from
// day 2 (the day before yesterday) back to day HISTORY_DAYS + 1. The loop counts
// DOWN so the arrays come out chronological — `SEED_CASH_COUNTS` order is
// load-bearing, and `dev-seed.ts` iterates these the same way.
for (let day = HISTORY_DAYS + 1; day >= 2; day -= 1) {
  for (const point of WORKING) {
    const operator = operatorAt.get(point);
    const roster = suppliersAt.get(point) ?? [];
    if (!operator || roster.length === 0) continue;

    const first = day === HISTORY_DAYS + 1;
    const last = day === 2;

    shifts.push({ point, day, openedBy: operator, closed: true });

    // The point's FIRST generated count anchors its whole chain.
    cashCounts.push({
      point,
      day,
      kind: 'opening',
      time: '07:30',
      countedBy: operator,
      ...(first ? { anchor: CURATED_ANCHOR[point] ?? '2000.00' } : {}),
      drift: '0.00',
    });

    const count = between(3, 8);
    for (let n = 0; n < count; n += 1) {
      const supplier = roster[between(0, roster.length - 1)];
      const grade = activeGrades[between(0, activeGrades.length - 1)];
      const grossCents = between(1500, 9000); // 15.00 to 90.00 kg
      const lines: SeedIntakeLine[] = [
        {
          product: grade.product,
          grade: grade.name,
          gross_kg: money(grossCents),
          pallet_kg: money(between(100, 400)),
          bonus: money(between(-10, 10) * 100),
          tare: [{ type: 'Ящик', units: between(1, 6) }],
        },
      ];
      intakes.push({
        point,
        day,
        // Unique within (point, day) by construction: the hour block is the
        // index, so no two generated receipts on a day share a code.
        typed: `H${String(day).padStart(2, '0')}${String(n).padStart(2, '0')}`,
        supplier,
        receivedBy: operator,
        time: `${String(8 + n).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}`,
        lines,
      });
      const key = `${point}/${supplier}`;
      const rate = Number(grade.base_price.split('.')[0]);
      receivedCents.set(key, (receivedCents.get(key) ?? 0) + Math.floor((grossCents * rate) / 100));
    }

    // One payout a day, to the supplier with the most owed, and only a slice of
    // it — the API refuses a payout above the debt, and the db-spec proves no
    // seeded balance goes negative.
    const owed = [...receivedCents.entries()]
      .filter(([key]) => key.startsWith(`${point}/`))
      .sort((a, b) => b[1] - a[1])[0];
    if (owed && owed[1] > 20000) {
      const supplier = owed[0].slice(point.length + 1);
      const amountCents = Math.floor(owed[1] / 4 / 100) * 100;
      payouts.push({
        point,
        day,
        typed: `H${String(day).padStart(2, '0')}P0`,
        supplier,
        paidBy: operator,
        time: '18:15',
        amount: money(amountCents),
      });
      receivedCents.set(owed[0], owed[1] - amountCents);
    }

    // The LAST generated closing lands on the curated anchor — see property 2
    // in this file's header. Every other closing simply agrees with the drawer.
    cashCounts.push({
      point,
      day,
      kind: 'closing',
      time: '19:05',
      countedBy: operator,
      ...(last && CURATED_ANCHOR[point] ? { anchor: CURATED_ANCHOR[point] } : {}),
      drift: '0.00',
    });
  }
}

export const HISTORY_SHIFTS: readonly SeedShift[] = shifts;
export const HISTORY_INTAKES: readonly SeedIntake[] = intakes;
export const HISTORY_PAYOUTS: readonly SeedPayout[] = payouts;
export const HISTORY_CASH_COUNTS: readonly SeedCashCount[] = cashCounts;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w backend -- dev-seed.history.spec`
Expected: PASS. If the "never pays more than received" test fails, lower the payout fraction — do NOT relax the assertion.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seed/dev-seed.history.ts backend/src/seed/dev-seed.history.spec.ts
git commit -m "feat(seed): deterministic 30-day history generator"
```

---

### Task 3: The runner seeds the history

**Files:**
- Modify: `backend/src/seed/dev-seed.ts` (`seedDocuments`)
- Modify: `backend/src/seed/dev-seed.db-spec.ts`

**Interfaces:**
- Consumes: `HISTORY_SHIFTS`, `HISTORY_INTAKES`, `HISTORY_PAYOUTS`, `HISTORY_CASH_COUNTS` from Task 2.
- Produces: no new exports; `DevSeedSummary` counts grow.

- [ ] **Step 1: Concatenate the arrays at every loop**

In `backend/src/seed/dev-seed.ts`, import the four history arrays, then replace each bare iteration with the concatenated one. The ORDER is load-bearing and differs per array:

```ts
// Shifts, intakes and payouts: history first, so the curated day is the newest
// thing in the journal — which is what every screen opens on.
const allShifts = [...HISTORY_SHIFTS, ...SEED_SHIFTS];
const allIntakes = [...HISTORY_INTAKES, ...SEED_INTAKES];
const allPayouts = [...HISTORY_PAYOUTS, ...SEED_PAYOUTS];
// Cash counts: history first AND chronological within each, because every
// opening count reads the point's PREVIOUS count as its expectation. Reversing
// these two would make the curated day anchor off a future count.
const allCashCounts = [...HISTORY_CASH_COUNTS, ...SEED_CASH_COUNTS];
```

Use `allShifts`, `allIntakes`, `allPayouts`, `allCashCounts` in place of the four `SEED_*` constants inside `seedDocuments` ONLY. Leave `SEED_TRANSFERS` and `SEED_TOP_UPS` loops untouched in this task.

- [ ] **Step 2: Run the unit suite**

Run: `npm test -w backend -- seed`
Expected: PASS.

- [ ] **Step 3: Fix the db-spec shift count**

`backend/src/seed/dev-seed.db-spec.ts` counts shifts against `SEED_SHIFTS` alone. Change those two assertions to account for the generated history:

```ts
    const openExpected = [...HISTORY_SHIFTS, ...SEED_SHIFTS].filter((s) => !s.closed).length;
    const closedExpected = [...HISTORY_SHIFTS, ...SEED_SHIFTS].filter((s) => s.closed).length;
    expect(shifts.open).toBe(openExpected);
    expect(shifts.closed).toBe(closedExpected);
```

Import `HISTORY_SHIFTS` at the top of the file.

- [ ] **Step 4: Run the db-spec against a FRESH database**

```bash
docker compose up -d postgres redis
dropdb --if-exists -h localhost -U postgres app_test 2>/dev/null || true
createdb -h localhost -U postgres app_test
npm run test:db -w backend -- dev-seed
```

Expected: PASS, and in particular the three cash assertions (`20910.00`, `12800.00`, `500.00`) still hold — that is the whole point of the anchor landing in Task 2. If any of them moved, the last generated closing is not carrying `CURATED_ANCHOR`; fix the generator, NOT the assertion.

- [ ] **Step 5: Run the whole db suite**

Run: `npm run test:db -w backend`
Expected: PASS. Note the runtime — if the seed spec now dominates it, say so in the PR body rather than trimming the history silently.

- [ ] **Step 6: Commit**

```bash
git add backend/src/seed/dev-seed.ts backend/src/seed/dev-seed.db-spec.ts
git commit -m "feat(seed): seed the generated season alongside the curated day"
```

---

### Task 4: Divergent prices and more top-ups

**Files:**
- Modify: `backend/src/seed/dev-seed.data.ts` (`SEED_PRICE_CHANGES`, `SEED_TOP_UPS`)

**Interfaces:**
- Consumes: `SeedPriceChange`, `SeedTopUp` (unchanged shapes).
- Produces: the data PR B and PR C are read against.

- [ ] **Step 1: Append per-point price divergence**

Issue #89's sheet renders «різні · 145–150» only when points DISAGREE. Today every working point is priced off one number plus the point's `price_offset`, so the column never takes that branch for the same grade at the same price. Append to `SEED_PRICE_CHANGES`:

```ts
  // #89's sheet reads «різні · 145–150» only when the reception points
  // disagree on ONE grade. These two changes are what put that branch on
  // screen: Шипинки is dearer for the better berry, Гайове cheaper.
  {
    point: 'Шипинки',
    product: 'Малина',
    grade: '1 сорт',
    base_price: '150.00',
    reason: 'Тут краща ягода',
  },
  {
    point: 'Гайове',
    product: 'Малина',
    grade: '1 сорт',
    base_price: '145.00',
    reason: 'Вирівняли з сусідами',
  },
```

Check the exact field names of `SeedPriceChange` at `dev-seed.data.ts:406` before writing, and match them.

- [ ] **Step 2: Append three more top-ups**

PR C's supplier card needs a timeline with more than one entry. Append to `SEED_TOP_UPS`, addressing receipts that EXIST — use generated codes from `HISTORY_INTAKES` (`H<day><index>`), which are stable across runs:

```ts
  {
    point: 'Шипинки',
    day: 4,
    typed: 'H0400',
    amount: '1200.00',
    reason: 'Перерахували за домовленістю після здачі',
  },
  {
    point: 'Конищів',
    day: 6,
    typed: 'H0601',
    amount: '480.00',
    reason: 'Ціну підняли заднім числом, ягода пішла на експорт',
  },
  {
    point: 'Гайове',
    day: 9,
    typed: 'H0900',
    amount: '2000.00',
    reason: 'Домовились про доплату за обсяг',
  },
```

Before committing, CONFIRM each `(point, day, typed)` exists in `HISTORY_INTAKES` — the generator picks its receipt count per day, so a given index may not exist. Print them:

```bash
npx tsx -e "import('./backend/src/seed/dev-seed.history.ts').then(m => console.log(m.HISTORY_INTAKES.filter(i => [4,6,9].includes(i.day)).map(i => i.point + '/' + i.day + '/' + i.typed)))"
```

Adjust the three literals to codes that actually appear.

- [ ] **Step 3: Run the unit suite**

Run: `npm test -w backend -- seed` then `npm run lint -w backend`
Expected: PASS, lint clean. `dev-seed.spec.ts` validates every price change against an active grade and an active point; a typo fails there.

- [ ] **Step 4: Run the db suite on a fresh database**

Run: `npm run test:db -w backend -- dev-seed`
Expected: PASS. The price-journal assertion (two rows per change: the change and the original) covers the new rows unchanged.

- [ ] **Step 5: Commit**

```bash
git add backend/src/seed/dev-seed.data.ts
git commit -m "feat(seed): divergent point prices and three more top-ups"
```

---

### Task 5: Documentation and the full gate

**Files:**
- Modify: `backend/CLAUDE.md` (the «Dev seed» section)

- [ ] **Step 1: Update the seed's description**

In `backend/CLAUDE.md`, the «Dev seed» section describes «a closed shift yesterday and open shifts today with ten receipts and four payouts». Replace that claim with the real shape, and name the split:

```markdown
The dataset is in TWO parts, and the split is load-bearing.
`src/seed/dev-seed.data.ts` is CURATED and hand-written: today and yesterday,
with every incident the screens are read against — above all Шипинки closing
90 ₴ short, the one seeded discrepancy. `src/seed/dev-seed.history.ts` is
GENERATED: 30 further business days at the working points, deterministic from a
constant seed, so the journal paginates and the sparklines have shape. No test
asserts a generated figure by hand.

The generated history is INVISIBLE to the curated cash chain. `anchor` overrides
a computed expectation, and the last closing count the generator writes for each
point carries that point's curated anchor — so the chain arrives at yesterday
holding exactly what yesterday expects. That is why `dev-seed.db-spec.ts` can
still assert Шипинки 20 910.00, Конищів 12 800.00 and Гайове 500.00 after a
season was inserted in front of them. If those figures ever move, the generator
stopped landing on the anchor; fix the generator, not the assertion.
```

- [ ] **Step 2: Run the complete gate**

```bash
npm test
npm run lint
npm run test:db -w backend
```

Expected: all green. Report the actual numbers — do not claim a pass without the output.

- [ ] **Step 3: Seed a real database and look at it**

```bash
docker compose up -d
npm run db:seed
npm run db:seed   # twice: idempotency is the seed's contract
```

Expected: the second run reports zero inserts. Then open the app and confirm the journal paginates and the supplier card has a timeline.

- [ ] **Step 4: Commit and open the PR**

```bash
git add backend/CLAUDE.md
git commit -m "docs(seed): describe the curated/generated split"
git push -u origin feat/season-seed
gh pr create --base main --title "feat(seed): a season of history behind the curated day" --body "..."
```
