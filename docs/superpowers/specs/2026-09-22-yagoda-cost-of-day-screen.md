# Yagoda CRM — Cost of Day Screen (§8.4, frontend + backend deltas)

**Source:** `26-rules-by-example.md` §8.3 (Витрати дня) and §8.4 (Собівартість кілограма).
**Reference:** `.reference/yagoda-crm/src/pages/CostOfDayPage.tsx` (Н8).
**Backend it stands on:** `backend/src/day-costs/` (2026-09-17 reweigh & cost-of-day slice).
**Precedent it copies:** `docs/superpowers/specs/2026-09-21-yagoda-reweigh-screen-design.md` —
the sibling §8 screen, built from the same reference against the same backend slice.

## 1. Goal

`GET /shifts/:shiftId/cost-of-day` has been serving §8.4 since 2026-09-17 and **no screen reads
it**. The follow-ups doc lists that fact twice (lines 1124 and the reweigh-screen deferrals) and
each time as the last item left in the slice. This spec closes it: the owner picks a point and a
day, reads the день's нараховано, недостача, витрати and СПІЛЬНИЙ КОШИК, writes the day's expense
lines, and sees the three prices §8.4 names — «було», «собівартість» and «нараховане ÷ наша вага».

It also closes the two response-shape gaps that make the screen unrenderable, both already
recorded as follow-ups rather than discovered here.

## 2. What already exists

- `CostOfDayService.forShift` — day totals, per-product prices, `provisional`, `top_ups_latest_at`.
- `DayExpensesService` + `DayExpensesController` — `POST`/`GET /shifts/:shiftId/expenses`,
  `PATCH`/`DELETE /expenses/:id`, owner-only, audited inside the write transaction.
- `productCostRows` — per-product `accrued`, `intake_net_kg`, `reweigh_net_kg`, `shortfall`,
  `complete`, shared with `NetworkAverageService`.
- `money.ts`'s `div` and `allocate`, both added by the 2026-09-17 slice for exactly this screen.
- `src/day-costs/**/*.ts` is already inside `eslint.config.mjs`'s money `files` array, so every
  addition below is under the arithmetic ban without touching that list.
- Frontend: `nav.cost` («Собівартість дня») exists in `AppLayout`'s management group as a
  **disabled placeholder with no `to`**, `uk.json` already carries the label, and `index.css`
  already carries the `.printable.print-landscape` rules — written for this page, named «(Н8)» in
  their own comment, and used by nothing.

## 3. Decisions

**3.1 Four per-product fields are un-dropped, not computed.** `CostOfDayProduct` gains `accrued`,
`intake_net_kg`, `reweigh_net_kg` (`string | null`) and `shortfall`. `productCostRows` already
produces all four and `buildProducts` discards them. §8.4's left half — вага · ₴/кг · нараховано,
plus «наша вага» and the per-product недостача — cannot be drawn without them. No new arithmetic.

**3.2 The «з них» split moves to the server.** `CostOfDayResponse` gains `shortfall_per_kg` and
`expenses_per_kg` (`string | null`), `div(shortfall_amount, reweighed_kg)` and
`div(expenses_amount, reweighed_kg)` behind the same `isZero(reweighedKg)` guard as `per_kg`. This
is §8.4's printed «з них недостача 1,94 / з них витрати 4,45» and the follow-up at line 1099 of
`2026-09-05-foundation-slice-follow-ups.md` verbatim: without it a frontend divides money in
React, which is the one thing `money.ts` exists to prevent.

**Each rounds half-up independently, so the pair can sit a kopiyka off `per_kg`.** `per_kg` stays
`div(basket, reweighed_kg)` — the figure actually added to every product's price, and the one the
existing tests pin. The screen prints the two as «з них» — a breakdown, never an addition — so on
a day where the rounding separates them, nothing on screen contradicts itself. §8.4's own worked
numbers (1,94 + 4,45 = 6,39) land exactly; that is arithmetic luck, not a guarantee, and the doc
comment on the two fields says so.

**3.3 `basket_share` per product, by `allocate`, not by multiplication.** The fifth new
per-product field: `allocate(basket, [reweigh_net_kg…])` across the **complete** products only.

This is the «із пулу» column, and the reason it is a field rather than a React expression is
§8.4's own sentence — «жодна гривня не загубилася і не з'явилася з нічого». `allocate` is a
largest-remainder split, so `Σ basket_share === basket` **exactly**; `per_kg × reweigh_net_kg` per
row drifts by a kopiyka a line, which is invisible on a fixture and wrong on a real day.
`allocate`'s doc comment names this call site as its reason for existing.

`basket_share` is `null` under the same two conditions `price_cost` is: `per_kg === null` (nothing
weighed at all), or `complete === false`. §3.15 keeps a partially weighed product out of
`переважено` and its недостача out of the basket; a product that contributes nothing to the
denominator collects nothing from the numerator. The allocation therefore runs over the complete
products alone, whose kilograms are exactly `reweighed_kg`.

