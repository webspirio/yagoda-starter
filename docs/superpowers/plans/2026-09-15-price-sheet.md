# Price Sheet (#89) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one-point-at-a-time price list with the mock's SHEET — rows are grades, columns are points — carrying a «Ціна дня загальна» column that reads a single number when the reception points agree and «різні · 145–150» when they do not, and a «встановити всім» gesture that writes every reception point in one transaction.

**Architecture:** Two new backend routes on the existing `grade-prices` module (`GET /sheet`, `POST /bulk`) sharing ONE «newest row wins» SQL fragment with `current()`, so the two reads cannot drift. The frontend replaces `PricesPage`'s `DataTable` with a grid and reuses `SetPriceDialog` for both the single-cell and the set-everywhere write.

**Tech Stack:** NestJS, TypeORM raw SQL, Jest (backend) · React 19, TanStack Query v5, Tailwind v4, Vitest + Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-09-15-yagoda-mock-ui-catchup.md` (section 3)

## Global Constraints

- Money is a DECIMAL STRING end to end. No `Number()`, `*`, `/` or `toFixed` on a price anywhere — `grade-prices` is one of the eight modules the eslint money rule covers. The min/max of a range is chosen by COMPARING strings through `shared/lib/money`'s `cmp`, never by `Math.min`.
- `business_date` is NOT reintroduced. The sheet shows CURRENT prices and carries no date picker; no heading may promise a date (spec section 3.3).
- The warehouse (`kind = 'warehouse'`) is EXCLUDED from «встановити всім» and from the «загальна» computation — DBML `collection_points` section 4.8. It still appears as its own column.
- An operator is pinned by `resolvePointFilter`; no new access rule is written. Their sheet is one column, read-only, with a lock icon and a caption (mock section 5.4).
- `max_markup` and `max_discount` are NOT NULL with no default. Every write sends all three numbers.

---

### Task 1: `GET /grade-prices/sheet`

**Files:**
- Create: `backend/src/grade-prices/dto/grade-price-sheet.query.ts`
- Modify: `backend/src/grade-prices/grade-prices.service.ts`
- Modify: `backend/src/grade-prices/grade-prices.controller.ts`
- Modify: `backend/src/grade-prices/grade-price.mapper.ts`
- Test: `backend/src/grade-prices/grade-prices.service.spec.ts`

**Interfaces:**
- Produces:
```ts
export interface SheetPointColumn { id: string; name: string; kind: PointKind; }
export interface SheetCell { base_price: string; max_markup: string; max_discount: string; }
export interface SheetRow {
  product_grade_id: string;
  grade_name: string;
  product_name: string;
  prices: Record<string, SheetCell>;   // keyed by collection_point_id; absent = unpriced
}
export interface GradePriceSheetResponse { points: SheetPointColumn[]; rows: SheetRow[]; }
```

- [ ] **Step 1: Extract the shared «newest row wins» fragment**

`current()` already builds it inline. Lift it to a module-level function so `sheet()` cannot grow a second definition of «current price»:

```ts
/**
 * THE ONE DEFINITION OF «the current price». `current()` (the operator's
 * picker, one point, paginated) and `sheet()` (the owner's grid, every point,
 * unpaginated) are different READS of the same rule, and a second copy of this
 * `DISTINCT ON` is how they would silently disagree about which row wins.
 *
 * Keyed on the PAIR, never the grade alone: a query spanning every point would
 * otherwise collapse five points' prices into one arbitrary row.
 */
