# Compact Reception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-lay out `pages/reception` so a whole visit fits a 1366×650 browser viewport: a one-line header, a point-state strip, an input card on the left and a «Розрахунок» card on the right.

**Architecture:** Pure re-layout inside `frontend/src/pages/reception`, plus one new shared primitive (`shared/ui/popover.tsx`). `PointStatePanel`, `ShiftBanner` and the `TodayReceipts` card collapse into one `PointStrip`; `SupplierSection`, `LineEditor`, `LinesTable` and `TotalsSection` are compacted and reordered. No read, mutation, rule or request changes.

**Tech Stack:** React 19, Tailwind v4, shadcn/ui on the `radix-ui` umbrella package (already a dependency), react-hook-form, TanStack Query, Vitest + Testing Library, i18next.

**Spec:** `docs/superpowers/specs/2026-10-23-compact-reception-design.md` — read it first; §4's table is the contract for where every existing piece goes.

## Global Constraints

- Target: at 1366×650, sidebar expanded, `document.documentElement.scrollHeight <= innerHeight` in spec §5.1's worst case (left: 4 committed lines + draft, one tare row, no warnings; right: previous balance + §3.6 cash-limit note + crate return with deposit).
- Behaviour is frozen: preview, refund confirmation, supplier-switch reset, Enter guard, `isOwnFormEvent` portal guards, `suggestedPaid`, clamps, error mapping. A test that asserts behaviour may change its query, never its expectation.
- Gross weight stays the largest input (large mono type).
- The previous balance appears only in «Розрахунок»; a negative balance (credit) renders below «Разом», never in the sum.
- DOM order = §2.1 order; no `tabIndex` overrides (spec §5.2).
- Anything portaled (the popover) is never a React child of `<form>`.
- No user-visible literal outside `uk.json`/`en.json`; both files change together (`locales` and `plain-text` verify rows).
- Stay inside `pages/reception` except `shared/ui/popover.tsx` and its `/ui-kit` entry. No `AppLayout` change.
- Work on a fresh branch from `main` (the current checkout carries unrelated uncommitted work, including an uncommitted sidebar collapse — do not build on it).

## Review Focus

1. A click inside the «Сьогодні» popover (row → receipt) must never post `POST /intakes` — owned by Task 2 (test: popover row click opens the receipt and the create mutation is not called).
2. A failed shift read must show the error in the status cell, never «Відкрити зміну» — Task 2 (ported from `ReceptionPage.test.tsx:539`).
3. A long supplier name or a 3-item history must not wrap the supplier row — Task 4 (test: the history line has `truncate`/`whitespace-nowrap`, and a voided item still reads «анульовано»).
4. Tab from the supplier picker reaches Брутто after at most one stop («Картка →»), and committed rows' ✕ come after the draft — Task 5 (test: `userEvent.tab()` sequence).
5. A negative balance never changes «Разом» and never sits in the «+ Попередній залишок» slot — Task 3 (test).

---

### Task 0: Branch and spec

**Files:** none changed in code.

