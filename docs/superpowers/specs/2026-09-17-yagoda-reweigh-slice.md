# Yagoda CRM — Reweigh & Cost-of-Day Slice Spec (§8)

**Date:** 2026-09-17
**Source:** `26-rules-by-example.md` §8 (Друга вага · Недостача · Витрати дня · Собівартість ·
Розподіл · Середня по мережі · Сторно), `docs/26-правки-і-запитання.md` edits 12 and 13,
`28-db-schema.dbml`, and the `/grilling` session of 2026-09-17 that produced the fifteen
decisions in §3. The foundation spec's §5 data conventions bind this slice in full.

**Position in the schema:** the DBML's original seventeen tables are complete, plus
`intake_top_ups` (#61) — eighteen. This slice adds **four** more: `reweighs`, `reweigh_items`,
`reweigh_item_tare_types`, `day_expenses`. Twenty-two in all. They are the first tables in the
schema that describe the **base** rather than a collection point.

**THIS SLICE SCOPES ONE WRITTEN RULE AND DEFERS TWO OTHERS.** The `intake_top_ups` Note's
«ДЕНЬ ДОПЛАТИ — ДЕНЬ ЇЇ СТВОРЕННЯ» is scoped to debt accrual and does **not** govern
cost-of-day (§3.12). §8.5's strategies ② and ③ are deliberately not built (§3.7). §8.2's
reconciliation is owner-only, with operator visibility deferred (§3.10).

---

## 1. Goal

Give §8 somewhere to live.

Berries accepted at a point are trucked to the base and weighed again. The second weight is
almost always smaller, and the difference — недостача — is money already paid for berries that
never arrived. Today the schema has no table for any of it: no second weight, no shortfall, no
day expenses, and therefore no cost per kilogram. The owner does this arithmetic on paper.

This slice records the weighing and the day's expenses, and computes — never stores — the
shortfall, the cost of the day, and the network's average price.

## 2. The client's instructions of 2026-09-17, in substance

> The documentation describes the re-weighing process, but the database schema currently has
> nowhere to record the re-weighing data. […] the re-weighing must be linked to the shift.
> The accepted berries are brought to the base for re-weighing.

> It's better to create a normalized version with one weighing per shift, and during the
> process we can add items — it doesn't matter how many times the berries are delivered from
> the various locations; the only thing that matters is which shift we're weighing.

> Lines just accumulate and собівартість is always computed live from whatever exists.

> §8.5 — we're proceeding based on the strategy; for now, we'll stick to a single strategy
> based on weight — this has been discussed with the team.

> §8.3 — this goes beyond the scope, but we need to implement it now.

> Top-ups need to be included in the calculations; this is a request from the client.

## 3. Decisions

Fifteen, in the order they were settled. Each is load-bearing; the reason is recorded because
every one of them has an obvious-looking opposite.

**3.1 The reweigh belongs to a shift by FK, not by gesture.** `reweighs.shift_id` is how the
document learns its point and its business date, exactly as `intakes` and `payouts` do — neither
stores those columns. Reweighing is **not** part of closing a shift. §8.1 is explicit that a
batch weighed on the morning of the 5th still counts for the 4th, and §8.7 gives the weighing to
the owner while §10.3 gives closing to the operator. A closed shift is therefore **not** a
finished shift, and the window between the two is what §8.2's «не перезважено» and §8.6's
«прийняв, але ще не зважили» both describe.

**3.2 One header per shift, lines accumulate.** `UNIQUE (shift_id)` on `reweighs`. Lines arrive
across deliveries and across calendar days; how many trips the berries came on is not recorded
and is not interesting.

**3.3 No posting moment.** No `posted_at`, no draft state, no status enum. §8.4's собівартість is
computed live from whatever lines exist at read time. The consequence, accepted: a day's cost
per kilogram moves when a late line lands, and there is no snapshot to compare against.
§8.2's «звірка видна до проведення документа» is therefore implemented as §3.9's open-shift
rule, not as a posting gate.

**3.4 Void lives on the line; the header is not voidable and has no `void_*` columns.** §8.7's
own worked storno reason is «переважили не ту партію» — a batch, not a day. A day whose every
line is voided is a day with no net weight, which §8.6 already covers: the cell is empty,
«Це не нуль». Lines are **immutable** once saved — no `PATCH` — so the line's `created_at` is
the freeze point that the absent posting moment would otherwise have provided. A correction is
a void plus a new line (§9.3).

**3.5 The author is on the line** (`reweigh_items.weighed_by_user_id`), not on the header. Two
owners can weigh different pallets of one shift a day apart; a header author would credit both
to whoever saved first.

**3.6 Недостача is computed, never stored, and valued at what was actually paid.** §8.2 is
explicit that the system computes it and «поля вводу для нього не існує — ні в кого, включно з
керівником». The price is `Σ нараховано ÷ Σ intake net_kg` **per grade** — the weighted average
actually accrued, bonuses included — not `grade_prices.base_price`. The reason is §8.4's звірка,
«жодна гривня не загубилася і не з'явилася з нічого»: недостача is not new money, it is the
slice of already-accrued money with no berries behind it. Valuing it at a price nobody paid
leaks kopecks straight into собівартість. **Compare per grade, display per product** — §4.1,
«ключ ціни це СОРТ, ключ звітності — товар»; rolling up is possible, rolling down is not.
`reweigh_items` therefore stores **no price and no amount**.

**3.7 No allocation column and no allocation parameter.** `by_weight` is hardcoded. §8.5's rule
«належить дню і заднім числом не змінюється» was a warning against a global switch that
rewrites history; a per-request parameter rewrites nothing, and a stored column with one legal
value is state pretending to be a decision. Since everything in §8 is computed live and nothing
durable depends on собівартість, no snapshot is required.
**For the follow-up:** strategy ③ «усе на один товар» cannot be a parameter alone — it must
name *which* berry, and that is per-day data. ① and ② need nothing stored; ③ needs
`expense_allocation` + `allocation_product_id` on the `reweighs` header. That is the moment the
header earns columns.

**3.8 Day expenses hang off the shift and are mutable.** `day_expenses.shift_id`, owner-only,
free-text `label` + `amount`, `PATCH` and `DELETE` allowed, no `void_*`. §2.7's freeze protects
«те, що надруковано на папері» — a supplier holding a receipt. Nothing is printed for «пальне
1 000,00»; nobody is owed it; §8.3's «+ ще рядок» is explicitly a scratchpad gesture. The cost
accepted: a past day's собівартість can change with no journal trace. Mitigated by writing an
audit entry on every expense write (§5.6), which is cheaper than the void ceremony and answers
the same question.

**3.9 No shift-status gate on writing lines.** §8.3's «Один рейс на три пункти» is a mid-day
trip by construction: the first point's berries are on the scale at the base while that point is
still buying. A "shift must be closed" rule would make that unrecordable and the workaround
would be to close the shift early, corrupting it to satisfy the schema. Instead: **while
`shifts.closed_at IS NULL`, the reconciliation reports недостача as `null` («—»)**, because the
claim is what waits, not the data.

**3.10 Owner-only across the whole §8 surface, reads included.** §8.7 «переважує і сторнує
тільки керівник», §8.3 «витрати вносить лише керівник», §8.4's screen is his. Operator
read-access to the недостача claimed against his own point is a real question the client has
not answered → follow-up.

**3.11 No `code` on `reweighs`.** `intakes`, `payouts` and `crate_issuances` carry one because a
human walks away holding that paper. Nothing is printed at the base. `transfers` and
`intake_top_ups` made the same call for the same reason.

**3.12 Top-ups are included, dated to the receipt's shift.** Client instruction. This diverges
from the `intake_top_ups` Note, and the divergence is deliberate and scoped: that rule governs
**debt accrual per point**, where the money genuinely arises the day the owner decides to pay.
Cost-of-day asks what *these kilograms* cost, and the answer is the berry day — the same
principle §8.1 states for the weighing itself. **Two clocks, two questions.** The consequence,
named: a top-up written today changes a closed day's собівартість with no journal entry saying
why. The screen carries a marker («включно з доплатами, останню внесено …»), not a snapshot.

**3.13 A top-up is split across its receipt's lines pro-rata by line `amount`.** The trigger is
«ціну перерахували ПІСЛЯ того, як людина здала» — a price revision, which scales with money, not
with kilograms. Split by `net_kg` would charge a cheap heavy berry the same top-up per kilogram
as an expensive light one. On a single-line receipt — the common case — every split agrees.
Mechanically `allocate()` with largest-remainder, so the parts sum exactly to the whole.
A top-up on a **voided** receipt contributes nothing, matching the debt formula's
`ti.voided_at IS NULL` on the parent. Attributing a top-up to a named grade is the correct
answer when only one grade's price was revised → follow-up.

**3.14 Scale 2 everywhere.** §8.5's worked `166,9114 ₴/кг` is paper arithmetic from the
strategy this slice does not implement; §8.4's own `6,39` and `166,39` are scale 2.

**3.15 Reconciliation row set.** Rows are the **products the shift actually accepted** — never
the catalogue. «Не перезважено» means that product has intake weight and **zero non-voided
reweigh lines**, and a product weighed in one grade but not another counts as «не перезважено»
too, because the shortfall on the unweighed grade would otherwise read as real. It is a state,
not a number, and must never render as `0`. A shift that accepted nothing shows §8.1's «Того дня
тут нічого не приймали» and accepts no lines.

## 4. Data model

```
reweighs
  id uuid pk
  shift_id uuid not null unique  -> shifts.id  ON DELETE RESTRICT
  created_at, updated_at

reweigh_items
  id uuid pk
  reweigh_id uuid not null       -> reweighs.id  ON DELETE CASCADE
  item_order int not null                 -- append-only, unique per header
  product_grade_id uuid not null -> product_grades.id  ON DELETE RESTRICT
  gross_kg      numeric(10,2) not null    -- > 0
  pallet_kg     numeric(10,2) not null default 0   -- >= 0
  tare_weight_kg numeric(10,2) not null   -- >= 0, SNAPSHOT of the tare catalogue
  net_kg        numeric(10,2) not null    -- > 0, (gross - pallet) - tare, PALLET FIRST
  weighed_by_user_id uuid not null -> users.id
  voided_at, voided_by_user_id, void_reason      -- num_nulls IN (0,3)
  created_at, updated_at
  unique (reweigh_id, item_order)
  index (reweigh_id)

reweigh_item_tare_types
  item_id uuid       -> reweigh_items.id  ON DELETE CASCADE
  tare_type_id uuid  -> tare_types.id     ON DELETE RESTRICT
  units int not null                      -- > 0
  pk (item_id, tare_type_id)

day_expenses
  id uuid pk
  shift_id uuid not null -> shifts.id  ON DELETE RESTRICT
  label varchar not null                  -- free text, owner-written
  amount numeric(12,2) not null           -- > 0
  created_by_user_id uuid not null -> users.id
  created_at, updated_at
  index (shift_id)
```

`reweigh_items` carries `created_at`/`updated_at` although `intake_items` does not: an intake
line is frozen with its parent, while a reweigh line has an independent lifecycle — it is
written and voided on its own, days after its header.

No equality CHECK on `net_kg`. Same reason `intake_items` refuses one on `amount` (foundation
§5.4): stored weights are rounded to two decimals, and a tolerance would be the «допустима
розбіжність» this schema will not have.

## 5. Behaviour

**5.1 Writing a line.** `POST /shifts/:shiftId/reweigh-items`. The header is created lazily on
the first line, inside the same transaction, `ON CONFLICT (shift_id) DO NOTHING` followed by a
re-read so two concurrent first lines cannot both insert. `item_order` is
`MAX(item_order) + 1` within the header, taken under `SELECT … FOR UPDATE` on the header row.

Validation, in order:
1. Shift exists (404).
2. The shift accepted at least one non-voided intake line (409 `NOTHING_ACCEPTED`, §8.1's
   «Того дня тут нічого не приймали»).
3. `product_grade_id` is among the grades that shift accepted (400 `GRADE_NOT_ACCEPTED`,
   §8.1's «Чужий товар додати не можна» — the API enforces what the picker promises).
4. Tare types exist; `tare_weight_kg` is computed as `Σ units × tare_types.weight_kg` and
   **snapshotted** — `tare_types.weight_kg` is editable and a stored breakdown without a
   snapshot would silently rewrite last week's net weight.
5. `net_kg = (gross_kg − pallet_kg) − tare_weight_kg` must be `> 0` (400 `NET_NOT_POSITIVE`).

**5.2 Voiding a line.** `POST /reweigh-items/:id/void`, reason required (§8.7's button is
inactive until the reason is typed). Owner-only. No time limit, no shift-status condition.
Already-voided → 409.

**5.3 Reconciliation** (`GET /shifts/:shiftId/reweigh`). Per §3.15 and §3.6:

```
{
  shift: { id, collection_point_id, business_date, closed_at },
  accepted_anything: boolean,
  items: [ … the non-voided lines, newest first … ],
  products: [{
    product_id, product_name,
    intake_net_kg,            // Σ non-voided intake line net, this product
    reweigh_net_kg,           // Σ non-voided reweigh line net, this product
    state: 'weighed' | 'not_reweighed',
    missing_kg: string|null,  // null while the shift is open, or not_reweighed
    missing_amount: string|null
  }]
}
```

`missing_kg` is the signed difference. A negative one is §8.2's impossible надлишок and is
surfaced as a signed number with `state: 'weighed'` — it is not clamped here, because the owner
needs to see it to fix it. It **is** clamped at zero when it enters the basket (§5.5), so a
surplus can never *reduce* the day's cost.

**5.4 Expenses.** `POST /shifts/:shiftId/expenses`, `PATCH /expenses/:id`,
`DELETE /expenses/:id`, all owner-only, all audited.

**5.5 Cost of day** (`GET /shifts/:shiftId/cost-of-day`), §8.4, `by_weight` only:

```
нараховано(grade)  = Σ intake_items.amount + Σ allocated top-ups      (non-voided both)
price(grade)       = нараховано(grade) ÷ Σ intake_items.net_kg(grade)
missing_kg(grade)  = Σ intake net_kg − Σ reweigh net_kg
недостача(grade)   = max(0, missing_kg) × price(grade)
витрати(day)       = Σ day_expenses.amount
переважено(day)    = Σ reweigh_items.net_kg, all grades
КОШИК              = Σ недостача(grade) + витрати(day)
на кілограм        = КОШИК ÷ переважено(day)          -- null when переважено = 0
було(product)      = нараховано(product) ÷ Σ intake net_kg(product)
собівартість(product) = було(product) + на кілограм    -- «однаково на ВСІ товари»
третя ціна(product)   = нараховано(product) ÷ Σ reweigh net_kg(product)
```

The response carries `top_ups_included: true` and `top_ups_latest_at` so the screen can render
§3.12's marker. It also carries the звірка pair (`нараховано`, `витрати`, and their sum) so the
client's own check — `135 700 = 131 900 + 3 800` — is visible rather than implied.

**5.6 Network average** (`GET /reports/network-average?date=YYYY-MM-DD`), §8.6. Per product,
across every point that has a shift on that business date:

```
сума(point, product)  = нараховано(product) − недостача(product)   -- what actually arrived
вага(point, product)  = Σ reweigh net_kg(product)
середня               = Σ сума ÷ Σ вага          -- NEVER the mean of the means
```

A point with no intake for that product, or with intake but no reweigh, contributes **nothing**
— not a zero. The client's own worked numbers are the acceptance test:
`790 кг / 126 400,00` and `210 кг / 32 550,00` give `1 000 кг / 158 950,00 → 158,95`, and
`(160,00 + 155,00) ÷ 2 = 157,50` is the wrong answer the implementation must not produce.

**5.7 Audit.** New actions: `reweigh-item.created`, `reweigh-item.voided`,
`day-expense.created`, `day-expense.updated`, `day-expense.deleted`.

## 6. `money.ts`

Two additions, in the one file the eslint rule protects:

- `div(a: string, b: string): string` — scale-2 quotient, half-up away from zero. Throws on a
  zero divisor; callers check for the empty day first and render «—».
- `allocate(total: string, weights: string[]): string[]` — largest-remainder split. The parts
  sum **exactly** to the total; a zero-weight vector splits evenly; a negative total mirrors.

Straight `mul` by a ratio would drift, and §8.4's «жодна гривня не загубилася» is checked on
screen.

`src/reweighs/**` and `src/day-costs/**` join the eslint money scope.

## 7. Out of scope → `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`

- §8.5 strategies ② «по сумі закупки» and ③ «усе на один товар» (③ needs two header columns).
- Per-grade attribution of a top-up (an `intake_top_ups.product_grade_id`).
- Operator read access to his own point's недостача.
- A visible history for a собівартість that moved because a late top-up or a late reweigh line
  landed.
