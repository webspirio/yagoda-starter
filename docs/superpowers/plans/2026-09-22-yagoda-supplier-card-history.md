# Supplier card history + balance breakdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The supplier card shows what each receipt contained without opening it, and reads its balance breakdown from the server instead of rebuilding it from a truncated page.

**Architecture:** Two backend reads, then the screen. `GET /intakes?expand=items` nests the existing `IntakeItemResponse` into list rows behind an opt-in flag, with product and grade names joined in at read time. `GET /suppliers/:id/balance` decomposes the existing `debtSql` into its three already-separate terms and adds three season counters. The card then renders lines under each receipt row and feeds its tiles from the breakdown.

**Tech Stack:** NestJS 11 + TypeORM (raw SQL for aggregates), Postgres, React 19 + TanStack Query v5, vitest + RTL, jest for backend.

**Spec:** `docs/superpowers/specs/2026-09-22-yagoda-supplier-card-history-design.md`

## Global Constraints

- **Worktree:** `/home/dz/work/yagoda-starter/.claude/worktrees/supplier-card`, branch `feat/148-supplier-card-history`. Never touch the main checkout or another worktree.
- **Every `numeric` crosses the wire as a scale-2 decimal STRING.** Cast in SQL with `::text`, and wrap `COALESCE` around the **cast**, not the number: `COALESCE(SUM(x)::text, '0.00')`. `COALESCE(SUM(x), 0)` yields an integer zero that Postgres renders `'0'`, not `'0.00'`.
- **No money arithmetic in JavaScript.** Backend sums in Postgres; the frontend uses `shared/lib/money` (`add`, `sum`, `cmp`). An eslint rule bans `*`, `/`, `Number()` and `toFixed` in the money-handling modules.
- **`voided_at IS NULL` discipline.** The debt formula carries four such filters across three terms — the top-up term needs two, one for the top-up and one for its parent receipt. Deleting either is invisible to a test that exercises only the other.
- **i18n:** every user-facing string goes into BOTH `frontend/src/shared/lib/i18n/locales/uk.json` and `en.json`. uk is the real product language — write prose, not translation. Reuse an existing key over adding a near-duplicate (#77 tracks that debt).
- **Backend tests need the ESM flag:** run `npm test` / `npm run test:db` from `backend/`, never a bare `npx jest`.
- **D-1 is closed.** Nothing in this plan computes, displays or approximates a per-receipt remaining balance, an "oldest open" document, or which payout closed which receipt.

---

### Task 1: `expand=items` on the intakes list

**Files:**
- Modify: `backend/src/intakes/dto/list-intakes.query.ts`
- Modify: `backend/src/intakes/intake.mapper.ts:36-52` (`IntakeItemResponse`), `:79-105` (`toIntakeResponse`), `:107-121` (`toIntakeItemResponse`)
- Modify: `backend/src/intakes/intakes.service.ts:334-395` (`list`), `:417-420` (`findOne`'s item load)
- Test: `backend/src/intakes/intakes.service.spec.ts`, `backend/src/intakes/intakes-expand.db-spec.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `IntakeItemResponse` gains `product_name: string` and `grade_name: string`; `IntakeResponse` gains `items?: IntakeItemResponse[]`, present **only** when `expand=items`. `ListIntakesQueryDto` gains `expand?: 'items'`. Task 3 mirrors all three on the frontend.

Names are joined at read time, never snapshotted — `product-grade.entity.ts:26` already states that a grade rename is retroactive by construction and that this is accepted. Do not add a name column to `intake_items`.

- [ ] **Step 1: Write the failing DTO test**

In `backend/src/intakes/dto/list-intakes.query.spec.ts` (create):

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ListIntakesQueryDto } from './list-intakes.query';

const parse = (q: Record<string, unknown>) =>
  validateSync(plainToInstance(ListIntakesQueryDto, q));

describe('ListIntakesQueryDto.expand', () => {
  it('accepts the one value the register names', () => {
    expect(parse({ expand: 'items' })).toHaveLength(0);
  });

  it('is optional — the default list must stay callable without it', () => {
    expect(parse({})).toHaveLength(0);
  });

  it('refuses anything else, so a typo cannot silently mean «no expansion»', () => {
    expect(parse({ expand: 'item' })).not.toHaveLength(0);
    expect(parse({ expand: 'true' })).not.toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm test -- list-intakes.query.spec`
Expected: FAIL — `expand: 'item'` currently validates fine, because the property does not exist.

- [ ] **Step 3: Add the flag**

In `backend/src/intakes/dto/list-intakes.query.ts`, add `IsIn` to the `class-validator` import and append to the class:

```ts
  /**
   * `expand=items` nests each row's lines. OPT-IN, because the day feed,
   * reception and the dashboard all read this endpoint and none of them wants
   * items — the default response must not get heavier for them.
   *
   * The word comes from the parity programme's shared-reads register (§6),
   * which names this read `expand=items` and gives it two consumers: the
   * supplier card (5.6) and the journal (5.8). A second spelling elsewhere
   * would split one read into two.
   */
  @IsOptional()
  @IsIn(['items'], { message: 'expand must be "items"' })
  expand?: 'items';
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd backend && npm test -- list-intakes.query.spec`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing mapper test**

In `backend/src/intakes/intakes.service.spec.ts`, add:

```ts
describe('intake item names', () => {
  it('carries the product and grade names so a list row can be read without a catalog lookup', () => {
    const item = {
      id: 'ii-1',
      item_order: 1,
      product_grade_id: 'g-1',
      gross_kg: '86.50',
      pallet_kg: '0.00',
      tare_weight_kg: '2.50',
      net_kg: '84.00',
      price: '120.00',
      bonus: '0.00',
      amount: '10080.00',
      tare: [],
      product_grade: { name: 'Альба', product: { name: 'Полуниця' } },
    } as unknown as IntakeItem;

    expect(toIntakeItemResponse(item)).toMatchObject({
      product_name: 'Полуниця',
      grade_name: 'Альба',
    });
  });
});
```

Import `toIntakeItemResponse` and `IntakeItem` at the top of the file if they are not already imported.

- [ ] **Step 6: Run it and watch it fail**

Run: `cd backend && npm test -- intakes.service.spec`
Expected: FAIL — `product_name` undefined.

- [ ] **Step 7: Add the names to the response**

In `backend/src/intakes/intake.mapper.ts`, extend the interface:

```ts
export interface IntakeItemResponse {
  id: string;
  item_order: number;
  product_grade_id: string;
  /** Joined at READ time, never snapshotted: `product-grade.entity.ts` states
   *  that a rename is retroactive by construction and that this is accepted. */
  product_name: string;
  grade_name: string;
  gross_kg: string;
  pallet_kg: string;
  tare_weight_kg: string;
  net_kg: string;
  price: string;
  bonus: string;
  amount: string;
  tare: IntakeItemTareResponse[];
}
```

and in `toIntakeItemResponse`, after `product_grade_id`:

```ts
    product_name: item.product_grade?.product?.name ?? '',
    grade_name: item.product_grade?.name ?? '',
```

- [ ] **Step 8: Extend `toIntakeResponse` to carry optional items**

Replace the signature and add the field:

```ts
export function toIntakeResponse(
  intake: Intake,
  shift: Shift,
  extras: IntakeRowExtras,
  /** Present ONLY for `expand=items`. Absent — not `[]` — on the plain list,
   *  so a consumer can tell «not asked for» from «a receipt with no lines»,
   *  which cannot exist but would be indistinguishable otherwise. */
  items?: IntakeItem[],
): IntakeResponse {
```

and inside the returned object, after `paid_amount`:

```ts
    ...(items
      ? { items: [...items].sort((a, b) => a.item_order - b.item_order).map(toIntakeItemResponse) }
      : {}),
```

Add to `IntakeResponse`:

```ts
  /** Lines, only when the caller asked with `expand=items`. */
  items?: IntakeItemResponse[];
```

`IntakeDetailResponse extends IntakeResponse` already declares `items` as required, which narrows the optional — no change needed there.

- [ ] **Step 9: Run and watch it pass**

Run: `cd backend && npm test -- intakes.service.spec`
Expected: PASS.

- [ ] **Step 10: Load the grade relation on both paths**

In `backend/src/intakes/intakes.service.ts`, `findOne`'s item load (around line 417) becomes:

```ts
    const items = await m.find(IntakeItem, {
      where: { intake_id: intake.id },
      relations: { tare: true, product_grade: { product: true } },
    });
```

In `list`, after the existing `qb.take(query.limit);` block, nest items only when asked. Add after the `byId` map is built and before the `return`:

```ts
    // ONE query for every row's lines, not one per row. `In` over the page's
    // ids keeps this at two round trips whatever the page size; a relation on
    // the main builder would instead multiply the joined rows by the lines and
    // break `skip`/`take`.
    const itemsByIntake = new Map<string, IntakeItem[]>();
    if (query.expand === 'items' && entities.length > 0) {
      const lines = await this.dataSource.manager.find(IntakeItem, {
        where: { intake_id: In(entities.map((i) => i.id)) },
        relations: { tare: true, product_grade: { product: true } },
      });
      for (const line of lines) {
        const bucket = itemsByIntake.get(line.intake_id);
        if (bucket) bucket.push(line);
        else itemsByIntake.set(line.intake_id, [line]);
      }
    }
```

and pass them through in the `data:` mapping:

```ts
        return toIntakeResponse(i, i.shift as Shift, { ...extras }, itemsByIntake.get(i.id));
```

Keep the existing `extras` object exactly as it is built today; only the fourth argument is new. Import `In` from `typeorm`. If `this.dataSource` is not already a field on the service, use the repository's manager (`this.repo.manager`) instead — do not add a new constructor dependency.

- [ ] **Step 11: Write the db-spec**

Create `backend/src/intakes/intakes-expand.db-spec.ts`, following the existing harness conventions in `backend/src/intakes/intake-paid-at-reception.db-spec.ts` (copy its setup block — point, operator, shift, supplier, product, grade, price — rather than inventing one). Assert:

```ts
it('nests the lines, ordered like the paper, when asked', async () => {
  const { body } = await get(`/intakes?supplier_id=${supplierId}&expand=items`);
  expect(body.data[0].items).toHaveLength(2);
  expect(body.data[0].items[0].item_order).toBe(1);
  expect(body.data[0].items[0]).toMatchObject({
    product_name: 'Полуниця',
    grade_name: 'Альба',
    net_kg: '84.000',
    price: '120.00',
  });
});

it('returns exactly today’s shape when nobody asks', async () => {
  const { body } = await get(`/intakes?supplier_id=${supplierId}`);
  expect(body.data[0].items).toBeUndefined();
  expect(Object.keys(body.data[0]).sort()).toEqual(
    [
      'amount', 'business_date', 'code', 'collection_point_id', 'created_at', 'id',
      'lines_count', 'net_kg', 'paid_amount', 'received_by_user_id', 'shift_id',
      'supplier_id', 'supplier_name', 'void_reason', 'voided_at', 'voided_by_user_id',
    ].sort(),
  );
});
```

Adjust the expected `net_kg` scale to whatever the column actually renders — read one row first and match it rather than guessing.

- [ ] **Step 12: Run the db-spec**

Run: `cd backend && npm run test:db -- intakes-expand`
Expected: PASS. (If it fails on config validation — `APP_URL is required` — the worktree is missing `.env`; copy it from the main checkout.)

- [ ] **Step 13: Full backend suite + commit**

```bash
cd backend && npm test && npm run test:db && npm run lint
git add backend/src/intakes
git commit -m "feat(intakes): expand=items nests the lines a list row was hiding (#148)"
```

---

### Task 2: the balance says what it is made of

**Files:**
- Modify: `backend/src/supplier-balance/supplier-balance.service.ts:37-47` (`debtSql`), and add `breakdownFor`
- Modify: `backend/src/supplier-balance/supplier-balance.mapper.ts:1-14`
- Modify: `backend/src/supplier-balance/supplier-balance.controller.ts:31-39`
- Test: `backend/src/supplier-balance/supplier-balance.service.spec.ts`, `backend/src/supplier-balance/supplier-balance-breakdown.db-spec.ts` (create)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `SupplierBalanceResponse` gains `intakes_total`, `top_ups_total`, `payouts_total`, `kg_total` (decimal strings), `intakes_count` (int), `last_intake_date` (`string | null`). `SupplierBalanceService.breakdownFor(supplierId): Promise<SupplierBalanceBreakdown>`. Task 3 mirrors the response.

`debtFor(supplierId, manager?)` **keeps its exact present signature and behaviour** — the payout ceiling calls it inside a transaction that holds the supplier row lock, and that call site must not change.

- [ ] **Step 1: Write the failing unit test**

In `backend/src/supplier-balance/supplier-balance.service.spec.ts`:

```ts
describe('breakdownFor', () => {
  it('returns three terms that add up to the debt it returns with them', async () => {
    const row = {
      debt: '4200.00',
      intakes_total: '10000.00',
      top_ups_total: '200.00',
      payouts_total: '6000.00',
      intakes_count: 3,
      kg_total: '250.500',
      last_intake_date: '2026-09-20',
    };
    const query = jest.fn().mockResolvedValue([row]);
    const service = new SupplierBalanceService({ manager: { query } } as never);

    const result = await service.breakdownFor('s-1');

    expect(result).toEqual(row);
    expect(add(result.intakes_total, result.top_ups_total)).toBe('10200.00');
    expect(sub('10200.00', result.payouts_total)).toBe(result.debt);
  });
});
```

Use the repo's own money helpers in the assertion (`backend/src/common/money.ts`) — import `add` and `sub` from there. If the existing spec file constructs the service differently, follow that file's construction, not this snippet's.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd backend && npm test -- supplier-balance.service.spec`
Expected: FAIL — `service.breakdownFor is not a function`.

- [ ] **Step 3: Split the formula into its three named terms**

In `supplier-balance.service.ts`, replace the single `debtSql` with three term builders plus a `debtSql` composed from them. Keep the existing long doc comment above them untouched — it explains the filters and is still true — and add one sentence saying why the terms are now named separately.

```ts
const intakesTermSql = (supplier: string): string =>
  `COALESCE((SELECT SUM(i.amount) FROM intakes i
              WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL), 0.00)`;

const topUpsTermSql = (supplier: string): string =>
  `COALESCE((SELECT SUM(t.amount) FROM intake_top_ups t
               JOIN intakes ti ON ti.id = t.intake_id
              WHERE ti.supplier_id = ${supplier}
                AND ti.voided_at IS NULL
                AND t.voided_at  IS NULL), 0.00)`;

const payoutsTermSql = (supplier: string): string =>
  `COALESCE((SELECT SUM(p.amount) FROM payouts p
              WHERE p.supplier_id = ${supplier} AND p.voided_at IS NULL), 0.00)`;

/** The total, COMPOSED from the three terms above rather than written again —
 *  a breakdown that restated the formula could drift from the number it is
 *  supposed to explain; this one cannot, because it IS the same SQL. */
const debtSql = (supplier: string): string =>
  `(${intakesTermSql(supplier)} + ${topUpsTermSql(supplier)} - ${payoutsTermSql(supplier)})`;
```

Verify by eye that the three terms are character-for-character the sub-selects that were in the original `debtSql`, including every `voided_at IS NULL`.

- [ ] **Step 4: Add `breakdownFor`**

```ts
  /**
   * The balance AND what it is made of, in one read. `GET /suppliers/:id/balance`
   * used to answer one number, so the card rebuilt the explanation from three
   * paginated reads and its tiles were wrong past 100 documents (#103).
   *
   * The three season counters ride here rather than in a separate summary
   * endpoint because the «Залишки» row and the owner's top-suppliers table
   * want the same numbers, and the programme's register forbids a second
   * query for numbers that already have one.
   */
  async breakdownFor(supplierId: string): Promise<SupplierBalanceBreakdown> {
    const sql = `SELECT
      ${debtSql('$1')}::text          AS debt,
      ${intakesTermSql('$1')}::text   AS intakes_total,
      ${topUpsTermSql('$1')}::text    AS top_ups_total,
      ${payoutsTermSql('$1')}::text   AS payouts_total,
      (SELECT COUNT(i.id)::int FROM intakes i
        WHERE i.supplier_id = $1 AND i.voided_at IS NULL) AS intakes_count,
      (SELECT COALESCE(SUM(ii.net_kg)::text, '0.00') FROM intake_items ii
         JOIN intakes i ON i.id = ii.intake_id
        WHERE i.supplier_id = $1 AND i.voided_at IS NULL) AS kg_total,
      (SELECT MAX(s.business_date) FROM intakes i
         JOIN shifts s ON s.id = i.shift_id
        WHERE i.supplier_id = $1 AND i.voided_at IS NULL) AS last_intake_date`;

    const [row] = (await this.dataSource.manager.query(sql, [
      supplierId,
    ])) as SupplierBalanceBreakdown[];

    return row;
  }
```

Declare the type in `supplier-balance.mapper.ts` and import it.

- [ ] **Step 5: Run and watch it pass**

Run: `cd backend && npm test -- supplier-balance.service.spec`
Expected: PASS.

- [ ] **Step 6: Widen the response and the controller**

In `supplier-balance.mapper.ts`:

```ts
/** The three terms of `Σ intakes + Σ top-ups − Σ payouts`, plus the season
 *  counters the card's tiles read instead of summing a truncated page. */
export interface SupplierBalanceBreakdown {
  debt: string;
  intakes_total: string;
  top_ups_total: string;
  payouts_total: string;
  intakes_count: number;
  kg_total: string;
  /** Business date of the most recent LIVE receipt; `null` when there is none. */
  last_intake_date: string | null;
}

export interface SupplierBalanceResponse extends SupplierBalanceBreakdown {
  supplier_id: string;
}

export function toSupplierBalanceResponse(
  supplier_id: string,
  breakdown: SupplierBalanceBreakdown,
): SupplierBalanceResponse {
  return { supplier_id, ...breakdown };
}
```

In the controller:

```ts
    const supplier = await this.suppliers.findOne(actor, id);
    return toSupplierBalanceResponse(supplier.id, await this.balance.breakdownFor(supplier.id));
```

Fix any other caller the compiler points at. `debtFor` stays exported and unchanged — the payout ceiling still uses it.

- [ ] **Step 7: Write the db-spec that pins the invariant**

Create `backend/src/supplier-balance/supplier-balance-breakdown.db-spec.ts`. Build one supplier with: two live receipts, one voided receipt **that has a top-up**, one live top-up on a live receipt, one live payout, one voided payout. Then:

```ts
it('adds up to its own debt over the same data', async () => {
  const { body } = await get(`/suppliers/${supplierId}/balance`);
  expect(sub(add(body.intakes_total, body.top_ups_total), body.payouts_total)).toBe(body.debt);
});

it('lets a voided receipt neutralise its own top-up', async () => {
  const { body } = await get(`/suppliers/${supplierId}/balance`);
  expect(body.top_ups_total).toBe('150.00'); // only the live receipt’s top-up
});

it('does not let a voided payout close any debt', async () => {
  const { body } = await get(`/suppliers/${supplierId}/balance`);
  expect(body.payouts_total).toBe('5000.00'); // the voided one is absent
});

it('counts and weighs only live receipts, and dates the newest of them', async () => {
  const { body } = await get(`/suppliers/${supplierId}/balance`);
  expect(body.intakes_count).toBe(2);
  expect(body.last_intake_date).toBe('2026-09-20');
});

it('reads 0.00, not 0, for a supplier with no documents at all', async () => {
  const { body } = await get(`/suppliers/${emptySupplierId}/balance`);
  expect(body).toMatchObject({
    debt: '0.00', intakes_total: '0.00', top_ups_total: '0.00',
    payouts_total: '0.00', intakes_count: 0, last_intake_date: null,
  });
});
```

Replace the literal amounts with the ones your fixture actually creates.

- [ ] **Step 8: Run the db-spec**

Run: `cd backend && npm run test:db -- supplier-balance-breakdown`
Expected: PASS (5 tests).

- [ ] **Step 9: Full backend suite + commit**

```bash
cd backend && npm test && npm run test:db && npm run lint
git add backend/src/supplier-balance
git commit -m "feat(suppliers): the balance says what it is made of (#103)"
```

---

### Task 3: the frontend read layer

**Files:**
- Modify: `frontend/src/entities/intake/model/intake.ts:1-22` (`Intake`), `:37-50` (`IntakeItem`), `:73-83` (`DocumentFilter`)
- Modify: `frontend/src/entities/intake/api/useIntakes.ts:7-19` (`documentParams`)
- Modify: `frontend/src/entities/supplier/model/*` (the balance type) and `frontend/src/entities/supplier/api/useSupplierBalances.ts`
- Test: `frontend/src/entities/intake/api/useIntakes.test.tsx`, `frontend/src/entities/supplier/api/useSupplierBalances.test.tsx`

**Interfaces:**
- Consumes: Task 1's `expand=items` + `items[]` with `product_name`/`grade_name`; Task 2's widened balance response.
- Produces: `DocumentFilter.expandItems?: boolean`; `Intake.items?: IntakeItem[]`; `IntakeItem.product_name`/`.grade_name`; the balance model's six new fields. Task 4 consumes all of these.

Find the balance type's actual file before editing — `grep -rn "SupplierBalance" frontend/src/entities/supplier/`. Do not create a second type.

- [ ] **Step 1: Write the failing hook test**

In `frontend/src/entities/intake/api/useIntakes.test.tsx`:

```tsx
it('asks for lines only when the caller wants them', async () => {
  mock.onGet('/intakes').reply((config) => {
    expect(config.params.expand).toBe('items');
    return [200, { data: [], total: 0, page: 1, limit: 100 }];
  });
  const { result } = renderHook(() => useIntakesQuery({ supplierId: 's1', expandItems: true }), {
    wrapper,
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});

it('leaves the param off entirely for every other caller', async () => {
  mock.onGet('/intakes').reply((config) => {
    expect('expand' in config.params).toBe(false);
    return [200, { data: [], total: 0, page: 1, limit: 100 }];
  });
  const { result } = renderHook(() => useIntakesQuery({ supplierId: 's1' }), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd frontend && npm test -- useIntakes`
Expected: FAIL — `expandItems` is not a known property.

- [ ] **Step 3: Widen the filter and the params**

In `model/intake.ts`, add to `DocumentFilter`:

```ts
  /** Ask the server to nest each row's lines (`expand=items`). Off for every
   *  other caller: the day feed, reception and the dashboard read the same
   *  endpoint and would pay for lines they never render. */
  expandItems?: boolean;
```

and in `documentParams`, before `include_voided`:

```ts
    ...(f.expandItems ? { expand: 'items' } : {}),
```

`expandItems` is part of `DocumentFilter`, which is already the whole query key — two callers asking for the same supplier with and without lines therefore get two cache entries, which is correct.

- [ ] **Step 4: Run and watch it pass**

Run: `cd frontend && npm test -- useIntakes`
Expected: PASS.

- [ ] **Step 5: Mirror the response types**

In `model/intake.ts`, add to `IntakeItem` (after `product_grade_id`):

```ts
  /** Joined by the server at read time — a rename is retroactive, by design. */
  product_name: string;
  grade_name: string;
```

and to `Intake`:

```ts
  /** Present ONLY when the read asked for `expand=items`; `undefined`
   *  otherwise, which is not the same as a receipt with no lines. */
  items?: IntakeItem[];
```

- [ ] **Step 6: Write the failing balance test**

In `frontend/src/entities/supplier/api/useSupplierBalances.test.tsx`:

```tsx
it('reads the breakdown, not just the total', async () => {
  mock.onGet('/suppliers/s1/balance').reply(200, {
    supplier_id: 's1', debt: '4200.00',
    intakes_total: '10000.00', top_ups_total: '200.00', payouts_total: '6000.00',
    intakes_count: 3, kg_total: '250.500', last_intake_date: '2026-09-20',
  });
  const { result } = renderHook(() => useSupplierBalanceQuery('s1'), { wrapper });
  await waitFor(() => expect(result.current.data?.intakes_total).toBe('10000.00'));
  expect(result.current.data?.last_intake_date).toBe('2026-09-20');
});
```

- [ ] **Step 7: Run, fail, widen the type, pass**

Run: `cd frontend && npm test -- useSupplierBalances` → FAIL (property missing on the type).
Add the six fields to the single-supplier balance type, mirroring Task 2's `SupplierBalanceResponse` exactly, with `last_intake_date: string | null`.
Run again → PASS.

Leave the **list** row type (`/supplier-balances`) alone — this task widens only the single-supplier read.

- [ ] **Step 8: Commit**

```bash
cd frontend && npm test && npm run lint && npm run build && rm -rf dist
git add frontend/src/entities
git commit -m "feat(entities): carry the lines and the balance breakdown (#148, #103)"
```

---

### Task 4: the card

**Files:**
- Modify: `frontend/src/pages/supplier-card/ui/SupplierCardPage.tsx:36-40` (the reads), and its tiles
- Modify: `frontend/src/pages/supplier-card/ui/SupplierTimeline.tsx` (receipt row rendering)
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json`
- Test: `frontend/src/pages/supplier-card/ui/SupplierCardPage.test.tsx`

**Interfaces:**
- Consumes: Task 3's `expandItems`, `Intake.items`, `IntakeItem.product_name`/`.grade_name`, and the balance breakdown fields.
- Produces: the finished screen. Nothing downstream.

- [ ] **Step 1: Write the failing test — lines without a click**

In `SupplierCardPage.test.tsx`, following the file's existing mocking conventions:

```tsx
it('shows what the person handed over without opening anything', async () => {
  renderCard({
    intakes: [
      {
        ...intakeFixture,
        code: 'КВ-000142',
        amount: '12480.00',
        items: [
          {
            ...itemFixture, item_order: 1, product_name: 'Полуниця', grade_name: 'Альба',
            gross_kg: '86.50', tare_weight_kg: '2.50', net_kg: '84.000',
            price: '120.00', bonus: '0.00',
          },
          {
            ...itemFixture, item_order: 2, product_name: 'Малина', grade_name: 'Полка',
            gross_kg: '60.00', tare_weight_kg: '2.00', net_kg: '58.000',
            price: '95.00', bonus: '0.00',
          },
        ],
      },
    ],
  });

  expect(await screen.findByText(/Полуниця «Альба»/)).toBeInTheDocument();
  expect(screen.getByText(/86,50 брутто − 2,50 тара · 120,00 ₴\/кг/)).toBeInTheDocument();
  expect(screen.getByText(/Малина «Полка»/)).toBeInTheDocument();
});

it('adds the bonus into the price it prints', async () => {
  renderCard({
    intakes: [{ ...intakeFixture, items: [{ ...itemFixture, price: '120.00', bonus: '5.00' }] }],
  });
  expect(await screen.findByText(/125,00 ₴\/кг/)).toBeInTheDocument();
});
```

Match the exact separators the repo's formatters produce — render one row first and copy what it emits rather than guessing the spaces and the minus sign.

- [ ] **Step 2: Run and watch it fail**

Run: `cd frontend && npm test -- SupplierCardPage`
Expected: FAIL — the text is not in the document.

- [ ] **Step 3: Ask for the lines**

In `SupplierCardPage.tsx`:

```tsx
  const intakes = useIntakesQuery({ supplierId: id, limit: 100, expandItems: true });
```

- [ ] **Step 4: Render them under the receipt row**

In `SupplierTimeline.tsx`, inside the receipt branch, beneath the existing row content, add a block that maps `row.intake.items ?? []` in `item_order` order. Per item, two lines:

```tsx
<span className="block text-sm">
  {t('supplierCard.line.what', { product: item.product_name, grade: item.grade_name })}
  {' · '}
  {formatKg(item.net_kg, locale)}
</span>
<span className="block text-xs text-muted-foreground">
  {t('supplierCard.line.weights', {
    gross: formatKg(item.gross_kg, locale),
    tare: formatKg(item.tare_weight_kg, locale),
    price: formatDecimal(add(item.price, item.bonus), locale),
  })}
</span>
```

All three helpers come from `@/shared/lib/money` (`format.ts:42-49`), and **which one goes where is not interchangeable — the units are already baked in:**

| Helper | Renders | Use it for |
|---|---|---|
| `formatKg('84.00')` | `84,00 кг` | `net_kg` only — the «{товар} «{сорт}» · {кг}» line |
| `formatDecimal('86.50')` | `86,50` | `gross_kg`, `tare_kg`, and the price — the key already supplies «брутто», «тара» and «₴/кг» |
| `formatUah('120.00')` | `120,00 ₴` | **not here** |

`formatUah` on the price would render «120,00 ₴ ₴/кг», and `formatKg` on gross/tare would render «86,50 кг брутто», neither of which is what the mock shows.

`add` comes from the same module — the eslint rule here bans a bare `+` on money.

Keep the row a single clickable target — the lines are inside the existing button, not siblings of it, so clicking anywhere still opens the receipt sheet.

- [ ] **Step 5: Run and watch it pass**

Run: `cd frontend && npm test -- SupplierCardPage`
Expected: PASS.

- [ ] **Step 6: Add the i18n keys**

`uk.json`, under a `supplierCard` group (create it if absent; if the card's keys already live elsewhere, follow that):

```json
"line": {
  "what": "{{product}} «{{grade}}»",
  "weights": "{{gross}} брутто − {{tare}} тара · {{price}} ₴/кг"
},
"breakdown": "{{intakes}} + {{topUps}} − {{payouts}}"
```

and the English mirror in `en.json`. Note the minus sign is U+2212 «−», not a hyphen, matching the mock and the rest of the app.

- [ ] **Step 7: Write the failing tiles test**

```tsx
it('reads its tiles from the breakdown, not from the page it happened to load', async () => {
  renderCard({
    // One loaded receipt worth 1 000, but the season had ninety more.
    intakes: [{ ...intakeFixture, amount: '1000.00', net_kg: '10.000' }],
    balance: {
      supplier_id: 's1', debt: '4200.00',
      intakes_total: '10000.00', top_ups_total: '200.00', payouts_total: '6000.00',
      intakes_count: 91, kg_total: '2500.500', last_intake_date: '2026-09-20',
    },
  });

  expect(await screen.findByText('91')).toBeInTheDocument();
  expect(screen.getByText(/10 000,00/)).toBeInTheDocument();
  expect(screen.queryByText(/1 000,00/)).not.toBeInTheDocument();
});
```

- [ ] **Step 8: Run, fail, rewire the tiles, pass**

Replace the tiles' values in `SupplierCardPage.tsx`: «Здач за сезон» ← `balance.data?.intakes_count`, «Ягоди здано» ← `kg_total`, «Нараховано» ← `intakes_total`, «Залишок за нами» ← `debt`. Delete the `sum(...)` calls over loaded rows that fed them, and the now-unused imports the linter will point at.

Under the balance tile render the breakdown line with `supplierCard.breakdown`.

Run: `cd frontend && npm test -- SupplierCardPage` → PASS.

- [ ] **Step 9: Keep the truncation note honest**

The timeline keeps `limit: 100` and its existing `isTruncated` note. Add a test that the note still appears when `total > data.length`, and that the tiles are **unaffected** by it — that pairing is the whole point of the change.

- [ ] **Step 10: Prove a voided receipt did not lose anything**

A receipt row grew a whole block of new content, and the СТОРНОВАНО treatment sits on the row it grew inside. Add:

```tsx
it('still strikes a voided receipt through, reason and all, now that it carries lines', async () => {
  renderCard({
    intakes: [
      {
        ...intakeFixture,
        voided_at: '2026-09-20T10:00:00.000Z',
        void_reason: 'Помилка ваги',
        items: [{ ...itemFixture, product_name: 'Полуниця', grade_name: 'Альба' }],
      },
    ],
  });

  expect(await screen.findByText('Помилка ваги')).toBeInTheDocument();
  // The lines are inside the struck-through row, not escaping it.
  expect(screen.getByText(/Полуниця «Альба»/)).toBeInTheDocument();
});
```

Assert the strike-through the way the existing voided-row test in this file does — copy its query, do not invent a new one.

- [ ] **Step 11: Verify and commit**

```bash
cd frontend && npm test && npm run lint && npm run build && rm -rf dist
git add frontend/src
git commit -m "feat(suppliers): the card explains itself without a click (#148, #103)"
```

---

## Final verification

```bash
cd backend  && npm test && npm run test:db && npm run lint
cd ../frontend && npm test && npm run lint && npm run build && rm -rf dist
cd .. && npm run verify:full
```

`verify:full`, not `verify` — the repo's own rule (root `CLAUDE.md` § Verification): money code's proof lives against a real Postgres, and the fast tier cannot see it. Task 2 rewrites the debt SQL, so this branch is money code by that definition.

**Report skips aloud.** A `SKIPPED` row is a row nobody ran — «the full tier is green, `test:ci-scripts` skipped, no jq on this machine» is the honest form; «all green» is not. And never widen a baseline or relax a rule to turn a row green: the ratchet turns one way.
