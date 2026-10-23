# Cost of Day — one colour-coded table (variant C)

**Date:** 2026-10-23
**Rules:** `26-rules-by-example.md` §8.2–§8.6 (esp. §8.4 «Собівартість кілограма»).
**Replaces the layout of:** `docs/superpowers/specs/2026-09-22-yagoda-cost-of-day-screen.md`
(the two-table + side-panel screen). Its data rules — server owns every figure, «—» is never a
zero, owner-only, expenses keyed on the shift — all still hold.
**Mockup the owner chose:** variant C in the artifact «Варіанти собівартості дня»
(https://claude.ai/artifact/GfucuokpfK8sEhgsWJ2qMn). Numbers below are its real day: Гайове, 19.10.
**Builds on:** the uncommitted per-product shortfall change on `fix/shortfall-by-product`
(`productShortfall`, `shortfall_kg`). This work assumes that change has landed.

## 1. Why

The owner reads the screen and cannot tell where a value comes from or which one matters. An
analysis of the 19.10 screen (three independent reviews: domain, UX, arithmetic) found:

- **The answer is not visually the answer.** «собівартість» sits in column five of the bottom
  table at the same weight as everything else; the biggest figures on screen (113 640,80,
  114 693,71) are intermediate.
- **The same figure is printed several times under different names.** 265,19 ×3, 3,22 ×3,
  1 965,19 ×4; «наша вага» in both tables; «₴/кг» (top) and «ціна в квитанції» (bottom) are the
  same number; «спільний кошик», «пул», «із пулу» are one concept.
- **Reading order ≠ calculation order.** Table → side panel (input wedged between expense lines
  and their total) → second table.
- **The §8.4 «з них недостача / з них витрати» breakdown is on the wire but not on screen**, and
  where printed it would not add up: 0,43 + 2,78 = 3,21 ≠ 3,22 (`cost-of-day.service.ts` rounds
  each half on its own; its own comment calls the pair «a breakdown, not an addition»).
- **Pooling is invisible.** Кизил has no shortfall yet pays 6,81 ₴ of Малина's (§8.4 «однаково
  на ВСІ товари») — correct by the rules, unexplained on screen.