- [ ] **Step 1:** Create a worktree on a new branch `feat/compact-reception` from `main` (superpowers:using-git-worktrees). Copy `docs/superpowers/specs/2026-10-23-compact-reception-design.md` and this plan into it.
- [ ] **Step 2:** In the worktree: `npm ci` then `npm run verify`. Expected: green (record the verdict line; note any SKIPPED rows).
- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-23-compact-reception-design.md docs/superpowers/plans/2026-10-23-compact-reception.md
git commit -m "docs(reception): compact reception design and plan"
```

### Task 1: `shared/ui/popover.tsx`

**Files:**
- Create: `frontend/src/shared/ui/popover.tsx`, `frontend/src/shared/ui/popover.test.tsx`
- Modify: `frontend/src/pages/ui-kit/ui/UiKitPage.tsx` (one gallery entry)

**Interfaces:**
- Produces: `Popover`, `PopoverTrigger`, `PopoverContent` (shadcn shape: `import { Popover as PopoverPrimitive } from 'radix-ui'`, `PopoverContent` wraps `PopoverPrimitive.Portal` + `Content` with `align` default `'end'`, `sideOffset` default 6, `data-slot` attributes). Surface classes match `Card`: `rounded-xl border border-line2 bg-card`.

- [ ] **Step 1: Failing test** `popover.test.tsx` — `it('opens its content in a portal on trigger click and closes on Escape')`: render `<Popover><PopoverTrigger>open</PopoverTrigger><PopoverContent>body</PopoverContent></Popover>`; expect `queryByText('body')` null; click trigger → `getByText('body')` present and `document.body` contains it; `userEvent.keyboard('{Escape}')` → gone.
- [ ] **Step 2:** `cd frontend && npx vitest run src/shared/ui/popover.test.tsx` → FAIL (module not found).
- [ ] **Step 3:** Implement `popover.tsx` as above; add a «Popover» block to `UiKitPage` next to the dialog entry.
- [ ] **Step 4:** Re-run → PASS. `npm run lint` in `frontend` → clean.
- [ ] **Step 5: Commit** `feat(ui): popover primitive for the kit`

### Task 2: `PointStrip` — shift status, cash, crates, today's receipts

**Files:**
- Create: `frontend/src/pages/reception/ui/PointStrip.tsx`, `PointStrip.test.tsx`
- Modify: `frontend/src/pages/reception/ui/TodayReceipts.tsx` (becomes the popover body: drop the `Card` and header, keep the list), `TodayReceipts.test.tsx`
- Delete: `PointStatePanel.tsx`, `PointStatePanel.test.tsx`, `ShiftBanner.tsx` (their tests move into `PointStrip.test.tsx`)
- Modify: `uk.json`, `en.json`

**Interfaces:**
- Consumes: Task 1's `Popover*`.
- Produces:

```ts
export function PointStrip(props: {
  pointId: string;
  shift: { status: 'pending' } | { status: 'error' } | { status: 'none' } | { status: 'open'; shift: Shift };
  isOwner: boolean;
  canOpen: boolean;            // me.role === 'point_operator'
  isOpening: boolean;
  onOpenShift: () => void;
  targetCrates: number | null;
  onOpenReceipt: (intakeId: string) => void;
}): JSX.Element
export function TodayReceipts(props: { shiftId: string | undefined; onOpen: (id: string) => void }): JSX.Element // list only
```

Cells, left to right (one row at `lg`, wrapping below): **status** · **«У касі за ягоду зараз»** (emphasised: larger value) · **«Видано за ягоду»** · **«На ранок порахували»** · **crates** «у людей / наділ» · **today** (popover trigger). Sums are computed exactly as `PointStatePanel` does now (move that code, do not rewrite it). Cash cells are links to `pointCashHref`, the crates cell to `cratesHref` (same `?point=` rule as today). The `truncatedCaption` stays under the affected value.

Status cell: `pending` → muted «…»; `error` → `common.somethingWentWrong` with `role="alert"`; `none` → amber «Зміну не відкрито» + «Відкрити зміну» button when `canOpen`, else «Зміну не відкрито — відкриває приймальник»; `open` → success-toned «Зміна відкрита о {{time}}» from `formatTime(shift.created_at, locale)`.

Today cell: trigger reads «Сьогодні ▾», value «{{count}} квит. · {{kg}}» over live rows, plus amber «відкрито {{uah}}» when `openToday > 0`. `PopoverContent` (width ~420 px) holds a `today.title` eyebrow and `<TodayReceipts>`.

i18n (both locales): add `reception.state.shiftOpen` «Зміна відкрита о {{time}}», `reception.state.crates` «Ящики у людей / наділ», `reception.state.cratesValue` «{{out}} / {{target}}», `reception.today.trigger` «Сьогодні», `reception.today.summary` «{{count}} квит. · {{kg}}», `reception.today.open` «відкрито {{uah}}». Delete `reception.state.cashTitle`, `cratesTitle`, `open`, `allotment`, `inField`, `reception.shift.hint` — only after `grep -rn "<key>" frontend/src` shows no other reader.

- [ ] **Step 1: Failing tests** in `PointStrip.test.tsx` (mocks copied from `PointStatePanel.test.tsx:17-35`):
  - port every `PointStatePanel.test.tsx` case (six figures, dash for no opening row, amber only when outstanding, never negative, unset allotment → «… / —», truncated captions ×3, links with/without `?point=`) to the strip;
  - `it('offers the operator «Відкрити зміну» when there is no shift, and calls onOpenShift')`;
  - `it('tells the owner the operator opens the shift, with no button')`;
  - `it('shows the error, not the open button, when the shift read failed')`;
  - `it('reads «Зміна відкрита о 07:12» from the shift’s created_at')`;
  - `it('summarises live receipts only in the today cell and opens the list in a popover')`: 2 live + 1 voided → «2 квит.»; click trigger → three rows listed, voided one struck through;
  - `it('a row click in the popover calls onOpenReceipt and nothing else')`.
- [ ] **Step 2:** `npx vitest run src/pages/reception/ui/PointStrip.test.tsx` → FAIL.
- [ ] **Step 3:** Implement `PointStrip`; trim `TodayReceipts` to the list; adapt `TodayReceipts.test.tsx` (drop the header/badge assertions — they moved to the strip; keep row assertions; `scrolls a tall list` keeps `max-h` + `overflow-y-auto`, now `max-h-[360px]`). Delete `PointStatePanel*` and `ShiftBanner.tsx`. In `ReceptionPage`, render `<PointStrip>` where `ShiftBanner` was (above `OpenShiftAlert`), mapping `shift` as described in Task 6 item «Remove…», and drop the right column's `PointStatePanel` and `TodayReceipts`; the rest of the layout waits for Task 6. Update the `ReceptionPage.test.tsx` cases that read the banner (`:503–566`) or today's card (`:976`, `:1014–1040`) to read the strip / open the «Сьогодні» popover first — expectations unchanged.
- [ ] **Step 4:** `npx vitest run src/pages/reception` → PASS.
- [ ] **Step 5: Commit** `feat(reception): point strip with shift status and today's receipts`

