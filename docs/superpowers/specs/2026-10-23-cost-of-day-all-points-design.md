# Cost of Day — «Усі точки»

**Date:** 2026-10-23
**Rules:** `26-rules-by-example.md` §8.4 (собівартість), §8.6 («сума ÷ вага, ніколи не середнє з
середніх»).
**Client request:** 23.10 call (Fireflies «Yagoda», 01M5EXFMXS67J793A8QMZ5ZJ2F, 1:15:13–1:19:36).
**Builds on:** `2026-10-23-cost-of-day-single-table-design.md` and
`2026-10-23-three-screens-ux-math-review.md` §2 (one table, colour bands, sums-only total row,
every figure a server field readable as a formula).

## 1. Why

The client does not want a separate «Середня ціна по мережі» screen: «ми просто тут вибираємо
замість не конкретну точку … кажемо всі» (1:17:40). «Аркуш керівника» was only ever going to be
a printout, and this page already prints (1:19:03). Both nav items are disabled placeholders
today; neither has a page.

The network figure is the sum of every point's day: «собівартість по усій мережі — це просто
підсумок кожної точки» (1:18:13). When choosing «Усі точки» there is no expense entry, because
an expense belongs to one point (1:17:55); the expenses already entered on each point are still
included.

## 2. Decisions

- **One day.** The page's date stepper, unchanged. A date range is not part of this
  (user, 2026-10-23).
- **Per product: Σ повна вартість ÷ Σ база кг** over the day's points: §8.6, never the mean of
  the per-point prices. In the call the client gave «(38 + 50) ÷ 2» as an example (1:16:48). §8.6
  forbids that formula, and the page does not use it.
- **«Повна вартість» comes from each point's own cost-of-day**, the same `full_cost` that the
  single-point page uses, so the network row adds up each point's own figures. No new allocation
  happens across points: each point's недостача and витрати are pooled over that point's
  kilograms only, as on its own page.
- **A point's sub-row prints that point's own собівартість** (`price_cost`, identical to its own
  page). Its «повна ÷ база» can be one kopiyka off that figure because of rounding. Only the
  network row's собівартість is a quotient of the figures printed in that same row (user,
  2026-10-23).
- **«Усі точки» is `?point=all`** (author's call). Picking a real point replaces it in one URL
  write. `?point=all` is never stored as the remembered point. Every other screen ignores it,
  because `keepUuids` drops it there.
- **Removed:** the `nav.network` and `nav.sheet` items and their strings. There is no route to
  redirect.

## 3. Backend — `GET /reports/cost-of-day?date=YYYY-MM-DD`

This route replaces `GET /reports/network-average`, which no screen reads. Owner only. It reuses
`NetworkAverageQueryDto`. `NetworkAverageService` stops calling `productCostRows` itself and
instead calls `CostOfDayService.forShift` for every shift on the date, ordered by point name.
Then it only **sums and divides**, with every operation going through `money.ts`.

Per product, the row sums over the **counted** points: the points that weighed the product in
full, or every point that has it if none did. A product with no complete point reads like the
single-point page's «не переважено» row: point figures are printed and everything after them is
«—».

| field | value |
|---|---|
| `intake_net_kg`, `accrued`, `top_ups`, `shortfall`, `shortfall_kg`, `shortfall_share`, `expenses_share`, `full_cost`, `reweigh_net_kg` | Σ over counted points; the base-side fields are `null` when `complete` is false |
| `price_was` | `div(accrued, intake_net_kg)` |
| `price_cost` | `div(full_cost, reweigh_net_kg)`, or `null` |
| `complete` | at least one point weighed the product in full |
| `unweighed` | `{ intake_kg, accrued }` over the points that are not complete, when `complete` is true; otherwise `null` |
| `points[]` | that point's product figures, plus `point_id`, `point_name`, `shift_id`, `provisional` |

The row identity holds exactly, because it holds exactly on each point:
`accrued − shortfall + shortfall_share + expenses_share = full_cost`.

The day-level fields are:

- `points[]`, one per shift: `point_id`, `point_name`, `shift_id`, `provisional`,
  `expenses_amount`, `weighed` (that point's `per_kg !== null`).
- `accrued`, `expenses_amount`, `reweighed_kg`, `shortfall_amount`: Σ over the points.
- `expenses_weighed`: Σ expenses of the points where something was weighed. Expenses of a point
  with nothing weighed have not been spread over any kilograms yet.
- `weighed` (total row, sums only): Σ of the complete product rows' `intake_kg`,
  `shortfall_kg`, `accrued`, `shortfall`, `shortfall_share`, `expenses_share`, `full_cost`.
  `null` when nothing in the network was weighed.
- `price_cost_avg`: `div(weighed.full_cost, reweighed_kg)`. The day formula becomes
  «(weighed.accrued + expenses_weighed) ÷ reweighed_kg = price_cost_avg», which is exact because
  `weighed.full_cost = weighed.accrued + expenses_weighed`.
- `unweighed`: `{ intake_kg, accrued }`, summed over the products' `unweighed` and the
  incomplete rows.
- `checks`: `{ points_ok, total_ok }`. `points_ok` is true when every point's own
  `shares_ok && total_ok` holds. `total_ok` checks
  `weighed.full_cost + unweighed.accrued + (expenses_amount − expenses_weighed) = accrued +
  expenses_amount`. Both are reported rather than assumed, and both are `null` when `weighed`
  is.

## 4. Frontend — `pages/cost-of-day`

- **Picker:** «Усі точки» is the first option, and it is shown to the owner only.
- **In all-points mode** the page shows:
  - A header, «Усі точки · {date}».
  - A status line: «N точок», plus the points still open (provisional) and the points with
    nothing weighed.
  - A read-only expenses line: «Витрати: Гайове 1 900,00 · Шипинки 3 800,00 · разом 5 700,00».
    The total is the server's figure.
  - **No `ExpensesStrip`.**
- **The network table** keeps the single-point table's bands and order. The per-kg halves become
  money, because a ₴/кг half differs from point to point:
  Товар | **Вага** Точка · База · Не доїхало | **Закупка** Нараховано · Ціна закупки ₴/кг |
  **Недостача** Своя ₴ (−) · Частка дня ₴ (+) | **Витрати** Частка ₴ (+) | **Результат** Повна
  вартість ₴ · Собівартість ₴/кг.
  - Expanding a product shows its formula, «{full_cost} ÷ {kg} = {price_cost} — сума ÷ вага по N
    точках», then one sub-row per point. Each sub-row carries that point's own собівартість, and
    a point that is not complete gets a «не переважено» badge.
  - Below the table: the total row, the unweighed line, the day formula, and the line «Середня по
    мережі — сума ÷ вага, ніколи не середнє з середніх цін точок.»
- **Print** uses the same button and the sheet title «Собівартість дня — усі точки — {date}».
- **No arithmetic in the browser.** Counting points and listing names is fine. Every number
  shown is a server field.

## 5. Not doing

- Date ranges, or an «all points» mode on any other screen.
- Cross-point pooling of недостача or витрати.
- §8.5 ② and ③.
- Hiding or gating a day whose points are still open. The status line names those points
  instead (§5.5: the owner watches the day take shape).
