# Cost of Day — three ways to split the day's basket

**Date:** 2026-10-24
**Rules:** `26-rules-by-example.md` §8.4 (собівартість кілограма), §8.5 (три способи розподілу),
§8.6 (сума ÷ вага).
**Request:** user, 2026-10-24 (grilling + brainstorming in one session).
**Builds on:** `2026-10-23-cost-of-day-single-table-design.md`,
`2026-10-23-three-screens-ux-math-review.md`, `2026-10-23-cost-of-day-all-points-design.md`.
**Closes:** the «§8.5 strategies ② and ③» item in
`docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (as re-scoped below).

## 1. Why

Today the day's basket — the pooled недостача plus the day's витрати — is spread **evenly per
kilogram** over every product weighed in full. On 19.10 at Гайове that adds 0,43 + 3,11 = 3,54 ₴/кг
to Кизил bought at 38,00 ₴/кг (+9 %) and to Малина bought at 189,42 ₴/кг (+2 %). The user: «деякі
товари за кілограм коштують дорого, деякі дешево — фіксовано додавати якесь значення на кілограм
не зовсім правильно». They want the basket split in proportion to **money**, while keeping the
current method, and a switch to choose which one the screen shows.

## 2. The three strategies

Every strategy splits the same two amounts — the day's `shortfall_amount` and `expenses_amount` —
over the same set of products: the ones weighed in full (`complete`, §3.15). Only the
**weights** of the split change.

| Key (`?split=`) | Label (uk) | недостача share of product *i* | витрати share of product *i* |
|---|---|---|---|
| `weight` (default) | «По вазі» | `allocate(shortfall_amount, reweigh_kg)` — as today | `allocate(expenses_amount, reweigh_kg)` — as today |
| `value` | «По сумі закупки» | `allocate(shortfall_amount, accrued)` | `allocate(expenses_amount, accrued)` |
| `own` | «Своя недостача + % витрат» | the product's **own** `shortfall` (no split) | `allocate(expenses_amount, accrued)` |

- `accrued` is «нараховано» **including доплати**, gross (not `accrued − shortfall`), over the
  complete products only. The user asked for a split «від … загальної кількості суми, якої ми
  прийняли за цей день» — that is нараховано, and a доплата is part of what was paid for those
  berries. A late top-up (§3.12) therefore moves the split on a closed day, exactly as it already
  moves `accrued` and `price_was` there.
- `allocate` is `money.ts`'s largest-remainder split, so each column still sums **exactly** to
  its day total and `checks.shares_ok` stays true by construction in all three.
- Under `own`, Σ own `shortfall` over complete products already equals `shortfall_amount`
  (incomplete products book none), so `shares_ok` holds there too.
- `full_cost_i = accrued_i − shortfall_i + shortfall_share_i + expenses_share_i` in all three.
  Under `own` this reduces to `accrued_i + expenses_share_i`.

**Invariant across strategies:** the day's `full_cost`, `price_cost_avg`, `basket`, `total_check`
and both `checks` are identical. Only the split between products moves. A test asserts this.

Worked example, 19.10 Гайове (expenses 1 900,00 ₴; Малина own недостача 265,19 ₴; Σ accrued
113 640,80 ₴; Кизил 596,60 ₴ / 15,70 кг; Малина 113 044,20 ₴ / 595,40 кг base):

| | Кизил ₴/кг | Малина ₴/кг |
|---|---|---|
| `weight` | 38,00 + 0,43 + 3,11 = 41,54 | 189,42 + 0,43 + 3,11 = 192,96 |
| `value`  | ≈ 38,72 | ≈ 193,04 |
| `own`    | 38,00 + 0,00 + 0,64 = 38,64 | 189,42 + 0,45 + 3,17 = 193,04 |

(The builder recomputes these with the real `allocate`/`div` and pins them in a test; the
kopiyka may differ from the hand figures above.)

### 2.1 Per-row per-kilogram figures

Under `weight` the row's «недостача дня, ₴/кг» and «витрати, ₴/кг» cells are the day's
`shortfall_per_kg` / `expenses_per_kg`, as today — unchanged behaviour, byte for byte.

Under `value` and `own` they are **the row's own**:

- `shortfall_per_kg_i = div(shortfall_share_i, reweigh_kg_i)`
- `expenses_per_kg_i  = div(expenses_share_i,  reweigh_kg_i)`
- `price_cost_i = price_was_i + shortfall_per_kg_i + expenses_per_kg_i`

so «ціна закупки + недостача + витрати = собівартість» keeps adding up on every row, every
operand a server field. To keep one shape, **every** product carries `shortfall_per_kg` and
`expenses_per_kg` fields (`null` when not complete / nothing weighed); under `weight` they equal
the day's halves.

### 2.2 The percentage — a caption, never an operand

`expenses_pct = expenses_amount ÷ weighed.accrued × 100` (and, under `value` only,
`shortfall_pct = shortfall_amount ÷ weighed.accrued × 100`), scale 2, half-up, through
`money.ts` (add a helper there if needed; no raw arithmetic — the eslint money rule applies).
`null` under `weight` and whenever the strategy has no base (§2.3).

It is printed **with «≈»** («≈ 1,67 % від закупки»), because a two-decimal percentage cannot be
an operand: 113 044,20 × 1,67 % = 1 887,84 ₴ against a true share of 1 890,03 ₴. Every check the
user can do on a calculator runs through hryvnias instead (§3.3).

### 2.3 No base to split by

Under `value`/`own`, if Σ `accrued` over the complete products is `0.00` (every weighed line was
a zero-price line — reachable: `intake_items.price >= 0`) there is nothing to take a percentage
of, and `allocate` would split evenly across zero weights — an arbitrary answer. **That day falls
back to the `weight` split**: the response echoes the requested `split`, carries
`split_applied: 'weight'`, the percentages are `null`, and the screen says so beside the switch
(«Нараховано 0 ₴ — розкладено по вазі»). Every other field is exactly the `weight` response, so
the §2 invariant, `checks` and the network's `expenses_weighed`/`total_ok` all hold unchanged on
such a day. *(author's call — nulling the day instead would break «Усі точки»'s `total_ok`,
because `NetworkCostDayPoint.weighed` reads `per_kg`.)* `split_applied` equals `split` on every
other day.

A single complete product with `accrued = 0` among others simply receives a zero share.

## 3. The screen

### 3.1 The switch

- A three-way segmented control labelled «Розподіл кошика», in the page's actions row beside the
  date stepper; `print-hide`. Three `Button`s with `aria-pressed` in one labelled group
  (`pages/cost-of-day/ui/SplitSwitch.tsx`) — not `shared/ui/segmented.tsx`, whose `motion/react`
  thumb put the lazy bundle 11 KiB over its ceiling. *(author's call on placement and control)*
- State lives in the URL as `?split=weight|value|own` via `useUrlParam`. An absent or unknown
  value falls back to the **remembered** choice, then to `weight`.
- The last choice is remembered per browser in a new `shared/lib/split-preference`, modelled on
  `shared/lib/sidebar-preference` (every storage error swallowed; a private window degrades to
  `weight`). Picking a strategy writes both the URL and the preference.
- The switch applies to the single-point view **and** to «Усі точки», and survives changing point
  or date.
- The print header line names the strategy: «Собівартість за 19 жовтня 2026 · Гайове · розподіл:
  по сумі закупки».

### 3.2 What changes per strategy

| Place | `weight` | `value` | `own` |
|---|---|---|---|
| Expenses strip total | «= 1 900,00 ₴ · 3,11 ₴/кг» (today) | «= 1 900,00 ₴ · ≈ 1,67 % від закупки» | same as `value` |
| Table header «Недостача» sub-column | «дня, ₴/кг» | «дня, ₴/кг» | «своя, ₴/кг» |
| Row per-kg cells | day halves (today) | the row's own (§2.1) | the row's own (§2.1) |
| Formula lines under the table | today's two lines (÷ кг) | «Недостача дня: 265,19 ₴ ÷ 113 640,80 ₴ ≈ 0,23 % від закупки», «Витрати дня: 1 900,00 ₴ ÷ 113 640,80 ₴ ≈ 1,67 % від закупки», plus «частка кожного товару — у розгорнутому рядку» | «Недостача — своя у кожного товару: своя ₴ ÷ база кг», the витрати line as in `value` |
| «Як читати рядок» line | unchanged | unchanged | unchanged |
| Day average formula | unchanged — invariant | unchanged | unchanged |

### 3.3 The opened row's chain

Under `value`/`own` the expanded product row prints its share **in hryvnias**, so it checks on a
calculator to the kopiyka without the rounded percentage:

```
Витрати:   1 900,00 ₴ × 113 044,20 ₴ ÷ 113 640,80 ₴ = 1 890,03 ₴ ÷ 595,40 кг = 3,17 ₴/кг
Недостача (value): 265,19 ₴ × 113 044,20 ₴ ÷ 113 640,80 ₴ = … ₴ ÷ 595,40 кг = … ₴/кг
Недостача (own):   своя 265,19 ₴ ÷ 595,40 кг = 0,45 ₴/кг
```

The «= 1 890,03 ₴» is the server's `expenses_share` (an `allocate` result), and the product
`x × a ÷ b` may sit a kopiyka off it on some days (largest remainder). Mark that step «≈» when
the two differ, or always — builder's call, as long as the screen never claims an equality that
a calculator refutes. Units next to every number (project memory: «units next to every
number»). Every operand carries its `data-trace` pointer like the existing chain.

### 3.4 «Усі точки»

`GET /reports/cost-of-day?date=…&split=…` passes `split` to each point's
`CostOfDayService.forShiftIn`; the network service keeps only summing shares and dividing once
per row, so it needs no new arithmetic. Splits never cross points — each point's basket is split
over that point's products, as today. If `NetworkCostTable` prints any per-kg day figure, it
follows §3.2's rules.

## 4. API

- `GET /shifts/:shiftId/cost-of-day?split=weight|value|own` and
  `GET /reports/cost-of-day?date=…&split=…`. `split` optional, default `weight`, validated by a
  DTO (`IsIn`) — an unknown value is a 400. Owner-only as today.
- `CostOfDayResponse` gains `split` (echo), `split_applied` (§2.3), `expenses_pct`,
  `shortfall_pct`; each
  `CostOfDayProduct` gains `shortfall_per_kg`, `expenses_per_kg`. Existing fields keep their
  meaning; under `weight` the response is identical to today's apart from the added fields.
- Frontend query keys include `split`, so switching back is a cache hit.

## 5. Rules file

Record the change in §8.5 of `26-rules-by-example.md` the way the file records every client
decision — **a dated «→ Правка 24.10.2026» entry**, old wording left visible above it (as §6.9's
«Правка 23.10.2026» does). The source is the owner's call in this session (2026-10-24: the switch
is a view, not a stored choice). The entry says:

- the three ways shipped are «по вазі» / «по сумі закупки» / «своя недостача + % витрат» (§2),
  each splitting the whole basket (недостача + витрати), with the 19.10 example;
- **спосіб розподілу — це вигляд екрана, а не стан дня.** Нічого не зберігається; собівартість
  рахується наживо, тож перемикач нічого не переписує заднім числом. Сума дня і середня
  собівартість однакові в усіх трьох — міняється лише розклад між товарами. This supersedes
  «правило розподілу належить дню…» `[СВ-26…СВ-28]`, which stays in the text struck through or
  marked superseded;
- the old ③ «усе на один товар» is not built (out of scope, §7), and the «узнать як вони це
  роблять» question is answered for ② by this entry and stays open for ③ only.

Update the follow-ups entry to say ② shipped as `value`/`own` and ③ «усе на один товар» remains
deferred. Update `backend/CLAUDE.md` / `frontend/CLAUDE.md` only if they describe the split.

## 6. Tests

- `cost-of-day.service.spec.ts`: each strategy on the 19.10 numbers; the invariant (§2) across
  all three; Σ shares = day totals per strategy; row identity `price_was + shortfall_per_kg +
  expenses_per_kg = price_cost` per strategy; incomplete product collects nothing; zero-accrued
  base (§2.3); `weight` output unchanged from today's fixture.
- `cost-of-day.db-spec.ts` / `network-cost-of-day.db-spec.ts`: one real-Postgres case per
  non-default strategy, and the DTO rejecting an unknown `split`.
- Frontend: switch writes URL + preference; fallback order (URL → preference → `weight`);
  §3.2's table of differences; the opened-row chain; «Усі точки» passes `split`.
- Money code ⇒ `npm run verify:full` (CLAUDE.md rule 1).

## 7. Out of scope

- §8.5's old ③ «усе на один товар» (needs a chosen product per day — stored state).
- Storing a strategy per day, or per network (user: view only).
- Splitting a basket across points.
- Any change to receipts, debts or the reweigh screen.
