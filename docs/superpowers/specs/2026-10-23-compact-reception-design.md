# Compact reception — the whole visit on one laptop screen

**Date:** 2026-10-23
**Source:** the owner's request of 2026-10-23: «зробити прийомку компактнішою, щоб вона
поміщалась на 1 екран та була інформативною, але не перевантаженою», then «перенеси стан
точки нагору». Settled in a grilling session the same day: the target screen, the layout
(variant «C · Фокус» of three shown), the point-state strip, the shift status, and keeping
the supplier's recent receipts. Calls the spec author made alone are marked
**(author's call)**.

**Position in the schema:** none. No backend change, no new read, no new request. This is a
re-layout of `frontend/src/pages/reception` and nothing else.

---

## 1. Why

At 1366×768 — the operator's laptop, about 650 px of browser height — the reception page is
~1 240 px tall. The operator scrolls down to pay and press «Прийняти», and back up to pick
the next supplier, for every visit. Measured on 2026-10-23 at 1366 px wide:

| Block | Height |
|---|---|
| App top bar + page header + «Зміну не відкрито» banner | 243 px |
| 1 · Постачальник | 105 |
| 2 · Вага з тарою | 253 |
| 3 · Товар, сорт і ціна дня | 237 |
| «+ Ще позиція» | 69 |
| 4 · Розрахунок + «Прийняти» | 330 |

Spacing alone buys 150–200 px; the layout has to change.

## 2. Goals, non-goals, anti-goals

**Goals**

- At 1366×768 (browser viewport 1366×650), an operator with an open shift completes a visit
  — supplier, weighing, grade, payout, «Прийняти» — **without scrolling the page**, with up
  to the five-line ceiling (§2.3) on the receipt.
- The order on screen is §2.1's order, left to right and top to bottom.
- Everything the page tells the operator today it still tells them (§4 lists each item and
  where it goes).

**Non-goals**

- Any change to behaviour: the server preview, the refund confirmation, the supplier-switch
  reset, the Enter guard, the portal submit guards, `suggestedPaid`, the clamps, error
  mapping — all stay exactly as they are. Moving a component must not change what it does.
- Phones and tablets. Below `lg` the page stacks into one column (see §5.6) and may scroll.
- Other pages, `AppLayout`, the app top bar.

**Anti-goals** — it fails even if it fits, if:

- the gross weight stops being the most prominent input (§2.1: «брутто великим шрифтом»);
- the operator loses the net weight / line amount before committing a line (§2.4: net is
  never typed, so this line is the only place they see the weighing's result);
- the supplier's previous balance appears in two places again (§3.1: one number, «Разом»);
- the deposit refund for returned crates — cash handed over — gets less visible than today.

## 3. Layout

```
┌ header: Прийомка ягоди · <point> · 23 жовтня     [point ▾ owner] [Ціни дня owner] [Каса точки] ┐
├ strip:  Зміна | У касі за ягоду | Видано сьогодні | На ранок | Ящики у людей / наділ | Сьогодні ▾ ┤
├ (OpenShiftAlert, only when a stale shift is open — unchanged)                                     ┤
┌ input card (wider, ~1.75fr) ───────────────────────┐ ┌ «Розрахунок» card (~1fr) ─────────────┐
│ Постачальник [picker + ОПТ/Фермер badge]  Останні: │ │ Нараховано · N поз.          11 782 ₴ │
│   21.10 · 28 кг · 3 360  19.10 · …   Картка →      │ │ Попередній залишок         + 1 200 ₴ │
│ marker hint (ОПТ → «додайте дод. ціну»)            │ │ ─────────────────────────────────────│
│ ┌ draft line (dashed) ───────────────────────────┐ │ │ Разом                      12 982 ₴ │
│ │ row 1: Брутто [BIG] · (+Піддон) · Тара [type]  │ │ │ (credit note, if balance < 0)         │
│ │        [− n +] kg                              │ │ │ Видано готівкою [ 12 900 ₴ ]          │
│ │ row 2: Товар · Сорт · Дод. ціна [− n +]        │ │ │ [Уся сума] [До сотні] [Усе в залишок] │
│ │ тара 14,40 · нетто 48,00 · 145 → 6 960 ₴       │ │ │ Лишається в залишку 82 ₴ / Розрах. ✓  │
│ │ warnings (one line each, amber)                │ │ │ cash-limit note (§3.6), when it applies│
│ │ [Інша тара] [Прибрати]   [+ Додати позицію]    │ │ │ ───────────────────────────────────── │
│ └────────────────────────────────────────────────┘ │ │ Повернув наших ящиків (у нього 20) [10]│
│ ┌ committed lines table (0–4 rows) ──────────────┐ │ │ Видайте заставу 1 200 ₴               │
│ │ Сорт · Брутто · Піддон · Ящ. · Нетто · Ціна ·  │ │ │ draft hint · form error                │
│ │ Сума · ✕                                       │ │ │ [ Прийняти 3 позиції · 86,9 кг · … ]   │
│ └────────────────────────────────────────────────┘ │ └────────────────────────────────────────┘
└────────────────────────────────────────────────────┘
```

Grid: `lg:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]` or close to it **(author's call)**.
The right card's «Прийняти» sits at the bottom of its card; the card is not sticky — at the
target size nothing scrolls, so sticky buys nothing.

## 4. Every piece of today's page, and where it goes

| Today | Where it goes | Decided by |
|---|---|---|
| `PageHeader` eyebrow (point · long date) + title, two lines | One line: title, then point name and date in muted text | owner (strip under a one-line header) |
| Point `SelectField` (owner), «Ціни дня» (owner), «Каса точки» | Header actions, same rules: picker and «Ціни дня» owner-only, «Каса точки» for both. Picker shrinks to the header's height | owner; «Ціни дня» stays owner-only as today (#221) |
| `ShiftBanner` (amber card, ~70 px) | **Removed.** First strip cell is the shift status: «Зміна відкрита» (+ time it opened, if the shift read has it — see §6) in the success tone, or «Зміну не відкрито» in amber with the «Відкрити зміну» button for the operator; for the owner, «відкриває приймальник» instead of a button. A failed shift read shows `common.somethingWentWrong` in that cell, never the open button (today's guard, unchanged) | owner |
| `OpenShiftAlert` (#114, stale open shift) | Unchanged, under the strip. Rare and important | owner |
| `PointStatePanel` — cash: «На ранок порахували», «Видано за ягоду», «У касі за ягоду зараз», «Відкрито за сьогоднішніми квитанціями»; crates: «Наділ», «У людей»; two «Відкрити» links | The strip. «У касі за ягоду» is the emphasised cell (largest figure — it is what limits the payout, §3.6). Crates become one cell «у людей / наділ». «Відкрито за сьогоднішніми квитанціями» moves into the «Сьогодні» cell (see next row). The two «Відкрити» links: the cash cells link to «Каса точки», the crates cell to «Ящики» (each cell is the link) **(author's call)**. The truncation captions (`isTruncated`) stay, as a small «100+»-style mark on the affected cell **(author's call)** | owner (strip) |
| `TodayReceipts` card | Last strip cell, «Сьогодні ▾ · 12 квит. · 840 кг» (+ «відкрито 3 200 ₴» when non-zero). Click opens a popover with today's existing list — same rows, same order, same struck-through voids, same amber remainder; a row click opens the receipt as today | owner (variant C) |
| `SupplierSection` picker | Top of the input card, unchanged component | — |
| `SupplierSection` amber «Попередній залишок {{uah}} — додасться в «Разом» нижче» | **Removed** — the same figure is in «Розрахунок», which is on screen from the moment a supplier is picked | author, §3.1 |
| `SupplierSection` green credit line (negative balance — since §3.8's correction it arises only from voiding a paid receipt, §3.5) | Moves into «Розрахунок» as a muted line **below** «Разом», never in the «+ Попередній залишок» slot above the divider — it is not part of the sum (`totalToPay` ignores it) and must not read as subtracted **(author's call)** | — |
| `SupplierSection` last 3 receipts (date · kg · amount; a voided one struck through with «анульовано» in place of the kg) + «Картка →» | One line beside the picker: «Останні: 21.10 · 28 кг · 3 360 ₴ · 19.10 · …  Картка →», the voided treatment unchanged. Truncates rather than wraps; empty history shows the existing «historyEmpty» text in the same line | owner («так, дивиться») |
| `SupplierPicker`'s ОПТ / Фермер hint (§2.11) | Stays the picker's own line under it. It already lives inside `SupplierPicker`; moving it next to «Дод. ціна» would mean reaching into the feature — not worth it **(author's call)** | — |
| `LineEditor` «2 · Вага з тарою» + «3 · Товар, сорт і ціна дня» (two sections, two eyebrows) | One draft block, **two rows** (the input card is ~630 px inside with the sidebar expanded; one row needs ~900 px). Row 1, weighing: Брутто (the widest field, keeps its large mono type) · Піддон (field or «+ Піддон» link, right after Брутто — §2.4 takes it off first) · Тара type + `− n +` + tare kg. Row 2, pricing: Товар · Сорт · Дод. ціна. Extra tare rows («Інша тара») render under the tare control and push the block down rather than widen it **(author's call)** | owner (C), author (§2.1 order, width) |
| «+ Піддон» button / auto-reveal at ≥ 20 units | Same rule, in row 1 right after Брутто (today's DOM order) | — |
| Line preview «тара · нетто · ціна → сума» | Kept, directly under the draft row, full width of the block | author (anti-goal) |
| Warnings: gross > 750, tare missing, grade missing, per-crate outside 2–14, `tareError` | Kept, one amber line each, under the preview line | author |
| «Прибрати позицію» on a draft with index > 0 | Kept, in the draft block's footer row | — |
| `LinesTable` (+ Ще позиція, hint, counter, committed rows) | Committed rows sit **below** the draft block, same columns, as today — so their ✕ buttons are not Tab stops between the picker and Брутто. «+ Ще позиція» moves into the draft block's footer (same `canAdd`, same cap hint at five). Rows compact (~26 px). No inner scroll: the cap is five. The counter «N поз. · kg» is dropped: «Нараховано · N поз.» and the submit label already say it **(author's call)** | author |
| `ReturnedCratesField` (only when the supplier holds our crates) | Moves into «Розрахунок», above «Прийняти». Same component and behaviour: pre-fill from crate tare, clamp on blur, the deposit instruction in amber | author (it is cash out) |
| `TotalsSection`: «Нараховано», «Попередній залишок», «Разом», «Видано готівкою» + 3 chips, remainder / «Розраховано повністю» box, cash-limit note, draft hint, form error, submit button with its summary label | The «Розрахунок» card, in that order, single column (its internal two-column grid goes — the card is ~380 px). The remainder box becomes a one-line tinted row under the chips (amber «Лишається в залишку 82 ₴ — датою сьогодні» / green «Розраховано повністю»). `ReturnedCratesField` goes between the cash-limit note and the draft hint; how `TotalsSection` admits it (split or a slot) is the builder's. The draft hint stays, right above the form error **(author's call)** | owner (C) |
| Step eyebrows «1 · ПОСТАЧАЛЬНИК» … «4 · РОЗРАХУНОК» | Dropped from the input card (field labels carry the meaning); «Розрахунок» keeps its eyebrow as the card's title | author |
| Empty states: no point (owner), loading, no prices | Unchanged | — |

## 5. Constraints and details

### 5.1 Height budget at 1366×650

Target: document height ≤ 650 px, with the sidebar **expanded** (the narrower case), in
the **realistic worst case** **(author's call)**:

- left: five lines (four committed + the draft), one tare row, no warnings;
- right: a previous balance, the §3.6 cash-limit note, and a crate return with a deposit.

Warnings, a second tare row, the form error and `OpenShiftAlert` may push past it — they
are exceptions the operator stops to read anyway.

Rough budget: top bar 56 · `<main>` padding 48 · header 32 · strip 44 · gaps 20 → 200;
leaves ~450 for each card. Left ≈ padding 24 + supplier row with history and marker
hint 86 + draft block ≈ 190 (two rows, preview, footer) + table header 20 + 4 rows × 26 +
gaps 16 ≈ 440. Right ≈ 450: the paid input and the submit button shrink from `h-12`/`h-14`
to `h-11`/`h-12` or so to get there.

### 5.2 Order and keyboard

Tab and Enter order follow §2.1: picker → («Картка →» link) → Брутто → (Піддон if shown) →
tare type → units → Товар → Сорт → Дод. ціна → draft footer buttons → committed rows' ✕ →
«Видано готівкою» → chips → returned crates → «Прийняти». DOM order must match this; no
`tabIndex` overrides. The one stop between the picker and Брутто is the «Картка →» link.

### 5.3 The «Сьогодні» popover

No popover primitive exists in `shared/ui` today. The builder picks between restyling the
unused Radix `dropdown-menu` to the kit and adding a small shadcn `popover`; either is fine,
adding it to `/ui-kit` per «Kit hygiene». Whatever it is, it must be a portal sibling of the
form, NOT a React child of `<form>` (the same reason `OpenShiftAlert` is a sibling — React
bubbles `submit` along the fiber tree). The strip sits outside the form, so this holds if the
popover's trigger lives in the strip.

### 5.4 i18n

New or changed labels go into both `uk.json` and `en.json`. Keys whose UI disappears
(`reception.shift.hint`, `reception.supplier.debtNote`, step eyebrows) are deleted only
after checking they have no other reader — mind the `register(…, { validate })` caveat in
`frontend/CLAUDE.md`.

### 5.5 FSD

Everything stays inside `pages/reception`. The strip is a new `ui/PointStrip.tsx` built on
`PointStatePanel`'s reads (or `PointStatePanel` reshaped into it); `TodayReceipts`' list
moves into the popover body. No read is duplicated or recomputed: the strip shows the same
sums `PointStatePanel` computes today.

### 5.6 Below `lg`

One column, DOM order: header, strip (cells wrap to two rows), input card, «Розрахунок».
Scrolling is allowed.

## 6. Left to the builder

- Exact Tailwind sizes, as long as §5.1 holds and the gross field stays the largest input.
- Whether the shift's opening time is available on the shift read; if not, the status cell
  says just «Зміна відкрита» — do not add a request for it.
- How the strip cells render a still-loading or failed read (today: the tile's own fallback).
- Test churn: `ReceptionPage.test.tsx` and the section tests assert on structure in places;
  update them to the new structure without weakening what they assert about behaviour.

## 7. How it is checked

- `npm run verify` (frontend unit tests, lint, i18n rows).
- In the browser at 1366×650, sidebar expanded, operator role, open shift:
  `document.documentElement.scrollHeight <= innerHeight` with one line, and in §5.1's worst
  case. Screenshot both. Repeat the worst case as owner on a point with an open shift.
- Closed shift, operator and owner: the status cell and «Відкрити зміну» behave as the banner
  did.
