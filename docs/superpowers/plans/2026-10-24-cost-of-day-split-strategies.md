# Cost of Day Split Strategies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let «Собівартість дня» split the day's basket (недостача + витрати) three ways — by weight (today), by purchase value, or own-shortfall + % of expenses — chosen by a view-only switch.

**Architecture:** The backend takes an optional `split` query param on both cost-of-day endpoints and changes only the *weights* of the two existing `allocate` splits inside `CostOfDayService.buildProducts`; the network service passes `split` through to each point. The frontend keeps the choice in `?split=` with a remembered per-browser fallback, sends it with both queries, and prints per-row per-kg cells from new per-product fields.

**Tech Stack:** NestJS + TypeORM + Jest (backend), React + TanStack Query + react-i18next + Vitest (frontend), `backend/src/common/money.ts` for every money operation.

**Spec:** `docs/superpowers/specs/2026-10-24-cost-of-day-split-strategies-design.md`

## Global Constraints

- Split keys, exactly: `weight` (default) | `value` | `own`. Query param name `split` on API and page URL.
- uk labels: «По вазі», «По сумі закупки», «Своя недостача + % витрат»; switch label «Розподіл кошика».
- Base for `value`/`own` = product `accrued` (нараховано incl. доплати, gross), complete products only.
- Every money/weight operation goes through `money.ts`; `backend/src/day-costs/**` is in the eslint money scope (no `*`, `/`, `Number()`, `toFixed`, …).
- Percentages are printed with «≈» and never used as an operand; checks run through hryvnias.
- Units next to every number in every formula (₴, кг, ₴/кг, %).
- Under `weight` every existing response field is byte-identical to today.
- Nothing is stored: no migration, no entity change.
- Money code ⇒ final proof is `npm run verify:full` (CLAUDE.md rule 1); quote verdict lines, name skipped rows.

## Review Focus

1. **Zero-accrued day under `value`/`own`** (all weighed lines at price 0) — must fall back to `weight` with `split_applied: 'weight'`, not split evenly. Test in Task 1.
2. **Partially weighed product under `value`/`own`** — must collect no share and keep `null` per-kg cells, exactly as under `weight`. Test in Task 1.
3. **Unknown `?split=` in the page URL or a corrupt stored preference** — page must fall back (URL → preference → `weight`), never send an invalid value (the API would 400). Test in Task 3.
4. **«Усі точки» with one point on a zero-accrued day** — network `checks.total_ok` must stay true. Test in Task 2.
5. **Switching strategy on an open shift with a half-typed expense** — the expenses strip draft must survive (it is keyed on `shift_id`, which does not change). Test in Task 4.

---

### Task 1: Backend — strategies in `CostOfDayService`

**Files:**
- Modify: `backend/src/common/money.ts` (add `percent`)
- Test: `backend/src/common/money.spec.ts`
- Create: `backend/src/day-costs/cost-split.ts`
- Create: `backend/src/day-costs/dto/cost-of-day.query.ts`
- Modify: `backend/src/day-costs/cost-of-day.service.ts`
- Modify: `backend/src/day-costs/cost-of-day.controller.ts`
- Test: `backend/src/day-costs/cost-of-day.service.spec.ts`

**Interfaces:**
- Produces:
  - `money.ts`: `export function percent(part: string, whole: string): string` — `div(mul(part, '100.00'), whole)`, scale 2, half-up; throws on zero `whole` like `div`.
  - `cost-split.ts`: `export const COST_SPLITS = ['weight', 'value', 'own'] as const; export type CostSplit = (typeof COST_SPLITS)[number];`
  - `CostOfDayQueryDto { split?: CostSplit }` (`@IsOptional() @IsIn(COST_SPLITS)`).
  - `CostOfDayService.forShift(actor, shiftId, split: CostSplit = 'weight')`, `forShiftIn(manager, shiftId, split: CostSplit = 'weight')`.
  - `CostOfDayResponse` adds: `split: CostSplit; split_applied: CostSplit; expenses_pct: string | null; shortfall_pct: string | null`.
  - `CostOfDayProduct` adds: `shortfall_per_kg: string | null; expenses_per_kg: string | null`.