**3.4 One more field than spec §5.5's formula list, and named as such.** §5.5 lists neither the
«з них» pair nor `basket_share`. The follow-up at line 1099 already calls that omission «a gap in
the plan as much as in the code»; 3.2 and 3.3 close it in the same character. Nothing else about
the §5.5 formulas changes.

**3.5 No allocation-policy selector.** The reference's «Розподіл: по вазі / по сумі / усе на
{товар}» is §8.5's three strategies. Only ① is built, and ② / ③ are a deliberate deferral blocked
on the rules file's own open question at the source — «→ Правка: узнать як вони це роблять». ③
additionally needs two columns the `reweighs` header does not have. The selector is **omitted**,
not rendered disabled: the same call `pages/reweigh` made for `at_point_id` — do not draw a
control that looks recorded and is not. The screen states «розподіл: по вазі» as a fact.

**3.6 The point picker is NOT filtered by `kind`.** The reweigh screen filters to
`kind === 'reception'` because only a reception point sends berries to the scale. This screen must
not: the base is a reception point with wholesale prices that also happens to be where weighing
happens, which is §8.6's own explanation for why the network average sits below Шипинки. The
reference names a `kind === 'reception'` filter here as a past bug that showed «two truths about
one day». All active points, no filter.

**3.7 No надлишок.** The reference renders a surplus day with its own word and an unsigned figure.
§8.2 settles it at the source — «→ **Правка:** надлишок *неможливий* ніякого функціоналу для кейсу
з надлишком не потрібно» — and the backend clamps per grade, so `shortfall_amount` and every
per-product `shortfall` are `>= 0` by construction. There is no branch to write.

**3.8 Expense lines are editable in place.** The backend's `PATCH /expenses/:id` exists, is
audited, and canonicalises `amount` at the DTO precisely so a no-op patch writes no audit entry.
`day_expenses` is the schema's one mutable money table and §8.3's reason is that nothing is
printed for a scratchpad line like «пальне 1 000,00». The reference offers add + delete only; this
screen offers add + inline edit + delete, so «13 000 замість 1 300» is one gesture, not two.

**3.9 The screen is owner-only at the route, not by hidden buttons.** `@Auth(UserRole.NetworkOwner)`
is on both controllers (§8 «Читання теж керівника»). The route carries `RequireRole`, matching
`/reweigh` and `/transfers`. Whether the operator may read the недостача claimed against his own
point is an open client question (reweigh slice §3.10) and is not reopened here.

**3.10 `per_kg === null` is the «не зведено» state, and it comes from the server.** The reference
derives `notSummed` from its own engine's `status === 'awaiting-reweigh'`. Here the server already
says it: nothing weighed means `per_kg`, `shortfall_per_kg`, `expenses_per_kg` and every
`basket_share` are `null`. The right column then shows only the manual expenses — «{витрати} не
розподілено» — because «Недостача в ягоді 17 419,07 ₴» on a day nobody weighed anything would be
an invented number, which is the reference's own reasoning and §8.6's «Це не нуль».

**3.11 Scale 2, and no `rate4`.** The reference prints rates at four decimals to expose a
per-product kopiyka split. §3.14 of the reweigh slice fixes scale 2 everywhere and §8.4's own
numbers are `6,39` and `166,39`. `rate4`, `signed()` and `UpliftBreakdown` do not come across.

## 4. Structure

```
backend/src/day-costs/
  cost-of-day.service.ts        # +5 response fields (3.1, 3.2, 3.3)
  cost-of-day.service.spec.ts   # + cases for each
  cost-of-day.db-spec.ts        # + the allocation identity against real Postgres

frontend/src/
  entities/cost-of-day/         # useCostOfDayQuery(shiftId) + CostOfDay / CostOfDayProduct types
  entities/day-expense/         # useDayExpensesQuery + create / update / delete mutations
  pages/cost-of-day/
    ui/CostOfDayPage.tsx        # header, point + date, the three read states
    ui/BerryTable.tsx           # ЛІВО · ЯГОДА — read-only
    ui/ExpensesPanel.tsx        # ПРАВО · ВИТРАТИ — the only input, + КОШИК block
    ui/FinalPrices.tsx          # Середня ціна після витрат + звірка
  app/owner-pages.ts            # + CostOfDayPage
  app/lazy-routes.ts            # + CostOfDayPage
  app/router.tsx                # + /cost-of-day, RequireAuth + RequireRole
  app/layouts/AppLayout.tsx     # nav.cost gains `to: '/cost-of-day'`
  shared/lib/i18n/locales/*.json
```

`entities/cost-of-day` is a server-computed report never
re-summed client-side, same contract as `entities/point-cash`. `entities/day-expense` carries its
mutations alongside its query, same as `entities/reweigh`. It joins the existing single owner
chunk rather than getting its own — `lazy-routes.ts`'s doc comment measures why.

