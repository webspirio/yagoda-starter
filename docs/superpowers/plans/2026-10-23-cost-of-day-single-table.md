# Cost of Day — One Colour-Coded Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cost-of-day screen's two tables + side panel with one colour-coded table whose every row adds up on screen, with every figure computed by the server.

**Architecture:** The backend `CostOfDayService` gains the breakdown and totals the browser used to derive (split `per_kg`, split shares, `full_cost`, `weighed.*`, `unweighed`, `checks`). The page `pages/cost-of-day` is rebuilt from four page-local components — `StatusChips`, `ExpensesStrip`, `CostTable`, `ChecksDisclosure` — that only format server strings.

**Tech Stack:** NestJS + TypeORM (raw SQL) + Jest/fast-check; React 19 + TanStack Query + i18next + Tailwind v4 + shadcn kit; Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-23-cost-of-day-single-table-design.md` (approved 2026-10-23). Read it first; this plan does not repeat its reasoning.

**Where to work:** branch `feat/cost-of-day-single-table` (already created from `a90b1626`). The main checkout is shared with another session — execute in a worktree (superpowers:using-git-worktrees). The spec and this plan are untracked in the main checkout; Task 1 step 1 copies them in and commits them.

## Global Constraints

- Every arithmetic operation on money/weight goes through `backend/src/common/money.ts` (`add`, `sub`, `sum`, `div`, `allocate`, `cmp`, `isZero`); the eslint money ban covers `src/day-costs/**`.
- The frontend does NO arithmetic on these figures: `pages/cost-of-day` must not import `add`, `sub`, `sum`, `cmp` from `@/shared/lib/money` (formatters only).
- `null` is «—», never «0,00» (§8.6 «Це не нуль»).
- Amber (`--amber`) only on недостача. Plum (`--plum`) only on витрати дня. Leaf on собівартість and «Звірено». Berry only on buttons.
- Every user-visible string through i18n, keys in both `uk.json` and `en.json` (`locales` and `plain-text` verify rows).
- `ExpensesStrip` stays keyed on `day.shift_id`.
- Money changes need `npm run verify:full` (real Postgres) before claiming done (CLAUDE.md rule 1).

## Review Focus

1. **A day with a not-fully-reweighed product** — the total row and `checks.total_ok` must still add up; the product shows «—» from «База» on and appears in the muted «Не перезважено» line. → Task 1 test `mixed day`, Task 4 test `unweighed row`.
2. **Nothing weighed yet (`per_kg === null`) with expenses entered** — no ✗, no disclosure, strip still editable, result columns «—». → Task 1 test `nothing weighed`, Task 5 test `checks null`, Task 6 test `awaiting`.
3. **Expenses = 0 and shortfall = 0 (basket 0,00)** — halves 0,00 + 0,00, no even-split surprise, собівартість = ціна в квитанції. → Task 1 test `empty basket`.
4. **A date whose shift changes under a half-typed expense** — draft dropped. → Task 3 keeps it, Task 6 ports `drops a half-typed expense…`.
5. **Print** — disclosure open, ⓘ texts as footnotes, colour doubled by sign/border. → Task 6 test `print`.

---

### Task 1: Server computes the breakdown and the totals

**Files:**
- Modify: `backend/src/day-costs/cost-of-day.service.ts` (interfaces + `forShift` + `buildProducts`)
- Test: `backend/src/day-costs/cost-of-day.service.spec.ts`
- Modify: `backend/src/day-costs/cost-of-day.db-spec.ts`
- Add (from main checkout): the spec and this plan

**Interfaces — Produces** (added to the existing response; nothing removed):

```ts
// CostOfDayProduct, additionally:
shortfall_share: string | null;   // allocate(shortfall_amount, weighed kg)[i]; null when basket_share is
expenses_share: string | null;    // allocate(expenses_amount, weighed kg)[i]
// basket_share now = add(shortfall_share, expenses_share)
full_cost: string | null;         // accrued − shortfall + basket_share; null when basket_share is

// CostOfDayResponse, additionally:
weighed: { intake_kg: string; shortfall_kg: string; accrued: string; shortfall: string; price_was: string } | null;
full_cost: string | null;         // Σ product full_cost
price_cost_avg: string | null;    // div(full_cost, reweighed_kg)
unweighed: { intake_kg: string; accrued: string };   // Σ over !complete, '0.00' when none
checks: { shares_ok: boolean; total_ok: boolean } | null;
// shortfall_per_kg / expenses_per_kg now = allocate(per_kg, [shortfall_amount, expenses_amount])
```
`weighed`, `full_cost`, `price_cost_avg`, `checks` are `null` exactly when `per_kg` is. `price_cost` unchanged (`add(price_was, per_kg)`). Rewrite the `expenses_per_kg` doc comment: the pair now IS an addition.

- [ ] **Step 1:** In the worktree, copy `docs/superpowers/specs/2026-10-23-cost-of-day-single-table-design.md` and `docs/superpowers/plans/2026-10-23-cost-of-day-single-table.md` from the main checkout; commit `docs(day-costs): spec and plan for the one-table cost-of-day screen`.

- [ ] **Step 2: Write the failing tests** in `cost-of-day.service.spec.ts`, new `describe('one-table fields (spec 2026-10-23)')`, with a `GAIOVE` fixture (one grade per product, `build(GAIOVE, '1700.00')`):
  Кизил `intake 15.70 / amount 596.60 / reweigh 15.70`, Малина `596.80 / 113044.20 / 595.40`.

  - `splits на кілограм so the halves sum to it` — `per_kg '3.22'`, `shortfall_per_kg '0.43'`, `expenses_per_kg '2.79'`.
  - `keeps §8.4 own halves` — existing `svc` (§8.4 day): `'1.94'`, `'4.45'` (existing test must still pass unchanged).
  - `splits each share into недостача and витрати` — Кизил `6.81 / 43.68 / basket_share 50.49`, Малина `258.38 / 1656.32 / 1914.70`.
  - `prices повна вартість per product and per day` — `full_cost` Кизил `647.09`, Малина `114693.71`; day `full_cost '115340.80'`, `price_cost_avg '188.74'`, `price_cost` `41.22` / `192.64` (unchanged).
  - `totals weighed products only` — `weighed` = `{ intake_kg '612.50', shortfall_kg '1.40', accrued '113640.80', shortfall '265.19', price_was '185.54' }`, `unweighed` `{ '0.00', '0.00' }`, `checks` `{ shares_ok: true, total_ok: true }`.
  - `§8.4 day` — `full_cost` Малина `131450.82`, Ожина `4249.18`, day `135700.00`, `price_cost_avg '158.90'`, `weighed.price_was '152.49'`.
  - `mixed day` — existing partial-product fixture (spec §3.15 block): `weighed` excludes it, `unweighed` carries its intake kg and accrued, its `full_cost`/`*_share` are `null`, `checks.total_ok === true`.
  - `nothing weighed` — `svcWithNoReweigh`: `weighed`, `full_cost`, `price_cost_avg`, `checks` all `null`; `unweighed.accrued === accrued`.
  - `empty basket` — §8.4 day with every `reweigh_net_kg = intake_net_kg` and expenses `'0.00'`: halves `'0.00'`/`'0.00'`, every `price_cost === price_was`.
  - Property (`fast-check`, as in `common/money.properties.spec.ts`): random 1–4 complete products (kg 0.01–9999.99, price 1–999.99, reweigh ≤ intake) and expenses 0–99999.99 → `add(shortfall_per_kg, expenses_per_kg) === per_kg`; Σ `shortfall_share` = `shortfall_amount`; Σ `expenses_share` = `expenses_amount`; `checks` both true.

- [ ] **Step 3:** `cd backend && npx jest src/day-costs/cost-of-day.service.spec.ts` → the new cases FAIL (fields undefined), old ones PASS.

- [ ] **Step 4: Implement** in `cost-of-day.service.ts`. `forShift` computes halves with `allocate(perKg, [shortfallAmount, expenses])`; `buildProducts(rows, perKg, shortfallAmount, expenses)` allocates the two parts over `weighed` kg separately and sets `basket_share = add(...)`; day fields from the products. Old single `allocate(basket, …)` goes.

- [ ] **Step 5:** same jest command → all PASS.

- [ ] **Step 6:** In `cost-of-day.db-spec.ts` test `reproduces §8.4 end to end against real Postgres`, add expectations for the §8.4 values above (halves, shares 1535.60/3515.22 and 124.40/284.78, `full_cost`, `price_cost_avg`, `weighed`, `checks`). Those values assume the unit fixture's day (Малина 800/128 000/790, Ожина 65/3 900/64, витрати 3 800); if the db-spec seeds different Ожина figures, recompute from its seed with the same formulas rather than editing the seed. Run `npm run verify:full` from repo root → `test:db` PASSED (quote the verdict line).

- [ ] **Step 7: Commit** `feat(day-costs): сервер рахує розклад надбавки, частки й підсумки дня`.

### Task 2: Frontend contract, colour token, words

**Files:**
- Modify: `frontend/src/entities/cost-of-day/model/cost-of-day.ts` (mirror Task 1's fields with the same doc comments, shortened)
- Modify: `frontend/src/index.css` — `--plum: #7a4cc4` (light, after `--sky`), `--plum: #a98bf0` (`.dark`), `--color-plum: var(--plum)` after `--color-sky`; add `.printable [class*='bg-[var(--plum)]']` to the `print-color-adjust` list.
- Modify: `uk.json`, `en.json` — add the keys below (uk shown; en mirrored), remove nothing yet (Task 6 removes the dead ones).
- Test: `frontend/src/entities/cost-of-day/api/useCostOfDay.test.tsx` fixture gains the new fields.

New keys under `costOfDay`:
```
description: «Скільки насправді коштує кілограм ягоди після недостачі й витрат дня.»
status.closed «Зміну закрито» · status.allWeighed «Усе перезважено» · status.notWeighed «Не перезважено: {{names}}»
status.topUps «Доплати враховано до {{at}}» · status.checked «Звірено» · status.mismatch «Не сходиться»
status.checksPending «Звірка — після переважування»   (open shift reuses costOfDay.provisional)
table.groupWeight «Вага, кг» · table.groupPurchase «Закупка» · table.groupShortfall «Недостача» · table.groupExpenses «Витрати» · table.groupResult «Результат»
table.product «Товар» · table.point «Пункт» · table.base «База» · table.notArrived «Не доїхало» · table.accrued «Нараховано» · table.priceWas «₴/кг у квитанції»
table.ownShortfall «Своя, ₴» · table.dayShortfall «Дня, ₴/кг» · table.expensesPerKg «₴/кг» · table.cost «Собівартість» · table.delta «Δ до квитанції»
table.total «Пункт» · table.unweighed «Не перезважено, не входить у підсумок: {{kg}} · {{amount}}»
table.share «Частка дня в гривнях: {{shortfall}} недостачі + {{expenses}} витрат = {{share}} · повна вартість {{full}} · кг, що доїхав, без витрат: {{byOur}}»
table.howToRead «Як читати рядок: <sky>ціна в квитанції</sky> + <amber>недостача дня на кг</amber> + <plum>витрати дня на кг</plum> = <leaf>собівартість</leaf>. Недостачу й витрати розкладено порівну на кожен кілограм, що доїхав на базу ({{kg}}).»   (render with react-i18next <Trans components>)
table.accruedHelpLabel «Що таке «нараховано»» · table.accruedHelp = current berry.note text
table.avgHelpLabel «Як рахується середня» · table.avgHelp «Сума повної вартості ÷ вага на базі (§8.6), не середнє з цін.»
expenses.title «Витрати дня» · expenses.addLine «Додати витрату» · expenses.total «= {{amount}} · {{perKg}} ₴/кг» · expenses.totalNoRate «= {{amount}}»
checks.title «Як перевірити, що жодна гривня не загубилась»
checks.shares «Частки товарів: {{shares}} = {{basket}} = недостача {{shortfall}} + витрати {{expenses}}»
checks.total «Повна вартість: {{fulls}} = {{full}} = нараховано {{accrued}} + витрати {{expenses}}»
checks.totalUnweighed «Повна вартість: {{fulls}} = {{full}}; {{full}} + не перезважено {{unweighed}} = нараховано {{accrued}} + витрати {{expenses}}»
```
(`{{shares}}` / `{{fulls}}` are the formatted parts joined with « + » by the component — string joining, not arithmetic.)

- [ ] **Step 1:** Update the entity types and the `useCostOfDay` test fixture; `cd frontend && npx tsc -b` → errors only in the old page components' test fixtures (missing new fields) — fix those fixtures by adding the new fields so the suite stays green.
- [ ] **Step 2:** Add the token and keys. `npm run verify` → PASSED (quote verdict; `locales` green).
- [ ] **Step 3: Commit** `feat(cost-of-day): контракт нових полів, токен plum, тексти`.

### Task 3: ExpensesStrip

**Files:**
- Create: `frontend/src/pages/cost-of-day/ui/ExpensesStrip.tsx`, `ExpensesStrip.test.tsx`
- Delete: `ExpensesPanel.tsx`, `ExpensesPanel.test.tsx` (in Task 6, once the page stops importing them — keep both until then)

**Interfaces:** `export function ExpensesStrip({ day, expenses, shiftId, locale }: { day: CostOfDay; expenses: DayExpense[]; shiftId: string; locale: string }): JSX.Element` — same props as `ExpensesPanel`.

Shape (spec §4.1 step 3, §4.5): plum-outlined row; `costOfDay.expenses.title`; one pill per line (label + mono plum amount + edit + remove buttons, same aria-labels `expenses.edit` / `expenses.remove`); a pill in edit mode becomes label input + `DecimalInput` + Зберегти/Скасувати; add form = label input + amount input + «+ Додати витрату» button; right-aligned `expenses.total` (or `totalNoRate` when `day.expenses_per_kg === null`) with `day.expenses_amount` / `day.expenses_per_kg`. Empty: `expenses.empty` inside the strip. No basket / на-кілограм / недостача rows (they live in the table now). Move all of `ExpensesPanel`'s logic verbatim (create/update/remove mutations, `useDecimalField`, patch-only-what-moved, refusal keeps form + toast, `FormatError`) — copy its component doc comment too, minus the basket paragraph.

- [ ] **Step 1:** Create `ExpensesStrip.test.tsx` by porting every `ExpensesPanel.test.tsx` case except `prints the basket and the rate without the «з них» split` and `names only the manual expenses when nothing has been weighed`, plus:
  - `sums the day's expenses and their rate in plum` — `= 1 700,00 ₴ · 2,79 ₴/кг` visible (19.10 day fixture).
  - `drops the rate when nothing was weighed` — `expenses_per_kg: null` → `= 1 700,00 ₴`, no «₴/кг».
- [ ] **Step 2:** `npx vitest run src/pages/cost-of-day/ui/ExpensesStrip.test.tsx` → FAIL (module missing).
- [ ] **Step 3:** Implement `ExpensesStrip.tsx`.
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5: Commit** `feat(cost-of-day): витрати дня — смуга над таблицею`.

### Task 4: CostTable

**Files:**
- Create: `frontend/src/pages/cost-of-day/ui/CostTable.tsx`, `CostTable.test.tsx`

**Interfaces:** `export function CostTable({ day, locale }: { day: CostOfDay; locale: string }): JSX.Element`.

Columns, cells, total row, unweighed row, expanded sub-row and grades: exactly spec §4.2 (two header rows; group headers coloured; tints ~8–10 %; sticky first column; `overflow-x-auto` container). Expand state: `useState<ReadonlySet<string>>`, collapsed by default, same toggle aria-labels as today (`berry.showGrades` / `berry.hideGrades` — keep those two keys). ⓘ tooltips on «Нараховано» (`table.accruedHelp`) and on the total «Собівартість» (`table.avgHelp`) plus a `print-only` numbered footnote list under the table with the same two texts. The `howToRead` line under the table (when `day.per_kg !== null`); when it is `null`, render instead `expenses.awaiting` + `expenses.awaitingAmount` + `expenses.awaitingNote` in a muted (NOT amber) box. Only formatters from `@/shared/lib/money`. Print: the Собівартість column carries a `print:` 1.5 pt border on both sides, недостача cells keep their minus sign, group names stay in the header — colour is never the only signal.

- [ ] **Step 1: Write failing tests** with the 19.10 fixture (all fields from Task 1's values):
  - `reads a row left to right as ціна + недостача + витрати = собівартість` — Малина row contains `596,80`, `595,40`, `−1,40`, `113 044,20 ₴`, `189,42`, `−265,19`, `0,43`, `2,79`, `192,64`, `+3,22`.
  - `prints a weighed zero as a muted 0,00` — Кизил «Не доїхало» `0,00`, no minus.
  - `totals weighed products and leaves Δ empty` — «Пункт» row: `612,50`, `611,10`, `−1,40`, `113 640,80 ₴`, `185,54`, `−265,19`, `0,43`, `2,79`, `188,74`; its Δ cell empty.
  - `opens a product into its share and its grades` — click `Показати сорти: Малина` → text `258,38`, `1 656,32`, `1 914,70`, `114 693,71`, `189,86`, and grade rows.
  - `dashes a product not reweighed in full and reports it under the total` — mixed fixture: its cells from «База» on are `—`, badge `не перезважено`, row `Не перезважено, не входить у підсумок: …` present; not in the total.
  - `shows the awaiting note instead of the reading hint when nothing is weighed` — `per_kg: null` → result cells `—`, awaiting text, no amber class on the box.
  - `uses amber only inside the Недостача group` — every element whose class contains `--amber` is inside a cell of the two Недостача columns.
- [ ] **Step 2:** `npx vitest run src/pages/cost-of-day/ui/CostTable.test.tsx` → FAIL.
- [ ] **Step 3:** Implement `CostTable.tsx` (port the grade-row rendering from `BerryTable.tsx`).
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5: Commit** `feat(cost-of-day): одна таблиця з колірними групами`.

### Task 5: StatusChips and ChecksDisclosure

**Files:**
- Create: `frontend/src/pages/cost-of-day/ui/StatusChips.tsx`, `ChecksDisclosure.tsx`, `StatusChips.test.tsx`, `ChecksDisclosure.test.tsx`

**Interfaces:**
- `export function StatusChips({ day, locale, onChecksClick }: { day: CostOfDay; locale: string; onChecksClick: () => void }): JSX.Element`
- `export function ChecksDisclosure({ day, locale, open, onOpenChange }: { day: CostOfDay; locale: string; open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element | null` — returns `null` when `day.checks === null`. A native `<details>` controlled through `open`; `id="cost-checks"` for the scroll target; `print:` always open (add `open` attribute in a `beforeprint` handler or render the body with `print:block` — builder's choice, test covers the markup).

Chips per spec §4.1 step 2, neutral outline + lucide icon (`CheckCircle2`, `Clock`, `AlertTriangle`, `XCircle`); `Звірено` leaf, `Не сходиться` destructive; the open-shift chip is NOT amber.

- [ ] **Step 1: Failing tests:**
  - StatusChips: `closed + all weighed + checked` → `Зміну закрито`, `Усе перезважено`, `Звірено`; `open shift` → `Зміна ще відкрита — цифри рухаються` and no `--amber` class; `names the products not reweighed` → `Не перезважено: Ожина`; `top-ups` → `Доплати враховано до …`; `checks null` → `Звірка — після переважування`, not a button; `mismatch` → `Не сходиться`, clicking calls `onChecksClick`.
  - ChecksDisclosure: `prints both identities from server figures` (19.10 → `50,49 ₴ + 1 914,70 ₴ = 1 965,19 ₴ = недостача 265,19 ₴ + витрати 1 700,00 ₴`, `647,09 ₴ + 114 693,71 ₴ = 115 340,80 ₴ = нараховано 113 640,80 ₴ + витрати 1 700,00 ₴`); `writes the unweighed identity` (mixed fixture → `totalUnweighed` text); `renders nothing when checks is null`.
- [ ] **Step 2:** run both test files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** `feat(cost-of-day): статуси дня і згорнута звірка`.

### Task 6: Assemble the page, remove the old screen

**Files:**
- Modify: `frontend/src/pages/cost-of-day/ui/CostOfDayPage.tsx`, `CostOfDayPage.test.tsx`
- Delete: `BerryTable.tsx`, `BerryTable.test.tsx`, `FinalPrices.tsx`, `FinalPrices.test.tsx`, `ExpensesPanel.tsx`, `ExpensesPanel.test.tsx`
- Modify: `uk.json`, `en.json` — delete keys no component reads any more (`costOfDay.berry.*` except `showGrades`/`hideGrades`, `costOfDay.final.*`, `costOfDay.topUps`, `costOfDay.expenses.{shortfallRow,expensesRow,basket,perKg,add}`); `grep -rn "costOfDay\.<key>" frontend/src` must return nothing for each deleted key.

Page body (inside the existing `printable print-landscape` card, below the existing title row which loses its two badges): `StatusChips` → `ExpensesStrip key={day.shift_id}` → (`day.products.length === 0` ? `noIntake` text : `CostTable`) → `ChecksDisclosure`. Disclosure `open` state lives in the page: initial `day.checks !== null && !(shares_ok && total_ok)`; `onChecksClick` sets it open and scrolls `#cost-checks` into view. Remove the `@container` grid and its comment. Keep the three read states, the point picker comment and the `KEYED ON THE SHIFT` comment (now above `ExpensesStrip`).

- [ ] **Step 1: Update `CostOfDayPage.test.tsx`:** fixture gains Task 1 fields; replace `renders the day — both halves and the final table` with `renders chips, the strip, the table and the checks in that order` (DOM order of `Витрати дня`, `Товар`, `Звірено`); replace `never mounts FinalPrices when per_kg is null…` with `keeps the strip and dashes the result when nothing is weighed`; replace `keeps the expenses panel reachable on an empty day…` with the same assertion against the strip; add `opens the checks when they fail` (`checks.total_ok: false` → disclosure open, `Не сходиться`); add `print` — the disclosure body and the two footnotes are in the DOM with `print-only`/open. Keep every other case.
- [ ] **Step 2:** `npx vitest run src/pages/cost-of-day` → new cases FAIL.
- [ ] **Step 3:** Rewire the page, delete the six old files, prune the keys.
- [ ] **Step 4:** `npx vitest run src/pages/cost-of-day` → PASS; `grep -rnE "from '@/shared/lib/money'" frontend/src/pages/cost-of-day` shows only formatter imports.
- [ ] **Step 5:** `npm run verify:full` from repo root → quote the verdict line; every SKIPPED row named aloud.
- [ ] **Step 6:** Open the page in the browser pane against the dev stack (`npm run db:seed`, owner login from the seed), a point/day with a reweigh; check light + dark, 1440 px and 1024 px (table scrolls inside its card, page does not), print preview (disclosure open, footnotes). Screenshot to the user.
- [ ] **Step 7: Commit** `feat(cost-of-day): екран зібрано в одну таблицю, старі компоненти прибрано`.