- [ ] **Step 1: Write the failing `percent` test** in `money.spec.ts`: `percent('3800.00','131900.00') === '2.88'`, `percent('1660.00','131900.00') === '1.26'`, `percent('1900.00','113640.80') === '1.67'`, throws on `percent('1.00','0.00')`.

- [ ] **Step 2: Write the failing service tests** in a new `describe('§8.5 split strategies (spec 2026-10-24)')` using the existing `build()` / `DAY` fixture (Малина 128 000,00 / 800 / 790, Ожина 3 900,00 / 65 / 64, expenses 3 800,00). Expected figures (computed with the real `allocate`/`div`):

| split | product | shortfall_share | expenses_share | shortfall_per_kg | expenses_per_kg | price_cost | full_cost |
|---|---|---|---|---|---|---|---|
| weight | Малина | 1535.60 | 3515.22 | 1.94 | 4.45 | 166.39 | 131450.82 |
| weight | Ожина | 124.40 | 284.78 | 1.94 | 4.45 | 66.39 | 4249.18 |
| value | Малина | 1610.92 | 3687.64 | 2.04 | 4.67 | 166.71 | 131698.56 |
| value | Ожина | 49.08 | 112.36 | 0.77 | 1.76 | 62.53 | 4001.44 |
| own | Малина | 1600.00 | 3687.64 | 2.03 | 4.67 | 166.70 | 131687.64 |
| own | Ожина | 60.00 | 112.36 | 0.94 | 1.76 | 62.70 | 4012.36 |

  Tests:
  - `it.each(['weight','value','own'])('%s matches the pinned table')` — the six rows above.
  - `it('keeps the day invariant across strategies')` — `full_cost`, `price_cost_avg`, `basket`, `total_check`, `checks`, `per_kg`, `shortfall_per_kg`, `expenses_per_kg` equal across all three.
  - `it('weight is today’s response plus the new fields')` — `forShift(owner,'s-1')` (no split) deep-equals `forShift(owner,'s-1','weight')`; `split === split_applied === 'weight'`; `expenses_pct === null && shortfall_pct === null`; each product's `shortfall_per_kg`/`expenses_per_kg` equal the day's halves.
  - `it('prints the percentages')` — `value`: `expenses_pct '2.88'`, `shortfall_pct '1.26'`; `own`: `expenses_pct '2.88'`, `shortfall_pct null`.
  - `it.each(['value','own'])('%s: row identity price_was + shortfall_per_kg + expenses_per_kg = price_cost')`.
  - `it.each(['value','own'])('%s: Σ shares = day totals, shares_ok true')`.
  - `it.each(['value','own'])('%s: a partially weighed product collects nothing')` — reuse the §3.15 partial fixture already in the file: its `shortfall_share`, `expenses_share`, `shortfall_per_kg`, `expenses_per_kg`, `price_cost`, `full_cost` are `null`.
  - `it.each(['value','own'])('%s: nothing weighed dashes everything')` — `svcWithNoReweigh`: per-product per-kg fields `null`, `expenses_pct null`.
  - `it.each(['value','own'])('%s: zero-accrued day falls back to weight')` — fixture with both grades `intake_amount '0.00'` and weights as `DAY`: response deep-equals the `weight` response except `split === <requested>`; `split_applied === 'weight'`; percentages `null`.
  - Extend the existing property test (`holds every printed identity for any day`) to draw `split` from `fc.constantFrom('weight','value','own')` and keep every identity it already asserts.

- [ ] **Step 3: Run** `npm test -w backend -- money.spec cost-of-day.service` — Expected: FAIL (`percent` not exported; `split` fields undefined).

