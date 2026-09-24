# Cost of Day Screen (§8.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build «Собівартість дня» — the owner's §8.4 screen — and add the five `cost-of-day` response fields that make it renderable.

**Architecture:** Three backend tasks widen `CostOfDayResponse` in one service (`cost-of-day.service.ts`) — four per-product passthroughs `productCostRows` already computes, the «з них» per-kilogram pair, and a `basket_share` split by `allocate`. Eight frontend tasks then add two entity slices (`entities/cost-of-day` read-only, `entities/day-expense` read + three mutations), a four-file page slice, and the routing/nav/i18n wiring. No migration, no new table, no new dependency.

**Tech Stack:** NestJS 12 + TypeORM (backend, Jest `*.spec.ts` and `*.db-spec.ts`); React 19 + TanStack Query v5 + Vitest + Testing Library (frontend); `money.ts` / `shared/lib/money` for every decimal.

**Spec:** `docs/superpowers/specs/2026-09-22-yagoda-cost-of-day-screen.md`

## Global Constraints

- **No arithmetic outside `money.ts`.** `src/day-costs/**/*.ts` is already inside `backend/eslint.config.mjs`'s money `files` array: `*`, `/`, `*=`, `/=`, `Number()`, `toFixed`, `parseInt`, `parseFloat` are lint errors there. Use `add`/`sub`/`sum`/`div`/`allocate`/`isZero`. Frontend equivalents come from `@/shared/lib/money`.
- **`numeric` is a string end to end.** No field added by this plan is ever a `number`.
- **Scale 2 everywhere** (reweigh slice §3.14). No four-decimal rates.
- **«Це не нуль»** (§8.6). Every absent figure is `null` on the wire and «—» on screen, never `'0.00'`.
- **Owner-only.** Both controllers already carry `@Auth(UserRole.NetworkOwner)`; the route carries `RequireRole role="network_owner"`.
- **No §8.5 policy selector.** Only `by_weight` exists; do not add a control for ② or ③.
- **Point picker is NOT filtered by `kind`** (spec §3.6) — the base is a reception point too.
- **i18n:** every user-visible string is a `t('costOfDay.…')` key present in BOTH `uk.json` and `en.json`.

---

### Task 1: Per-product passthrough fields

**Files:**
- Modify: `backend/src/day-costs/cost-of-day.service.ts`
- Test: `backend/src/day-costs/cost-of-day.service.spec.ts`

