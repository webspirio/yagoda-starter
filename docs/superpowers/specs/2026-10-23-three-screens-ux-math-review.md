# Прийомка · Собівартість дня · Переважування — UX & math review fixes

**Date:** 2026-10-23 (evening, after the client call of the same day)
**Inputs:** the 23.10 client call (Fireflies «Yagoda», 01M5EXFMXS67J793A8QMZ5ZJ2F), three
independent reviews (reception, cost-of-day, reweigh — math re-derived from the live dev API
for Гайове 19.10, shift `cb4c6a33-…`), Full HD screenshots as operator and owner.
**Goal the owner set:** simple, clean, not overloaded, key info only, and **every number on
screen traceable — readable as a formula a person can re-check with a hand calculator.**

Calls the author made alone are marked **(author's call)**.

---

## 0. Shared — one price for the shortfall

The same 1,40 кг of Малина (Гайове 19.10) printed **229,99 ₴** on «Переважування» and
**265,19 ₴** on «Собівартість дня». The 35,19 ₴ gap is exactly the 15 000 ₴ доплата's share
(1,40 × 15 000 ÷ 596,80): reweigh priced at receipts only (164,28 ₴/кг), cost-of-day at
receipts + доплати (189,42 ₴/кг). **265,19 is right:** reweigh spec §3.12 includes top-ups on
the client's instruction, and on 23.10 the client confirmed доплата feeds the average price.

- `topUpsByGradeForShift` (`day-costs/top-up-allocation.ts`) is now the ONE reader of a
  shift's доплати per grade; both screens call it.
- The «1,4 кг vs 106,3» complaint itself is already fixed by `98a8a8ab` (per-product shortfall).

## 1. Прийомка ягоди

| # | Change | Fact |
|---|---|---|
| R1 | «Прийняти» (and Enter) is **disabled** while the typed «Видано готівкою» is above the cap; the amber hint says the cap. No silent clamp on submit. | Client MUST, 23.10 22:04–26:27 («кнопка має бути неактивна») |
| R2 | Submit label: **«Прийняти · видати {X} ₴»**, or **«Прийняти без виплати»** when nothing is paid. Kilograms leave the button. | Client MUST, 26:34–27:10 |
| R3 | «Разом» = accrued + the **signed** balance (§3.5 correction 04.09: «"Разом" дорівнює балансу»). A negative balance shows as «Попередній залишок − 500,00 ₴»; the «Переплата за нами» plaque goes (§3.8 is cancelled: «Немає переплати»). The cap never goes below 0. | Server already caps at the signed balance (`payout-writer.ts:58-66`); today the screen suggests a payout the server refuses |
| R4 | The draft line reads as its own formula: **«52,30 − 1,20 тара = 51,10 кг × 28,00 = 1 430,80 → 1 431 ₴»** — pallet shown when non-zero, the exact product and the whole-hryvnia result both printed when they differ. The exact product comes from the server (`amount_exact` on the preview item), never browser multiplication. | §2.4, §2.12; a calculator gives 1 430,80, the screen showed only 1 431,00 |
| R5 | Committed rows: «Тара» in kg (not a unit count across mixed types), «Ціна» the final price (price + bonus). | Calculator check of `брутто − піддон − тара = нетто` |
| R6 | Printed receipt (`widgets/receipt`): footer in the agreed order **Сума · Борг · Разом · Виплачено · Залишок** — «Виплачено» always printed (0,00 when nothing paid); «Операція: прийомка ягоди» removed; a **tare block** at the end, one line per tare type summed over the receipt's lines (e.g. «Чешка — 4»). «Борг» = Залишок − Сума + Виплачено. | Client MUST, 02:43, 03:10–06:33, 38:18–47:06 |
| R7 | `SupplierProfile` popover (WIP): drop the balance tile — the balance already lives in «Попередній залишок» (compact-reception spec anti-goal: one number) and includes доплати the client wants kept from the operator. Keep contacts, crates on hand, the season, the last receipts, the card link. | Spec 2026-10-23 §2 anti-goals; call 06:49–16:33 |
| R8 | Grade options and the price stepper use the locale's decimal comma («28,00»), like every other figure on the screen. | Consistency |

**Not doing:** hiding доплати from the operator (asked, not committed — confirm first);
crates going negative (a business-rule change to `CrateStockGuard`, follow-up); a confirm
step before «Прийняти» (client rejected it, 27:10–29:20); rounding «Уся сума» (§12.1 open);
removing «Новий борг / Гасимо з попереднього залишку» (added at the owner's request an hour
earlier — kept).

## 2. Собівартість дня

| # | Change | Fact |
|---|---|---|
| C1 | **Each ₴/кг half is its own quotient:** `shortfall_per_kg = div(shortfall_amount, reweighed_kg)`, `expenses_per_kg = div(expenses_amount, reweighed_kg)`, `per_kg = add(both)`. Supersedes the 2026-10-23 single-table spec §3.2 `allocate` split, which summed exactly but did not survive a ÷ check on some days. | Calculator: 265,19 ÷ 611,10 must print 0,43 |
| C2 | **Total row shows sums only** (Пункт · База · Не доїхало · Нараховано · Своя ₴); its per-kg cells are empty. Under the table, one formula line for the day: «(113 640,80 + 1 900,00) ÷ 611,10 = 189,07 ₴/кг — середня собівартість кілограма дня». | 185,54 + 0,43 + 3,11 = 189,08 ≠ 189,07 printed in the same row — mixed point-kg and base-kg |
| C3 | **Доплати visible:** each product carries `top_ups` (server). «Нараховано» shows «у т.ч. доплати 15 000,00» under the figure when non-zero; the per-kg column is named «Ціна закупки, ₴/кг» (189,42 is on no receipt — receipts average 164,28). The доплати chip shows the total amount. | Review C: the 15 000 ₴ was invisible |
| C4 | **Expanded row = this row's calculator chain**, server figures only: «Ціна закупки: 113 044,20 ÷ 596,80 = 189,42 · Недостача: 1,40 кг × 189,42 = 265,19 ₴ · Собівартість: 189,42 + 0,43 + 3,11 = 192,96», then the grade rows as today. | Traceability |
| C5 | Drop the «Δ до квитанції» column (it repeats the two cells before it) — 11 → 10 columns, and the «(§8.6)» rule code leaves the client-facing tooltip. | Overload; fits 1366 better |

**Not doing (needs the client):** allocation by purchase value (§8.5 ②, client asked on 23.10
59:56) — it must be stored per day (§8.5 «правило належить дню») and the call's +39,83 ₴/кг
was inflated by the since-fixed 106,3 кг bug; today's figure is +3,54. The comparison
(19.10: by weight Кизил 41,54 / Малина 192,96; own shortfall + expenses by value 38,64 /
193,04) goes back to the client. «Усі точки» in the point picker replacing «Середня ціна по
мережі» — a feature of its own.

## 3. Переважування

| # | Change | Fact |
|---|---|---|
| W1 | The tare type defaults to the crate («Ящик»), as reception does. | With 115 crates the «Лубянка 0,30» default overstates net by 103,5 кг, silently |
| W2 | The shortfall is priced at the product's accrued average **with доплати** (§0); the server returns `rate` per product and the clamped day totals (`missing_total_kg`, `missing_total_amount` — shortfalls only, a surplus never offsets another product's shortfall, as on cost-of-day). The browser sums nothing. | Review W: the browser total let a surplus cancel a shortfall |
| W3 | A shortfall prints **«−1,40 кг»** and **«1,40 × 189,42 = 265,19 ₴»** in amber (the cost-of-day colour for недостача); a surplus prints «+x кг» muted with no money. | §8.2; one colour per concept |
| W4 | Net weight shows its formula under the big figure and in every committed/day row's title: **«300,60 − 15,60 − 48 × 1,20 = 227,40»**. | Calculator check |
| W5 | **Crates and пересорт** in «Звірка з пунктом»: per product, a muted second line «ящ. {point} → {base}», and grade sub-rows (point kg → base kg per grade) so a re-grading reads at a glance. Counts come from the server (tare units per product from `intake_item_tare_types` / `reweigh_item_tare_types`), never inferred from kg. | Client MUST, 47:55–53:07 and 10-06; «пересорт навіть за однакової ваги» |
| W6 | Trim copy: the long page description, the drafts hint, the post note, step eyebrows shorter. | Overload |

**Not doing:** surplus handling (§8.2 правка), money on пересорт, a separate base crate-count
input (crates are already entered per line), redesigning the form (the client praised it,
1:04:28).
