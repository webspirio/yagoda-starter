# Whole-app UI/UX & math audit — triage and fix plan

**Date:** 2026-10-24
**Inputs:** six independent audits run against the live dev stack (seeded data, 24.10):
reception · point cash & transfers · cost of day / reweigh / dashboard · debts / suppliers /
journal · crates / admin screens / design system · a visual walkthrough of every route as owner
and operator at 1440, 1280 and 375 px, light and dark. Every money figure was re-derived from
raw API data with `Decimal`/integer kopiykas.
**Goal (owner):** premium, readable, easy to understand; no misleading, duplicated or unneeded
information; every number traceable; tooltips and explanations where a figure is not obvious.

Calls made by the author alone, without a client call behind them, are marked **(author's call)**.
Client decisions already on record (specs, §-rules) are NOT reopened here — see «Kept on purpose».

---

## What the audits verified as correct (no change)

- Reception line math on all 730 lines 01–24.10 (`net = gross − pallet − tare`, `mulWholeHryvnia`,
  Σ lines = header), the preview's `amount_exact → amount`, cap = min(Разом, drawer), R1/R2.
- Point-cash ledger adds up on every sampled point/date (e.g. Шипинки 24.10: 35 820 − 4 000 +
  15 000 = 46 820; 23.10 «Мало бути» 35 910, counted 35 820, −90).
- Supplier debt for all 19 suppliers = Σ live receipts + Σ live top-ups − Σ live payouts; settlement
  lines sum to the debt; journal tiles = Σ live rows over four ranges.
- Cost of day / reweigh Гайове 19.10: 189,42 · 265,19 · 0,43 · 3,11 · 192,96 · 189,07 and the
  network day 208 334,80 — all re-derived exactly.
- Crates bar identity `total = on_hand + in_field + with_berry` at all six points; holder deposits;
  all 91 price-sheet cells equal the newest price record.
- No float arithmetic anywhere in the browser; all money through `shared/lib/money`.

## Cross-cutting design rules (apply in every slice you touch)

1. **Colour carries meaning, red is not a neutral.** Berry (`primary`/`brand`) = brand, the ONE
   primary CTA of a screen, and destructive actions. Not for: «active/open» badges (→ no badge
   when active, `outline` «Неактивна/Неактивний» otherwise; an open shift → `leaf`), plain money
   values (→ neutral ink), row-level repeated actions (→ `outline`/`secondary`, never a column of
   primary buttons). **(author's call)**
2. **Contrast AA.** Small amber/sky text must reach 4.5:1. The light-mode `--amber`/`--sky` tokens
   are darkened for text use; berry TEXT in dark mode uses `text-brand` (the lightened berry),
   never `text-primary` (fill colour, 2.77:1 on the dark card).
3. **Surfaces.** One outlined shell: `border border-line2` (the `Card` look). `SectionCard`,
   `StatTile` and ad-hoc `ring-1 ring-foreground/10` panels move to it (frontend/CLAUDE.md
   «Surfaces» already planned this).
4. **Numbers.** Every money/weight/count goes through `formatUah`/`formatDecimal`/`formatKg`/
   `formatCount`, rendered `font-mono tabular-nums whitespace-nowrap`. In TABLES the unit lives in
   the header («Сума, ₴», «Нетто, кг», «Ціна, ₴/кг») and cells are plain; stand-alone figures carry
   their unit. Never a raw `"25.00"`, never a hand-built `… ₴`.
5. **Signs.** A label must agree with its sign. A negative shortfall is «Понад наділ 2 800,00 ₴»,
   not «Не вистачає −2 800,00». A count difference is named: «Недостача 90,00 ₴» (bad) /
   «Надлишок 50,00 ₴» (amber) / «Зійшлося» (leaf) — one helper, everywhere a count or a disputed
   transfer is compared.
6. **Words (glossary).**
   - «точка» for a collection point everywhere in UI copy (pickers, hints). The cost-of-day /
     reweigh WEIGHT columns keep «Пункт · База» (spec 10-23 §4.4) and reweigh adopts the same
     names: «Пункт · База · Різниця», «Разом на базі».
   - «Наділ» for both targets: «Наділ каси», «Наділ ящиків» (was «Ціль …» on /points).
   - «залишок» = the supplier's WHOLE balance we owe. A receipt's unpaid part = «не виплачено».
     A top-up = «доплата» (badge «Доплата», action «Додати доплату», toast «Доплату додано»).
   - «завдаток» for a crate deposit (not «застава»).
   - On past dates nothing says «сьогодні»: «за день» instead.
7. **No developer notes in the UI.** Issue numbers, «ще немає вікна…», «поки не рахуються» columns —
   removed or rewritten as user help.
8. **Loading/error never reads as zero.** A figure not yet known shows «—» (or the skeleton), never
   `0,00 ₴`.
9. **Layout.** Pages do not add their own `px-4 py-6` on top of `<main>`'s padding; widths go
   through the templates. Equivalent big figures use two sizes only. Uppercase micro-labels use
   `<Eyebrow>`. Below 400 px KPI grids go one column and action rows stack.
10. **Shell point select** appears only on routes that use it (the point screens). Elsewhere the
    slot is empty; the operator's chip shows the point's NAME.

---

## Fix list by slice

Priorities: **P0** wrong/misleading money · **P1** confusing/inconsistent · **P2** polish.

### A. Receipts & intakes backend (`backend/src/intakes/**`, migration, `widgets/receipt/**`, `entities/intake`, `shared/ui/receipt.tsx`)

- **P0 A1 — reprinted receipt prints a moved «Борг/Разом/Залишок».** The intake receipt derives
  them from the supplier's LIVE debt; any later payout/receipt/top-up changes a reprint (Неля
  Фурман HAI-IN-20261024-001 reprints Борг 321 816,89, true 323 816,89). Add
  `intakes.balance_after` (NOT NULL), written under the supplier ledger lock exactly like
  `payouts.balance_after` (#145), backfilled as-of each intake; the receipt prints
  `Залишок = balance_after`, `Борг = balance_after − amount + paid_amount`. **(author's call —
  #145 left it out of scope, not rejected.)**
- **P0 A2 — voided receipt prints Борг/Разом/Залишок** that count its own amount. A voided
  receipt prints the lines and «Сума» and «Анульовано — у залишок не входить» instead of the
  balance block.
- **P1 A3 — journal/intake list order.** Rows run 24.10 → 19.10 → 23.10; order by
  `business_date DESC, created_at DESC`.
- **P2 A4 — receipt dialog:** title «Квитанція {code}», line count as subtitle; footer sticky so
  «Друк/Анулювати» are reachable at 1440×900; payout receipt copy «тут можна анулювати документ»
  only when the button is shown.

### B. Reception (`pages/reception/**`, `features/pick-supplier`, `features/top-up-intake`, `features/edit-supplier`)

- **P0 B1 — «Новий борг з цієї здачі» ignores a negative previous balance**; «Залишок за нами після
  здачі −200» contradicts its label. newDebt = max(0, accrued − paid − max(0, −debt)); a negative
  remainder reads «Постачальник винен нам {abs}».
- **P0 B2 — balance pending/error shows «Разом» without the old debt.** Pass the state through;
  «Попередній залишок» shows «…»/«не вдалося прочитати», «Разом» shows «—», submit stays blocked
  until known.
- **P1 B3 —** «Уся сума» disabled while the cap is unknown (like «До сотні»).
- **P1 B4 —** the cash strip names every term: «на ранок Y · + надійшло T · − видано X» (from
  `breakdown`), so it adds up to the drawer figure.
- **P1 B5 —** refund confirm button «Видав обидві суми» when two sums are paid.
- **P1 B6 —** today's receipts appear twice (strip popover and card): the strip keeps the summary
  and scrolls to the card.
- **P1 B7 —** per-receipt «залишок» → «не виплачено»; strip «відкрито» → «не виплачено»; picker's
  bare amber figure gets the word «залишок».
- **P1 B8 —** «застава» → «завдаток»; top-up dialog «Додати доплату»/«Доплату додано»; screen
  «Новий борг з цієї здачі» → «Борг з цієї здачі».
- **P1 B9 — mobile 375:** «+ Ще позиція» overlaps «Піддон», «Усе в залишок» clipped — stack the
  action rows.
- **P2 B10 —** LinesTable headers with units, hide the Піддон column when every row is 0;
  `errors.paidFormat` example with a comma; `lines.capHint` → «Не більше 5 позицій в одній
  квитанції»; line count excludes the blank draft; `success` → `leaf`; `text-[10px]` → ≥ 11 px;
  one label case for form fields (sentence case).

### C. Point cash & transfers (`pages/point-cash/**`, `pages/transfers/**`, `features/count-shift`, `receive-/resolve-/send-transfer`, `set-point-target`, `set-cash-explanation`, `set-operator-note`, `widgets/count-result`, `entities/{point-cash,cash-count,transfer,shift}`)

- **P0 C1 — «Видано за минулі дні» is a season-long running total** (Шипинки −48 939, capped at
  100 payouts) inside the card «Звідки взялося це число». The row, its truncation key and
  `twoRowsNote` go; today's paid-down-old-balances already lives in «Звірка каси».
- **P0 C2 — «Звірка каси» rows do not sum to their total** (23 986 / 0 / −4 000 / −19 986 →
  «Разом вийшло 4 000»). Lay it out as an equation: «Нараховано 23 986 − пішло в залишки 19 986 =
  … ; видано без ягоди 4 000 …» with unsigned breakdown terms and one «=» total that the visible
  terms produce.
- **P0 C3 —** disputed-transfer footer «Каса не змінилася ні на копійку» is false (the reported
  sum is credited): «У касу зараховано {{uah}} — скільки ви нарахували. Остаточну суму встановить
  керівник.»
- **P0 C4 —** «Не вистачає до наділу … керівник ще не переказав» while 24 000 ₴ is on the road:
  hint «з них {{uah}} уже в дорозі» (Σ `sent` transfers to that point via `sum`); same on
  «Перекази».
- **P0 C5 —** negative shortfall → «Понад наділ {abs}» (tile and table).
- **P1 C6 —** «сьогодні» on past dates → «за день».
- **P1 C7 —** one discrepancy helper (rule 5) for the shift panel pill (which today shows no amount
  and a green «✓ Розбіжність»), the result dialog, the history table, the ledger and the dispute
  details.
- **P1 C8 —** duplicates: drop the opening row's «наділ …» hint; the shift panel shows status,
  times, actions, recounts — not the ledger's figures again.
- **P1 C9 —** one tone rule for cash (negative = amber on the tile AND the ledger; plain cash is
  neutral ink, not berry).
- **P1 C10 — «Перекази»:** add a `status:'disputed'` read so every open dispute is resolvable
  (Конищів has 3, the page shows 2); remove the «Ящиків · поки не рахуються» column or fill it
  from the transfer's crates; inactive points hidden; row «Надіслати» → `outline`.
- **P1 C11 —** resolve dialog shows «Відправили · Точка нарахувала · Різниця».
- **P1 C12 —** «Каса за ящики» on a past date: hint «на сьогодні — книга ящиків не має дати».
- **P1 C13 — mobile:** day-feed rows become two-line cards; «Анулювати» never overlaps amounts;
  payout rows keep the amount column aligned.
- **P2 C14 —** copy: toast «…зайшли в касу; нестача до наділу зменшилась»; «Закрито: {{name}}»;
  «Вийшло з каси» hint «уся видана готівка — і за сьогоднішню ягоду, і за старі залишки;
  анульовані — доки гроші не повернули»; late change «Змінилося після закриття»; one term set
  «Мало бути · Пораховано · Різниця»; history truncation note; unexplained-incidents line
  «Невирішених розбіжностей: N · {sum}» for the owner; KPI tiles align when one lacks a caption.

### D. Debts, suppliers, journal (`pages/{debts,supplier-card,suppliers,journal}/**`, `features/{settle-payout,void-document}`, `entities/{supplier,payout}`, `backend/src/supplier-balance/**`)

- **P0 D1 — payout dialog offers what the server refuses:** ceiling = min(debt, berry cash of the
  point), prefilled and «Усе — {min}»; submit disabled above it; hint «У касі за ягоду {{cash}} —
  більше зараз видати нема з чого. Решта лишається в залишку.»; no open shift → explained, not a
  server error.
- **P0 D2 —** debts tiles show «—» while loading/error, not 0.
- **P0 D3 — supplier card history** is cut unevenly (100 newest receipts, all payouts) with a wrong
  caption: cut merged rows at the newest «oldest loaded» date; caption «Показано історію з {{date}}
  — давніші документи в «Журналі прийомки»» with a link.
- **P1 D4 —** «Відкриті залишки» shows the oldest 10 then «Показати всі (N)»; partly paid lines say
  «з {amount}».
- **P1 D5 —** payout and top-up rows in the history carry date/time.
- **P1 D6 —** top-up badge «Доплата» (glossary).
- **P1 D7 —** suppliers toolbar in one row; journal name lookup not capped at 100 (page through);
  `/suppliers/:id` and `/suppliers` do not show the shell point select (rule 10).
- **P1 D8 —** «Видати без ягоди» row buttons → `outline`.
- **P2 D9 —** drop the eyebrow count that repeats the tile; breakdown line ends « = {{debt}}»;
  payouts tab column «Документ»; voided amounts struck through; «Стан» empty for live rows;
  `tabular-nums font-mono` on the suppliers list; one date format on the card; «Постачальників із
  залишком» counts `debt > 0` (backend); age badge colour scale so 45–54 days are not all the same
  red as 8 days.

### E. Cost of day, reweigh, dashboard (`pages/{cost-of-day,reweigh,dashboard}/**`, `entities/{cost-of-day,day-expense,reweigh,intake-top-up}`, `backend/src/{day-costs,reweighs}/**`)

- **P0 E1 — «Усі точки»: a product reweighed at only some points looks like the network figure.**
  Badge «перезважено {n} з {m} точок» + muted «без {kg} кг»; under the day formula «враховано
  611,10 кг з 1 точки з 6».
- **P1 E2 —** dashboard «Нараховано» is receipts only while cost-of-day's includes доплати: the
  dashboard says «Сума квитанцій».
- **P1 E3 —** the day formula names its operand when products are unweighed («нараховано по
  перезваженому …»).
- **P1 E4 —** «Звірено» names each operand by product («Кизил 55,62 + Малина 2 109,57 = …»).
- **P1 E5 —** reweigh's shortfall rate explains itself: «Середня ціна закупки з доплатами: 113 044,20
  ÷ 596,80 = 189,42 ₴/кг» (needs `accrued`/`top_ups` on the reconciliation product — backend).
- **P1 E6 —** reweigh columns renamed per the glossary; picker label «Точка».
- **P1 E7 —** dashboard «Залишків по мережі» uses the server's `total_owed`, label «Всього винні».
- **P1 E8 —** reweigh on a day with no shift: ONE empty state «Цього дня точка не працювала —
  переважувати нічого», form hidden.
- **P1 E9 —** units in headers only (rule 4); «Собівартість, ₴/кг».
- **P1 E10 — mobile:** dashboard KPI grid one column < 400 px, money `whitespace-nowrap`.
- **P2 E11 —** «Частка, ₴» for both groups; one sign for shortfall money; on-screen duplicate
  heading print-only; «0,00 ₴ не розподілено» hidden when zero; «разом» dropped with one entry;
  expenses: delete undo/confirm, accessible name «Сума витрати, ₴», 0 disables «Додати», Enter
  submits; reweigh `DateStepper` gets «Сьогодні»; reweigh placeholders with a comma; one apostrophe;
  noise badges removed; dashboard: «Квитанцій», «Найбільші залишки» link to the supplier card,
  inactive points collapsed; dead `price_by_our_weight` removed or shown; double page padding.

### F. Design system, shell, crates, admin (`frontend/src/index.css`, `shared/ui/**`, `shared/lib/**`, `app/layouts/**`, `pages/{crates,catalog,prices,points,users,settings,profile,login,not-found}/**`, `features/{issue-crates,return-crates}`, `entities/{crate,collection-point,product-grade,tare-type}`)

- **P1 F1 — tokens:** light `--amber`/`--sky` text-safe (≥ 4.5:1 on card and page); neutral focus
  ring; `text-primary` text → `text-brand` in the files of this slice and in shared/ui.
- **P1 F2 — surfaces:** `SectionCard`, `StatTile` → `border border-line2`; StatTile's berry tone is
  not used for plain money (C9/E-slices pick their tone).
- **P1 F3 — `SelectField`** chevron detached: the width belongs to the wrapper.
- **P1 F4 — shell:** point select only on point routes, operator chip shows the point name,
  collapsed sidebar tooltips, mobile header shows the page title.
- **P1 F5 —** «Видати ящики» shows «Завдаток: {{units}} × {{price}} = {{total}}» (new `mulInt` in
  `shared/lib/money`) and the toast prints the server's `deposit_taken`.
- **P1 F6 —** crates bar: «У дорозі: {{n}} — ще не прийнято переказ».
- **P1 F7 —** raw decimals on prices/points/catalog → formatters; prices sheet header «Ціна дня,
  ₴/кг»; «різні · …» readable; no-op price changes not logged as changes (if UI-side).
- **P1 F8 —** one table look: the hand-written tables (`InFieldTable`, `PriceSheet`) on the `Table`
  primitives (reception's `LinesTable` is slice B's).
- **P1 F9 —** pages padded twice (crates, prices) and widths via templates; Profile/Login/404 on
  `PageHeader`, 404 back link a `Button`.
- **P1 F10 —** «Активна» badges (rule 1); «Ціль ящиків/каси» → «Наділ …»; create buttons get `Plus`;
  `h-[46px]` → scale; prices row «Встановити всім» → `outline`.
- **P2 F11 —** `<Eyebrow>` for hand-copied micro-labels; `formatCount`; two big-number sizes;
  tooltip not berry-filled; sidebar label contrast; profile avatar initials from first+last name and
  no «Приймальник №» for the owner; login shows the product name; crate dev notes removed.

---

## Kept on purpose (not reopened)

- Receipt footer labels «Сума · Борг · Разом · Виплачено · Залишок» — client MUST, 23.10 (R6).
- Hiding доплати from the operator and the picker's balance figure — asked, not committed; client
  to confirm.
- Supplier list name order «Прізвище Ім'я» — spec 2026-10-14.
- Empties going negative, amber with «−» — client 23.10.
- Whole-hryvnia line rounding, «До сотні», no confirm step before «Прийняти» — client.
- The journal's «Прийнято ягоди на суму» without доплати — #102 (a hint «без доплат» is added).