### Task 3: «Розрахунок» — single column, credit, crate return slot

**Files:** Modify `TotalsSection.tsx`, `TotalsSection.test.tsx`, `ReceptionPage.tsx` (pass the two new props only), `ReceptionPage.test.tsx:618`.

**Interfaces:**
- Produces: `TotalsSection` gains `credit: string | null` (positive amount of a negative balance, or null) and `crateReturn?: ReactNode` (rendered after the cash-limit note, before the draft hint). Everything else unchanged.

Order: eyebrow «Розрахунок» · «Нараховано · N поз.» · «+ Попередній залишок» (only when `carried > 0`) · divider · «Разом до видачі» (value `text-3xl`) · credit line (only when `credit !== null`: green, muted, `supplier.credit`) · «Видано готівкою» (`h-11`) · chips · one-line remainder row (amber «Залишок за нами {{uah}} · датою сьогодні» / green «Розраховано повністю» / neutral «—») · cash-limit note · `crateReturn` · draft hint · form error · submit (`h-12`). The internal two-column grid goes. Card padding `p-4`, gaps `gap-2`.

i18n: `reception.totals.eyebrow` → «Розрахунок»; add `reception.totals.remainderLine` «Залишок за нами {{uah}} · додасться датою сьогодні»; `remainderHint`/`settledHint` deleted if no reader.