**Interfaces:**
- Consumes: `ProductCostRow` from `./product-cost-rows` (already imported), which carries `accrued`, `intake_net_kg`, `reweigh_net_kg: string | null`, `shortfall`, `complete`.
- Produces: `CostOfDayProduct` gains `accrued: string`, `intake_net_kg: string`, `reweigh_net_kg: string | null`, `shortfall: string`. Tasks 4 and 7 mirror these on the wire.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/day-costs/cost-of-day.service.spec.ts` (the file's `owner`, `DAY`, `build`, `svc` and `svcWithNoReweigh` bindings are already defined at the top — reuse them, do not redeclare):

```ts
describe('CostOfDayProduct carries the figures it was built from (§8.4 left half)', () => {
  it('passes нараховано, both weights and the недостача through per product', async () => {
    const res = await svc.forShift(owner, 's-1');
    const rasp = res.products.find((p) => p.product_id === 'p-rasp');

    // 800 кг accruing 128 000,00 is 160,00 ₴/кг; 790 кг came back, so 10 кг
    // short × 160,00 = 1 600,00 — §8.4's own raspberry line.
    expect(rasp).toMatchObject({
      accrued: '128000.00',
      intake_net_kg: '800.00',
      reweigh_net_kg: '790.00',
      shortfall: '1600.00',
    });
  });

  it('reports reweigh_net_kg as null — never 0.00 — for a product nothing weighed', async () => {
    const res = await svcWithNoReweigh.forShift(owner, 's-1');

    // §8.6's «Це не нуль»: the screen must be able to print «—» rather than a
    // zero that reads as «the berries vanished».
    expect(res.products.map((p) => p.reweigh_net_kg)).toEqual([null, null]);
    expect(res.products.map((p) => p.shortfall)).toEqual(['0.00', '0.00']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w backend -- cost-of-day.service.spec.ts`
Expected: FAIL — `toMatchObject` reports `accrued`, `intake_net_kg`, `reweigh_net_kg` and `shortfall` as `undefined` on the product.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/day-costs/cost-of-day.service.ts`, add four fields to the `CostOfDayProduct` interface, directly above `price_was`:

```ts
  /** «нараховано» for this product — Σ intake_items.amount + its allocated
   *  top-ups, non-voided. The numerator behind `price_was`, carried so §8.4's
   *  left table can print the money column it divides. */
  accrued: string;
  /** Σ intake_items.net_kg — what the POINT says it took in. */
  intake_net_kg: string;
  /** Σ reweigh_items.net_kg — «наша вага». `null`, never '0.00', whenever
   *  `complete` is false: §8.6's «Це не нуль», so the screen prints «—». */
  reweigh_net_kg: string | null;
  /** «недостача» for this product, already clamped so a surplus on one grade
   *  never lowers it. '0.00' both when nothing is missing and when the product
   *  is not `complete` — `reweigh_net_kg === null` is what tells the two apart. */
  shortfall: string;
```

Then in `buildProducts`, add the four to the returned object (after `product_name`):

```ts
      return {
        product_id: r.product_id,
        product_name: r.product_name,
        accrued: r.accrued,
        intake_net_kg: r.intake_net_kg,
        reweigh_net_kg: r.reweigh_net_kg,
        shortfall: r.shortfall,
        price_was: priceWas,
        price_cost: priceCost,
        price_by_our_weight: priceByOurWeight,
        complete: r.complete,
      };
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w backend -- cost-of-day.service.spec.ts`
Expected: PASS, including every pre-existing case in the file.

- [ ] **Step 5: Commit**

```bash
git add backend/src/day-costs/cost-of-day.service.ts backend/src/day-costs/cost-of-day.service.spec.ts
git commit -m "feat(cost-of-day): stop dropping the per-product figures the response was built from

\`productCostRows\` computes нараховано, both weights and the clamped
недостача per product; \`buildProducts\` used all four to derive three prices
and then discarded them. §8.4's left table is exactly those four columns, so
the screen could not be drawn against the response at all.

No new arithmetic — four passthroughs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The «з них недостача / з них витрати» pair

**Files:**
- Modify: `backend/src/day-costs/cost-of-day.service.ts`
- Test: `backend/src/day-costs/cost-of-day.service.spec.ts`

**Interfaces:**
- Consumes: `div` and `isZero` from `../common/money` (`div` is already imported; add `isZero` — it is already imported too, check the import line before editing).
- Produces: `CostOfDayResponse` gains `shortfall_per_kg: string | null` and `expenses_per_kg: string | null`. Task 8 renders them.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/day-costs/cost-of-day.service.spec.ts`:

```ts
describe('на кілограм splits into its two halves (§8.4)', () => {
  it('prints з них недостача 1,94 and з них витрати 4,45 on §8.4 own numbers', async () => {
    const res = await svc.forShift(owner, 's-1');

    // КОШИК 5 460,00 over 854 кг. The three divisions are independent, which
    // is why they are asserted as three facts and not as an addition.
    expect(res.basket).toBe('5460.00');
    expect(res.reweighed_kg).toBe('854.00');
    expect(res.per_kg).toBe('6.39');
    expect(res.shortfall_per_kg).toBe('1.94');
    expect(res.expenses_per_kg).toBe('4.45');
  });

  it('dashes both halves on a day with nothing on the scale', async () => {
    const res = await svcWithNoReweigh.forShift(owner, 's-1');

    // Same guard as `per_kg`: `div` throws on a zero divisor by design, and
    // «нічого не важили» is a dash, never a zero.
    expect(res.per_kg).toBeNull();
    expect(res.shortfall_per_kg).toBeNull();
    expect(res.expenses_per_kg).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w backend -- cost-of-day.service.spec.ts`
Expected: FAIL — `res.shortfall_per_kg` is `undefined`, not `'1.94'`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/day-costs/cost-of-day.service.ts`, add to the `CostOfDayResponse` interface, immediately after `per_kg`:

```ts
  /** §8.4's «з них недостача 1,94» — `shortfall_amount ÷ reweighed_kg`.
   *  `null` under the same condition as `per_kg`. */
  shortfall_per_kg: string | null;
  /** §8.4's «з них витрати 4,45» — `expenses_amount ÷ reweighed_kg`.
   *
   *  THIS PAIR IS A BREAKDOWN, NOT AN ADDITION. Each rounds half-up on its
   *  own, so the two can sit a kopiyka away from `per_kg`; `per_kg` stays
   *  `basket ÷ reweighed_kg`, because that is the figure actually added to
   *  every product's price. §8.4's own numbers (1,94 + 4,45 = 6,39) land
   *  exactly — arithmetic luck, not a guarantee — and the screen prints the
   *  two under «з них» so nothing on it ever reads as a sum that fails. */
  expenses_per_kg: string | null;
```

In `forShift`, replace the single `perKg` line with the three:

```ts
    // §8.6 «Це не нуль» — a day with nothing weighed gets a dash, not '0.00'.
    const weighedNothing = isZero(reweighedKg);
    const perKg = weighedNothing ? null : div(basket, reweighedKg);
    const shortfallPerKg = weighedNothing ? null : div(shortfallAmount, reweighedKg);
    const expensesPerKg = weighedNothing ? null : div(expenses, reweighedKg);
```

and add both to the returned object, after `per_kg: perKg,`:

```ts
      shortfall_per_kg: shortfallPerKg,
      expenses_per_kg: expensesPerKg,
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w backend -- cost-of-day.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/day-costs/cost-of-day.service.ts backend/src/day-costs/cost-of-day.service.spec.ts
git commit -m "feat(cost-of-day): serve §8.4's «з них недостача / з них витрати» split

The response carried \`shortfall_amount\`, \`expenses_amount\` and \`per_kg\`
but not the two per-kilogram components the client's own screen prints, so a
frontend would have to divide money in React — the one thing money.ts exists
to prevent. Two \`div\` calls behind the guard \`per_kg\` already has.

The pair is a breakdown, not an addition: each rounds half-up independently,
so it can sit a kopiyka off \`per_kg\`, which stays basket ÷ reweighed_kg.

Closes the follow-up recorded at 2026-09-05-foundation-slice-follow-ups.md.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `basket_share` — the basket split, not multiplied

**Files:**
- Modify: `backend/src/day-costs/cost-of-day.service.ts`
- Test: `backend/src/day-costs/cost-of-day.service.spec.ts`
- Test: `backend/src/day-costs/cost-of-day.db-spec.ts`

**Interfaces:**
- Consumes: `allocate` from `../common/money` (NEW import on that line), `ProductCostRow.complete`.
- Produces: `CostOfDayProduct.basket_share: string | null`. Task 8 renders it as «із пулу» and checks `Σ basket_share === basket` on screen.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/day-costs/cost-of-day.service.spec.ts`. Note the new `PARTIAL` fixture and `svcPartial` binding — add them next to the other `build(...)` bindings near the top of the file, then add the `describe` at the bottom:

```ts
/**
 * §3.15 — Малина has TWO grades and only one is on the scale, so the whole
 * product is «не перезважено»: it contributes no kilograms to переважено and
 * therefore collects no share of the basket. Ожина is weighed in full.
 */
const PARTIAL: GradeTotalsRow[] = [
  {
    ...DAY[0],
    product_grade_id: 'g-rasp-1',
    product_grade_name: 'Малина 1',
    intake_net_kg: '400.00',
    intake_amount: '64000.00',
    reweigh_net_kg: '395.00',
  },
  {
    ...DAY[0],
    product_grade_id: 'g-rasp-2',
    product_grade_name: 'Малина 2',
    intake_net_kg: '400.00',
    intake_amount: '64000.00',
    reweigh_net_kg: null,
  },
  DAY[1],
];
const svcPartial = build(PARTIAL);
```

```ts
describe('basket_share is allocated, never multiplied out (§8.4)', () => {
  const shareOf = (products: { product_id: string; basket_share: string | null }[], id: string) =>
    products.find((p) => p.product_id === id)?.basket_share ?? null;

  it('splits the basket so the parts sum EXACTLY to it', async () => {
    const res = await svc.forShift(owner, 's-1');

    // КОШИК 5 460,00 over 790 кг + 64 кг. Largest remainder puts the leftover
    // kopiyka on raspberry.
    expect(shareOf(res.products, 'p-rasp')).toBe('5050.82');
    expect(shareOf(res.products, 'p-black')).toBe('409.18');
    expect(add('5050.82', '409.18')).toBe(res.basket);
  });

  it('does not lose the kopiykas a per-row multiplication would', async () => {
    const res = await svc.forShift(owner, 's-1');

    // per_kg × kg per row is 6,39 × 790 + 6,39 × 64 = 5 457,06 — 2,94 ₴ of a
    // 5 460,00 basket gone. This is the whole reason the field exists.
    expect(add(mul(res.per_kg as string, '790.00'), mul(res.per_kg as string, '64.00'))).toBe(
      '5457.06',
    );
    expect(res.basket).toBe('5460.00');
  });

  it('gives a partially weighed product no share at all — not a zero', async () => {
    const res = await svcPartial.forShift(owner, 's-1');

    // §3.15: Малина contributed no kilograms to переважено, so it collects
    // nothing from the denominator it was left out of. Ожина takes the lot.
    expect(shareOf(res.products, 'p-rasp')).toBeNull();
    expect(shareOf(res.products, 'p-black')).toBe(res.basket);
    expect(res.reweighed_kg).toBe('64.00');
  });

  it('dashes every share on a day with nothing on the scale', async () => {
    const res = await svcWithNoReweigh.forShift(owner, 's-1');
    expect(res.products.map((p) => p.basket_share)).toEqual([null, null]);
  });
});
```

The test file's money import at the top currently reads `import { add, sub, gte } from '../common/money';` — widen it to `import { add, sub, gte, mul } from '../common/money';`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w backend -- cost-of-day.service.spec.ts`
Expected: FAIL — `basket_share` is `undefined` on every product.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/day-costs/cost-of-day.service.ts`:

Widen the money import to include `allocate`:

```ts
import { add, allocate, div, isZero, sum } from '../common/money';
```

Add the field to `CostOfDayProduct`, after `shortfall`:

```ts
  /** «із пулу» — this product's share of the СПІЛЬНИЙ КОШИК.
   *
   *  ALLOCATED, NOT MULTIPLIED. `allocate` is a largest-remainder split, so
   *  Σ `basket_share` === `basket` exactly, which is what §8.4's «жодна
   *  гривня не загубилася» claims and what the screen checks in front of the
   *  owner. A per-row `mul(per_kg, reweigh_net_kg)` loses 2,94 ₴ of a
   *  5 460,00 basket on §8.4's own numbers.
   *
   *  `null` under the same two conditions as `price_cost`: nothing weighed at
   *  all, or this product is not `complete` (§3.15 — a product that
   *  contributed nothing to the denominator collects nothing from the
   *  numerator). */
  basket_share: string | null;
```

Pass the basket into `buildProducts` at the call site:

```ts
      products: this.buildProducts(rows, perKg, basket),
```

And rewrite `buildProducts`' signature and head:

```ts
  private buildProducts(
    rows: ProductCostRow[],
    perKg: string | null,
    basket: string,
  ): CostOfDayProduct[] {
    // §3.15 — the split runs over the COMPLETE products alone, whose
    // kilograms are exactly `reweighed_kg`. `perKg === null` means that sum
    // is zero, and `allocate` would otherwise split the basket evenly across
    // weightless rows rather than refusing.
    const weighed = rows.filter((r) => r.complete);
    const shares = perKg === null
      ? []
      : allocate(basket, weighed.map((r) => r.reweigh_net_kg as string));
    const shareOf = new Map(weighed.map((r, i) => [r.product_id, shares[i]]));

    return rows.map((r) => {
```

Then inside the `map`, add to the returned object after `shortfall: r.shortfall,`:

```ts
        basket_share: shareOf.get(r.product_id) ?? null,
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w backend -- cost-of-day.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add the same identity as a DB-backed test**

Append to `backend/src/day-costs/cost-of-day.db-spec.ts`, inside its existing top-level `describe`. Read the file first: it already seeds a shift with intakes and reweigh lines and holds the ids in `describe`-scoped bindings — reuse those exactly as the neighbouring cases do rather than seeding a second fixture.

```ts
  it('allocates the whole basket and nothing but the basket (§8.4)', async () => {
    const res = await service.forShift(owner, shiftId);

    const shares = res.products
      .map((p) => p.basket_share)
      .filter((s): s is string => s !== null);

    // The figures being split come out of SQL, so the identity is asserted
    // against a real Postgres and not only against a mocked query.
    expect(shares.length).toBeGreaterThan(0);
    expect(sum(shares)).toBe(res.basket);
    // And nothing incomplete collected a share.
    for (const product of res.products) {
      if (!product.complete) expect(product.basket_share).toBeNull();
    }
  });
```

Ensure `sum` is imported from `../common/money` at the top of the db-spec; add it to the existing import if it is not already there.

- [ ] **Step 6: Run the DB suite**

Run: `npm run test:db -w backend -- cost-of-day.db-spec.ts`
Expected: PASS. Requires a reachable Postgres (`docker compose up -d postgres`). If it cannot connect, say so out loud rather than reporting the task green.

- [ ] **Step 7: Commit**

```bash
git add backend/src/day-costs/cost-of-day.service.ts backend/src/day-costs/cost-of-day.service.spec.ts backend/src/day-costs/cost-of-day.db-spec.ts
git commit -m "feat(cost-of-day): allocate the basket per product instead of multiplying it out

§8.4's screen prints an «із пулу» column and checks «Σ із пулу = КОШИК» in
front of the owner. Derived as per_kg × reweigh_net_kg per row that check
fails by 2,94 ₴ on §8.4's own numbers — money.ts's \`allocate\` is a
largest-remainder split, so the parts sum exactly to the total, which is what
\`allocate\` was added to this file for in the first place.

A product that is not \`complete\` gets \`null\`, not a zero: §3.15 keeps its
kilograms out of the denominator, so it collects nothing from the numerator.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `entities/cost-of-day`

**Files:**
- Create: `frontend/src/entities/cost-of-day/model/cost-of-day.ts`
- Create: `frontend/src/entities/cost-of-day/api/useCostOfDay.ts`
- Create: `frontend/src/entities/cost-of-day/api/useCostOfDay.test.tsx`
- Create: `frontend/src/entities/cost-of-day/index.ts`
- Modify: `frontend/src/shared/api/queryKeys.ts`

**Interfaces:**
- Consumes: the wire shape Tasks 1–3 produced.
- Produces: `useCostOfDayQuery(shiftId: string | undefined)`, types `CostOfDay` and `CostOfDayProduct`, and `queryKeys.costOfDay`. Tasks 7–10 import all of them from `@/entities/cost-of-day`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/entities/cost-of-day/api/useCostOfDay.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useCostOfDayQuery } from './useCostOfDay';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const day = {
  shift_id: 's1',
  closed_at: null,
  provisional: true,
  accrued: '131900.00',
  reweighed_kg: '854.00',
  shortfall_amount: '1660.00',
  expenses_amount: '3800.00',
  basket: '5460.00',
  per_kg: '6.39',
  shortfall_per_kg: '1.94',
  expenses_per_kg: '4.45',
  total_check: '135700.00',
  top_ups_included: true,
  top_ups_latest_at: null,
  products: [],
};

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useCostOfDayQuery', () => {
  it('reads one shift собівартість', async () => {
    mock.onGet('/shifts/s1/cost-of-day').reply(200, day);

    const { result } = renderHook(() => useCostOfDayQuery('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(day);
  });

  it('does not fire without a shift — «no shift» is a state, not a request', () => {
    const { result } = renderHook(() => useCostOfDayQuery(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- useCostOfDay`
Expected: FAIL — cannot resolve `./useCostOfDay`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/entities/cost-of-day/model/cost-of-day.ts`:

```ts
/**
 * One product on §8.4's screen. EVERY figure here is the server's — this
 * screen never re-derives one, same contract as `entities/point-cash`.
 *
 * The three `null`s are three different silences and none of them is a zero
 * (§8.6 «Це не нуль»): `reweigh_net_kg` is «не перезважено», `price_cost` and
 * `basket_share` are «this product was left out of the day's denominator, so
 * it collects nothing from it» (§3.15).
 */
export interface CostOfDayProduct {
  product_id: string;
  product_name: string;
  /** «нараховано» — the accrued purchase, top-ups included. NOT cash paid out. */
  accrued: string;
  /** What the POINT weighed in. */
  intake_net_kg: string;
  /** «наша вага» — what the base's scale said. `null` when `complete` is false. */
  reweigh_net_kg: string | null;
  /** «недостача», clamped: never negative, §8.2's надлишок is impossible. */
  shortfall: string;
  /** «із пулу» — this product's allocated share of the basket. `null` when it
   *  contributed no kilograms to the day. */
  basket_share: string | null;
  /** «було» — нараховано ÷ вага пункту. */
  price_was: string;
  /** «собівартість» — було + на кілограм. `null` when there is no на кілограм. */
  price_cost: string | null;
  /** «нараховане ÷ наша вага» — the third of §8.4's three prices. */
  price_by_our_weight: string | null;
  /** §3.15 — every grade this product had this shift is on the scale. */
  complete: boolean;
}

/** §8.4 for one shift. `GET /shifts/:shiftId/cost-of-day`, owner-only. */
export interface CostOfDay {
  shift_id: string;
  closed_at: string | null;
  /** The shift is still open, so every figure below is still moving (§3.9). */
  provisional: boolean;
  accrued: string;
  reweighed_kg: string;
  shortfall_amount: string;
  expenses_amount: string;
  /** СПІЛЬНИЙ КОШИК — недостача + витрати. */
  basket: string;
  /** «на кілограм» — `null` when nothing was weighed, and then so are the two
   *  halves below and every product's `basket_share`. */
  per_kg: string | null;
  shortfall_per_kg: string | null;
  expenses_per_kg: string | null;
  /** §8.4's own звірка: нараховано + витрати. */
  total_check: string;
  top_ups_included: true;
  /** §3.12's marker — a late доплата moved an already-closed day. */
  top_ups_latest_at: string | null;
  products: CostOfDayProduct[];
}
```

Create `frontend/src/entities/cost-of-day/api/useCostOfDay.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { CostOfDay } from '../model/cost-of-day';

/**
 * §8.4's собівартість for ONE shift — computed live, with no posting moment
 * and no snapshot (reweigh slice §3.3), so a read is always the current
 * answer and a write anywhere in the day invalidates it.
 *
 * `enabled` on the shift id: «зміну не відкривали» is a state the page
 * renders, never a request it sends.
 */
export function useCostOfDayQuery(shiftId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.costOfDay, shiftId] as const,
    enabled: shiftId !== undefined,
    queryFn: async (): Promise<CostOfDay> => {
      const { data } = await httpClient.get<CostOfDay>(`/shifts/${shiftId}/cost-of-day`);
      return data;
    },
    staleTime: STALE.detail,
  });
}
```

Create `frontend/src/entities/cost-of-day/index.ts`:

```ts
export { useCostOfDayQuery } from './api/useCostOfDay';
export type { CostOfDay, CostOfDayProduct } from './model/cost-of-day';
```

In `frontend/src/shared/api/queryKeys.ts`, add both keys this plan needs (the second is used by Task 5) after `cashCounts`:

```ts
  /** §8.4's собівартість — prefix; a read appends the shift. Invalidated by
   *  every expense write, since a витрата moves the basket and на кілограм. */
  costOfDay: ['cost-of-day'] as const,
  /** §8.3's витрати дня — prefix; a read appends the shift. */
  dayExpenses: ['day-expenses'] as const,
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w frontend -- useCostOfDay`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/cost-of-day frontend/src/shared/api/queryKeys.ts
git commit -m "feat(cost-of-day): add the entities/cost-of-day read

A server-computed report never re-summed client-side, same contract as
entities/point-cash. Every null in the type is a distinct silence rather than
a zero, and the doc comments say which is which — §8.6's «Це не нуль» is the
rule the whole screen is built on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `entities/day-expense`

**Files:**
- Create: `frontend/src/entities/day-expense/model/day-expense.ts`
- Create: `frontend/src/entities/day-expense/api/useDayExpenses.ts`
- Create: `frontend/src/entities/day-expense/api/useDayExpenseMutations.ts`
- Create: `frontend/src/entities/day-expense/api/useDayExpenses.test.tsx`
- Create: `frontend/src/entities/day-expense/api/useDayExpenseMutations.test.tsx`
- Create: `frontend/src/entities/day-expense/index.ts`

**Interfaces:**
- Consumes: `queryKeys.dayExpenses` and `queryKeys.costOfDay` (added in Task 4).
- Produces: `useDayExpensesQuery(shiftId: string | undefined)`, `useCreateDayExpenseMutation()` taking `{ shiftId, label, amount }`, `useUpdateDayExpenseMutation()` taking `{ id, label?, amount? }`, `useDeleteDayExpenseMutation()` taking `{ id }`, and the `DayExpense` type. Task 8 uses all five.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/entities/day-expense/api/useDayExpenses.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { useDayExpensesQuery } from './useDayExpenses';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

const rows = [
  {
    id: 'e1',
    shift_id: 's1',
    label: 'пальне',
    amount: '1000.00',
    created_by_user_id: 'u1',
    created_at: '2026-09-22T08:00:00.000Z',
    updated_at: '2026-09-22T08:00:00.000Z',
  },
];

beforeEach(() => {
  mock = new MockAdapter(httpClient);
});
afterEach(() => mock.restore());

describe('useDayExpensesQuery', () => {
  it("reads a shift's expense lines", async () => {
    mock.onGet('/shifts/s1/expenses').reply(200, rows);

    const { result } = renderHook(() => useDayExpensesQuery('s1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(rows);
  });

  it('does not fire without a shift', () => {
    const { result } = renderHook(() => useDayExpensesQuery(undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mock.history.get).toHaveLength(0);
  });
});
```

Create `frontend/src/entities/day-expense/api/useDayExpenseMutations.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import {
  useCreateDayExpenseMutation,
  useUpdateDayExpenseMutation,
  useDeleteDayExpenseMutation,
} from './useDayExpenseMutations';

attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

let mock: MockAdapter;
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const row = {
  id: 'e1',
  shift_id: 's1',
  label: 'пальне',
  amount: '1000.00',
  created_by_user_id: 'u1',
  created_at: '2026-09-22T08:00:00.000Z',
  updated_at: '2026-09-22T08:00:00.000Z',
};

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => mock.restore());

describe('day expense mutations', () => {
  it('posts a new line against the shift', async () => {
    mock.onPost('/shifts/s1/expenses').reply(201, row);

    const { result } = renderHook(() => useCreateDayExpenseMutation(), { wrapper });
    result.current.mutate({ shiftId: 's1', label: 'пальне', amount: '1000.00' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      label: 'пальне',
      amount: '1000.00',
    });
  });

  it('patches a line by id, and by id alone', async () => {
    mock.onPatch('/expenses/e1').reply(200, { ...row, amount: '1300.00' });

    const { result } = renderHook(() => useUpdateDayExpenseMutation(), { wrapper });
    result.current.mutate({ id: 'e1', amount: '1300.00' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(JSON.parse(mock.history.patch[0].data as string)).toEqual({ amount: '1300.00' });
  });

  it('deletes a line by id', async () => {
    mock.onDelete('/expenses/e1').reply(204);

    const { result } = renderHook(() => useDeleteDayExpenseMutation(), { wrapper });
    result.current.mutate({ id: 'e1' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mock.history.delete[0].url).toBe('/expenses/e1');
  });

  it.each([
    ['create', () => useCreateDayExpenseMutation(), () => mock.onPost('/shifts/s1/expenses').reply(201, row), { shiftId: 's1', label: 'пальне', amount: '1000.00' }],
    ['update', () => useUpdateDayExpenseMutation(), () => mock.onPatch('/expenses/e1').reply(200, row), { id: 'e1', amount: '1300.00' }],
    ['delete', () => useDeleteDayExpenseMutation(), () => mock.onDelete('/expenses/e1').reply(204), { id: 'e1' }],
  ])(
    'invalidates BOTH the expenses and the собівартість after %s',
    async (_name, hook, arrange, input) => {
      arrange();
      const spy = vi.spyOn(client, 'invalidateQueries');

      // A витрата moves expenses_amount, basket, per_kg, expenses_per_kg and
      // every basket_share — refreshing only the list would leave the
      // собівартість on screen contradicting the line just typed under it.
      const { result } = renderHook(hook, { wrapper });
      (result.current.mutate as (v: unknown) => void)(input);

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
      expect(keys).toContainEqual(queryKeys.dayExpenses);
      expect(keys).toContainEqual(queryKeys.costOfDay);
    },
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w frontend -- day-expense`
Expected: FAIL — cannot resolve `./useDayExpenses` / `./useDayExpenseMutations`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/entities/day-expense/model/day-expense.ts`:

```ts
/**
 * §8.3's «витрати дня» — one free-text line the owner records against a
 * point's working day: «касир 1 000,00 / вантажник 1 300,00 / пальне
 * 1 000,00». There is no closed list of categories, by rule.
 *
 * THE ONE MUTABLE MONEY ROW IN THIS SCHEMA. Every other document is frozen
 * (§2.7) and corrected by a void plus a new one; nothing is printed for a
 * scratchpad line, so this one is patched and deleted in place. The
 * compensating control is an audit entry on every write that changes
 * something, written in the same transaction, server-side.
 */
export interface DayExpense {
  id: string;
  shift_id: string;
  label: string;
  amount: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}
```

Create `frontend/src/entities/day-expense/api/useDayExpenses.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { DayExpense } from '../model/day-expense';

/**
 * §8.3 — one shift's expense lines, oldest first (the server orders by
 * `created_at`, so the list reads in the order the owner typed it).
 *
 * Unpaginated on purpose: this is a handful of lines about one day, and the
 * screen totals them from the собівартість response rather than from here.
 */
export function useDayExpensesQuery(shiftId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.dayExpenses, shiftId] as const,
    enabled: shiftId !== undefined,
    queryFn: async (): Promise<DayExpense[]> => {
      const { data } = await httpClient.get<DayExpense[]>(`/shifts/${shiftId}/expenses`);
      return data;
    },
    staleTime: STALE.detail,
  });
}
```

Create `frontend/src/entities/day-expense/api/useDayExpenseMutations.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { DayExpense } from '../model/day-expense';

export interface CreateDayExpenseInput {
  shiftId: string;
  label: string;
  amount: string;
}

export interface UpdateDayExpenseInput {
  id: string;
  label?: string;
  amount?: string;
}

/**
 * EVERY WRITE HERE INVALIDATES TWO KEYS, and that is the point of this file
 * rather than three loose `useMutation`s in the page. A витрата moves
 * `expenses_amount`, `basket`, `per_kg`, `expenses_per_kg` and every
 * product's `basket_share`; refreshing only the list would leave §8.4's
 * arithmetic on screen contradicting the line just typed beneath it.
 */
function useExpenseInvalidation() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: queryKeys.dayExpenses });
    await qc.invalidateQueries({ queryKey: queryKeys.costOfDay });
  };
}

