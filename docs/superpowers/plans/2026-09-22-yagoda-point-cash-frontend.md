# «Каса точки» frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** `pages/point-cash` reproduces the mock's «Каса точки» for both roles: the crates book beside the berry book, the shift-and-recount panel with open/close/recount and the result view, disputed transfers, the ledger and target polish, laptop-first.

**Architecture:** The page keeps its one honesty rule — every figure is the server's (`GET /point-cash?collection_point_id=` row, `GET /cash-counts?shift_id=`), never a client sum. New pieces: `pages/point-cash/ui/CratesBookCard.tsx`, `ShiftCountPanel.tsx`, `features/count-shift`'s `RecountDrawerDialog` + `useRecountMutation`; `IncomingTransfers` grows the disputed card; `CashLedger` the opening row; `SetTargetCashDialog` the live preview. Tests run with i18n in English.

**Tech Stack:** React 19, TanStack Query, react-hook-form, Tailwind v4 + the kit (`StatTile`, `Eyebrow`, `SectionCard`, `Dialog`, `DataTable`), Vitest + Testing Library + axe.

**Spec:** `docs/superpowers/specs/2026-09-22-yagoda-point-cash-parity.md` (§3, rulings R1, R4–R10). Backend contract (this branch's backend tasks): `POST /cash-counts { book:'berry', counted_amount }` → the count row; `ShiftResponse.opened_by_name/closed_by_name`; `CashCount.counted_by_name`; point-cash rows carry `crate_deposits` (string) and `crate_deposit_units` (int).

## Global Constraints
- FSD import direction only; a page composes features; `features/count-shift` is the ONE home of shift/count verbs (pages/day, pages/reception and now pages/point-cash consume it).
- No new npm dependency. Copy in BOTH `uk.json` and `en.json` via `t()`; the mock's Ukrainian verbatim where the spec quotes it.
- Money as STRINGS through `@/shared/lib/money` (`cmp`, `sub`, `formatUah`, `isNegative`); crate units are integers.
- React Compiler lint: no setState in effects, no refs during render.
- Honesty rules of this page stay (its tests name them): the server total is never re-summed; zero counts read «ще не рахували», null target/shortfall render «—»; the target button is absent for the operator.
- Laptop-first: `lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]`; below `lg` one column, right column after the ledger.
- Commit per task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no push; `npm run verify` after each task, `npm run verify:full` at the end.

---

### Task 1: Wire types and the recount verb

**Files:** Modify `frontend/src/entities/point-cash/model/point-cash.ts` (`crate_deposits: string`, `crate_deposit_units: number` on `PointCashRow` AND `PointCashOne`), `entities/cash-count/model/cash-count.ts` (`counted_by_name: string | null`), `entities/shift/model/shift.ts` (`opened_by_name`, `closed_by_name`: `string | null`); every test fixture that builds these literals (grep `unexplained_difference:`, `counted_by_user_id:`, `opened_by_user_id:` under `frontend/src` tests — trust the grep). Create `features/count-shift/api/recount.ts` — `useRecountMutation()` → `POST /cash-counts` with `{ book: 'berry', counted_amount }`, `onSuccess` invalidates `cashCounts` and `pointCash` (reuse `useInvalidateDay` if it already covers both); export from the feature's `index.ts`. Test: the mutation posts the body and invalidates.
- Commit: `feat(entities): the crates book, deposit units and names on the point-cash wire types`.

### Task 2: Header, stats and the owner's grouped point select (R6, R7-description)

**Files:** Modify `pages/point-cash/ui/PointCashPage.tsx` (+ test), `uk.json`/`en.json`.
- Eyebrow `pointCash.eyebrow` → «{{point}} · {{date}}, {{weekday}}» (`formatLongDate`, `formatWeekday`); description → «Скільки грошей на точці має бути просто зараз і скільки не хватає до наділу. Гроші за ягоду й завдатки за ящики — дві окремі книги, вони не позичають одна в одної.»
- Stat hints: `stats.targetUnset` «наділу цій точці ще не призначали»; `stats.cashHint` «готівка, якою можна платити за ягоду»; shortfall hints `shortfallUnset` «без наділу порівнювати нема з чим», `shortfallOwed` «керівник ще не переказав», NEW `shortfallOver` «у касі більше, ніж наділ» (when `cmp(shortfall,'0') === -1`), `shortfallSettled` «наділ на точці відновлено». The cash tile carries `tone="amber"` when `isNegative(cash)`.
- Owner select: two `<optgroup>`s — `pointCash.pick.withTarget` «З наділом» (points whose `/point-cash` row has `target_cash !== null`) and `pointCash.pick.withoutTarget` «Без наділу» — this needs the unscoped `usePointCashQuery()` rows for the owner (one read, already the list endpoint); operator unchanged. Tests: the grouped options; each shortfall hint branch; the amber tone on negative cash.
- Commit: `feat(point-cash): the mock's header, hints and a grouped point select`.

### Task 3: «Каса за ящики» card, no combined drawer (R1, R8)

**Files:** Create `pages/point-cash/ui/CratesBookCard.tsx` (+ test); modify `PointCashPage.tsx` (replace the `PendingSlice` and the «У шухляді має бути» `StatTile`; delete `pointCash.drawer.*` keys), `uk.json`/`en.json`.
- Card (`SectionCard` or `Card`): `Eyebrow` «Каса за ящики»; big mono figure `formatUah(crate_deposits)`; caption «завдатків за {{count}} ящиків» with Ukrainian plurals (`_one` «ящик», `_few` «ящики», `_many` «ящиків»); footnote «Ці гроші лежать окремо від ягідних: людині віддамо за її ящики, навіть якщо каса за ягоду порожня. За розписку завдатку не брали — такі ящики сюди не рахуються.»; a muted two-books line under it: «Дві книги: ягода {{berry}} · ящики {{crates}}» — two figures side by side, NEVER a sum (comment cites the client's «Правка» and `point-cash.service.ts`). Zero units → caption «завдатків за ящики немає».
- Tests: figure and plural caption; zero state; no element ever shows berry + crates added (assert the sum string is absent); the page test «reserves the crates section with a labelled placeholder» is replaced by «shows the crates book from the row».
- Commit: `feat(point-cash): the crates book beside the berry book — two figures, never a sum (R1)`.

### Task 4: Disputed transfers as the red card (R5)

**Files:** Modify `pages/point-cash/ui/IncomingTransfers.tsx` (+ test), `uk.json`/`en.json`.
- Second query `useTransfersQuery({ pointId, status: 'disputed' })`; rows with `resolved_at === null` render a destructive-toned card: header «Заявлено «не сходиться» — переказ від {{date}}» (`formatShortDate(sent_at)`), body «Відправлено {{cash}} і {{crates}} ящ. · ви нарахували {{reportedCash}} і {{reportedCrates}} ящ.», italic ««{{note}}»» when `dispute_note`, footer «Каса не змінилася ні на копійку. Керівник врегулює переказ — на точці цю цифру не правлять.». In-transit card copy aligned to the mock: «У дорозі: {{cash}} і {{crates}} ящ.», caption «{{carrier}} · відправлено {{date}} о {{time}} · поки не натиснете «Прийняв», каса й наділ не рухаються»; non-actor label «приймає точка». Accept toast «Переказ прийнято» + «{{cash}} і {{crates}} ящ. зайшли в касу й у наділ.» (keep the feature's existing toast keys if they already say this; otherwise update `features/receive-transfer`'s keys — a feature may change its own copy).
- Tests: a disputed transfer renders the red card with the reported figures; a resolved one does not; the two queries are asked with the right statuses; the component still renders nothing when both are empty.
- Commit: `feat(point-cash): a disputed transfer is a red card on the point's own screen (R5)`.

### Task 5: Ledger polish (R6)

**Files:** Modify `pages/point-cash/lib/buildLedger.ts` (+ test), `ui/CashLedger.tsx` (+ test), `PointCashPage.tsx`, locales.
- `buildLedger` gains an input `openingCount: string | null` (the day's `opening` berry count `counted_amount`, found in the page from `useCashCountsQuery({ pointId, from: date, to: date })` — pick `kind === 'opening' && book === 'berry'`) and emits a first row `{ key: 'opening', value, hint? }` when present; the row label «на початок дня» (`ledger.opening`); its hint «наділ {{target}}» when a target exists (the mock's «− борг бази» half is not derivable — say so in a comment). The total row stays the server `cash`.
- `CashLedger`: negative-cash notice under the total when `isNegative(cash)`: «Каса за ягоду пішла в мінус: наділ не покриває цього дня. Це не помилка вводу — це означає, що видали більше, ніж на точці було грошей на ягоду.» (`ledger.negative`); the footnote rewritten generically: «Видача стоїть двома рядками навмисно: за день можна видати більше, ніж нарахували, бо гасяться давні залишки — одне число «видано» цього не пояснює.» (`ledger.twoRowsNote`).
- Tests: opening row present only with a count; hint only with a target; the notice only on negative cash; the total is still the prop.
- Commit: `feat(point-cash): «на початок дня» from the opening count, the negative notice, the two-rows note`.

### Task 6: «Зміна і перерахунок каси» panel with open / close / recount (R4)

**Files:** Create `features/count-shift/ui/RecountDrawerDialog.tsx` (+ test) and export it; create `pages/point-cash/ui/ShiftCountPanel.tsx` (+ test) and `pages/point-cash/ui/CountResultView.tsx` (+ test); modify `PointCashPage.tsx` (the panel in the right column; `CashCountHistory` behind a toggle «Уся історія перерахунків»), `CashCountHistory.tsx` (a `kind` column already exists — add «хто рахував» from `counted_by_name`), locales.
- Reads: `useShiftOnDateQuery(pointId, date)`; `useCashCountsQuery({ shiftId: shift?.id })` (berry book rows; sort by `counted_at`).
- Panel (`Eyebrow` «Зміна і перерахунок каси»): shift line «Зміна {{status}}» with `open` → «відкрита», `closed` → «закрита» (no `awaiting_explanation` copy — unreachable by decision, R4) + mono «з {{from}}» / «з {{from}} до {{to}}» (`formatTime(created_at)`, `formatTime(closed_at)`); rows «На ранок порахували» (opening count), «На кінець дня порахували» (closing count, if any); discrepancy pill «Розбіжність» — leaf «✓» when the CLOSING discrepancy is `'0.00'`, destructive «⚠» otherwise (opening never has one); «закрив {{name}}» from `closed_by_name`; italic ««{{explanation}}»». The day's recounts list: `midday` rows as «Перерахунок о {{time}}» + «✓ зійшлося» / «⚠ не зійшлося» (leaf/destructive) + the counted figure; empty «Цього дня касу ще не перераховували.»
- Actions (operator only; the owner sees none): open shift today → «Перерахувати касу» (opens `RecountDrawerDialog`) and «Закрити зміну» (opens `CountDrawerDialog mode="close"`); closed shift that day → «Зміну цього дня вже зведено. Другої книги на ту саму шухляду не заводять, і перерахунок до закритої зміни не чіпляється.»; no shift and the date is today → «Відкрити зміну» (`CountDrawerDialog mode="open"`) with caption «перерахунок чіпляється до відкритої зміни»; otherwise «Зміни на цей день немає — перерахунок нема до чого підчепити.» Footnote always: «Рахувати можна скільки завгодно разів на день — кожен перерахунок лишається окремим записом і нічого не виправляє.»
- `RecountDrawerDialog { open, onClose }`: title «Перерахунок каси», text «Порахуйте готівку в шухляді й уведіть суму. Скільки має бути — не показуємо, поки не введете: інакше це вже не перерахунок.», field «Скільки в шухляді, ₴» (`amountRules`), error «Уведіть суму числом більшим за нуль — і лише поки зміна відкрита: до закритої перерахунок не чіпляється.» (also the `SHIFT_NOT_OPEN` banner copy), footer «Скасувати» / «Порахував». After success the dialog switches to `CountResultView` with the returned row: rows «Очікувано» (`expected_amount`), «Пораховано» (`counted_amount`), pill «Розбіжність»; when non-zero the line «Змінити цю цифру в програмі не можна. Зателефонуйте на базу — керівник знайде, де розійшлося.»; footer «Готово».
- After `CountDrawerDialog` (open/close) succeeds on this page, the panel shows `CountResultView` for the new opening/closing row (read back from the counts query): open → «Пораховано», «Зміну відкрито»; close → «Пораховано», «Розбіжність», then «Зміна закрита. День зійшовся.» or «Зміна закрита. Розбіжність {{amount}} — керівник побачить її у своєму списку.» (R4). The view lives in a `Dialog` the page controls (`resultFor: 'open' | 'close' | null`).
- Tests (English copy): each of the four action states per role; the recount dialog posts and shows the result; open/close result copy for zero and non-zero; the panel lists midday rows with ✓/⚠; axe.
- Commit: `feat(point-cash): the shift-and-recount panel — open, close and recount on the point's own screen (R4)`.

### Task 7: Target dialog polish (R7)

**Files:** Modify `features/set-point-target/ui/SetTargetCashDialog.tsx` (+ test), locales.
- Description: «Діючий: {{amount}}» when `currentTarget` exists, else «Цій точці наділу каси ще не призначали.»; field label «Скільки грошей, ₴» (prefilled with the current target); reason as today; live preview box: «У касі за ягоду зараз» = `pointCash.data.cash`, «Не хвататиме до наділу» = `sub(typed, cash)` when typed is valid and greater than cash, else «—»; over-target copy when typed < cash: «У касі вже більше, ніж цей наділ. Заборгованості перед точкою не буде взагалі — заборонити цього не можна: наділ управлінське рішення.» (replaces the amber warning; still not a block); static note «Каса не перераховується: змінюється лише сума, від якої рахують «не хватає до наділу».»; success toast «Наділ каси — {{amount}}» + «{{point}}. Старий наділ у історію не пишеться — це одне число на точці.» (03.09 decision, honest).
- Tests: preview updates as the user types; the over-target copy; the description with and without a current target.
- Commit: `feat(set-point-target): the dialog says what the drawer holds now and what will be short (R7)`.

### Task 8: Layout, records of truth, verification (R10)

**Files:** Modify `PointCashPage.tsx` (+ test), `frontend/CLAUDE.md` (`pages/point-cash`, `features/count-shift` lines), the spec (§5 audit marks, items 25–65: `ported` / `not ported (rule)` / `deferred → D-n` with one clause each; R1 and R9 deviations listed).
- Layout: stats → notice → `IncomingTransfers` (full width) → grid: `CashLedger` left, right column `CratesBookCard` then `ShiftCountPanel` → the history toggle → `SetTargetCashDialog`. Page tests: composition order for owner and operator; below-`lg` order (right column after the ledger) via class assertions.
- `npm run verify:full` from the worktree root — paste the verdict (only `test:ci-scripts` may be SKIPPED). Then the controller re-points the compose stack from this worktree for the owner's two-window check (not the implementer).
- Commit: `docs(point-cash): records of truth and the audit marks for the point-cash slice`.
