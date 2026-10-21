# Inactive Suppliers (#228) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inactive suppliers stop looking deleted: «Ящики»'s switch lists only people who took crates, «Прийняти ящики» can pick any current holder (inactive included), «Постачальники» can list inactive suppliers, and an inactive supplier's card says so and offers no money action that would fail.

**Architecture:** Three backend read changes (no migration): `/crate-balances?include_zero` gains an issuance-exists predicate, `/crate-standing` gains `holders`, `/supplier-totals` gains `status`. The frontend consumes them in the crates page, the return dialog (new paged-to-completion `useCrateHoldersQuery`), the suppliers page (URL-held status selector) and the supplier card (badge, banner, hidden actions, back link that keeps the list's query string).

**Tech Stack:** NestJS + TypeORM raw SQL on PostgreSQL 16 (Jest unit `*.spec.ts`, Jest DB `*.db-spec.ts`); React + TanStack Query + react-router + react-i18next (Vitest, Testing Library, axe).

**Spec:** `docs/superpowers/specs/2026-10-21-inactive-suppliers-design.md`

## Global Constraints

- No migration, no new table or column.
- Every new user-facing string goes into BOTH `frontend/src/shared/lib/i18n/locales/en.json` and `uk.json`. Frontend tests run in English (`test-setup` pins `en`).
- Existing badge styling: `<Badge variant="outline">` (`@/shared/ui/badge`).
- `include_zero=false` behaviour of `/crate-balances` is unchanged; the response shape is unchanged.
- `/supplier-totals` stays unpaged; search, the three sorts and operator scoping are unchanged. `status` defaults to `active`; any other value than `active|inactive|all` is a 400.
- An absent or unknown `?status=` in the suppliers page URL reads as `active`; `active` is written to the URL as nothing (no param).
- The issue dialog stays active-only; `SupplierPicker` and «Борги» are not touched.
- Work on the branch `feat/228-inactive-suppliers` in the main checkout (already created), not a worktree.
- Run `npm run verify:full` once at the end (Task 8), not per commit. Its rows that need a daemon or a database may be SKIPPED locally — say which, never «all green».

## Review Focus

1. **The holders walk must terminate.** A page that comes back empty before `total` is reached (rows returned while pages were being walked), `total = 0`, and `total` exactly 100 (one page, no second request) — Task 4 pins all three.
2. **A card opened from anywhere but the list** (deep link, «Ящики», «Борги», browser refresh) has no router state; the back link must fall back to plain `/suppliers`. Router state that is not a string starting with `?` (e.g. `{ from: '//evil.example' }`) is ignored — Task 7.
3. **Inactive supplier who IS owed money:** «Виплатити N ₴» stays hidden even with `debt > 0` — Task 7.
4. **Junk `?status=archived`** reads as Активні and sends `status: 'active'`, not a 400 — Task 6.
5. **Owner with no point chosen** must not fire an unscoped `/crate-balances` walk from the return dialog — Task 5 (the dialog's hook is disabled while closed, and the dialog is only mounted once a point is chosen).

---

### Task 1: `/crate-balances?include_zero=true` lists only people who took crates

**Files:**
- Modify: `backend/src/crates/crate-balances.service.ts` (the `base` SQL)
- Modify: `backend/src/crates/dto/list-crate-balances.query.ts` (doc comment on `include_zero`)
- Test: `backend/src/crates/crate-balances.db-spec.ts`

**Interfaces:**
- Produces: unchanged `CrateBalancesService.list(actor, query): Promise<Paginated<CrateBalanceRowResponse>>`; with `include_zero=true` the row set is «suppliers at the point with ≥1 non-voided `crate_issuances` row in a shift at that point».

- [ ] **Step 1: Write the failing tests**

Add fixtures in `beforeAll` (after the existing ones): `never = await supplier(pointA, 'Нічого')` (no issuance); `goneQuiet = await supplier(pointA, 'НеактивнийТримає')` with `issue(shiftA, goneQuiet, 7, 'deposit', '100.00')`; `goneSettled = await supplier(pointA, 'НеактивнийПовернув')` with an issuance of 3 fully given back via `giveBack`. Deactivate both with `UPDATE suppliers SET is_active = false WHERE id = ANY($1)`. Then:

```ts
it('leaves out a supplier who never took a crate, even with include_zero', async () => {
  expect(await rowFor(never, { include_zero: true })).toBeUndefined();
});

it('leaves out a supplier whose only issuance was voided, even with include_zero', async () => {
  expect(await rowFor(voided, { include_zero: true })).toBeUndefined();
});

it('lists an INACTIVE holder both ways, flagged inactive', async () => {
  for (const include_zero of [false, true]) {
    const row = await rowFor(goneQuiet, { include_zero });
    expect(row).toMatchObject({ outstanding_units: 7, is_active: false });
  }
});

it('lists an inactive supplier who returned everything only with include_zero', async () => {
  expect(await rowFor(goneSettled)).toBeUndefined();
  expect(await rowFor(goneSettled, { include_zero: true })).toMatchObject({ outstanding_units: 0, is_active: false });
});
```

- [ ] **Step 2: Run to verify the first two fail**

Run: `npm run test:db -w backend -- crate-balances.db-spec`
Expected: FAIL on «never took a crate» and «only issuance was voided» (both currently listed at 0); the inactive tests pass already.

- [ ] **Step 3: Implement**

In `base`, when `query.include_zero` is true, add a predicate that the supplier has a non-voided issuance through a shift matching `pointPredicate` (reuse the same `s.collection_point_id = $N` placeholder; an `EXISTS` subquery or a join is the builder's choice per spec §9). Combine it with the existing `WHERE sup.collection_point_id = …` correctly when `pointId` is absent (owner, no filter). Rewrite the `include_zero` doc comment in `list-crate-balances.query.ts` to the spec §4.1 meaning («everyone who ever took crates here, including those who brought all of them back; never someone who never took any»).

- [ ] **Step 4: Run to verify all pass**

Run: `npm run test:db -w backend -- crate-balances.db-spec`
Expected: PASS, including the existing «agrees with GET /suppliers/:id/crate-balance» test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/crates/crate-balances.service.ts backend/src/crates/dto/list-crate-balances.query.ts backend/src/crates/crate-balances.db-spec.ts
git commit -m "fix(crates): include_zero lists only people who took crates (#228)"
```

---

### Task 2: `/crate-standing` reports `holders`

**Files:**
- Modify: `backend/src/crates/crate-standing.service.ts` (`CrateStandingResponse`, SQL)
- Test: `backend/src/crates/crate-standing.db-spec.ts`

**Interfaces:**
- Produces: `CrateStandingResponse.holders: number` — distinct suppliers with an open tranche at the point, from the same `tranche` CTE (`openTranchesSql`) as `in_field`. Integer (`::int`).

- [ ] **Step 1: Write the failing test**

In the existing `it('agrees with the sum of /crate-balances for the same point', …)` add `expect(got.holders).toBe(page.total);`. Add to the «voided documents change nothing» neighbourhood nothing — `toEqual(before)` already covers `holders` once it exists. Add one test outside the step-by-step block: a point with one supplier holding 5 and one who returned everything → `holders === 1`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:db -w backend -- crate-standing.db-spec`
Expected: FAIL — `holders` is `undefined`.

- [ ] **Step 3: Implement**

Add `holders` to `CrateStandingResponse` (doc: «People holding at least one crate here — the row count of `/crate-balances` without `include_zero`»), select `(SELECT COUNT(DISTINCT supplier_id)::int FROM tranche) AS holders` in `figures`, and pass `f.holders` through the outer `SELECT`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:db -w backend -- crate-standing.db-spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/crates/crate-standing.service.ts backend/src/crates/crate-standing.db-spec.ts
git commit -m "feat(crates): crate standing counts holders (#228)"
```

---

### Task 3: `/supplier-totals?status=active|inactive|all`

**Files:**
- Modify: `backend/src/supplier-balance/dto/list-supplier-totals.query.ts`
- Modify: `backend/src/supplier-balance/queries/list-supplier-totals.query.ts:45`
- Modify: `backend/CLAUDE.md` (the `supplier-balance/` line: «every active supplier in scope» → «every supplier in scope matching `status`, active by default»)
- Test: `backend/src/supplier-balance/dto/list-supplier-totals.query.spec.ts`, `backend/src/supplier-balance/queries/list-supplier-totals.query.spec.ts`, `backend/src/supplier-balance/supplier-totals.db-spec.ts`

**Interfaces:**
- Produces: `export type SupplierTotalsStatus = 'active' | 'inactive' | 'all'` exported from the DTO file; `ListSupplierTotalsQueryDto.status: SupplierTotalsStatus = 'active'`.

- [ ] **Step 1: Write the failing tests**

DTO spec:

```ts
it('defaults status to active and accepts all three', () => {
  expect(parse({}).status).toBe('active');
  for (const status of ['active', 'inactive', 'all']) expect(errors({ status })).toHaveLength(0);
});
it('refuses an unknown status', () => {
  expect(errors({ status: 'archived' })).not.toHaveLength(0);
});
```

Query unit spec: replace `it('lists active suppliers only', …)` with one test per status asserting the `where` predicate — `'s.is_active = true'` for `active` (and for the DTO default), `'s.is_active = false'` for `inactive`, and no `is_active` predicate at all for `all`.

DB spec (its fixtures already hold an inactive «Гнатюк»): `status: 'inactive'` returns exactly Гнатюк; `status: 'all'` returns the active set plus Гнатюк, sorted by name with Гнатюк in its alphabetical place; each row carries `is_active` matching the database.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w backend -- list-supplier-totals` then `npm run test:db -w backend -- supplier-totals.db-spec`
Expected: FAIL — `status` is not whitelisted (400 / `forbidNonWhitelisted`) and the predicate is hard-coded.

- [ ] **Step 3: Implement**

`@IsOptional() @IsIn(SUPPLIER_TOTALS_STATUSES) status: SupplierTotalsStatus = 'active';` and rewrite the DTO doc comment's «Active suppliers only» sentence. In the query, map status to its predicate (`active` → `s.is_active = true`, `inactive` → `s.is_active = false`, `all` → none) instead of the fixed `.where('s.is_active = true')`; the point filter and search keep working whether or not a status predicate was added (use `andWhere` consistently). Update the backend/CLAUDE.md line named above.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w backend -- list-supplier-totals` then `npm run test:db -w backend -- supplier-totals.db-spec`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/supplier-balance backend/CLAUDE.md
git commit -m "feat(suppliers): supplier totals filter by status (#228)"
```

---

### Task 4: Frontend crate entity — `holders` and `useCrateHoldersQuery`; the table summary reads `holders`

**Files:**
- Modify: `frontend/src/entities/crate/model/crate.ts` (`CrateStanding.holders: number`)
- Modify: `frontend/src/entities/crate/api/useCrates.ts` (new hook)
- Modify: `frontend/src/entities/crate/index.ts` (export it)
- Modify: `frontend/src/pages/crates/ui/InFieldTable.tsx`, `frontend/src/pages/crates/ui/CratesPage.tsx`
- Test: `frontend/src/entities/crate/api/useCrates.test.tsx`, `frontend/src/pages/crates/ui/InFieldTable.test.tsx`, `frontend/src/pages/crates/ui/CratesPage.test.tsx` (add `holders` to its standing fixture)

**Interfaces:**
- Produces: `useCrateHoldersQuery(pointId: string | null, enabled: boolean): UseQueryResult<CrateBalanceRow[]>` — every current holder at the point (`include_zero` NOT sent), walking `/crate-balances` with `limit: 100`, `page: 1, 2, …` until it has `total` rows or a page comes back empty. Query key under `queryKeys.crateBalances` (e.g. `[...queryKeys.crateBalances, 'holders', pointId]`) so every crate write's existing invalidation refreshes it. `collection_point_id` sent only when `pointId` is non-null.
- Produces: `InFieldTable` props become `{ rows, total, standing, truncated, renderDocs }` — the summary's `count` reads `standing.holders`; the truncation note reads `total` (the list's row count).

- [ ] **Step 1: Write the failing tests**

`useCrates.test.tsx`, `describe('useCrateHoldersQuery')`:
- total 150: first call returns 100 rows `total: 150`, second returns 50 → result has 150 rows; calls carry `page: 1` then `page: 2`, both `limit: 100`, neither carries `include_zero`.
- total exactly 100 in one page → exactly one request.
- total 0 → `[]`, one request.
- first page 100 rows `total: 150`, second page `[]` → resolves with 100 rows, no third request.
- `enabled: false` → no request.

`InFieldTable.test.tsx`: with `standing.holders = 2`, `total = 5` and five rows (three at 0 units), the summary reads «· 2 people» (match the English plural of `crates.inField.summary`), not 5.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w frontend -- useCrates InFieldTable`
Expected: FAIL — the hook is not exported; the summary shows 5.

- [ ] **Step 3: Implement**

The hook, the `holders` field on `CrateStanding` (doc: «people holding ≥1 crate — not the list's row count, which `include_zero` inflates»), the `InFieldTable` prop rename (`holders` → `total`) with `standing.holders` in the summary, and `CratesPage` passing `total={balances.data?.total ?? rows.length}`. Add `holders` to the standing fixtures in both page tests.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w frontend -- useCrates InFieldTable CratesPage`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/crate frontend/src/pages/crates
git commit -m "feat(crates): holders on the standing; paged-to-completion holders query (#228)"
```

---

### Task 5: «Прийняти ящики» lists current holders, inactive included

**Files:**
- Modify: `frontend/src/features/return-crates/ui/ReturnCratesDialog.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`, `uk.json` (`crates.return.noHolders`)
- Test: `frontend/src/features/return-crates/ui/ReturnCratesDialog.test.tsx`

**Interfaces:**
- Consumes: `useCrateHoldersQuery(pointId, enabled)` and `CrateBalanceRow` from `@/entities/crate` (Task 4); `supplierName` from `@/entities/supplier`.

- [ ] **Step 1: Write the failing tests**

Replace the `@/entities/supplier` `useSuppliersQuery` mock with a `@/entities/crate` mock of `useCrateHoldersQuery` (keep `supplierName` real via `importOriginal`). Tests:
- an active holder's option reads «Ivan Koval — 12»; an inactive holder's option reads «Petro Hnatiuk — 7 · deactivated» (EN value of `crates.inField.inactive`) and is selectable (choosing it sends its `supplier_id` on submit);
- the hook is called with `(pointId ?? null, open)` — `(null, true)` for an operator, `('p1', true)` for an owner;
- with `data: []`, the dialog shows the `crates.return.noHolders` text (EN «Nobody at this point is holding crates.») and the submit button is disabled;
- the existing tests keep passing with holders in place of suppliers.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w frontend -- ReturnCratesDialog`
Expected: FAIL — the dialog still reads `useSuppliersQuery`.

- [ ] **Step 3: Implement**

Swap the source to `useCrateHoldersQuery(pointId ?? null, open)`; option value `row.supplier_id`, label `` `${supplierName(row)} — ${row.outstanding_units}` `` plus `` ` · ${t('crates.inField.inactive')}` `` when `!row.is_active`. Add `crates.return.noHolders` — EN «Nobody at this point is holding crates.», UK «Ні в кого на цій точці немає ящиків.» — and render it in place of an empty select.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w frontend -- ReturnCratesDialog`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/return-crates frontend/src/shared/lib/i18n/locales
git commit -m "fix(crates): return dialog lists every current holder, inactive too (#228)"
```

---

### Task 6: «Постачальники» — Активні / Неактивні / Усі

**Files:**
- Modify: `frontend/src/entities/supplier/model/supplier.ts` (`SupplierTotalsStatus`), `frontend/src/entities/supplier/index.ts`
- Modify: `frontend/src/entities/supplier/api/useSupplierTotals.ts`
- Create: `frontend/src/pages/suppliers/model/supplierStatus.ts`
- Modify: `frontend/src/pages/suppliers/ui/SuppliersPage.tsx`
- Modify: `en.json`, `uk.json` (`suppliers.status.*`, `suppliers.inactive`, `suppliers.emptyInactive.*`)
- Test: `frontend/src/entities/supplier/api/useSupplierTotals.test.tsx`, `frontend/src/pages/suppliers/model/supplierStatus.test.ts`, `frontend/src/pages/suppliers/ui/SuppliersPage.test.tsx`

**Interfaces:**
- Produces: `type SupplierTotalsStatus = 'active' | 'inactive' | 'all'` (entity); `useSupplierTotalsQuery({ search, sort, order, status })` — sends `status` always, and `status` is part of the query key.
- Produces (page model): `readStatus(param: string | null): SupplierTotalsStatus` (unknown → `'active'`); `statusToUrl(s: SupplierTotalsStatus): string | null` (`'active'` → `null`).
- Produces: navigation from the list to a card passes router state `{ from: location.search }` (both the name `Link` and `onRowClick`'s `navigate`) — Task 7 reads it.

- [ ] **Step 1: Write the failing tests**

- `supplierStatus.test.ts`: `readStatus(null)`, `readStatus('archived')` → `'active'`; `'inactive'`, `'all'` round-trip; `statusToUrl('active') === null`.
- `useSupplierTotals.test.tsx`: params include `status: 'inactive'`; changing status is a new request.
- `SuppliersPage.test.tsx`:
  - default render asks `queryMock` with `status: 'active'` and the segmented control has «Active» checked;
  - clicking «Inactive» puts `?status=inactive` in the URL (read `router.state.location.search`) and asks with `status: 'inactive'`, keeping the current sort;
  - `/suppliers?status=all&sort=amount` restores both;
  - `/suppliers?status=archived` reads as Active;
  - a row with `is_active: false` shows the «Inactive» badge next to its name; an active row shows none;
  - under `status=inactive` with no rows, the empty state reads the `suppliers.emptyInactive.title` text, not «No suppliers yet»;
  - clicking a row navigates with `state.from` equal to the list's `search` (assert via `router.state.location.state`).

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w frontend -- supplierStatus useSupplierTotals SuppliersPage`
Expected: FAIL.

- [ ] **Step 3: Implement**

Hook and type; `supplierStatus.ts`; in the page, `const [statusParam] = useUrlParam('status')`, `status = readStatus(statusParam)`, a `<Segmented>` (`fit="content"`, `label={t('suppliers.status.label')}`) beside the search in the `toolbar`, writing through `patchUrl({ status: statusToUrl(next) })`; `<Badge variant="outline">` after the name link when `!s.is_active`; the empty state switches on `status === 'inactive'`; pass `state: { from: location.search }` on both navigations. Strings:

| key | en | uk |
|---|---|---|
| `suppliers.status.label` | Show | Показати |
| `suppliers.status.active` | Active | Активні |
| `suppliers.status.inactive` | Inactive | Неактивні |
| `suppliers.status.all` | All | Усі |
| `suppliers.inactive` | Inactive | Неактивний |
| `suppliers.emptyInactive.title` | No deactivated suppliers | Деактивованих постачальників немає |
| `suppliers.emptyInactive.hint` | A supplier switched off in the edit dialog shows up here. | Тут з'являються постачальники, яких вимкнули в діалозі редагування. |

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w frontend -- supplierStatus useSupplierTotals SuppliersPage`
Expected: PASS, including the axe check.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/entities/supplier frontend/src/pages/suppliers frontend/src/shared/lib/i18n/locales
git commit -m "feat(suppliers): list inactive suppliers — Active / Inactive / All (#228)"
```

---

### Task 7: Supplier card — badge, banner, no failing money actions, back link keeps the view

**Files:**
- Modify: `frontend/src/pages/supplier-card/ui/SupplierCardPage.tsx`
- Modify: `frontend/src/pages/supplier-card/ui/SupplierTimeline.tsx` (`onAddTopUp` becomes optional)
- Modify: `en.json`, `uk.json` (`supplierCard.inactive`, `supplierCard.inactiveBanner`)
- Test: `frontend/src/pages/supplier-card/ui/SupplierCardPage.test.tsx`

**Interfaces:**
- Consumes: router state `{ from: string }` set by Task 6.
- Produces: `SupplierTimeline`'s `onAddTopUp?: (intake: Intake) => void` — when absent, no «add top-up» button renders.

- [ ] **Step 1: Write the failing tests**

Extend `renderCard` with `state?: unknown` (passed as `initialEntries: [{ pathname, state }]`). With `supplierMock` returning `{ ...SUPPLIER, is_active: false }`:
- the header shows the «Inactive» badge and the banner text (EN «This supplier is deactivated — receipts, payouts and top-ups are unavailable. Activate them first to move money.»);
- with `debt > 0` (settlement fixture) there is no «Pay out» button;
- as the owner, with a live receipt in the timeline, there is no add-top-up button;
- Void on an owner-visible payout row is still offered.
With an active supplier: no badge, no banner, Pay out and add top-up behave as today (existing tests).
Back link: `state: { from: '?status=inactive&sort=name' }` → link `href` is `/suppliers?status=inactive&sort=name`; no state → `/suppliers`; `state: { from: '//evil.example' }` and `state: { from: 42 }` → `/suppliers`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w frontend -- SupplierCardPage`
Expected: FAIL.

- [ ] **Step 3: Implement**

`const inactive = !s.is_active`; badge in the `PageHeader` title area; banner directly under the header (a muted bordered paragraph like the page's other notices — builder's call, with `role="status"`); `actions` only when `!inactive && cmp(debt, '0') === 1`; `onAddTopUp={inactive ? undefined : openTopUp}`. Back link: read `useLocation().state`, accept `from` only when `typeof from === 'string' && from.startsWith('?')`, and use `/suppliers${from}` for the main back link and the error-state back links alike. Strings:

| key | en | uk |
|---|---|---|
| `supplierCard.inactive` | Inactive | Неактивний |
| `supplierCard.inactiveBanner` | This supplier is deactivated — receipts, payouts and top-ups are unavailable. Activate them first to move money. | Постачальника деактивовано — прийом, виплати й доплати недоступні. Щоб провести гроші, спершу активуйте. |

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w frontend -- SupplierCardPage SupplierTimeline`
Expected: PASS, including the axe check.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/supplier-card frontend/src/shared/lib/i18n/locales
git commit -m "feat(supplier-card): say a supplier is inactive and offer no failing money action (#228)"
```

---

### Task 8: Verify the branch and record the follow-ups

**Files:**
- Already modified, uncommitted: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`, the spec, this plan

- [ ] **Step 1: Typecheck the frontend** (Vitest does not typecheck)

Run: `npm run build -w frontend`
Expected: exit 0.

- [ ] **Step 2: Run the full tier** (DB-backed reads changed)

Run: `npm run verify:full`
Expected: the verdict line reports no FAILED row. Quote it, and name every SKIPPED row.

- [ ] **Step 3: Commit the docs**

```bash
git add docs/superpowers/specs/2026-10-21-inactive-suppliers-design.md docs/superpowers/plans/2026-10-21-inactive-suppliers.md docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "docs: #228 inactive suppliers spec, plan and follow-ups"
```