export function useCreateDayExpenseMutation() {
  const invalidate = useExpenseInvalidation();
  return useMutation({
    mutationFn: async ({ shiftId, ...body }: CreateDayExpenseInput): Promise<DayExpense> => {
      const { data } = await httpClient.post<DayExpense>(`/shifts/${shiftId}/expenses`, body);
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Addressed by LINE id and nothing else — the row already knows its shift,
 * and the server refuses a patch that names one. Only the fields actually
 * being changed are sent: the backend records an audit entry only when a
 * value really moved, and a no-op field would make the trail say otherwise.
 */
export function useUpdateDayExpenseMutation() {
  const invalidate = useExpenseInvalidation();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateDayExpenseInput): Promise<DayExpense> => {
      const { data } = await httpClient.patch<DayExpense>(`/expenses/${id}`, body);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteDayExpenseMutation() {
  const invalidate = useExpenseInvalidation();
  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<void> => {
      await httpClient.delete(`/expenses/${id}`);
    },
    onSuccess: invalidate,
  });
}
```

Create `frontend/src/entities/day-expense/index.ts`:

```ts
export { useDayExpensesQuery } from './api/useDayExpenses';
export {
  useCreateDayExpenseMutation,
  useUpdateDayExpenseMutation,
  useDeleteDayExpenseMutation,
} from './api/useDayExpenseMutations';
export type { CreateDayExpenseInput, UpdateDayExpenseInput } from './api/useDayExpenseMutations';
export type { DayExpense } from './model/day-expense';
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w frontend -- day-expense`
Expected: PASS (2 + 6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/day-expense
git commit -m "feat(cost-of-day): add entities/day-expense — the read and all three writes

§8.3's витрати дня. The mutations live beside the query, as in
entities/reweigh, for one reason worth a file of its own: every write
invalidates BOTH the expenses list and the собівартість, because a витрата
moves the basket, на кілограм and every product's share of it.

PATCH is here because day_expenses is the schema's one mutable money table —
nothing is printed for a scratchpad line, and the audit entry the server
writes in the same transaction is the compensating control.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: i18n strings

**Files:**
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`

**Interfaces:**
- Produces: the whole `costOfDay.*` namespace. Tasks 7–10 render `t('costOfDay.…')` and every key they use is defined here.

- [ ] **Step 1: Add the `costOfDay` block to `uk.json`**

Insert as a new top-level key, after the existing `"reweigh"` block:

```json
  "costOfDay": {
    "eyebrow": "Керівництву",
    "title": "Собівартість дня",
    "description": "Недостача й витрати дня, розкидані на кожен кілограм ягоди. Ліва половина тільки читає, права — єдине місце вводу.",
    "point": "Пункт",
    "print": "Друк",
    "provisional": "Зміна ще відкрита — цифри рухаються",
    "topUps": "Включно з доплатами, останню внесено {{at}}",
    "noShift": "Зміну {{date}} на пункті «{{point}}» не відкривали.",
    "noIntake": "Цього дня на цьому пункті прийомки не було.",
    "sheetTitle": "Собівартість за {{date}} · {{point}}",
    "berry": {
      "title": "Ягода",
      "product": "товар",
      "weight": "вага",
      "perKg": "₴/кг",
      "accrued": "нараховано",
      "ourWeight": "наша вага",
      "shortfall": "недостача",
      "total": "РАЗОМ по пункту",
      "totalOurWeight": "наша вага, разом",
      "notReweighed": "не перезважено",
      "note": "«Нараховано» — це нарахована сума закупки, а не готівка з каси: борги існують, тому готівка, що вийшла з каси за цей день, — інше число, і воно на собівартість не впливає."
    },
    "expenses": {
      "title": "Витрати за день",
      "empty": "Витрат за цей день ще не заводили.",
      "labelField": "Підпис витрати",
      "amountField": "₴",
      "add": "ще рядок",
      "edit": "Змінити «{{label}}»",
      "save": "Зберегти",
      "cancel": "Скасувати",
      "remove": "Прибрати «{{label}}»",
      "shortfallRow": "Недостача в ягоді",
      "expensesRow": "Витрати дня",
      "basket": "Спільний кошик",
      "perKg": "на кілограм",
      "split": "з них недостача {{shortfall}} · з них витрати {{expenses}}",
      "awaiting": "Очікує переважування",
      "awaitingAmount": "{{amount}} не розподілено",
      "awaitingNote": "Поки партію не зважили на базі, недостачі ще немає — витрати дня нікуди не лягли.",
      "addFailed": "Рядок не додано",
      "updateFailed": "Рядок не змінено",
      "removeFailed": "Рядок не прибрано"
    },
    "final": {
      "title": "Середня ціна після витрат",
      "basis": "розподіл: по вазі",
      "rate": "≈ {{rate}} ₴/кг на всіх",
      "product": "Товар",
      "ourWeight": "наша вага",
      "fromBasket": "із пулу",
      "together": "разом",
      "cost": "собівартість",
      "was": "було",
      "byOurWeight": "нараховане ÷ наша вага",
      "total": "РАЗОМ",
      "summary": "Витрати дня разом із недостачею — {{basket}} на {{kg}} — це {{rate}} ₴ на кожен кілограм будь-якої ягоди.",
      "checkShare": "Σ із пулу {{shares}} = кошик {{basket}}",
      "checkTotal": "{{total}} = нараховано {{accrued}} + витрати {{expenses}}"
    }
  }
```

- [ ] **Step 2: Add the mirrored `costOfDay` block to `en.json`**

```json
  "costOfDay": {
    "eyebrow": "Management",
    "title": "Cost of day",
    "description": "The day's shortfall and expenses, spread over every kilogram of berries. The left half only reads; the right is the only place anything is entered.",
    "point": "Point",
    "print": "Print",
    "provisional": "The shift is still open — these figures are still moving",
    "topUps": "Includes price top-ups, the latest entered {{at}}",
    "noShift": "No shift was opened at «{{point}}» on {{date}}.",
    "noIntake": "Nothing was taken in at this point on this day.",
    "sheetTitle": "Cost of day for {{date}} · {{point}}",
    "berry": {
      "title": "Berries",
      "product": "product",
      "weight": "weight",
      "perKg": "₴/kg",
      "accrued": "accrued",
      "ourWeight": "our weight",
      "shortfall": "shortfall",
      "total": "TOTAL at the point",
      "totalOurWeight": "our weight, total",
      "notReweighed": "not re-weighed",
      "note": "«Accrued» is the purchase accrued, not cash out of the drawer: debts exist, so the cash that left the drawer that day is a different number and does not affect the cost of day."
    },
    "expenses": {
      "title": "Expenses for the day",
      "empty": "No expenses have been entered for this day yet.",
      "labelField": "Expense label",
      "amountField": "₴",
      "add": "another line",
      "edit": "Edit «{{label}}»",
      "save": "Save",
      "cancel": "Cancel",
      "remove": "Remove «{{label}}»",
      "shortfallRow": "Shortfall in berries",
      "expensesRow": "Day expenses",
      "basket": "Shared basket",
      "perKg": "per kilogram",
      "split": "of which shortfall {{shortfall}} · of which expenses {{expenses}}",
      "awaiting": "Awaiting re-weighing",
      "awaitingAmount": "{{amount}} not spread",
      "awaitingNote": "Until the load is weighed at the base there is no shortfall yet — the day's expenses have landed nowhere.",
      "addFailed": "Line not added",
      "updateFailed": "Line not changed",
      "removeFailed": "Line not removed"
    },
    "final": {
      "title": "Average price after expenses",
      "basis": "spread: by weight",
      "rate": "≈ {{rate}} ₴/kg on everything",
      "product": "Product",
      "ourWeight": "our weight",
      "fromBasket": "from basket",
      "together": "together",
      "cost": "cost",
      "was": "was",
      "byOurWeight": "accrued ÷ our weight",
      "total": "TOTAL",
      "summary": "The day's expenses together with the shortfall — {{basket}} over {{kg}} — come to {{rate}} ₴ on every kilogram of any berry.",
      "checkShare": "Σ from basket {{shares}} = basket {{basket}}",
      "checkTotal": "{{total}} = accrued {{accrued}} + expenses {{expenses}}"
    }
  }
```

- [ ] **Step 3: Verify both files still parse and carry the same key tree**

Run:
```bash
node -e "
const uk = require('./frontend/src/shared/lib/i18n/locales/uk.json');
const en = require('./frontend/src/shared/lib/i18n/locales/en.json');
const flat = (o, p = []) => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flat(v, [...p, k]) : [[...p, k].join('.')]);
const a = new Set(flat(uk.costOfDay)), b = new Set(flat(en.costOfDay));
const only = (x, y) => [...x].filter((k) => !y.has(k));
console.log('uk only:', only(a, b), 'en only:', only(b, a), 'count:', a.size);
"
```
Expected: `uk only: [] en only: [] count: 55`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/shared/lib/i18n/locales/uk.json frontend/src/shared/lib/i18n/locales/en.json
git commit -m "i18n(cost-of-day): add the costOfDay namespace in both locales

Added ahead of the components so no task renders a raw key, and so the two
locales are written as one tree rather than one being backfilled later.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `BerryTable` — §8.4's left half

**Files:**
- Create: `frontend/src/pages/cost-of-day/ui/BerryTable.tsx`
- Test: `frontend/src/pages/cost-of-day/ui/BerryTable.test.tsx`

**Interfaces:**
- Consumes: `CostOfDayProduct` from `@/entities/cost-of-day`; `formatKg`, `formatUah`, `formatDecimal` from `@/shared/lib/money`; the `Table*` set from `@/shared/ui/table`; `Badge`, `Eyebrow`.
- Produces: `BerryTable({ products, reweighedKg, accrued, locale }: { products: CostOfDayProduct[]; reweighedKg: string; accrued: string; locale: string })`. Task 10 renders it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/cost-of-day/ui/BerryTable.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CostOfDayProduct } from '@/entities/cost-of-day';
import { BerryTable } from './BerryTable';

const weighed: CostOfDayProduct = {
  product_id: 'p-rasp',
  product_name: 'Малина',
  accrued: '128000.00',
  intake_net_kg: '800.00',
  reweigh_net_kg: '790.00',
  shortfall: '1600.00',
  basket_share: '5050.82',
  price_was: '160.00',
  price_cost: '166.39',
  price_by_our_weight: '162.03',
  complete: true,
};

const unweighed: CostOfDayProduct = {
  ...weighed,
  product_id: 'p-black',
  product_name: 'Ожина',
  reweigh_net_kg: null,
  shortfall: '0.00',
  basket_share: null,
  price_cost: null,
  price_by_our_weight: null,
  complete: false,
};

const renderTable = (products: CostOfDayProduct[]) =>
  render(
    <BerryTable products={products} reweighedKg="790.00" accrued="128000.00" locale="uk" />,
  );

describe('BerryTable', () => {
  it("prints the point's weight, its rate and what it accrued", () => {
    renderTable([weighed]);

    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('800,00 кг')).toBeInTheDocument();
    expect(within(row).getByText('160,00')).toBeInTheDocument();
    expect(within(row).getByText('128 000,00 ₴')).toBeInTheDocument();
  });

  it('shows the недостача as its own line when there is one', () => {
    renderTable([weighed]);
    expect(screen.getByText('недостача')).toBeInTheDocument();
    expect(screen.getByText('1 600,00 ₴')).toBeInTheDocument();
  });

  it('prints «наша вага» as a dash, never a zero, when nothing was weighed', () => {
    renderTable([unweighed]);

    // §8.6's «Це не нуль»: «0,00 кг наша вага» beside 128 000,00 accrued reads
    // as berries that vanished, rather than berries nobody has weighed yet.
    // Scoped by the BADGE, not by «наша вага»: the totals below carry a
    // «наша вага, разом» row that the looser name would match as well.
    const ourWeight = screen.getByRole('row', { name: /не перезважено/ });
    expect(within(ourWeight).getAllByText('—')).toHaveLength(2);
    expect(within(ourWeight).queryByText('0,00 кг')).not.toBeInTheDocument();
  });

  it('omits the недостача line entirely when nothing is missing', () => {
    renderTable([{ ...weighed, shortfall: '0.00' }]);
    expect(screen.queryByText('недостача')).not.toBeInTheDocument();
  });

  it("totals the point's weight and ours as two separate rows", () => {
    renderTable([weighed]);

    const pointTotal = screen.getByRole('row', { name: /РАЗОМ по пункту/ });
    expect(within(pointTotal).getByText('800,00 кг')).toBeInTheDocument();
    expect(within(pointTotal).getByText('128 000,00 ₴')).toBeInTheDocument();

    // 790 кг is the BASE's number and belongs on its own line. Printed under
    // «РАЗОМ по пункту» it would claim the point weighed in what the base
    // weighed out — the exact disagreement this screen exists to show.
    const ourTotal = screen.getByRole('row', { name: /наша вага, разом/ });
    expect(within(ourTotal).getByText('790,00 кг')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- BerryTable`
Expected: FAIL — cannot resolve `./BerryTable`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/cost-of-day/ui/BerryTable.tsx`:

```tsx
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { formatDecimal, formatKg, formatUah, isZero, sum } from '@/shared/lib/money';
import type { CostOfDayProduct } from '@/entities/cost-of-day';

/**
 * §8.4's LEFT HALF — «Ліва половина екрана (ЯГОДА) — тільки читання, жодного
 * поля вводу». There is no control in this component by rule, not by
 * omission.
 *
 * Every cell is the server's own figure. «наша вага» is `reweigh_net_kg`,
 * which is `null` — never '0.00' — for a product not weighed in full, and
 * that null is printed «—» because §8.6 says so in as many words: a zero
 * beside 128 000,00 нараховано reads as berries that disappeared rather than
 * berries nobody has put on the scale yet.
 *
 * The «недостача» line is omitted when there is none, rather than printed as
 * a zero: §8.2 settles that a надлишок is impossible, so this figure is
 * either a claim or nothing at all.
 */
export function BerryTable({
  products,
  reweighedKg,
  accrued,
  locale,
}: {
  products: CostOfDayProduct[];
  reweighedKg: string;
  accrued: string;
  locale: string;
}) {
  const { t } = useTranslation();

  // Σ of the server's own per-product figures — an addition of money already
  // computed, never a division. The response carries no day-level intake
  // weight: `reweighed_kg` is the BASE's total and answers a different
  // question, which is the whole point of the two total rows below.
  const intakeTotal = products.length > 0 ? sum(products.map((p) => p.intake_net_kg)) : '0.00';

  return (
    <div>
      <Eyebrow className="mb-2">{t('costOfDay.berry.title')}</Eyebrow>
      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('costOfDay.berry.product')}</TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.weight')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.perKg')}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {t('costOfDay.berry.accrued')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => (
              <Fragment key={p.product_id}>
                <TableRow>
                  <TableCell className="font-medium">{p.product_name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatKg(p.intake_net_kg, locale)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatDecimal(p.price_was, locale)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatUah(p.accrued, locale)}
                  </TableCell>
                </TableRow>

                {isZero(p.shortfall) ? null : (
                  <TableRow className="text-[var(--amber)]">
                    <TableCell className="pl-6">{t('costOfDay.berry.shortfall')}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatUah(p.shortfall, locale)}
                    </TableCell>
                  </TableRow>
                )}

                <TableRow className="bg-muted/40">
                  <TableCell className="pl-6 font-medium">
                    {t('costOfDay.berry.ourWeight')}
                    {p.complete ? null : (
                      <Badge variant="outline" className="ml-1.5 font-normal">
                        {t('costOfDay.berry.notReweighed')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {p.reweigh_net_kg === null ? '—' : formatKg(p.reweigh_net_kg, locale)}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono tabular-nums">
                    {p.price_by_our_weight === null
                      ? '—'
                      : formatDecimal(p.price_by_our_weight, locale)}
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}

            {/* TWO total rows, not one. «РАЗОМ по пункту» is what the POINT
                weighed in; «наша вага, разом» is what the base's scale said.
                Collapsing them prints the base's kilograms under the point's
                own heading. */}
            <TableRow className="border-t-2 border-border">
              <TableCell className="font-semibold">{t('costOfDay.berry.total')}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatKg(intakeTotal, locale)}
              </TableCell>
              <TableCell />
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatUah(accrued, locale)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">{t('costOfDay.berry.totalOurWeight')}</TableCell>
              <TableCell className="text-right font-mono font-medium tabular-nums">
                {formatKg(reweighedKg, locale)}
              </TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        {t('costOfDay.berry.note')}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w frontend -- BerryTable`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/cost-of-day/ui/BerryTable.tsx frontend/src/pages/cost-of-day/ui/BerryTable.test.tsx
git commit -m "feat(cost-of-day): the ЯГОДА table — §8.4's read-only left half

No control in the component, by rule rather than by omission: «Ліва половина
екрана (ЯГОДА) — тільки читання, жодного поля вводу».

«наша вага» prints «—» for a product not weighed in full. A zero there, next
to 128 000,00 нараховано, reads as berries that disappeared rather than
berries nobody has put on the scale (§8.6 «Це не нуль»).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `ExpensesPanel` — §8.3's input and the КОШИК block

**Files:**
- Create: `frontend/src/pages/cost-of-day/ui/ExpensesPanel.tsx`
- Test: `frontend/src/pages/cost-of-day/ui/ExpensesPanel.test.tsx`

**Interfaces:**
- Consumes: `CostOfDay` from `@/entities/cost-of-day`; `DayExpense` and the three mutation hooks from `@/entities/day-expense`; `maskDecimalInput`, `formatUah` from `@/shared/lib/money`; `toast` from `@/shared/ui/toast`; `apiErrorToBanner` from `@/shared/lib/api-error`.
- Produces: `ExpensesPanel({ day, expenses, shiftId, locale }: { day: CostOfDay; expenses: DayExpense[]; shiftId: string; locale: string })`. Task 10 renders it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/cost-of-day/ui/ExpensesPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CostOfDay } from '@/entities/cost-of-day';
import type { DayExpense } from '@/entities/day-expense';
import { ExpensesPanel } from './ExpensesPanel';

const { createMock, updateMock, removeMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock('@/entities/day-expense', () => ({
  useCreateDayExpenseMutation: () => ({ mutateAsync: createMock, isPending: false }),
  useUpdateDayExpenseMutation: () => ({ mutateAsync: updateMock, isPending: false }),
  useDeleteDayExpenseMutation: () => ({ mutateAsync: removeMock, isPending: false }),
}));

const day: CostOfDay = {
  shift_id: 's1',
  closed_at: '2026-09-22T18:00:00.000Z',
  provisional: false,
  accrued: '131900.00',
  reweighed_kg: '854.00',
  shortfall_amount: '1660.00',
  expenses_amount: '3800.00',
  basket: '5460.00',
  per_kg: '6.39',
  shortfall_per_kg: '1.94',
  expenses_per_kg: '4.45',
  total_check: '135700.00',
  top_ups_included: true,
  top_ups_latest_at: null,
  products: [],
};

const lines: DayExpense[] = [
  {
    id: 'e1',
    shift_id: 's1',
    label: 'пальне',
    amount: '1000.00',
    created_by_user_id: 'u1',
    created_at: '2026-09-22T08:00:00.000Z',
    updated_at: '2026-09-22T08:00:00.000Z',
  },
];

const renderPanel = (over: Partial<CostOfDay> = {}, rows = lines) =>
  render(
    <ExpensesPanel day={{ ...day, ...over }} expenses={rows} shiftId="s1" locale="uk" />,
  );

beforeEach(() => {
  createMock.mockReset().mockResolvedValue(undefined);
  updateMock.mockReset().mockResolvedValue(undefined);
  removeMock.mockReset().mockResolvedValue(undefined);
});

describe('ExpensesPanel', () => {
  it('prints the basket and §8.4 «з них» split', () => {
    renderPanel();

    expect(screen.getByText('5 460,00 ₴')).toBeInTheDocument();
    expect(screen.getByText(/з них недостача 1,94/)).toBeInTheDocument();
    expect(screen.getByText(/з них витрати 4,45/)).toBeInTheDocument();
  });

  it('adds a line and clears the form only after the write succeeds', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByPlaceholderText('Підпис витрати'), 'водій');
    await user.type(screen.getByPlaceholderText('₴'), '500');
    await user.click(screen.getByRole('button', { name: 'ще рядок' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({ shiftId: 's1', label: 'водій', amount: '500' }),
    );
    expect(screen.getByPlaceholderText('Підпис витрати')).toHaveValue('');
  });

  it('keeps what was typed when the write is refused', async () => {
    createMock.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByPlaceholderText('Підпис витрати'), 'водій');
    await user.type(screen.getByPlaceholderText('₴'), '500');
    await user.click(screen.getByRole('button', { name: 'ще рядок' }));

    // A line that vanishes without a word is worse than one that refuses out
    // loud: the собівартість would then be computed without it, silently.
    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(screen.getByPlaceholderText('Підпис витрати')).toHaveValue('водій');
  });

  it('patches only the field that actually moved', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Змінити «пальне»' }));
    const amount = screen.getByDisplayValue('1000.00');
    await user.clear(amount);
    await user.type(amount, '1300');
    await user.click(screen.getByRole('button', { name: 'Зберегти' }));

    // The server writes an audit entry only when a value really changed, so
    // sending an unchanged `label` would put a no-op in the one trail this
    // mutable table has.
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ id: 'e1', amount: '1300' }));
  });

  it('removes a line', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Прибрати «пальне»' }));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith({ id: 'e1' }));
  });

  it('names only the manual expenses when nothing has been weighed', () => {
    renderPanel({ per_kg: null, shortfall_per_kg: null, expenses_per_kg: null });

    // The engine would read the whole day's weight as a shortfall here; saying
    // «недостача 17 419,07 ₴» on a day nobody weighed anything would be an
    // invented number. Name the manual expenses and nothing else.
    expect(screen.getByText('Очікує переважування')).toBeInTheDocument();
    expect(screen.getByText('3 800,00 ₴ не розподілено')).toBeInTheDocument();
    expect(screen.queryByText(/Спільний кошик/i)).not.toBeInTheDocument();
  });

  it('says so when no expenses have been entered', () => {
    renderPanel({}, []);
    expect(screen.getByText('Витрат за цей день ще не заводили.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- ExpensesPanel`
Expected: FAIL — cannot resolve `./ExpensesPanel`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/cost-of-day/ui/ExpensesPanel.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { TextInput } from '@/shared/ui/text-input';
import { toast } from '@/shared/ui/toast';
import { formatUah, maskDecimalInput } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import {
  useCreateDayExpenseMutation,
  useDeleteDayExpenseMutation,
  useUpdateDayExpenseMutation,
  type DayExpense,
} from '@/entities/day-expense';
import type { CostOfDay } from '@/entities/cost-of-day';

/**
 * §8.3's «Витрати дня» and §8.4's КОШИК — «Права (ВИТРАТИ) — єдине місце
 * вводу». Everything writable on this screen is in this component.
 *
 * INLINE EDIT IS HERE ON PURPOSE, and the reference screen has only add and
 * delete. `day_expenses` is the schema's one mutable money table: §2.7 freezes
 * a document to protect a supplier's printed receipt, and nothing is printed
 * for «пальне 1 000,00». The patch sends ONLY the field that moved, because
 * the server writes an audit entry only when a value really changed and that
 * trail is the sole compensating control for the table being mutable at all.
 *
 * THE FORM IS NOT CLEARED ON A REFUSAL. A line that disappears without a word
 * leaves the собівартість computed without it, silently — the one outcome
 * this screen must never produce.
 *
 * WHEN `per_kg` IS NULL nothing but the manual expenses is named. The day's
 * weight would otherwise read as one enormous недостача, and «недостача
 * 17 419,07 ₴» on a day nobody weighed anything is an invented number, not a
 * cautious one.
 */
export function ExpensesPanel({
  day,
  expenses,
  shiftId,
  locale,
}: {
  day: CostOfDay;
  expenses: DayExpense[];
  shiftId: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const create = useCreateDayExpenseMutation();
  const update = useUpdateDayExpenseMutation();
  const remove = useDeleteDayExpenseMutation();

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftAmount, setDraftAmount] = useState('');

  const notSpread = day.per_kg === null;

  async function add() {
    const trimmed = label.trim();
    if (!trimmed || amount === '') return;
    try {
      await create.mutateAsync({ shiftId, label: trimmed, amount });
      setLabel('');
      setAmount('');
    } catch (error) {
      toast.error(t('costOfDay.expenses.addFailed'), {
        description: t(apiErrorToBanner(error, 'common.somethingWentWrong')),
      });
    }
  }

  function startEdit(line: DayExpense) {
    setEditing(line.id);
    setDraftLabel(line.label);
    setDraftAmount(line.amount);
  }

  async function saveEdit(line: DayExpense) {
    // ONLY what moved — see the component doc above.
    const patch: { id: string; label?: string; amount?: string } = { id: line.id };
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== line.label) patch.label = trimmed;
    if (draftAmount !== '' && draftAmount !== line.amount) patch.amount = draftAmount;

    if (patch.label === undefined && patch.amount === undefined) {
      setEditing(null);
      return;
    }
    try {
      await update.mutateAsync(patch);
      setEditing(null);
    } catch (error) {
      toast.error(t('costOfDay.expenses.updateFailed'), {
        description: t(apiErrorToBanner(error, 'common.somethingWentWrong')),
      });
    }
  }

  async function removeLine(line: DayExpense) {
    try {
      await remove.mutateAsync({ id: line.id });
    } catch (error) {
      toast.error(t('costOfDay.expenses.removeFailed'), {
        description: t(apiErrorToBanner(error, 'common.somethingWentWrong')),
      });
    }
  }

  return (
    <div className="flex h-fit flex-col gap-3 rounded-lg bg-muted/40 p-4 ring-1 ring-foreground/5">
      <Eyebrow>{t('costOfDay.expenses.title')}</Eyebrow>

      {expenses.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('costOfDay.expenses.empty')}</p>
      ) : (
        expenses.map((line) =>
          editing === line.id ? (
            <div key={line.id} className="flex flex-wrap items-center gap-2">
              <TextInput
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                aria-label={t('costOfDay.expenses.labelField')}
                className="h-8 min-w-24 flex-1 text-xs"
              />
              <TextInput
                value={draftAmount}
                onChange={(e) => setDraftAmount(maskDecimalInput(e.target.value))}
                inputMode="decimal"
                aria-label={t('costOfDay.expenses.amountField')}
                className="h-8 w-24 text-right font-mono text-xs"
              />
              <Button variant="secondary" size="sm" onClick={() => void saveEdit(line)}>
                <Check className="size-3.5" />
                {t('costOfDay.expenses.save')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('costOfDay.expenses.cancel')}
                onClick={() => setEditing(null)}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
            <div key={line.id} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">{line.label}</span>
              <span className="font-mono text-sm tabular-nums">
                {formatUah(line.amount, locale)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="print-hide text-muted-foreground"
                aria-label={t('costOfDay.expenses.edit', { label: line.label })}
                onClick={() => startEdit(line)}
              >
                <Pencil className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="print-hide text-muted-foreground"
                aria-label={t('costOfDay.expenses.remove', { label: line.label })}
                onClick={() => void removeLine(line)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ),
        )
      )}

      <div className="print-hide flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <TextInput
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('costOfDay.expenses.labelField')}
          className="h-8 min-w-28 flex-1 text-xs"
        />
        <TextInput
          value={amount}
          onChange={(e) => setAmount(maskDecimalInput(e.target.value))}
          inputMode="decimal"
          placeholder={t('costOfDay.expenses.amountField')}
          className="h-8 w-24 text-right font-mono text-xs"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void add()}
          disabled={!label.trim() || amount === '' || create.isPending}
        >
          <Plus className="size-3.5" />
          {t('costOfDay.expenses.add')}
        </Button>
      </div>

      {notSpread ? (
        <div className="rounded-lg bg-[var(--amber)]/10 px-3 py-2.5 text-[var(--amber)]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium">{t('costOfDay.expenses.awaiting')}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {t('costOfDay.expenses.awaitingAmount', {
                amount: formatUah(day.expenses_amount, locale),
              })}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed opacity-90">
            {t('costOfDay.expenses.awaitingNote')}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm">{t('costOfDay.expenses.shortfallRow')}</span>
            <span className="font-mono text-sm tabular-nums">
              {formatUah(day.shortfall_amount, locale)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{t('costOfDay.expenses.expensesRow')}</span>
            <span className="font-mono text-sm tabular-nums">
              {formatUah(day.expenses_amount, locale)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <span className="text-sm font-semibold uppercase">
              {t('costOfDay.expenses.basket')}
            </span>
            <span className="font-mono text-base font-semibold tabular-nums">
              {formatUah(day.basket, locale)}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm">{t('costOfDay.expenses.perKg')}</span>
            <span className="font-mono text-sm font-semibold tabular-nums">
              {formatUah(day.per_kg as string, locale)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('costOfDay.expenses.split', {
              shortfall: formatUah(day.shortfall_per_kg as string, locale),
              expenses: formatUah(day.expenses_per_kg as string, locale),
            })}
          </p>
        </>
      )}
    </div>
  );
}
```


- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w frontend -- ExpensesPanel`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/cost-of-day/ui/ExpensesPanel.tsx frontend/src/pages/cost-of-day/ui/ExpensesPanel.test.tsx
git commit -m "feat(cost-of-day): the ВИТРАТИ column — §8.3's input and §8.4's КОШИК

Everything writable on this screen lives in one component, which is what
«Права (ВИТРАТИ) — єдине місце вводу» means.

Three decisions worth reading rather than rediscovering: the patch sends only
the field that actually moved, so the audit trail this mutable table depends
on never records a transition that did not happen; the add form is NOT
cleared on a refusal, because a line that vanishes silently leaves the
собівартість computed without it; and when per_kg is null the panel names the
manual expenses alone — the day's weight would otherwise read as one
enormous недостача that nobody has measured.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `FinalPrices` — the three prices and the two звірки

**Files:**
- Create: `frontend/src/pages/cost-of-day/ui/FinalPrices.tsx`
- Test: `frontend/src/pages/cost-of-day/ui/FinalPrices.test.tsx`

**Interfaces:**
- Consumes: `CostOfDay` from `@/entities/cost-of-day`; `add`, `sum`, `cmp`, `formatUah`, `formatKg`, `formatDecimal` from `@/shared/lib/money`.
- Produces: `FinalPrices({ day, locale }: { day: CostOfDay; locale: string })`. Task 10 renders it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/cost-of-day/ui/FinalPrices.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { CostOfDay } from '@/entities/cost-of-day';
import { FinalPrices } from './FinalPrices';

const day: CostOfDay = {
  shift_id: 's1',
  closed_at: '2026-09-22T18:00:00.000Z',
  provisional: false,
  accrued: '131900.00',
  reweighed_kg: '854.00',
  shortfall_amount: '1660.00',
  expenses_amount: '3800.00',
  basket: '5460.00',
  per_kg: '6.39',
  shortfall_per_kg: '1.94',
  expenses_per_kg: '4.45',
  total_check: '135700.00',
  top_ups_included: true,
  top_ups_latest_at: null,
  products: [
    {
      product_id: 'p-rasp',
      product_name: 'Малина',
      accrued: '128000.00',
      intake_net_kg: '800.00',
      reweigh_net_kg: '790.00',
      shortfall: '1600.00',
      basket_share: '5050.82',
      price_was: '160.00',
      price_cost: '166.39',
      price_by_our_weight: '162.03',
      complete: true,
    },
    {
      product_id: 'p-black',
      product_name: 'Ожина',
      accrued: '3900.00',
      intake_net_kg: '65.00',
      reweigh_net_kg: '64.00',
      shortfall: '60.00',
      basket_share: '409.18',
      price_was: '60.00',
      price_cost: '66.39',
      price_by_our_weight: '60.94',
      complete: true,
    },
  ],
};

describe('FinalPrices', () => {
  it('prints §8.4 three prices for a product', () => {
    render(<FinalPrices day={day} locale="uk" />);

    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('160,00')).toBeInTheDocument(); // було
    expect(within(row).getByText('166,39')).toBeInTheDocument(); // собівартість
    expect(within(row).getByText('162,03')).toBeInTheDocument(); // нараховане ÷ наша вага
  });

  it('shows «разом» as нараховано plus the allocated share', () => {
    render(<FinalPrices day={day} locale="uk" />);

    // 128 000,00 + 5 050,82 — two server figures added, never a division.
    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getByText('133 050,82 ₴')).toBeInTheDocument();
  });

  it('reports the Σ із пулу = КОШИК звірка as passing', () => {
    render(<FinalPrices day={day} locale="uk" />);

    const check = screen.getByText(/Σ із пулу/);
    expect(check).toHaveTextContent('5 460,00 ₴');
    expect(check).toHaveAttribute('data-ok', 'true');
  });

  it('reports the звірка as FAILING when the shares do not sum to the basket', () => {
    const broken = { ...day, basket: '5461.00' };
    render(<FinalPrices day={broken} locale="uk" />);

    // The check exists to be read by a person, not to be decorative — a
    // mismatch has to look like one.
    expect(screen.getByText(/Σ із пулу/)).toHaveAttribute('data-ok', 'false');
  });

  it('dashes every derived cell for a product left out of the day', () => {
    const partial: CostOfDay = {
      ...day,
      products: [
        { ...day.products[0], reweigh_net_kg: null, basket_share: null, price_cost: null, price_by_our_weight: null, complete: false },
      ],
    };
    render(<FinalPrices day={partial} locale="uk" />);

    const row = screen.getByRole('row', { name: /Малина/ });
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(within(row).queryByText('0,00 ₴')).not.toBeInTheDocument();
  });

  it('prints §8.4 own звірка — нараховано plus витрати', () => {
    render(<FinalPrices day={day} locale="uk" />);
    const check = screen.getByText(/131 900,00/);
    expect(check).toHaveTextContent('135 700,00 ₴');
    expect(check).toHaveTextContent('3 800,00 ₴');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- FinalPrices`
Expected: FAIL — cannot resolve `./FinalPrices`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/cost-of-day/ui/FinalPrices.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { cn } from '@/shared/lib/cn';
import { add, cmp, formatDecimal, formatKg, formatUah, sum } from '@/shared/lib/money';
import type { CostOfDay } from '@/entities/cost-of-day';

/**
 * §8.4's three prices — «було» (what it was bought for), «собівартість»
 * (plus its share of the недостача and the витрати) and «нараховане ÷ наша
 * вага» — plus the two звірки, SHOWN TO THE PERSON rather than hidden in a
 * test.
 *
 * «із пулу» is the server's `basket_share`, allocated by largest remainder so
 * the parts sum exactly to the basket. That identity is what the first check
 * below prints, and it is §8.4's own claim: «жодна гривня не загубилася і не
 * з'явилася з нічого». The only arithmetic done here is `add(accrued,
 * basket_share)` for the «разом» column — two server figures summed, never a
 * division.
 *
 * Every derived cell of a product that is not `complete` is «—». It
 * contributed no kilograms to the day's denominator, so it collects no share
 * from it (§3.15), and a row of zeroes beside 128 000,00 нараховано would
 * read as berries that vanished.
 *
 * `day.per_kg` is cast non-null here because `CostOfDayPage` renders this
 * whole section only when it is not: a day with nothing on the scale has no
 * «середня ціна після витрат» to print, and `ExpensesPanel` says that in
 * words instead.
 */
export function FinalPrices({ day, locale }: { day: CostOfDay; locale: string }) {
  const { t } = useTranslation();

  const shares = day.products
    .map((p) => p.basket_share)
    .filter((s): s is string => s !== null);
  const sharesTotal = shares.length > 0 ? sum(shares) : '0.00';
  const sharesMatch = cmp(sharesTotal, day.basket) === 0;

  return (
    <div className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>{t('costOfDay.final.title')}</Eyebrow>
        <div className="flex flex-wrap items-center gap-3">
          {/* §8.5's ② and ③ are not built, so this states the rule rather than
              offering a choice: a selector with one legal value is a control
              that looks recorded and is not. */}
          <span className="font-mono text-xs text-muted-foreground">
            {t('costOfDay.final.basis')}
          </span>
          <span className="font-mono text-xs font-medium">
            {t('costOfDay.final.rate', { rate: formatDecimal(day.per_kg as string, locale) })}
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('costOfDay.final.product')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.ourWeight')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.fromBasket')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.together')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.cost')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.was')}</TableHead>
              <TableHead scope="col" className="text-right">{t('costOfDay.final.byOurWeight')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {day.products.map((p) => (
              <TableRow key={p.product_id}>
                <TableCell className="font-medium">{p.product_name}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {p.reweigh_net_kg === null ? '—' : formatKg(p.reweigh_net_kg, locale)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {p.basket_share === null ? '—' : formatUah(p.basket_share, locale)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {p.basket_share === null
                    ? '—'
                    : formatUah(add(p.accrued, p.basket_share), locale)}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold tabular-nums">
                  {p.price_cost === null ? '—' : formatDecimal(p.price_cost, locale)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatDecimal(p.price_was, locale)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {p.price_by_our_weight === null
                    ? '—'
                    : formatDecimal(p.price_by_our_weight, locale)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 border-border">
              <TableCell className="font-semibold">{t('costOfDay.final.total')}</TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatKg(day.reweighed_kg, locale)}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatUah(sharesTotal, locale)}
              </TableCell>
              <TableCell className="text-right font-mono font-semibold tabular-nums">
                {formatUah(add(day.accrued, day.expenses_amount), locale)}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
              <TableCell className="text-right text-muted-foreground">—</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-sm leading-relaxed">
        {t('costOfDay.final.summary', {
          basket: formatUah(day.basket, locale),
          kg: formatKg(day.reweighed_kg, locale),
          rate: formatDecimal(day.per_kg as string, locale),
        })}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span
          data-ok={String(sharesMatch)}
          className={cn('font-mono', sharesMatch ? 'text-[var(--leaf)]' : 'text-destructive')}
        >
          {t('costOfDay.final.checkShare', {
            shares: formatUah(sharesTotal, locale),
            basket: formatUah(day.basket, locale),
          })}{' '}
          {sharesMatch ? '✓' : '✗'}
        </span>
        <span className="font-mono text-muted-foreground">
          {t('costOfDay.final.checkTotal', {
            total: formatUah(day.total_check, locale),
            accrued: formatUah(day.accrued, locale),
            expenses: formatUah(day.expenses_amount, locale),
          })}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w frontend -- FinalPrices`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/cost-of-day/ui/FinalPrices.tsx frontend/src/pages/cost-of-day/ui/FinalPrices.test.tsx
git commit -m "feat(cost-of-day): §8.4's three prices and the two звірки

«із пулу» is the server's allocated share, so «Σ із пулу = КОШИК» is an
identity rather than a rounded approximation — and it is printed for the
owner to read, which is what §8.4 means by «жодна гривня не загубилася».

The only arithmetic here is add(accrued, basket_share) for «разом»: two
server figures summed, never a division.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `CostOfDayPage` — the composition and the three read states

**Files:**
- Create: `frontend/src/pages/cost-of-day/ui/CostOfDayPage.tsx`
- Create: `frontend/src/pages/cost-of-day/index.ts`
- Test: `frontend/src/pages/cost-of-day/ui/CostOfDayPage.test.tsx`

**Interfaces:**
- Consumes: `useWorkingPoint` (`@/features/point-scope`), `usePointOptionsQuery` (`@/entities/collection-point`), `useShiftOnDateQuery` (`@/entities/shift`), `useCostOfDayQuery`, `useDayExpensesQuery`, and the three components from Tasks 7–9.
- Produces: `CostOfDayPage` and the barrel `export { CostOfDayPage } from './ui/CostOfDayPage';`. Task 11 routes it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/cost-of-day/ui/CostOfDayPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostOfDayPage } from './CostOfDayPage';

const { workingPointMock, pointsMock, shiftMock, dayMock, expensesMock, setDateMock } =
  vi.hoisted(() => ({
    workingPointMock: vi.fn(),
    pointsMock: vi.fn(),
    shiftMock: vi.fn(),
    dayMock: vi.fn(),
    expensesMock: vi.fn(),
    setDateMock: vi.fn(),
  }));

// `useUrlParam` reads react-router's search params, so without this stub the
// page cannot mount outside a Router at all. `null` means «no ?date=», which
// the page clamps to today — the date stepper is not what these tests drive.
vi.mock('@/shared/lib/url-state', () => ({ useUrlParam: () => [null, setDateMock] }));
vi.mock('@/features/point-scope', () => ({ useWorkingPoint: () => workingPointMock() }));
vi.mock('@/entities/collection-point', () => ({ usePointOptionsQuery: () => pointsMock() }));
vi.mock('@/entities/shift', () => ({ useShiftOnDateQuery: () => shiftMock() }));
vi.mock('@/entities/cost-of-day', () => ({ useCostOfDayQuery: () => dayMock() }));
vi.mock('@/entities/day-expense', () => ({
  useDayExpensesQuery: () => expensesMock(),
  useCreateDayExpenseMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDayExpenseMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDayExpenseMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const day = {
  shift_id: 's1',
  closed_at: null,
  provisional: true,
  accrued: '131900.00',
  reweighed_kg: '854.00',
  shortfall_amount: '1660.00',
  expenses_amount: '3800.00',
  basket: '5460.00',
  per_kg: '6.39',
  shortfall_per_kg: '1.94',
  expenses_per_kg: '4.45',
  total_check: '135700.00',
  top_ups_included: true as const,
  top_ups_latest_at: null,
  products: [
    {
      product_id: 'p-rasp',
      product_name: 'Малина',
      accrued: '128000.00',
      intake_net_kg: '800.00',
      reweigh_net_kg: '790.00',
      shortfall: '1600.00',
      basket_share: '5460.00',
      price_was: '160.00',
      price_cost: '166.39',
      price_by_our_weight: '162.03',
      complete: true,
    },
  ],
};

const ok = <T,>(data: T) => ({ data, isPending: false, isError: false });
const pending = { data: undefined, isPending: true, isError: false };
const failed = { data: undefined, isPending: false, isError: true };

beforeEach(() => {
  workingPointMock.mockReturnValue({ pointId: 'p1', canPick: true, setPointId: vi.fn() });
  pointsMock.mockReturnValue(ok([{ id: 'p1', name: 'Шипинки', kind: 'reception' }]));
  shiftMock.mockReturnValue(ok({ id: 's1', status: 'open' }));
  dayMock.mockReturnValue(ok(day));
  expensesMock.mockReturnValue(ok([]));
});

describe('CostOfDayPage', () => {
  it('renders the day — both halves and the final table', () => {
    render(<CostOfDayPage />);

    expect(screen.getByRole('heading', { name: 'Собівартість дня' })).toBeInTheDocument();
    expect(screen.getByText('Ягода')).toBeInTheDocument();
    expect(screen.getByText('Витрати за день')).toBeInTheDocument();
    expect(screen.getByText('Середня ціна після витрат')).toBeInTheDocument();
  });

  it('marks an open shift as still moving', () => {
    render(<CostOfDayPage />);
    expect(screen.getByText('Зміна ще відкрита — цифри рухаються')).toBeInTheDocument();
  });

  it('reports a failed read as a failure, never as an empty day', () => {
    // The whole point of the three-state split: a dead /collection-points must
    // not be reported to the owner as a business fact about their own shift.
    pointsMock.mockReturnValue(failed);
    render(<CostOfDayPage />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Ягода')).not.toBeInTheDocument();
  });

  it('shows a spinner while the reads are in flight', () => {
    dayMock.mockReturnValue(pending);
    render(<CostOfDayPage />);

    expect(screen.queryByText('Ягода')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the shift was never opened, distinctly from an empty day', () => {
    shiftMock.mockReturnValue(ok(null));
    dayMock.mockReturnValue({ data: undefined, isPending: false, isError: false });
    render(<CostOfDayPage />);

    expect(screen.getByText(/Зміну .* не відкривали/)).toBeInTheDocument();
  });

  it('says nothing was taken in when the shift exists but has no products', () => {
    dayMock.mockReturnValue(ok({ ...day, products: [] }));
    render(<CostOfDayPage />);

    expect(screen.getByText('Цього дня на цьому пункті прийомки не було.')).toBeInTheDocument();
  });

  it('offers every active point, base included — this screen does not filter by kind', () => {
    pointsMock.mockReturnValue(
      ok([
        { id: 'p1', name: 'Шипинки', kind: 'reception' },
        { id: 'p2', name: 'Склад', kind: 'base' },
      ]),
    );
    render(<CostOfDayPage />);

    // «Склад тоже считається як одна прийомка» — filtering it out here showed
    // the same day two different ways on two screens.
    expect(screen.getByRole('option', { name: 'Склад' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- CostOfDayPage`
Expected: FAIL — cannot resolve `./CostOfDayPage`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/pages/cost-of-day/ui/CostOfDayPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/shared/ui/page-header';
import { SelectField } from '@/shared/ui/select-field';
import { DateStepper } from '@/shared/ui/date-stepper';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Spinner } from '@/shared/ui/spinner';
import { useUrlParam } from '@/shared/lib/url-state';
import {
  todayIso,
  addDaysIso,
  isRealIsoDate,
  formatShortDate,
  formatLongDate,
  formatDateTime,
} from '@/shared/lib/date';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useShiftOnDateQuery } from '@/entities/shift';
import { useCostOfDayQuery } from '@/entities/cost-of-day';
import { useDayExpensesQuery } from '@/entities/day-expense';
import { BerryTable } from './BerryTable';
import { ExpensesPanel } from './ExpensesPanel';
import { FinalPrices } from './FinalPrices';

/**
 * §8.4 «Собівартість дня» — where the whole §8 slice converges. The
 * reweigh reconciliation, the top-up allocation and the day's expenses are
 * all inputs to exactly this screen.
 *
 * THE DATE IS LOCAL, and `?date=` is this screen's own: the owner works
 * through yesterday's day while the points are still buying today, so a
 * global date would move the working day under the very people being checked.
 * Copied from `pages/day` and `pages/reweigh`, clamp included.
 *
 * THE POINT PICKER IS NOT FILTERED BY `kind`, and that is the one place this
 * screen deliberately differs from `pages/reweigh`. The base is a reception
 * point with wholesale prices that also happens to be where weighing happens
 * — it is why §8.6's network average sits below Шипинки — and filtering it
 * out here made the same day read two different ways on two screens.
 *
 * THREE READ STATES, never two. A failed `/collection-points` leaves every
 * downstream query disabled, and reporting that as «зміну не відкривали»
 * states a business fact about a shift nobody managed to read.
 */
export function CostOfDayPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const { pointId, canPick, setPointId } = useWorkingPoint();
  const pointsQuery = usePointOptionsQuery();
  const points = pointsQuery.data ?? [];

  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  const date = isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today;

  const shift = useShiftOnDateQuery(pointId, date);
  const shiftId = shift.data?.id;
  const cost = useCostOfDayQuery(shiftId);
  const expenses = useDayExpensesQuery(shiftId);

  const readsPending =
    pointsQuery.isPending ||
    (pointId !== null && shift.isPending) ||
    (shiftId !== undefined && (cost.isPending || expenses.isPending));
  const readsFailed =
    pointsQuery.isError || shift.isError || cost.isError || expenses.isError;

  const pointName = points.find((p) => p.id === pointId)?.name ?? '—';
  const day = cost.data;

  const actions = (
    <div className="print-hide flex flex-wrap items-center gap-2">
      {canPick ? (
        <SelectField
          aria-label={t('costOfDay.point')}
          value={pointId ?? ''}
          onChange={(e) => setPointId(e.target.value || null)}
          className="w-44"
        >
          {points.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      <DateStepper
        label={formatShortDate(date, locale)}
        onPrev={() => setDateParam(addDaysIso(date, -1))}
        onNext={() => setDateParam(addDaysIso(date, 1))}
        onToday={date === today ? undefined : () => setDateParam(today)}
        canNext={date < today}
      />
      <Button variant="outline" size="sm" onClick={() => window.print()}>
        <Printer className="size-4" />
        {t('costOfDay.print')}
      </Button>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-6">
      <PageHeader
        eyebrow={t('costOfDay.eyebrow')}
        title={t('costOfDay.title')}
        description={t('costOfDay.description')}
        actions={actions}
      />

      {readsFailed ? (
        <p role="alert" className="py-6 text-center text-destructive">
          {t('common.somethingWentWrong')}
        </p>
      ) : readsPending ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : !day ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('costOfDay.noShift', { date: formatShortDate(date, locale), point: pointName })}
        </p>
      ) : (
        <div className="printable print-landscape rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <div className="print-only mb-4">
            <div className="font-display text-lg font-semibold">
              {t('costOfDay.sheetTitle', {
                date: formatLongDate(date, locale),
                point: pointName,
              })}
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
            <span className="font-display text-lg leading-none font-medium">{pointName}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {formatShortDate(date, locale)}
            </span>
            {day.provisional ? (
              <Badge variant="outline" className="border-[var(--amber)]/40 text-[var(--amber)]">
                {t('costOfDay.provisional')}
              </Badge>
            ) : null}
            {day.top_ups_latest_at ? (
              <Badge variant="secondary" className="font-normal">
                {t('costOfDay.topUps', { at: formatDateTime(day.top_ups_latest_at, locale) })}
              </Badge>
            ) : null}
          </div>

          {day.products.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('costOfDay.noIntake')}
            </p>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(290px,0.6fr)]">
                <BerryTable
                  products={day.products}
                  reweighedKg={day.reweighed_kg}
                  accrued={day.accrued}
                  locale={locale}
                />
                <ExpensesPanel
                  day={day}
                  expenses={expenses.data ?? []}
                  shiftId={day.shift_id}
                  locale={locale}
                />
              </div>
              {day.per_kg === null ? null : <FinalPrices day={day} locale={locale} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

Create `frontend/src/pages/cost-of-day/index.ts`:

```ts
export { CostOfDayPage } from './ui/CostOfDayPage';
```


- [ ] **Step 4: Run the tests and make sure they pass**

Run: `npm test -w frontend -- CostOfDayPage`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/cost-of-day
git commit -m "feat(cost-of-day): the §8.4 page — composition and the three read states

The date is local to this screen: the owner works through yesterday while the
points are still buying today, so a global date would move the working day
under the very people being checked.

The point picker is NOT filtered by kind, and that is the one place this
screen deliberately differs from pages/reweigh — the base is a reception
point with wholesale prices that also happens to be where weighing happens,
and filtering it out made the same day read two ways on two screens.

Three read states, never two: a failed /collection-points reported as «зміну
не відкривали» would state a business fact about a shift nobody could read.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Route, nav, and the full verification gate

**Files:**
- Modify: `frontend/src/app/owner-pages.ts`
- Modify: `frontend/src/app/lazy-routes.ts`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/layouts/AppLayout.tsx`
- Modify: `frontend/CLAUDE.md`
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`
- Test: `frontend/src/app/router.test.tsx` (read it first — extend, do not rewrite)

**Interfaces:**
- Consumes: `CostOfDayPage` from `@/pages/cost-of-day` (Task 10).
- Produces: the `/cost-of-day` route, owner-gated and lazy.

- [ ] **Step 1: Write the failing test**

`frontend/src/app/router.test.tsx` drives the real tree through `createMemoryRouter` and stubs each guarded page to a sentence. Add a stub beside the two already there, near the top of the file:

```tsx
vi.mock('@/pages/cost-of-day', () => ({
  CostOfDayPage: () => <p>cost-of-day page</p>,
}));
```

and the pair of cases, alongside the existing `/transfers` pair:

```tsx
  it('keeps /cost-of-day away from an operator', async () => {
    // §8's READS are owner-only as well as its writes: what the base claims
    // went missing is not something the point reads about itself. A
    // route-level RequireRole gate, so the owner chunk is never even fetched
    // — invert the two and code-splitting becomes authorisation-by-download.
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'point_operator', display_name: 'Оператор Тест' },
      isPending: false,
      isError: false,
    });
    renderAt('/cost-of-day');
    expect(await screen.findByRole('heading', { name: /summary/i })).toBeInTheDocument();
    expect(screen.queryByText('cost-of-day page')).not.toBeInTheDocument();
  });

  it('lets an owner onto /cost-of-day', async () => {
    useSession.setState({ token: 'tok' });
    meMock.mockReturnValue({
      data: { role: 'network_owner', display_name: 'Керівник Тест' },
      isPending: false,
      isError: false,
    });
    renderAt('/cost-of-day');
    expect(await screen.findByText('cost-of-day page')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w frontend -- router`
Expected: FAIL — no route matches `/cost-of-day`.

- [ ] **Step 3: Wire the route**

In `frontend/src/app/owner-pages.ts`, add:

```ts
export { CostOfDayPage } from '@/pages/cost-of-day';
```

In `frontend/src/app/lazy-routes.ts`, add:

```ts
export const CostOfDayPage = lazy(() => ownerPages().then((m) => ({ default: m.CostOfDayPage })));
```

In `frontend/src/app/router.tsx`, add `CostOfDayPage` to the existing `./lazy-routes` import list (keep it alphabetical) and add the route beside `/reweigh`:

```tsx
      {
        // Owner-only, like /reweigh: §8's reads as well as its writes are the
        // base's view of a point, not something the point sees about itself.
        path: '/cost-of-day',
        element: (
          <RequireAuth>
            <RequireRole role="network_owner">
              <CostOfDayPage />
            </RequireRole>
          </RequireAuth>
        ),
      },
```

In `frontend/src/app/layouts/AppLayout.tsx`, give the existing placeholder its destination:

```tsx
      { labelKey: 'nav.cost', icon: Calculator, to: '/cost-of-day' },
```

- [ ] **Step 4: Run the frontend suite**

Run: `npm test -w frontend`
Expected: PASS in full. `route-suspense.test.tsx` and `router.lazy-guard.test.tsx` exercise the lazy set — if either enumerates the owner chunk's members, extend it rather than loosening it.

- [ ] **Step 5: Update the two docs that now say something false**

In `frontend/CLAUDE.md`:
- add `/cost-of-day` to the `router.tsx` route list in the Structure table;
- add the two new entity slices and the page slice to the `src/` tree listing, beside `entities/reweigh` and `pages/reweigh`.

In `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:
- **Delete** the «**§8.4 «Собівартість дня»** — `GET /shifts/:shiftId/cost-of-day` already serves it and no screen reads it» bullet from the reweigh-screen deferrals: the finding is gone, and a ratchet turns one way — a stale entry is as wrong as a missing one.
- **Delete** the «§8.4's «з них недостача 1,94 / з них витрати 4,45» split is not in the response» bullet from the #121/#122 review section, for the same reason.
- **Add**, under a new heading `## Deferred from the cost-of-day screen (2026-09-22)`:

```markdown
- **§8.6 «Середня ціна по мережі».** `GET /reports/network-average?date=` is served, tested and
  read by no screen — exactly where §8.4 stood before this branch. `nav.network` is the next
  disabled placeholder in the management group.
- **«Аркуш керівника»** (`nav.sheet`) — a placeholder with no endpoint behind it at all.
- **§8.5's allocation-policy selector.** Still blocked on the rules file's own open question
  («узнать як вони це роблять»); ③ additionally needs `expense_allocation` and
  `allocation_product_id` on the columnless `reweighs` header.
- **`basket_share` is not in spec §5.5's formula list.** It was added because §8.4's screen
  prints «із пулу» and checks «Σ із пулу = КОШИК» in front of the owner, and `per_kg × kg` per
  row fails that check by 2,94 ₴ on §8.4's own numbers. If the rules file is ever revised, §5.5
  should gain the formula rather than the code losing it.
```

- [ ] **Step 6: Run the full verification gate**

Run: `npm run verify:full`

This change touches money code, SQL-backed figures and a lazy chunk's contents — the fast tier reaches none of those (CLAUDE.md: «Money code is that kind too», and the bundle ceiling only moves under a real build). Paste the verdict line under the claim. Name every `SKIPPED` row out loud — «the fast tier is green; `smoke` was skipped, no daemon» — never «all green». If a row is red, fix the code or the measurement; widening a baseline or lowering a floor is not turning green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app frontend/CLAUDE.md docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "feat(cost-of-day): route /cost-of-day and give nav.cost its destination

nav.cost has been a disabled placeholder since the migration began, and
index.css has carried .print-landscape rules written for this page — named
«(Н8)» in their own comment — with no consumer. Both now have one.

The screen joins the existing single owner chunk rather than taking its own:
lazy-routes.ts measures why one dynamic entry point beats six.

Two follow-up entries are DELETED rather than ticked — «no screen reads it»
and «the «з них» split is not in the response» are both false as of this
branch, and a stale ratchet entry is as wrong as a missing one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification summary

Report, at the end, with the command named and its verdict line pasted:

- `npm test -w backend -- cost-of-day` — Tasks 1–3.
- `npm run test:db -w backend -- cost-of-day.db-spec.ts` — Task 3's allocation identity. Needs Postgres; if it did not run, say so.
- `npm test -w frontend` — Tasks 4–11.
- `npm run verify:full` — the gate. Money code, a real database and the bundle ceiling are all in scope, and the fast tier sees none of them.