- **«разом» and several totals are computed in the browser**, contradicting the entity's own
  contract («EVERY figure here is the server's»). «разом ÷ наша вага» = 192,63 beside
  «собівартість» 192,64 is the visible symptom.

## 2. Goals, non-goals, anti-goals

**Goals**
1. One table, one row per product, read left → right in calculation order:
   weight → purchase → shortfall → expenses → result.
2. Every figure printed once, where it arises; every row adds up exactly on screen:
   `ціна в квитанції + недостача дня ₴/кг + витрати ₴/кг = собівартість`.
3. One colour per concept, the same everywhere on the page (§4.3).
4. The server computes every printed figure, including totals and the breakdown.

**Non-goals**
- Changing *who pays what*. Pooled shortfall «по вазі» (§8.4, §8.5 ①) stays. §8.5 ② / ③ stay
  unbuilt.
- The network-average screen and `NetworkAverageService` — untouched.
- A selling price / margin — the rules have none.
- The «Аркуш керівника» (§11.3).

**Anti-goals (a failure even if it works)**
- A row whose parts visibly do not sum to its result.
- Any figure the browser derives with arithmetic (sums included).
- Amber used for anything but недостача.
- An input anywhere except the expenses strip (§8.4: one place of entry).

## 3. Backend — `GET /shifts/:shiftId/cost-of-day`

All arithmetic through `backend/src/common/money.ts`. `src/day-costs/**` is already in the
money `files` array.

### 3.1 The definition of собівартість does not change

§8.4 defines it literally: «було» + «на кілограм», the same на кілограм for every product
(«160,00 було → 166,39 собівартість», 6,39 ₴/кг «однаково на ВСІ товари»). So `price_cost`
stays `add(price_was, per_kg)` — Малина 192,64, Кизил 41,22.

`повна вартість ÷ наша вага` (192,63) is **not** собівартість and is never printed next to it;
the 1-kopiyka gap is the rounding of «було» and cannot be closed in two-decimal money without
breaking either the additive row (Goal 2) or the money звірка. The screen therefore never shows a
per-kilogram figure derived from «повна вартість» (§5).

### 3.2 The breakdown sums to `per_kg` exactly

`shortfall_per_kg`, `expenses_per_kg` become a **split of `per_kg`**, not two independent
quotients:

```
[shortfall_per_kg, expenses_per_kg] = allocate(per_kg, [shortfall_amount, expenses_amount])
19.10: allocate(3,22, [265,19; 1 700,00]) = [0,43; 2,79]      0,43 + 2,79 = 3,22 ✓
```

`allocate` is largest-remainder, so the pair is always exact. Both stay `null` when `per_kg` is.
Edge: `basket = 0` → `allocate` splits 0,00 → both 0,00 (no even-split surprise, the total is zero).
Rewrite the field comments: it IS now an addition.

### 3.3 Per-product share, split in two

Each complete product gains two fields; `basket_share` becomes their sum.

```
shortfall_share = allocate(shortfall_amount, weighed kg)[i]
expenses_share  = allocate(expenses_amount,  weighed kg)[i]
basket_share    = shortfall_share + expenses_share
19.10: Кизил 6,81 + 43,68 = 50,49 · Малина 258,38 + 1 656,32 = 1 914,70
       Σ shortfall_share = 265,19 · Σ expenses_share = 1 700,00 · Σ basket_share = 1 965,19
```

`basket_share` may now differ by a kopiyka from the old single `allocate(basket, …)` on some
days; Σ `basket_share` = `basket` still holds exactly. `null` under the same conditions as today
(not `complete`, or nothing weighed).

### 3.4 Figures moved from the browser to the server

| New field | Formula | 19.10 |
|---|---|---|
| product `full_cost` | `accrued − shortfall + basket_share` (complete only, else `null`) | 647,09 · 114 693,71 |
| day `weighed.intake_kg` | Σ `intake_net_kg` of **complete** products | 612,50 |
| day `weighed.shortfall_kg` | Σ `shortfall_kg` of complete products | 1,40 |
| day `weighed.accrued` | Σ `accrued` of complete products | 113 640,80 |
| day `weighed.shortfall` | Σ `shortfall` of complete products (= `shortfall_amount`) | 265,19 |
| day `weighed.price_was` | `div(weighed.accrued, weighed.intake_kg)` | 185,54 |
| day `full_cost` | Σ product `full_cost` | 115 340,80 |
| day `price_cost_avg` | `div(full_cost, reweighed_kg)` — §8.6 «сума ÷ вага» | 188,74 |
| day `unweighed` | `{ intake_kg, accrued }` Σ over products not `complete` | 0,00 · 0,00 |
| day `checks` | `null` when `per_kg` is `null`; else `{ shares_ok, total_ok }` | — |
| `checks.shares_ok` | Σ `basket_share` = `basket` | true |
| `checks.total_ok` | `full_cost + unweighed.accrued = accrued + expenses_amount` (`total_check`) | true |

`full_cost` is the money figure the old «разом» showed; it is now named for what it is
(«повна вартість»). `full_cost`, `price_cost_avg` and the `weighed.*` group are `null` when
`per_kg` is.

**The total row covers complete products only** (designer's call), so every column of it adds
up: Пункт − База = Не доїхало, and «₴/кг у квитанції» = нараховано ÷ пункт of the same rows.
Products not reweighed in full are reported beside it, never folded in (§4.2).

### 3.5 Tests

- `cost-of-day.service.spec.ts`: 19.10 as a fixture (every number in this doc); §8.4's own
  numbers (6,39 → 1,94 + 4,45 must still hold); a day where independent rounding would have
  missed (assert the pair sums to `per_kg`); basket 0; nothing weighed; one product incomplete.
- `cost-of-day.db-spec.ts`: response shape against real Postgres.
- Property test (alongside `money.properties.spec.ts` style): for random baskets/weights,
  Σ halves = `per_kg`, Σ shares = parts, `checks.*` true.

## 4. Frontend — `pages/cost-of-day`

### 4.1 Layout, top to bottom

1. **Header** (unchanged controls: point, date stepper, Друк). Description becomes «Скільки
   насправді коштує кілограм ягоди після недостачі й витрат дня.»
2. **Status chips**, neutral outline with icon, never amber:
   - «Зміну закрито» ✓ / «Зміна ще відкрита — цифри рухаються» (clock icon);
   - «Усе перезважено» ✓ / «Не перезважено: {names}»;
   - «Доплати враховано до {datetime}» when `top_ups_latest_at`;
   - «Звірено» ✓ (leaf) / «Не сходиться» ✗ (destructive) from `checks`; clicking scrolls to and
     opens §4.1 step 5. When `checks` is `null` (nothing weighed yet) the chip reads «Звірка —
     після переважування», neutral, not clickable, and the disclosure is not rendered.
3. **Expenses strip** (plum outline): label «Витрати дня», one pill per line «{label}
   {amount}» with edit and delete, «+ Додати витрату», and right-aligned «= {expenses_amount} ₴ ·
   {expenses_per_kg} ₴/кг» (the ₴/кг part only when `per_kg` is not null).
4. **The table** (§4.2), then one line under it: «Як читати рядок: ціна в квитанції + недостача
   дня на кг + витрати дня на кг = собівартість. Недостачу й витрати розкладено порівну на кожен
   кілограм, що доїхав на базу ({reweighed_kg} кг).» — terms coloured per §4.3.
5. **«✓ Звірено» disclosure**, collapsed by default (open when a check fails, and always open in
   print): the two money identities, server figures only:
   - «Частки товарів: {shares…} = {basket} = недостача {shortfall_amount} + витрати {expenses}»;
   - «Повна вартість: {full_costs…} = {full_cost} = нараховано {accrued} + витрати {expenses}»;
     when `unweighed.accrued` is non-zero the line is written as the identity it is:
     «{full_cost} + не перезважено {unweighed.accrued} = нараховано {accrued} + витрати
     {expenses}».

Removed: the right-hand panel (its basket/на-кілограм block), the «Середня ціна після витрат»
table, its «розподіл: по вазі ≈ … ₴/кг на всіх» header, the summary sentence, the long grey note
under the berry table (moves into an ⓘ on «Нараховано»).

### 4.2 The table

Two header rows. Group row (coloured underline per group) / column row:

| Group | Columns | Product row | Total row «Пункт» |
|---|---|---|---|
| — | Товар | ▸ name (+ «не перезважено» badge) | «Пункт» |
| Вага, кг (neutral) | Пункт · База · Не доїхало | intake · reweigh · −shortfall_kg | weighed.intake_kg · reweighed_kg · −weighed.shortfall_kg |
| Закупка (sky) | Нараховано ⓘ · ₴/кг у квитанції | accrued · price_was | weighed.accrued · weighed.price_was |
| Недостача (amber) | Своя, ₴ · Дня, ₴/кг | −shortfall · shortfall_per_kg | −weighed.shortfall · shortfall_per_kg |
| Витрати (plum) | ₴/кг | expenses_per_kg | expenses_per_kg |
| Результат (leaf) | Собівартість · Δ до квитанції | **price_cost** · +per_kg | **price_cost_avg** · *empty* |

- 19.10 rows: Кизил 15,70 · 15,70 · 0,00 | 596,60 · 38,00 | 0,00 · 0,43 | 2,79 | **41,22** · +3,22;
  Малина 596,80 · 595,40 · −1,40 | 113 044,20 · 189,42 | −265,19 · 0,43 | 2,79 | **192,64** · +3,22;
  Пункт 612,50 · 611,10 · −1,40 | 113 640,80 · 185,54 | −265,19 · 0,43 | 2,79 | **188,74**.
- The total row's Δ stays empty on purpose: 185,54 + 3,22 ≠ 188,74 (the point's «було» is per
  point-kilogram, the average is per base-kilogram). Printing it would break Goal 2. ⓘ on the
  total собівартість: «Сума повної вартості ÷ вага на базі (§8.6), не середнє з цін».
- Собівартість cells: bold, leaf, larger than the rest; the leaf-tinted column is the visual
  end of every row.
- «Не доїхало» and «Своя, ₴» print with a minus and amber when > 0; a weighed zero is a muted
  «0,00»; not weighed is «—» (unchanged rule). The column is named «Не доїхало», not «Різниця»,
  because it is clamped at zero (§8.2: surplus is impossible): a product that somehow weighs
  more at the base shows «0,00», and the name does not promise a subtraction.
- A product not reweighed in full keeps its row: Пункт, Нараховано and ₴/кг у квитанції are
  printed; every cell from «База» on is «—» and the «не перезважено» badge sits by its name.
  It is **not** in the total row. When any such product exists, one muted row sits under the
  total: «Не перезважено, не входить у підсумок: {unweighed.intake_kg} кг · {unweighed.accrued} ₴».
- **Expanded row** (chevron, collapsed by default): one full-width sub-row «Частка дня в
  гривнях: {shortfall_share} недостачі + {expenses_share} витрат = {basket_share} ₴ · повна
  вартість {full_cost} ₴ · кг, що доїхав, без витрат: {price_by_our_weight}», then the grade
  rows as today (пункт · база · ₴/кг у квитанції · нараховано; shortfall cells empty — the
  shortfall is the product's).
- Width: the table owns the card's full width now; below its natural width it scrolls inside its
  own container (`overflow-x-auto`), the page never does. The first column is sticky.

### 4.3 Colour code

| Concept | Token | Where |
|---|---|---|
| Weight | `--foreground` / muted | Вага group |
| Purchase | `--sky` (exists) | Закупка group, «ціна в квитанції» in the hint line |
| Shortfall | `--amber` (exists) | Недостача group only — no longer on the provisional badge |
| Day expenses | **`--plum` (new)** — light `#7a4cc4`, dark `#a98bf0` | Expenses strip, Витрати column |
| Result | `--leaf` (exists) | Собівартість column, «Звірено» chip |
| Action | `--primary` (berry) | Buttons only |

Add `--plum` and `--color-plum` to `index.css` next to `--sky`, both themes. Group columns get a
~8–10 % tint of their colour; text in the group uses the colour.

**Print:** colour is doubled by form — minus sign on shortfall, a 1.5 pt box/rule on the
Собівартість column, group names in the header row. Status chips print as text. The disclosure
prints open. ⓘ texts print as numbered footnotes under the table (today they vanish with
`print-hide`). Landscape stays.

### 4.4 Words (uk; en mirrored)

«наша вага» → «База» (column) / «вага на базі» (prose). «із пулу», «разом», «спільний кошик» are
gone from the screen. «Нараховано» ⓘ: the current `berry.note` text. «Закупівельна ціна» →
«кг, що доїхав, без витрат» inside the expanded row only.

### 4.5 Expenses strip behaviour

Everything `ExpensesPanel` does today carries over, only its shape changes:
- the component stays keyed on `day.shift_id` (draft must die with the shift);
- amount inputs gate on `parseDecimal` / `useDecimalField` (#72), same error lines;
- edit sends only the field that moved; a refusal keeps the form filled and toasts;
- a pill in edit mode turns into label + amount inputs + Зберегти / Скасувати in place;
- empty: «Витрат за цей день ще не заводили.» inside the strip, add control still there;
- `per_kg === null` («Очікує переважування»): the strip still works; the table shows its
  weight/purchase groups with «—» in Недостача ₴/кг, Витрати ₴/кг and Результат, and the hint line
  is replaced by the current `awaitingNote` text naming `{expenses} не розподілено`.

### 4.6 Components and tests

- `BerryTable` + `FinalPrices` → one `CostTable` (page-local, `pages/cost-of-day/ui`).
- `ExpensesPanel` → `ExpensesStrip` (same logic, new shape).
- New `StatusChips`, `ChecksDisclosure` (page-local).
- `entities/cost-of-day/model/cost-of-day.ts` mirrors §3's new fields; the browser does no
  arithmetic (`sum`, `add`, `sub`, `cmp` imports leave this page).
- Tests move with the components: every case the four current test files cover that still
  applies (null dashes, incomplete product, provisional, top-ups badge, keyed draft, patch-only-
  what-moved, refusal keeps form), plus: row parts are printed from server fields; a failing
  `checks` opens the disclosure and shows ✗; amber appears only in the Недостача group.

## 5. Calls made by the designer (check these)

- Pooled shortfall stays (rules §8.4); the owner can still ask the client about per-product
  shortfall later — it would be a rules change, not a screen change.
- The 1-kopiyka gap is closed by never printing `повна вартість ÷ вага` beside собівартість,
  not by redefining собівартість (§3.1).
- The breakdown split is `allocate(per_kg, [shortfall, expenses])` → 0,43 + 2,79 on 19.10 (the
  mockup showed 0,44 + 2,78 — a guess; this is the rule-consistent split).
- Total row shows the average собівартість and leaves Δ empty (§4.2).
- «Зміна відкрита» loses amber.
- The total row sums complete products only; not-reweighed products get one muted line under
  it instead (§3.4, §4.2).
- «Різниця» is named «Не доїхало», because it is clamped at zero.
- Before anything is weighed `checks` is `null`: the chip reads «Звірка — після переважування»
  and the disclosure is not rendered.

## 6. Left to the builder

Exact spacing and font sizes inside the kit; icon choice for chips; whether the sticky first
column needs a shadow; field names in §3.4 (keep snake_case, keep them documented in the
service's interface the way the current ones are).