function latestPricesSql(where: string): string {
  return `
      SELECT DISTINCT ON (gp.collection_point_id, gp.product_grade_id) gp.*
        FROM grade_prices gp
        JOIN product_grades pg ON pg.id = gp.product_grade_id
        ${where}
       ORDER BY gp.collection_point_id, gp.product_grade_id, gp.created_at DESC, gp.id DESC`;
}
```

Rewrite `current()` to call it. Run `npm test -w backend -- grade-prices` — every existing test must still pass, which is what proves the extraction changed nothing.

- [ ] **Step 2: Write the failing service test**

```ts
describe('sheet', () => {
  it('returns one row per active grade with a cell per priced point', async () => {
    const result = await service.sheet(owner, {});
    expect(result.points.map((p) => p.name)).toEqual(['Шипинки', 'Конищів', 'Склад']);
    const row = result.rows.find((r) => r.grade_name === 'Вищий сорт')!;
    expect(row.prices[shypynkyId].base_price).toBe('150.00');
    expect(row.prices[warehouseId].base_price).toBe('145.00');
  });

  it('gives an operator a single column — their own point', async () => {
    const result = await service.sheet(operator, {});
    expect(result.points).toHaveLength(1);
    expect(result.points[0].id).toBe(operator.collection_point_id);
  });

  it('omits a point with no price for a grade rather than sending null', async () => {
    const result = await service.sheet(owner, {});
    const row = result.rows.find((r) => r.grade_name === 'Нестандарт');
    expect(row).toBeUndefined(); // inactive grades are not on the sheet at all
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -w backend -- grade-prices`
Expected: FAIL — `service.sheet is not a function`.

- [ ] **Step 4: Implement `sheet()`**

```ts
  /**
   * THE OWNER'S GRID: every active grade against every point in scope.
   * UNPAGINATED, deliberately — `CurrentGradePricesQueryDto`'s `@Max(100)` is
   * what forced the old screen to fetch «one point at a time», and a sheet that
   * silently dropped a column would be worse than no sheet. The result is
   * bounded by (active grades x points in scope), both small and both
   * administered.
   *
   * SCOPED BY `resolvePointFilter`, so an OPERATOR gets a one-column sheet of
   * their own point and no new access rule exists anywhere. The owner gets
   * every ACTIVE point, warehouse included — §4.8 excludes the warehouse from
   * the «поставити всім» GESTURE, not from the screen.
   *
   * Inactive grades are absent: §4.5 — a grade the network retired is not
   * priced. There is no `include_inactive` here; that flag belongs to the
   * picker, where the owner needs the last price of a grade retired mid-season.
   */
  async sheet(
    actor: AuthenticatedUser,
    _query: GradePriceSheetQueryDto,
  ): Promise<GradePriceSheetResponse> {
    const pointId = resolvePointFilter(actor, undefined);

    const pointParams: unknown[] = [];
    let pointWhere = `WHERE cp.is_active = true`;
    if (pointId) {
      pointParams.push(pointId);
      pointWhere += ` AND cp.id = $${pointParams.length}`;
    }
    const points: SheetPointColumn[] = await this.repo.manager.query(
      `SELECT cp.id, cp.name, cp.kind FROM collection_points cp ${pointWhere}
        ORDER BY cp.kind, cp.name, cp.id`,
      pointParams,
    );

    const grades: { id: string; grade_name: string; product_name: string }[] =
      await this.repo.manager.query(
        `SELECT pg.id, pg.name AS grade_name, p.name AS product_name
           FROM product_grades pg JOIN products p ON p.id = pg.product_id
          WHERE pg.is_active = true
          ORDER BY p.name, pg.name, pg.id`,
      );

    const ids = points.map((p) => p.id);
    const cells: (GradePrice & { collection_point_id: string })[] = ids.length
      ? await this.repo.manager.query(
          `SELECT * FROM (${latestPricesSql(
            `WHERE pg.is_active = true AND gp.collection_point_id = ANY($1::uuid[])`,
          )}) t`,
          [ids],
        )
      : [];

    const byGrade = new Map<string, Record<string, SheetCell>>();
    for (const c of cells) {
      const row = byGrade.get(c.product_grade_id) ?? {};
      // Strings straight through: no arithmetic, no reformatting.
      row[c.collection_point_id] = {
        base_price: c.base_price,
        max_markup: c.max_markup,
        max_discount: c.max_discount,
      };
      byGrade.set(c.product_grade_id, row);
    }

    return {
      points,
      rows: grades.map((g) => ({
        product_grade_id: g.id,
        grade_name: g.grade_name,
        product_name: g.product_name,
        // An UNPRICED cell is ABSENT, never `null`: §4.5 makes the absence of a
        // row the disabling mechanism, and a `null` would invite a reader to
        // render «0».
        prices: byGrade.get(g.id) ?? {},
      })),
    };
  }
```

Add `GradePriceSheetQueryDto` as an empty class (a seam for a later filter) and wire the route BEFORE the bare `@Get()`, next to `/current`, for the declaration-order reason the controller already documents:

```ts
  @Get('sheet')
  @Auth()
  sheet(@CurrentUser() actor: AuthenticatedUser, @Query() query: GradePriceSheetQueryDto) {
    return this.prices.sheet(actor, query);
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w backend -- grade-prices` then `npm run lint -w backend`
Expected: PASS, lint clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/grade-prices
git commit -m "feat(prices): GET /grade-prices/sheet — every point in one read (#89)"
```

---

### Task 2: `POST /grade-prices/bulk`

**Files:**
- Create: `backend/src/grade-prices/dto/bulk-grade-price.dto.ts`
- Modify: `backend/src/grade-prices/grade-prices.service.ts`, `grade-prices.controller.ts`
- Test: `backend/src/grade-prices/grade-prices.service.spec.ts`
- Test: `backend/src/grade-prices/grade-prices-bulk.db-spec.ts` (create)

**Interfaces:**
- Produces: `bulk(actor, dto): Promise<{ created: number }>`

- [ ] **Step 1: Write the DTO**

```ts
/**
 * ONE GRADE, ONE SET OF NUMBERS, MANY POINTS — the «поставити всім» gesture.
 *
 * THE POINTS ARE NAMED BY THE CLIENT, not computed here as «all reception
 * points». §4.8's warehouse exclusion is a rule about the GESTURE, and the
 * screen that performs the gesture is where a reader should be able to see it;
 * buried in a service it becomes a surprise the next caller inherits. Each id
 * is still validated through `assertOwnsPoint`.
 */
export class BulkGradePriceDto {
  @IsUUID()
  product_grade_id: string;

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  collection_point_ids: string[];

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: 'base_price must be a decimal string with at most 2 decimal places' })
  @CanonicalDecimal()
  base_price: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: 'max_markup must be a decimal string with at most 2 decimal places' })
  @CanonicalDecimal()
  max_markup: string;

  @Matches(/^\d{1,8}(\.\d{1,2})?$/, { message: 'max_discount must be a decimal string with at most 2 decimal places' })
  @CanonicalDecimal()
  max_discount: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
```

- [ ] **Step 2: Write the failing tests**

```ts
describe('bulk', () => {
  it('writes one row per named point', async () => {
    const result = await service.bulk(owner, { ...base, collection_point_ids: [a, b, c] });
    expect(result.created).toBe(3);
  });

  it('refuses the whole batch when one point does not exist', async () => {
    await expect(
      service.bulk(owner, { ...base, collection_point_ids: [a, missing] }),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuses an inactive grade rather than silently skipping it', async () => {
    await expect(
      service.bulk(owner, { ...base, product_grade_id: retiredGradeId }),
    ).rejects.toMatchObject({ response: { code: 'PRODUCT_GRADE_INACTIVE' } });
  });

  it('refuses a duplicate point id — a double write is a lie about the journal', async () => {
    await expect(
      service.bulk(owner, { ...base, collection_point_ids: [a, a] }),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_COLLECTION_POINT' } });
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `npm test -w backend -- grade-prices`
Expected: FAIL — `service.bulk is not a function`.

- [ ] **Step 4: Implement `bulk()`**

```ts
  /**
   * «Поставити всім» — one grade, one set of numbers, every named point, in ONE
   * TRANSACTION.
   *
   * THE TRANSACTION IS THE POINT, and spec `2026-09-07` §8.1 asked for it by
   * name when it removed `business_date`: «Carry this into §4.8's bulk route
   * when it is built — that route must be ONE transaction». A client-side loop
   * of N POSTs can fail half way, and a half-applied row renders on the sheet
   * as «різні · 145–150» — INDISTINGUISHABLE from prices the owner set
   * differently on purpose. The screen would be lying about the network.
   *
   * EVERY VALIDATION RUNS BEFORE THE FIRST INSERT, so a refusal costs nothing
   * and a partial write is not merely rolled back but never begun.
   */
  async bulk(actor: AuthenticatedUser, dto: BulkGradePriceDto): Promise<{ created: number }> {
    const unique = new Set(dto.collection_point_ids);
    if (unique.size !== dto.collection_point_ids.length) {
      throw new BadRequestException({
        message: 'The same collection point was named twice',
        code: 'DUPLICATE_COLLECTION_POINT',
      });
    }

    const grade = await this.grades.findOneRaw(dto.product_grade_id);
    if (!grade) throw new NotFoundException('Product grade not found');
    if (!grade.is_active) {
      throw new BadRequestException({
        message: 'That grade is inactive and cannot be priced',
        code: 'PRODUCT_GRADE_INACTIVE',
      });
    }

    for (const id of dto.collection_point_ids) {
      assertOwnsPoint(actor, id);
      const point = await this.points.findOneRaw(id);
      if (!point) throw new NotFoundException('Collection point not found');
    }

    return this.repo.manager.transaction(async (manager) => {
      const rows = dto.collection_point_ids.map((id) =>
        manager.create(GradePrice, {
          collection_point_id: id,
          product_grade_id: dto.product_grade_id,
          base_price: dto.base_price,
          max_markup: dto.max_markup,
          max_discount: dto.max_discount,
          created_by_user_id: actor.sub,
          reason: dto.reason ?? null,
        }),
      );
      await manager.save(rows);
      return { created: rows.length };
    });
  }
```

Route, owner-only:

```ts
  @Post('bulk')
  @Auth(UserRole.NetworkOwner)
  bulk(@CurrentUser() actor: AuthenticatedUser, @Body() dto: BulkGradePriceDto) {
    return this.prices.bulk(actor, dto);
  }
```

- [ ] **Step 5: Write the db-spec that proves atomicity**

Create `backend/src/grade-prices/grade-prices-bulk.db-spec.ts`. The assertion that matters: after a refused bulk, the journal holds NOTHING from it.

```ts
  it('writes nothing at all when one named point is missing', async () => {
    const before = await countRows(gradeId);
    await expect(
      request(app).post('/grade-prices').send(/* ... */),
    ).resolves.toMatchObject({ status: 404 });
    expect(await countRows(gradeId)).toBe(before);
  });

  it('writes every named point on success, and the sheet reads them as agreeing', async () => {
    await request(app).post('/grade-prices/bulk').send({ /* three points, 150.00 */ }).expect(201);
    const { body } = await request(app).get('/grade-prices/sheet').expect(200);
    const row = body.rows.find((r) => r.product_grade_id === gradeId);
    expect(new Set(Object.values(row.prices).map((c) => c.base_price))).toEqual(new Set(['150.00']));
  });
```

- [ ] **Step 6: Run everything**

```bash
npm test -w backend -- grade-prices
npm run lint -w backend
npm run test:db -w backend -- grade-prices
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/grade-prices
git commit -m "feat(prices): POST /grade-prices/bulk in one transaction (#89)"
```

---

### Task 3: The sheet on screen

**Files:**
- Create: `frontend/src/pages/prices/api/priceSheet.ts`
- Create: `frontend/src/pages/prices/ui/PriceSheet.tsx`
- Create: `frontend/src/pages/prices/lib/dayPrice.ts` + `dayPrice.test.ts`
- Modify: `frontend/src/pages/prices/ui/PricesPage.tsx`, `SetPriceDialog.tsx`, `model/gradePrice.ts`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json` (+ the uk source)
- Test: `frontend/src/pages/prices/ui/PricesPage.test.tsx`

**Interfaces:**
- Consumes: `GET /grade-prices/sheet`, `POST /grade-prices/bulk` from Tasks 1-2.
- Produces: `dayPrice(row, commonPointIds): { common: string } | { min: string; max: string } | null`

- [ ] **Step 1: Write the failing test for the «загальна» rule**

`frontend/src/pages/prices/lib/dayPrice.test.ts`:

```ts
describe('dayPrice', () => {
  it('is null when no reception point has a price', () => {
    expect(dayPrice({}, ['a', 'b'])).toBeNull();
  });

  it('reports a common price only when EVERY reception point agrees', () => {
    expect(dayPrice({ a: cell('150.00'), b: cell('150.00') }, ['a', 'b'])).toEqual({
      common: '150.00',
    });
  });

  it('is a RANGE when one point is missing, even though the known ones agree', () => {
    // A missing point is a disagreement: «поставити всім» has not been pressed
    // here, and showing a bare number would promise an agreement that the
    // gesture would change.
    expect(dayPrice({ a: cell('150.00') }, ['a', 'b'])).toEqual({ min: '150.00', max: '150.00' });
  });

  it('spans the known values when points disagree', () => {
    expect(dayPrice({ a: cell('145.00'), b: cell('150.00') }, ['a', 'b'])).toEqual({
      min: '145.00',
      max: '150.00',
    });
  });

  it('compares money as decimal strings, not as floats', () => {
    expect(dayPrice({ a: cell('9.90'), b: cell('100.00') }, ['a', 'b'])).toEqual({
      min: '9.90',
      max: '100.00',
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -w frontend -- dayPrice`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dayPrice`**

```ts
import { cmp } from '@/shared/lib/money';
import type { SheetCell } from '../model/gradePrice';

/**
 * «Ціна дня загальна» for one grade, computed over EXACTLY the set of points
 * «встановити всім» would write — the active RECEPTION points, warehouse
 * excluded (§4.8). Computing it over a different set would let the column
 * promise an agreement the button does not produce.
 *
 * A MISSING POINT IS A DISAGREEMENT, not a smaller sample: if four points read
 * 150 and the fifth has no price, this is a RANGE, because pressing the button
 * would change something. The mock's `dayPrice` makes the same call.
 *
 * Money is compared with `cmp` on the decimal strings. `Math.min` would route
 * every price through a binary float on its way to a screen that prints it.
 */
export function dayPrice(
  prices: Record<string, SheetCell>,
  commonPointIds: readonly string[],
): { common: string } | { min: string; max: string } | null {
  const known: string[] = [];
  let missing = 0;
  for (const id of commonPointIds) {
    const cell = prices[id];
    if (cell === undefined) missing += 1;
    else known.push(cell.base_price);
  }
  if (known.length === 0) return null;
  let min = known[0];
  let max = known[0];
  for (const v of known) {
    if (cmp(v, min) < 0) min = v;
    if (cmp(v, max) > 0) max = v;
  }
  if (missing === 0 && cmp(min, max) === 0) return { common: min };
  return { min, max };
}
```

- [ ] **Step 4: Run it**

Run: `npm test -w frontend -- dayPrice`
Expected: PASS.

- [ ] **Step 5: Build `PriceSheet.tsx` and rewrite `PricesPage`**

The grid: a sticky first column of `Товар · Сорт`, then «Ціна дня загальна», then one column per point. Warehouse columns carry a visible marker so a reader can see why the button skips them. Requirements:
- The grid scrolls horizontally inside its own `overflow-x-auto` container; the page body never scrolls sideways.
- A cell is a `<button>` for the owner and plain text plus a lock icon for the operator.
- An unpriced cell renders the existing muted dash, never «0».
- «встановити всім» is a header-row button per grade, owner only, ABSENT for an operator (§10.2 — «заблокована кнопка вчить шукати обхід, відсутня не вчить нічого»).

- [ ] **Step 6: Extend `SetPriceDialog` for the bulk write**

One dialog, two modes. When opened from «встановити всім» it takes `pointIds: string[]` and posts to `/bulk`; otherwise it posts to `/grade-prices` as today. The dialog must NAME the points it is about to write in its description, and say that the warehouse is not among them.

- [ ] **Step 7: Write the page tests**

```tsx
it('shows a bare number in «загальна» when every reception point agrees', async () => { /* ... */ });
it('shows a range when they do not', async () => { /* ... */ });
it('never offers «встановити всім» to an operator', async () => { /* ... */ });
it('gives an operator exactly one column', async () => { /* ... */ });
it('does not include the warehouse in the bulk request body', async () => { /* ... */ });
```

- [ ] **Step 8: Run everything**

```bash
npm test
npm run lint
```
Expected: PASS.

- [ ] **Step 9: Look at it in the browser**

```bash
docker compose up -d && npm run dev -w frontend
```
Sign in as `admin`/`admin`, open `/prices`. Confirm: Малина/Вищий сорт reads a bare `150.00` in «загальна» with Склад on `145.00`; Малина/1 сорт reads a range. Sign in as `oksana`/`operator` and confirm one locked column and no buttons.

- [ ] **Step 10: Commit and open the PR**

```bash
git add frontend/src/pages/prices frontend/src/shared/lib/i18n
git commit -m "feat(prices): the day-price sheet — grades by points (#89)"
git push -u origin feat/89-price-sheet
gh pr create --base feat/season-seed --title "feat(prices): «Ціна дня» as a sheet (#89)"
```