- [ ] **Step 4: Implement.** `percent` in `money.ts`. In `CostOfDayService`:
  - `forShift`/`forShiftIn` take `split`, pass it to `buildProducts`.
  - `weighedAccrued = sum(complete rows' accrued)`; `applied = split !== 'weight' && isZero(weighedAccrued) ? 'weight' : split`.
  - `buildProducts(rows, perKg, shortfallAmount, expenses, applied, shortfallPerKg, expensesPerKg)`: weights for the expenses split = `reweigh_net_kg` under `weight`, `accrued` otherwise; shortfall shares = `allocate(shortfallAmount, kg)` / `allocate(shortfallAmount, accrued)` / own `r.shortfall` for `weight`/`value`/`own`.
  - Per-product per-kg: under `applied === 'weight'` the day halves (only for complete products, `null` otherwise); else `div(share, reweigh_net_kg)` each. `price_cost = add(price_was, add(shortfall_per_kg, expenses_per_kg))` in all cases (under `weight` this equals today's `add(priceWas, perKg)` because `perKg` is defined as the sum of the halves).
  - `expenses_pct = applied === 'weight' || perKg === null ? null : percent(expenses, weighedAccrued)`; `shortfall_pct` the same but only for `applied === 'value'`.
  - Update the JSDoc on the changed/new fields in the file's own style (cite spec 2026-10-24 §2).
  - Controller: `@Query() query: CostOfDayQueryDto` → `forShift(actor, shiftId, query.split ?? 'weight')`.

- [ ] **Step 5: Run** `npm test -w backend -- money.spec cost-of-day.service` — Expected: PASS. Then `npm run lint -w backend` — Expected: 0 problems.

- [ ] **Step 6: Commit**

```bash
git add backend/src/common/money.ts backend/src/common/money.spec.ts backend/src/day-costs
git commit -m "feat(cost-of-day): розподіл кошика по вазі, по сумі закупки, своя недостача + % витрат"
```

### Task 2: Backend — network passthrough and real-Postgres proof

**Files:**
- Modify: `backend/src/day-costs/dto/network-cost-of-day.query.ts`
- Modify: `backend/src/day-costs/network-cost-of-day.controller.ts`
- Modify: `backend/src/day-costs/network-cost-of-day.service.ts`
- Test: `backend/src/day-costs/network-cost-of-day.service.spec.ts`, `backend/src/day-costs/cost-of-day.db-spec.ts`, `backend/src/day-costs/network-cost-of-day.db-spec.ts`

**Interfaces:**
- Consumes: `CostSplit`, `COST_SPLITS`, `forShiftIn(manager, shiftId, split)` from Task 1.
- Produces: `NetworkCostOfDayService.forDate(actor, date, split: CostSplit = 'weight')`; `NetworkCostOfDayResponse` adds `split: CostSplit`. `NetworkCostOfDayQueryDto` adds `split?: CostSplit` (`@IsOptional() @IsIn(COST_SPLITS)`).

- [ ] **Step 1: Write failing tests.**
  - Unit (`network-cost-of-day.service.spec.ts`): `forDate(owner, date, 'value')` calls `forShiftIn` with `'value'` for every shift; response `split === 'value'`.
  - Unit: `it('keeps total_ok on a point whose weighed accrued is zero, under value')` — one point with zero-price weighed lines and non-zero expenses: `checks.total_ok === true`, `points_ok === true`.
  - DB (`cost-of-day.db-spec.ts`): seed one shift with two products of different prices, reweighed in full, plus one expense; `GET /shifts/:id/cost-of-day?split=value` and `?split=own` return Σ `expenses_share` = `expenses_amount`, `checks.shares_ok && checks.total_ok`, and the day `full_cost` equal to the `?split=weight` response's; `?split=bogus` → 400.
  - DB (`network-cost-of-day.db-spec.ts`): `GET /reports/cost-of-day?date=…&split=own` → 200, `split === 'own'`, `checks.total_ok === true`; `&split=bogus` → 400.

- [ ] **Step 2: Run** `npm test -w backend -- network-cost-of-day.service` — Expected: FAIL.

- [ ] **Step 3: Implement** the DTO field, controller passthrough `query.split ?? 'weight'`, `forDate`/`forDateIn` threading `split` into `forShiftIn`, and `split` echoed in the response. No new arithmetic in the network service.

- [ ] **Step 4: Run** `npm test -w backend -- network-cost-of-day.service` — Expected: PASS. Run DB specs: `TEST_DB_NAME=split_test npm run test:db -w backend -- cost-of-day network-cost-of-day` — Expected: PASS (if no Postgres is up, say so and leave it to Task 6's `verify:full`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/day-costs
git commit -m "feat(cost-of-day): стратегія розподілу і для «Усі точки»"
```

### Task 3: Frontend — entity types, queries and the remembered choice

**Files:**
- Modify: `frontend/src/entities/cost-of-day/model/cost-of-day.ts`, `model/network-cost-of-day.ts`
- Modify: `frontend/src/entities/cost-of-day/api/useCostOfDay.ts`, `api/useNetworkCostOfDay.ts`, `index.ts`
- Create: `frontend/src/shared/lib/split-preference/index.ts`
- Create: `frontend/src/pages/cost-of-day/model/useCostSplit.ts`
- Test: `frontend/src/entities/cost-of-day/api/useCostOfDay.test.tsx`, `useNetworkCostOfDay.test.tsx`, `frontend/src/pages/cost-of-day/model/useCostSplit.test.tsx`

**Interfaces:**
- Consumes: the API fields from Tasks 1–2.
- Produces:
  - `entities/cost-of-day`: `export type CostSplit = 'weight' | 'value' | 'own'; export const COST_SPLITS: readonly CostSplit[]; export function isCostSplit(v: unknown): v is CostSplit`; `CostOfDay` gains `split`, `split_applied`, `expenses_pct`, `shortfall_pct`; `CostOfDayProduct` gains `shortfall_per_kg`, `expenses_per_kg`; `NetworkCostOfDay` gains `split`.
  - `useCostOfDayQuery(shiftId: string | undefined, split: CostSplit)` — key `[...queryKeys.costOfDay, shiftId, split]`, sends `params: { split }`.
  - `useNetworkCostOfDayQuery(date: string | null, split: CostSplit)` — key `[...queryKeys.costOfDay, 'network', date, split]`.
  - `shared/lib/split-preference`: `getStoredCostSplit(): string | null`, `storeCostSplit(value: string): void` — key `'web-starter:cost-split'`, every storage error swallowed (copy `sidebar-preference`'s shape; `shared` may not import `entities`, so it stores a plain string and the hook validates).
  - `useCostSplit(): [CostSplit, (next: CostSplit) => void]` — reads `useUrlParam('split')`; if `isCostSplit(url)` use it, else `isCostSplit(stored)` → stored, else `'weight'`; setter writes the URL param and the preference.

- [ ] **Step 1: Write failing tests.**
  - Hooks: the request carries `params.split` (`'own'` and network `'value'`), and two splits make two cache entries.
  - `useCostSplit`: `?split=value` → `'value'`; `?split=bogus` + stored `'own'` → `'own'`; nothing → `'weight'`; stored `'garbage'` → `'weight'`; `localStorage.getItem` throwing → `'weight'`; setter writes both `?split=` and the stored value.
- [ ] **Step 2: Run** `npm test -w frontend -- cost-of-day useCostSplit` — Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block; add the new fields to every existing test fixture that builds a `CostOfDay`/`CostOfDayProduct` so `npm run typecheck -w frontend` stays clean (under `weight` fixtures: `split: 'weight', split_applied: 'weight', expenses_pct: null, shortfall_pct: null`, product per-kg = the fixture's day halves for complete products, `null` otherwise).
- [ ] **Step 4: Run** `npm test -w frontend -- cost-of-day useCostSplit && npm run typecheck -w frontend` — Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `git commit -m "feat(cost-of-day): стратегія розподілу в запитах і пам'ять вибору"` (frontend entity, shared lib, hook, fixtures).

### Task 4: Frontend — the switch and what each strategy prints

**Files:**
- Modify: `frontend/src/pages/cost-of-day/ui/CostOfDayPage.tsx`, `ExpensesStrip.tsx`, `CostTable.tsx`, `CostTableRow.tsx`, `NetworkCostOfDay.tsx`, `trace-ids.ts` (only if a new trace id is needed)
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json`
- Test: `CostOfDayPage.test.tsx`, `ExpensesStrip.test.tsx`, `CostTable.test.tsx`, `NetworkCostTable.test.tsx`

**Interfaces:**
- Consumes: `useCostSplit`, `COST_SPLITS`, the new fields (Task 3); `Segmented` from `@/shared/ui/segmented`.
- Produces: nothing used by later tasks.

**Copy (uk; en mirrors it):**
- `costOfDay.split.label` «Розподіл кошика»; `.weight` «По вазі»; `.value` «По сумі закупки»; `.own` «Своя недостача + % витрат»; `.fallback` «Нараховано 0 ₴ — розкладено по вазі»; `.print` «розподіл: {{name}}» (lower-case name in print).
- `costOfDay.expenses.totalPct` «= {{amount}} · ≈ {{pct}} % від закупки».
- `costOfDay.table.ownShortfallPerKg` «своя, ₴/кг» (header under `own`).
- `costOfDay.table.howToReadShortfallPct` «Недостача дня: {{shortfall}} ÷ {{accrued}} ≈ {{pct}} % від закупки»; `howToReadShortfallOwn` «Недостача — своя у кожного товару: своя ₴ ÷ база кг»; `howToReadExpensesPct` «Витрати дня: {{expenses}} ÷ {{accrued}} ≈ {{pct}} % від закупки»; `howToReadShareNote` «Частка кожного товару в гривнях — у розгорнутому рядку (›)».
- `costOfDay.chain.expensesShare` «Витрати: {{expenses}} × {{accrued}} ÷ {{total}} ≈ {{share}} ÷ {{kg}} = {{perKg}}»; `chain.shortfallShare` the same with «Недостача»; `chain.shortfallOwn` «Недостача: своя {{shortfall}} ÷ {{kg}} = {{perKg}}». («≈» always before the share: `allocate` may differ by a kopiyka from `x × a ÷ b`.)

- [ ] **Step 1: Write failing tests.**
  - Page: a `Segmented` radiogroup named «Розподіл кошика» with three options; clicking «По сумі закупки» refetches with `split=value` and puts `?split=value` in the URL; the choice survives switching to «Усі точки» (network request carries `split=value`); `split_applied: 'weight'` with `split: 'value'` shows «Нараховано 0 ₴ — розкладено по вазі»; the print header contains «розподіл: по сумі закупки»; a draft typed in the expenses strip is still there after switching strategy (Review Focus 5).
  - Strip: under `weight` prints «= 1 900,00 ₴ · 3,11 ₴/кг» as today; with `expenses_pct: '1.67'` prints «≈ 1,67 % від закупки».
  - Table, `value` fixture (19.10 Гайове: Кизил 596,60 ₴ / 15,70 кг, `shortfall_per_kg '0.09'`, `expenses_per_kg '0.64'`, `price_cost '38.73'`; Малина 113 044,20 ₴ / 595,40 кг, `'0.44'`, `'3.17'`, `'193.03'`; `expenses_pct '1.67'`, `shortfall_pct '0.23'`): row cells print the product's own per-kg values; formula lines read «≈ 0,23 % від закупки» and «≈ 1,67 % від закупки» plus the share note; the opened Малина row's chain contains «1 900,00 ₴ × 113 044,20 ₴ ÷ 113 640,80 ₴ ≈ 1 890,03 ₴ ÷ 595,40 кг = 3,17 ₴/кг».
  - Table, `own` fixture (Кизил `'0.00'`/`'0.64'`/`'38.64'`, Малина `'0.45'`/`'3.17'`/`'193.04'`): header «своя, ₴/кг»; Малина chain «Недостача: своя 265,19 ₴ ÷ 595,40 кг = 0,45 ₴/кг».
  - Table, `weight`: existing assertions unchanged (they are the regression guard).
- [ ] **Step 2: Run** `npm test -w frontend -- pages/cost-of-day` — Expected: FAIL on the new cases only.
- [ ] **Step 3: Implement.**
  - Page: `const [split, setSplit] = useCostSplit()`; pass `split` to both queries; render `<Segmented label={t('costOfDay.split.label')} size="sm" fit="content" tone="strong" …>` in the `actions` row before `DateStepper` (`print-hide` wrapper); add the fallback note beside it when `data.split_applied !== data.split`; append «· розподіл: …» to the print-only title (single point and network).
  - `CostTableRow`: drop the `shortfallPerKg`/`expensesPerKg` props and read `p.shortfall_per_kg`/`p.expenses_per_kg`; keep `perDay(...)` trace refs only when `day.split_applied === 'weight'` (pass `applied` as a prop); under `value`/`own` add the chain lines from the copy above, operands traced to this row's cells and `DAY.expenses`/`TOTAL.accrued`.
  - `CostTable`: header label per `applied`; formula lines per spec §3.2 (the day-average formula and «Як читати рядок» unchanged).
  - `ExpensesStrip`: `totalPct` when `day.expenses_pct !== null`, else today's keys.
  - `NetworkCostOfDay`: nothing beyond the shared switch unless a test shows a per-kg day figure (spec §3.4).
- [ ] **Step 4: Run** `npm test -w frontend -- pages/cost-of-day && npm run typecheck -w frontend && npm run lint -w frontend` — Expected: PASS, 0 problems.
- [ ] **Step 5: Commit** `git commit -m "feat(cost-of-day): перемикач «Розподіл кошика» на екрані собівартості"`.

### Task 5: Rules file and follow-ups

**Files:**
- Modify: `26-rules-by-example.md` §8.5
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (the «§8.5 strategies ② and ③» bullet)

- [ ] **Step 1:** In §8.5 add, below the existing block and rule (left intact, the old rule line prefixed «~~» … «~~» with «(замінено Правкою 24.10.2026)»), a «→ **Правка 24.10.2026:**» entry with spec §5's three points and the 19.10 example table (Кизил 41,54 / 38,73 / 38,64; Малина 192,96 / 193,03 / 193,04).
- [ ] **Step 2:** Rewrite the follow-ups bullet: ② shipped as `value`/`own` (link spec + plan), view-only by owner's call 24.10; ③ «усе на один товар» stays deferred for the same stored-state reason.
- [ ] **Step 3:** Update the `money.ts` `div` JSDoc sentence that says the slice «does not implement» §8.5 only if it now reads false (③ is still unbuilt, so it likely stays).
- [ ] **Step 4: Commit** `git commit -m "docs(rules): §8.5 — Правка 24.10.2026, розподіл кошика як вигляд екрана"`.

### Task 6: Full verification and browser check

- [ ] **Step 1:** `npm run verify` — Expected: verdict line green; quote it.
- [ ] **Step 2:** `npm run verify:full` (money code + DB specs). Per project memory, in a worktree use an isolated `TEST_DB_NAME` and `--exclude smoke` or ask first. Quote the verdict line and name every `SKIPPED` row.
- [ ] **Step 3:** Browser: start the frontend preview (`.claude/launch.json`), open «Собівартість дня» for Гайове 19.10, switch all three strategies, confirm the 19.10 table values from Task 5's example, open the Малина row under `value` and `own`, check «Усі точки» keeps the choice, reload to confirm the remembered choice, and screenshot each strategy.
