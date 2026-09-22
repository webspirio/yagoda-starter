# Reception review residuals — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close the residuals the final review of PR #137 parked: the clamp note's warning tone, the picker's keyboard leftovers, and the tests those leftovers never had.

**Architecture:** No new state, no new dependency. One small kit extension (`Field.hintTone`) so a hint can be a warning; the picker's trigger gains the keyboard entry the WAI-ARIA combobox pattern expects.

**Spec:** `docs/superpowers/specs/2026-09-21-yagoda-reception-parity.md` (§3 picker + «4 · Розрахунок»; §5 records the deviations). Review findings are the plan's argument: I3-tone, M5, M7, M10 of the 2026-09-21 final review.

## Global Constraints
- FSD import direction only; no new npm dependency; copy in BOTH `uk.json` and `en.json`.
- Money/weight as STRINGS through `shared/lib/money`.
- React Compiler lint: no setState in effects, no refs during render.
- Tests run with i18n in English; assert the `en.json` twin.
- Commit per task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no push (the controller pushes).

---

### Task 1: `Field.hintTone` and the clamp note's warning tone

**Files:** Modify `frontend/src/shared/ui/field.tsx` (+ its test), `frontend/src/pages/reception/ui/TotalsSection.tsx` (+ test).

- `Field` gains `hintTone?: 'muted' | 'warning'` (default `'muted'`); `'warning'` renders the hint `<p>` with `text-amber` (the token `LinesTable`/`TotalsSection` already use for the amber remainder) instead of `text-muted-foreground`; the `id`/`aria-describedby` wiring is unchanged. Test: the hint paragraph carries the warning class when `hintTone="warning"` and the muted one by default.
- `TotalsSection` passes `hintTone="warning"` ONLY while the clamp note (`overCap`/`overCash`) is the hint; the plain state (no note) stays muted. Test: with `paid` over the cap the hint has the warning class; otherwise not.
- Commit: `fix(reception): the clamp note under «Видано готівкою» is a warning again (Field.hintTone)`.

### Task 2: The picker's keyboard entry and its state on close (M7)

**Files:** Modify `frontend/src/features/pick-supplier/ui/SupplierPicker.tsx` (+ `SupplierPicker.test.tsx`).

- `aria-controls` on the trigger only while the listbox is mounted (`open`), so it never references an absent id.
- `ArrowDown` (and `ArrowUp`) on the CLOSED trigger opens the list and highlights the first (last) option — the trigger gets its own `onKeyDown`; Enter/Space keep the native button toggle.
- Escape and outside-click reset `search` to `''` and `active` to `-1` (the same reset `pick` already does) so reopening starts clean.
- Tests: ArrowDown on the closed trigger opens and highlights index 0 (assert `aria-activedescendant`); `aria-controls` absent when closed, present when open; after Escape the search box is empty on reopen.
- Commit: `fix(pick-supplier): keyboard opens the list from the trigger; closing forgets the search`.

### Task 3: The untested paths (M10) and the empty key (M5)

**Files:** Modify `SupplierPicker.test.tsx`; `frontend/src/pages/reception/ui/LineEditor.tsx`; `uk.json`/`en.json`.

- Tests: Escape closes and restores focus to the trigger; a click outside closes without picking; owner mode keyboard: ArrowDown walks across the «Наша точка» → «Інші точки» group boundary and Enter picks the highlighted option from the second group (the `home.length + i` offset).
- `reception.weight.rowWeight` is `"{{kg}}"` in both locales — a key with no translation. Render `formatKg(...)` directly in `LineEditor.tsx` and delete the key from both files (grep first: `t()` and `register()` paths).
- Commit: `test(pick-supplier): Escape, outside-click and the owner's grouped keyboard path; drop the empty rowWeight key`.