## 5. Data flow

1. `useWorkingPoint()` → `pointId`, unfiltered (3.6). `useUrlParam('date')` → `date`, clamped to
   today, local to this screen (the owner works yesterday while the points buy today).
2. `useShiftOnDateQuery(pointId, date)` → `shiftId`.
3. `useCostOfDayQuery(shiftId)` and `useDayExpensesQuery(shiftId)`, both `enabled` on `shiftId`.
4. Every mutation invalidates **both** keys: an expense line moves `expenses_amount`, `basket`,
   `per_kg`, `expenses_per_kg` and every `basket_share`.

Three read states, the split `ReweighPage` documents: pending (guarded by `enabled` so a disabled
query never parks the screen on a spinner), failed (its own banner), and answered. A failed
`/collection-points` must never report itself as «зміну не відкривали».

## 6. Behaviour

**Header.** Point select · `DateStepper` · «Сьогодні» when off today · «Друк». Inside
`.printable.print-landscape`; the add-row form and the row buttons carry `print-hide`.

**Banners.** `provisional` → amber «зміна ще відкрита, цифри рухаються» (§3.9 puts no gate here —
the owner watches the day take shape). `top_ups_latest_at` → §3.12's «включно з доплатами,
останню внесено {дата}».

**ЛІВО · ЯГОДА**, read-only, per product: вага (`intake_net_kg`) · ₴/кг (`price_was`) ·
нараховано (`accrued`); a «★ наша вага» sub-row (`reweigh_net_kg`, «не перезважено» badge when
`complete === false`); a «недостача» sub-row when `shortfall > 0`. РАЗОМ from `reweighed_kg` and
`accrued`. The footnote §8.4 asks for: «нараховано» is the accrued purchase, not cash out of the
drawer — debts exist, so the day's cash is a different number and does not touch собівартість.

**ПРАВО · ВИТРАТИ**, the only input: the lines with inline edit and delete, the add form
(`maskDecimalInput`, `amountRules`), then недостача + витрати = **СПІЛЬНИЙ КОШИК**, then `per_kg`
with «з них недостача {shortfall_per_kg} · з них витрати {expenses_per_kg}». When `per_kg === null`
the block is replaced by the amber «Очікує переважування — {expenses_amount} не розподілено» (3.10).

**Середня ціна після витрат**, per product: наша вага · із пулу (`basket_share`) · разом
(`add(accrued, basket_share)`, one client-side addition of two server figures — not a division) ·
собівартість (`price_cost`) · було (`price_was`) · нараховане ÷ наша вага (`price_by_our_weight`).
Every `null` is «—», never `0,00`, and never `NaN`.

**Звірка**, two lines, shown to the person rather than hidden in a test:
`Σ із пулу {Σ basket_share} = КОШИК {basket}` and §8.4's own
`{total_check} = {accrued} (нараховано) + {expenses_amount} (витрати)`.

**Empty day.** `products.length === 0` → «Цього дня на цьому пункті прийомки не було.» No shift
at all → the «зміну не відкривали» state, distinct from it.

## 7. Testing

- **Backend unit** (`cost-of-day.service.spec.ts`): the four passthrough fields; `shortfall_per_kg`
  / `expenses_per_kg` null on an unweighed day and correct on §8.4's own numbers; `basket_share`
  null for an incomplete product and for an unweighed day; `Σ basket_share === basket` on a day
  whose per-kg share does not divide evenly — the case that fails under multiplication.
- **Backend db-spec** (`cost-of-day.db-spec.ts`): the same allocation identity against real
  Postgres, since the figures it splits come out of SQL.
- **Frontend**: a test per `ui/` component plus the page — the three read states, `per_kg === null`
  rendering «не розподілено» and no invented недостача, «не перезважено» rendering «—» rather than
  a zero, and the expense mutations invalidating both query keys.
- **Verification**: `npm run verify:full`. Money code and SQL formulas are in scope, and the fast
  tier reaches neither a real Postgres nor coverage — CLAUDE.md's «Money code is that kind too».

## 8. Out of scope → follow-ups

- §8.5's strategies ② and ③, and the `reweighs` columns ③ needs (3.5) — unchanged deferral.
- §8.6's «Середня ціна по мережі». `GET /reports/network-average` is served and equally unread by
  any screen; `nav.network` is the next disabled placeholder. One screen at a time.
- «Аркуш керівника» (`nav.sheet`), which has no endpoint at all.
- The reference's `violations` / `ViolationLine` — a mock-engine construct with no server
  equivalent; the backend refuses at write time instead.
- The «товар не з цього пункту» badge — no server signal exists for it.
- A visible history for a собівартість that moved (reweigh slice §3.12) — still blocked on what
  gets snapshotted, and when, for a number defined never to stop moving.
- Operator read access to §8 (reweigh slice §3.10) — still a client question.