- [ ] **Step 1: Failing tests** (`TotalsSection.test.tsx`):
  - `it('shows a credit below «Разом» and leaves «Разом» equal to the accrual')`: `accrued='100.00'`, `debt='-50.00'`, `credit='50.00'` → «Разом до видачі» reads 100,00 ₴; the credit text follows the total in DOM order (`compareDocumentPosition`) and there is no «Попередній залишок».
  - `it('renders the crate return slot between the cash note and the submit')`.
  - Adapt the remainder-panel cases to the one-line row (same strings for the amount and «Розраховано повністю»; M1's neutral dash kept).
  - `ReceptionPage.test.tsx:618` (negative balance): keep it, but assert the credit inside the «Розрахунок» card (`within` the card holding «Разом до видачі»).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; in `ReceptionPage` pass `credit` (`cmp(debt,'0') === -1 ? sub('0', debt) : null`) and move `<ReturnedCratesField …/>` into `crateReturn`. `SupplierSection` still renders its own plaques until Task 4.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(reception): single-column settlement card with credit and crate slot`

### Task 4: `SupplierSection` — one row, history in one line

**Files:** Modify `SupplierSection.tsx`; tests live in `ReceptionPage.test.tsx` (`choosing the supplier`, `the supplier's history`).

**Interfaces:**
- Produces: `SupplierSection` loses its `debt` prop (the balance moves to Task 3). Signature otherwise unchanged.

Layout: `flex items-center gap-3` — picker (`flex-1 min-w-0`, max ~360 px) then the history line `min-w-0 flex-1 truncate text-xs text-muted-foreground`: «Останні:» then up to 3 items «{{date}} · {{kg}} · {{uah}}» (voided: struck through, «анульовано» instead of kg), then the «Картка →» link last. Empty history → existing `historyEmpty`. No eyebrow.

i18n: add `reception.supplier.recent` «Останні:». Delete `supplier.eyebrow`, `supplier.debt`, `supplier.debtNote`, `supplier.history` after grep. `supplier.credit` stays (Task 3 uses it).

- [ ] **Step 1: Failing tests** — rewrite `ReceptionPage.test.tsx:586` to `it('picks a supplier and shows their last receipts in one line beside the picker')`: after picking, `getByText('Останні:')` and the three items are inside one element with class `truncate`; `queryByText(/додасться в «Разом»/)` is null. Keep `:946` (voided item struck through, reads «анульовано»).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS, `:618` included (Task 3 already shows the credit in «Розрахунок»).
- [ ] **Step 5: Commit** `feat(reception): supplier row with one-line history`

### Task 5: The draft block and the lines table

**Files:** Modify `LineEditor.tsx`, `LinesTable.tsx`, `LinesTable.test.tsx`; tests in `ReceptionPage.test.tsx`.

**Interfaces:**
- Produces:
  - `LineEditor` gains `canAdd: boolean`, `atCap: boolean`, `onAdd: () => void`. The draft hint stays in `TotalsSection`.
  - `LinesTable` loses `canAdd`, `atCap`, `lineCount`, `netKg`, `onAdd`; keeps `rows`, `disabled`, `onRemove`. Renders nothing when `rows` is empty.

Draft block (one `rounded-lg border border-dashed` box, no eyebrows):
- Row 1 (weighing): Брутто (`flex-[1.4]`, keep the large mono input; its label shortens to «Брутто, кг») · Піддон field or «+ Піддон» link (same reveal rule) · tare rows (type select + stepper + kg; extra rows stack under the first, inside the tare column) · «Інша тара» link under the tare rows.
- Row 2 (pricing): Товар · Сорт · Дод. ціна stepper.
- Preview line, then the warnings, then a footer: «Прибрати позицію» (index > 0) left, «+ Ще позиція» right with `lines.hint`/`lines.capHint` as its `title`/muted text.
- Inputs in rows 1–2 use `h-10` except Брутто (`h-12`).

`LinesTable` sits after the draft block; rows `py-1`.

i18n: `reception.weight.gross` → «Брутто, кг»; `reception.weight.tare` → «Тара»; `reception.grade.grade` → «Сорт»; `reception.grade.bonus` → «Дод. ціна, ₴/кг». Delete `weight.eyebrow`, `grade.eyebrow`, `lines.counter_*` after grep.

- [ ] **Step 1: Failing tests**
  - `LinesTable.test.tsx`: drop the counter assertions (the counter is removed by spec §4); keep tare units, signed amber bonus; add `it('renders nothing without committed rows')`.
  - `ReceptionPage.test.tsx:807` («counts only committed rows in the table's own counter») — delete: the counter no longer exists (spec §4). Say so in the commit body.
  - Add `it('tabs from the supplier to Брутто through only the card link, and reaches committed rows after the draft')`: pick a supplier, commit one line, focus the picker, `userEvent.tab()` twice → Брутто focused; tab onward → the committed row's remove button comes after «Ще позиція».
  - Every other `several lines` / `tare rows` / `ergonomics` test must pass unchanged except label queries (`/Брутто/` regex already matches).
- [ ] **Step 2:** Run reception tests → FAIL on the new/changed ones.
- [ ] **Step 3:** Implement; move the add button and hints out of `LinesTable` into `LineEditor`'s footer.
- [ ] **Step 4:** `npx vitest run src/pages/reception` → PASS.
- [ ] **Step 5: Commit** `feat(reception): two-row draft block above the committed lines`

### Task 6: Assemble `ReceptionPage`

**Files:** Modify `ReceptionPage.tsx`, `ReceptionPage.test.tsx`, `ReceptionPage.portal.test.tsx` (only if a query broke), `uk.json`, `en.json`, `frontend/CLAUDE.md` (the `pages/reception/` line).

**Interfaces:**
- Consumes: `PointStrip` (Task 2), `TotalsSection`'s `credit` and `crateReturn` (Task 3), `SupplierSection` without `debt` (Task 4), `LineEditor`'s `canAdd/atCap/onAdd` and the slimmer `LinesTable` (Task 5).

Layout, top to bottom:
1. Header row `flex items-center justify-between gap-3 pb-3`: `<h1 className="font-display text-xl">` «Прийомка ягоди» + muted «{{point}} · {{date}}» inline; actions as today (point select owner-only and `h-9`, «Ціни дня» owner-only, «Каса точки»). Do not use `PageHeader`.
2. `PointStrip` (only when `pointId` is set and prices exist — same branches as today's `body`), `mb-3`.
3. `OpenShiftAlert` unchanged.
4. The `<form>` itself is the grid — `className="grid gap-3 lg:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]"`, its handlers unchanged — so both cards sit in ONE form and «Прийняти» stays its submit. Left `Card`: `SupplierSection`, `LineEditor`, `LinesTable`. Right `Card`: `TotalsSection` (already receiving `credit` and `crateReturn` from Task 3).
5. Dialogs as today.

Remove `ShiftBanner`/`PointStatePanel` imports; pass `shift` to the strip as `{status:'error'}` when `shift.isError`, `'pending'` when `shift.isPending`, `'open'` with the shift when `shiftOpen`, else `'none'`.

- [ ] **Step 1:** Update any remaining queries in `ReceptionPage.test.tsx` that relied on removed structure (step eyebrows, `PageHeader`'s eyebrow). Expectations stay.
- [ ] **Step 2:** Run `npx vitest run src/pages/reception` → FAIL until wired.
- [ ] **Step 3:** Implement the assembly.
- [ ] **Step 4:** `npx vitest run src/pages/reception` → PASS, including the axe tests (`:1717`, `:1722`).
- [ ] **Step 5:** Orphaned i18n keys: for each key deleted in Tasks 2–5 (all of them), `grep -rn` once more across `frontend/src` (incl. `validate`/`register` string returns). Update the `pages/reception/` line of `frontend/CLAUDE.md` to the new layout (strip, popover, two cards) in one or two sentences.
- [ ] **Step 6:** `npm run verify` from the repo root → paste the verdict line; name every SKIPPED row.
- [ ] **Step 7: Commit** `feat(reception): compact one-screen layout (strip + two cards)`

### Task 7: Prove it fits

**Files:** none, unless the measurement fails (then tighten paddings in the offending card and re-run Task 6 step 6).

- [ ] **Step 1:** Run the dev stack (`docker compose up`), `npm run db:seed`; open `/reception` in the browser pane (`preview_start {name: "frontend"}`), viewport 1366×650, sidebar expanded, operator from the seed with an open shift.
- [ ] **Step 2:** One line: `document.documentElement.scrollHeight <= innerHeight` → `true`. Screenshot.
- [ ] **Step 3:** Worst case: a supplier with a previous balance and our crates; 4 committed lines + a filled draft; a drawer smaller than «Разом» (cash-limit note shows); returned crates with a deposit. Same check → `true`. Screenshot.
- [ ] **Step 4:** Owner on that point: worst case again → `true`. Closed shift, operator and owner: the status cell and «Відкрити зміну» behave as the banner did.
- [ ] **Step 5:** Light and dark theme screenshots of the worst case; check the strip's emphasised cell and the amber/green rows read in both.
- [ ] **Step 6:** Hand the screenshots and the verify verdict to review (superpowers:requesting-code-review).
