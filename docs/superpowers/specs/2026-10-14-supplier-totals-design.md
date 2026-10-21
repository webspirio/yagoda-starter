# Suppliers list with totals — weight, main product, accrued (#230)

**Date:** 2026-10-14
**Source:** issue #230 («Постачальники | додати чисельність на загальну сторінку»), the mock's
suppliers table, and `26-rules-by-example.md` §11.4 «Топ здавальників». Every decision below
was settled with the owner in a grilling session on 2026-10-14.

**Position in the schema:** none. A new read endpoint, a module refactor, a shared-table
option. No table, column, index or migration changes.

**Amended 2026-10-19 (PR #253 review).** Three decisions below were reversed after review:
- **Unpaged.** `/supplier-totals` returns every active supplier in scope as one array. There is
  no `page`/`limit`, no «Показати ще», no «Показано N з M» and no client dedup. The sort keys
  are live sums, so an offset page drifted between clicks and could skip a supplier entirely.
  Ranking evaluates every aggregate for every supplier in scope anyway. §3.2's infinite query
  and §3.3's footer are superseded.
- **«Ім'я» shows «Прізвище Ім'я»**, matching the last-then-first sort.
- **Names sort by `COLLATE "uk-UA-x-icu"`**, on this list and on `/suppliers`, through one
  `suppliers/supplier-order.ts`. The cluster's default `c` provider orders by code point, which
  puts Є and І before А and Ґ after Я.

---

## 1. Goal

The suppliers page stops being a contact directory and becomes §11.4's «топ здавальників»:
each row shows how much the person has delivered and earned, and the list can be ranked by
it. Default order is weight, heaviest first.

### Columns

| Before | After |
|---|---|
| Ім'я · Телефон · Тип · Точка · Стан · Картка | Ім'я · **Загальна вага** · **Основний товар** · Тип · **Нараховано** · Картка |

- **Стан** goes because the page only ever lists active suppliers (it never sends
  `include_inactive`); the column always said «Активний».
- **Телефон** and **Точка** go as the issue asks. Search by phone keeps working. A
  same-named person at two points (§3.9) is told apart through «Картка»; a point hint or a
  point filter is a follow-up, not part of this change.
- The column keeps the existing label «Тип», not the mock's «Маркер».
- No «село» column (§11.4's 04.09.2026 amendment).

### Definitions

| Field | Definition |
|---|---|
| `kg_total` | `Σ intake_items.net_kg` over the supplier's live intakes (`voided_at IS NULL`), `0.00` when none. **All time** — no season exists in the system yet, and the number must equal the card's `kg_total` tile. |
| `accrued` | `Σ intakes.amount + Σ intake_top_ups.amount`, with exactly the void filters of the debt formula (`debtTermsSql.intakes` + `debtTermsSql.topUps`). Not the debt, not the balance — those stay per-point (§11.4). |
| `main_product_name` | The PRODUCT (not grade) with the greatest `Σ net_kg` over live lines. Tie → product name A→Z, then product id. `null` when the supplier has no live intake (rendered «—»). |

### Out of scope (follow-ups)

- Seasons, and the mock's «Сезон / День» switch.
- A point filter or point hint for the owner.
- Pagination on other screens.
- Merging one person's records across points («вага складена по всіх пунктах»): a supplier
  row is point-bound by the schema.

---

## 2. Backend

### 2.1 Refactor `suppliers` into commands and queries (first commit, no behaviour change)

`SuppliersService` (318 lines: `list`, `findOne`, `create`, `update` + five private helpers)
is split per `nest-module-conventions`:

```
suppliers/
  commands/create-supplier.command.ts   CreateSupplierCommand.create(actor, dto)
  commands/update-supplier.command.ts   UpdateSupplierCommand.update(actor, id, dto)
  queries/list-suppliers.query.ts       ListSuppliersQuery.list(actor, query)
  queries/find-supplier.query.ts        FindSupplierQuery.findOne(actor, id)
  supplier-search.ts                    applySupplierSearch(qb, alias, q)
  supplier-access.ts                    resolveWritePoint, visibleTo
  phone.ts, supplier.mapper.ts, supplier.entity.ts, dto/   unchanged
```

- `applySupplierSearch` is today's `q` handling lifted verbatim out of `list`: phone vs name
  lane, exact canonical match or digit-suffix match, `%`/`_`/`\` escaping with a named
  `ESCAPE`. It takes a TypeORM `SelectQueryBuilder` and the supplier alias, so
  `/supplier-totals` runs the very same code.
- The remaining private helpers (`assertPhoneFree`, `snapshot`, `tryCanonicalize`) move to
  whoever calls them; one shared by both commands goes into a small sibling file, not a new
  service.
- The controller injects the four classes; each handler delegates to exactly one.
- The module exports `TypeOrmModule` and `FindSupplierQuery` instead of `SuppliersService`.
  Its two outside callers — `crates/crate-balance.controller.ts` and
  `supplier-balance/supplier-balance.controller.ts`, both using `findOne` as an access
  check — switch to `FindSupplierQuery.findOne`.
- `suppliers.service.spec.ts` is split into one co-located spec per class with its cases
  unchanged; that unchanged suite is the proof the refactor moved code and changed nothing.

### 2.2 `GET /supplier-totals`

Lives in `supplier-balance/`, modelled on `GET /supplier-balances`: it owns the debt-term SQL
this endpoint reuses, and it already imports `SuppliersModule` (the reverse import would be a
cycle).

```
supplier-balance/
  supplier-totals.controller.ts
  queries/list-supplier-totals.query.ts
  dto/list-supplier-totals.query.ts
  supplier-totals.sql.ts               kgTotalSql(supplier), mainProductSql(supplier)
```

**Access.** `@Auth()`, both roles. Scope from `resolvePointFilter`: an operator sees their
point, the owner the network or one point via `collection_point_id`. Active suppliers only;
there is no `include_inactive` parameter.

**Request** — `PaginationQueryDto` (page, limit ≤ 100) plus:

| Param | Values | Default |
|---|---|---|
| `q` | as `/suppliers` | — |
| `collection_point_id` | uuid, ignored for an operator | — |
| `sort` | `weight` \| `amount` \| `name` | `weight` |
| `order` | `asc` \| `desc` | `desc` for `weight`/`amount`, `asc` for `name` |

Unknown `sort`/`order` → 400 (class-validator, no `code`).

**Response** — `Paginated<SupplierTotalsRowResponse>`:

```ts
interface SupplierTotalsRowResponse extends SupplierResponse {
  kg_total: string;              // "3603.99"
  accrued: string;               // "466180.00"
  main_product_name: string | null;
}
```

**Query.** A QueryBuilder on the `Supplier` repository, read with `getRawAndEntities()` so
the supplier half goes through the existing `toSupplierResponse` and only the three
aggregates come from `raw`.

- `kg_total` — `kgTotalSql('s.id')`. The expression is extracted from
  `SupplierBalanceBreakdownQuery` into `supplier-totals.sql.ts`, and the breakdown imports
  it back, so the list and the card cannot compute weight two ways.
- `accrued` — `debtTermsSql.intakes('s.id') + debtTermsSql.topUps('s.id')`. The terms are
  reused, not restated; the addition happens in SQL.
- `main_product_name` — `mainProductSql('s.id')`, a correlated subquery over live lines
  joined through `product_grades` to `products`, `GROUP BY p.id, p.name ORDER BY
  SUM(ii.net_kg) DESC, p.name ASC, p.id ASC LIMIT 1`.
- Order: the chosen key in the chosen direction, then always `last_name ASC, first_name
  ASC, s.id ASC`, so paging is stable. Paged with `offset()/limit()`, not `skip()/take()`.
- `total` — `getCount()` on the same builder before the aggregates are added; scope and
  search are applied by the same calls, so page and count cannot drift.

**Money.** Aggregates are strings end to end. `supplier-balance` is already in the money
`files` list of `backend/eslint.config.mjs`; no JS arithmetic is done on these values.

**Performance.** Every correlated term rides an existing index:
`IDX_intakes_supplier_created` (leading `supplier_id`), the unique `(intake_id,
item_order)` on `intake_items`, and `IDX_intake_top_ups_intake`. Sorting by an aggregate
evaluates it for every supplier in scope before paging; at the network's size (hundreds of
suppliers) that is acceptable and needs no index or cache.

---

## 3. Frontend

### 3.1 `shared/ui/data-table.tsx` — opt-in sorting

- `Column<Row>` gains `sortable?: boolean`.
- `DataTable` gains `sort?: { key: string; order: 'asc' | 'desc' }` and
  `onSortChange?: (key: string) => void`.
- A `sortable` header renders as a `<button>` with a lucide `ArrowDown`/`ArrowUp` on the
  active column; the active `th` carries `aria-sort="descending" | "ascending"`, other
  sortable ones `"none"`.
- The table only reports which column was clicked. Direction logic belongs to the page.
- Without these props the render is byte-for-byte what it is today, so the twelve other
  tables are untouched.
- `ListPage` forwards `sort` and `onSortChange` to `DataTable`.

### 3.2 `entities/supplier`

- `model/supplier.ts`: `SupplierTotalsRow = Supplier & { kg_total: string; accrued:
  string; main_product_name: string | null }`.
- `api/useSupplierTotals.ts`: `useSupplierTotalsInfiniteQuery({ search, sort, order })`,
  `limit: 100`, `getNextPageParam` = next page while `page * limit < total`.
- **Cache key** `[...queryKeys.supplierBalances, 'totals', { search, sort, order }]`. Under
  the `supplierBalances` prefix on purpose: every document write (intake, payout, top-up,
  their voids) already invalidates that prefix, so a new receipt refreshes the totals with
  no new invalidation call. Editing a supplier invalidates `suppliers` only, so
  `features/edit-supplier`'s two mutations also invalidate `supplierBalances` (a renamed
  or re-typed supplier must show up in the totals list).
- `useSuppliersQuery` stays as it is for its six other consumers.

### 3.3 `pages/suppliers`

- `model/supplierSort.ts`: pure `nextSort(current, clickedKey)`. Clicking the active column
  flips its direction; clicking another selects it in its default direction (weight and
  amount ↓, name ↑).
- Sort lives in the URL through `useUrlParam('sort')` and `useUrlParam('order')`, so «Назад»
  from a card restores it. An unknown value reads as the default. The default (weight ↓)
  writes `null`, so a clean URL means the default. Search stays component state.

| Column | Align | Sortable | Render |
|---|---|---|---|
| Ім'я | left | yes (`name`) | `first_name last_name` |
| Загальна вага | right | yes (`weight`) | `formatKg`, `tabular-nums` |
| Основний товар | left | no | name or «—», `hideBelow: 'sm'` |
| Тип | left | no | `suppliers.kindLabel.*`, `hideBelow: 'sm'` |
| Нараховано | right | yes (`amount`) | `formatUah`, `tabular-nums` |
| Картка | right | no | link, as today |

- Values keep kopiykas (`formatUah`), unlike the mock, so the figure matches the card.
- `footer`: «Показано N з M» and a «Показати ще» button. The button hides when there is no
  next page and shows a `Spinner` while `isFetchingNextPage`. The count stays visible when
  everything is loaded.
- The page drops `usePointOptionsQuery`; it no longer needs point names.
- Row click still opens `SupplierFormDialog`; the row is a full `Supplier`, so the dialog is
  unchanged.
- i18n (`uk.json` + `en.json`): add `suppliers.col.weight`, `suppliers.col.mainProduct`,
  `suppliers.col.accrued`, `suppliers.shownOf`, `suppliers.showMore`. Remove
  `suppliers.col.phone`, `suppliers.col.point`, `suppliers.col.status`, `suppliers.active`,
  `suppliers.inactive` only where nothing else uses them, and check the key-usage traps in
  `frontend/CLAUDE.md` first.
- Phone layout: no dedicated work beyond the two `hideBelow` columns.

---

## 4. Testing

### Backend

- Refactor: the existing `suppliers.service.spec.ts` cases, split per class, unchanged.
  New `supplier-search.spec.ts` for the `q` lanes. The two outside callers' specs mock
  `FindSupplierQuery`.
- `list-supplier-totals.query.spec.ts` (unit): scope per role, the `ORDER BY` for each
  `sort`×`order` with its tie-break tail, the per-key default direction.
- `dto/list-supplier-totals.query.spec.ts`: unknown `sort`/`order` refused.
- `supplier-totals.db-spec.ts` (real Postgres):
  - a voided intake does not count towards `kg_total` or `accrued`;
  - `accrued` includes live top-ups, and excludes a voided top-up and any top-up on a
    voided intake;
  - main product by product, not grade (300 kg «Малина 1» + 250 kg «Малина 2» against
    400 kg «Полуниця» → «Малина»), and a tie resolved by name;
  - a supplier with no intakes reads `0.00`, `0.00`, `null`;
  - sort order is stable across pages, with no row repeated or dropped;
  - an operator never sees another point's supplier;
  - `kg_total` equals `GET /suppliers/:id/balance`'s `kg_total` for the same supplier.

### Frontend (tests pin `en`)

- `data-table.test.tsx`: no `sort` → plain headers; with `sort` → a click calls
  `onSortChange(key)`; `aria-sort` on the active column.
- `supplierSort.test.ts`: `nextSort` flipping and per-key defaults.
- `useSupplierTotals.test.tsx`: `getNextPageParam`.
- `SuppliersPage.test.tsx`: the new columns with formatted numbers, «—» for no intakes,
  Phone/Point/Status gone, a click on «Accrued» writes `?sort=amount` and refetches,
  «Show more» loads page two and then disappears, the «N of M» count.

### Verification

Money/weight SQL and a real Postgres are involved, so the gate is **`npm run verify:full`**
(`db-checks`, `coverage`, `bundle` included), plus `tsc -b` for the frontend since Vitest does
not typecheck. Run once at the end of the task.

`/suppliers` is an eager route and the first-load budget has roughly 10 KiB raw of headroom.
If `bundle` goes red, the fix is to make `/suppliers` a lazy route, never to raise the
ceiling.

## 5. Delivery

One branch (`feat/230-supplier-totals`), one PR, four commits:

1. `refactor(suppliers)`: commands and queries, no behaviour change.
2. `feat(supplier-balance)`: `GET /supplier-totals`.
3. `feat(data-table)`: opt-in sorting.
4. `feat(suppliers)`: the page.
