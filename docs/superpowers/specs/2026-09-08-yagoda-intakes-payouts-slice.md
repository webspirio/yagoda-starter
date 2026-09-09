# Yagoda CRM — Intakes & Payouts Slice Spec

**Date:** 2026-09-08
**Source:** `28-db-schema.dbml` (the schema of record), the decisions taken in the `/grilling`
session of 2026-09-08, and the three preceding specs:
`2026-09-04-yagoda-foundation-slice.md` (**the foundation spec**),
`2026-09-06-yagoda-catalog-slice.md` (**the catalog spec**) and
`2026-09-07-yagoda-suppliers-prices-slice.md` (**the prices spec**).

The foundation spec's §5 data conventions bind this slice in full. Where this slice diverges
from the DBML — and it does, in seven named places — §8 states each divergence with what it
costs.

**Position in the schema:** `28-db-schema.dbml` describes 17 tables. Foundation implemented two
(`users` reshaped, `collection_points` new); catalog implemented three (`products`,
`product_grades`, `tare_types`); prices implemented two (`suppliers`, `grade_prices`). This
slice implements **five** — `shifts`, `intakes`, `intake_items`, `intake_item_tare_types`,
`payouts` — and nothing else. After it, five tables remain: `crate_issuances`, `crate_returns`,
`crate_return_allocations`, `cash_counts`, `transfers`.

**`26-rules-by-example.md` IS NOW IN THE REPOSITORY, and this is the first spec written with
it.** All three earlier specs state that it is absent and that every `§N` was read from
quotations inside the DBML's own `Note` blocks. That is no longer true: this spec quotes the
primary source directly, and §10 records the four places where the primary text **contradicted
a decision this slice had already taken** — each of which was reversed rather than argued away.
«правка N» still points at `26-правки-і-запитання.md`, which remains absent.

**A note for whoever revisits the earlier slices:** their reasoning was built on second-hand
quotation and has not been re-checked against the source. §10.5 names the one place where that
matters today.

---

## 1. Goal

Make the system able to record what it exists to record: **berries came in, money went out.**

Everything before this slice was reference data — who works here, which points exist, what we
buy, from whom, at what price. Nothing in the database yet describes a transaction. This slice
adds the first two documents and the container they live in, and with them the first number the
business actually asks for: **what do we owe this person.**

## 2. Scope

**In:**

- `shifts` — its own module, in **minimal form**. Open, close, reopen, read. No cash
  reconciliation of any kind.
- `intakes` + `intake_items` + `intake_item_tare_types` — one module, one aggregate, one
  document.
- `payouts` — its own module, including the `void` and `return_settled` gestures.
- `supplier-balance` — a small module owning the debt formula and nothing else.
- `common/money.ts` — the single arithmetic seam. First slice that computes anything.
- `collection_points.code` — a new column on a foundation table, required by the receipt-code
  scheme (§6.2). The only thing this slice touches outside its own five tables.

**Out, and named rather than forgotten:**

- **Cash.** The whole of it. `cash_counts`, `transfers`, and therefore the `каса за ягоду` half
  of §3.6's payout ceiling. See §6.6 and §10.
- **Shift reconciliation.** `awaiting_explanation`, `shifts.explanation`, and §7.7's rule that
  the OWNER closes a shift with a discrepancy. Unreachable without `cash_counts`; see §6.1.
- **Crates.** `crate_issuances`, `crate_returns`, `crate_return_allocations`. Note that
  `intake_item_tare_types` is *not* crates — §2.6 is explicit that «ящики В КВИТАНЦІЇ (вага, що
  знімається) і ящики НА РУКАХ (майно) ніде не складаються в одне».
- **`decimal.js`.** Deferred again; §6.7 says what replaces it and why that is not a decision to
  celebrate.
- **§2.3's five-line ceiling.** Deliberately not enforced; §8.7.
- **Any frontend.** Backend only, as with every slice so far.

### 2.1 Why `shifts` is in, having been cut once

The prices spec §2.1 cut `shifts` with a specific argument: its **close path** cannot be built
correctly without `cash_counts`, and building it incorrectly means building it twice.

That argument is still true and is not being overturned. What changed is the alternative. Every
document in this slice carries `shift_id NOT NULL`, and the shift is the **only** place a
document learns its point and its business date — neither `intakes` nor `payouts` has a
`collection_point_id` column. So `shifts` is not deferrable alongside `intakes`; it is a
precondition of it.

The resolution is to build the container and skip the reconciliation:

- **Built:** open, close, reopen, read; the point and business-date derivation; the partial
  unique index that keeps one drawer to one book (§7.8).
- **Not built:** `awaiting_explanation` (nothing can enter it), `explanation` (nothing writes
  it), and the owner-closes-on-discrepancy role split (nothing can detect a discrepancy).

**The bill is paid knowingly, and it is the one the prices spec named:** the close path *will*
be revisited when `cash_counts` lands. What is being avoided instead is worse — a slice that
implements four document tables against a shift that does not exist.

---

## 3. Module boundaries

Four modules. Dependencies point one way and there are no cycles.

| Module | Owns (sole writer) | Reads, and through what |
|---|---|---|
| `shifts` | `shifts` | `collection_points` — existence of a body-supplied point, via `CollectionPointsService` |
| `intakes` | `intakes`, `intake_items`, `intake_item_tare_types` | `shifts` (via `ShiftsService`), `grade_prices` (via `GradePricesService`), `tare_types` (via `TareTypesService`), `suppliers` (via `SuppliersService`) |
| `payouts` | `payouts` | `shifts`, `suppliers`, and `supplier-balance` for the ceiling |
| `supplier-balance` | nothing | `intakes` and `payouts` tables, directly and read-only |

`supplier-balance` is the one module that reads two other modules' tables directly rather than
through their services, and that is deliberate: it exists **because** the formula must be a
single aggregate query over both histories, and routing it through two services would either
return two numbers to subtract in a third place or drag a `SUM` into services that own a row
model. The `nest-module-conventions` invariant it satisfies is the one that matters here —
*reads are open, writes go through a seam*. It writes nothing.

### 3.1 Read seams this slice adds to already-shipped modules

Three owners gain a narrow read method. None gains a write path.

| Owner | New method | Why |
|---|---|---|
| `GradePricesService` | `currentFor(pointId, gradeId)` → the newest row or `null` | §6.3's price snapshot. The existing `current()` is a paginated list shaped for a screen; the intake path needs one pair. |
| `TareTypesService` | `findManyRaw(ids)` → entities | §6.3's tare weight. The service currently exposes only `list`/`create`/`update`; the intake path needs specific rows by id. |
| `ShiftsService` | `findOpenAtPoint(pointId)`, `findOneRaw(id)` | Every document write resolves its shift through the owner. |

`SuppliersService` already has what is needed (`findOne` enforces visibility); `ProductsService`
already exposes `findOneRaw` and is reached only indirectly, through `GradePricesService`, which
already validates the grade.

### 3.2 Layout

Flat, as in every existing module (`<name>.service.ts`, `<name>.controller.ts`,
`<name>.mapper.ts`, `dto/`, entity co-located) — the same reasoning the catalog spec §3
recorded: `nest-module-conventions` marks directory names as **conventions rather than
invariants** and permits a consistent alternative, and this repo has one. Adopting
`commands/`+`queries/` for four modules while eleven existing ones use the flat shape would make
the codebase less legible, not more.

The one place the aggregate justifies a second file: `intakes/intake-lines.ts`, a pure module
that turns a validated request plus the snapshotted price and tare rows into the item and
tare-line records. It performs no data access, so it is unit-testable without a database — which
matters, because it holds every piece of arithmetic in the slice.

---

## 4. Routes

```
POST   /shifts                                                              @Auth(PointOperator)
GET    /shifts/current    ?collection_point_id=                             @Auth()
GET    /shifts            ?collection_point_id= &status= &from= &to= &page= &limit=   @Auth()
GET    /shifts/:id                                                          @Auth()
POST   /shifts/:id/close                                                    @Auth(PointOperator)
POST   /shifts/:id/reopen                                                   @Auth(NetworkOwner)

POST   /intakes                                                             @Auth()
POST   /intakes/:id/void                                                    @Auth()
GET    /intakes           ?collection_point_id= &shift_id= &supplier_id=
                          &from= &to= &include_voided= &page= &limit=        @Auth()
GET    /intakes/:id                                                         @Auth()

POST   /payouts                                                             @Auth()
POST   /payouts/:id/void                                                    @Auth()
POST   /payouts/:id/settle-return                                           @Auth(NetworkOwner)
GET    /payouts           ?collection_point_id= &shift_id= &supplier_id=
                          &from= &to= &include_voided= &page= &limit=        @Auth()
GET    /payouts/:id                                                         @Auth()

GET    /suppliers/:id/balance                                               @Auth()
```

**No `DELETE`, anywhere** — foundation §5.5.

**No `PATCH`, anywhere in this slice** — and unlike the missing `DELETE`, this one is new. Every
module built so far has an update path. These three do not, for the reason §6.5 sets out: a
document is corrected by voiding it and writing another one.

**`GET /suppliers/:id/balance` is registered by `supplier-balance`, not by `suppliers`.** The
`nest-module-conventions` caveat about registration order across modules does not bite here: the
route has one more path segment than `GET /suppliers/:id`, so neither can shadow the other
whichever module Nest registers first. Recorded because the caveat *would* bite if a later slice
adds `GET /suppliers/:something` at the same depth.

**Responses** (mappers, mirroring `toSupplierResponse`):

```
Shift        { id, collection_point_id, business_date, status,
               opened_by_user_id, closed_by_user_id, closed_at, created_at }

Intake       { id, code, shift_id, collection_point_id, business_date,
               supplier_id, amount, received_by_user_id,
               voided_at, voided_by_user_id, void_reason, created_at }

IntakeDetail { ...Intake, items: [ { id, item_order, product_grade_id,
                 gross_kg, pallet_kg, tare_weight_kg, net_kg,
                 price, bonus, amount,
                 tare: [ { tare_type_id, units } ] } ] }

Payout       { id, code, shift_id, collection_point_id, business_date,
               supplier_id, amount, paid_by_user_id,
               voided_at, voided_by_user_id, void_reason,
               return_settled_at, return_settled_by_user_id, return_note,
               created_at }

Balance      { supplier_id, debt }
```

Every `numeric` — `amount`, all four weights, `price`, `bonus`, `debt` — is a **string**, never a
number (foundation §5.1).

`collection_point_id` and `business_date` appear on the document responses even though neither is
a column on those tables: they are joined in from `shifts` for the reader's benefit. This is not
a second copy of a fact — nothing stores them, the mapper composes them — and without them every
client would have to fetch the shift to render a list row.

`GET /intakes` returns headers only; `GET /intakes/:id` returns the nested detail. A list of
documents each carrying up to five items and their tare lines is a payload nobody's list screen
wants.

---

## 5. Access rules

Guards decide from the request; `assert*` helpers decide from a row. Unchanged convention.

| Operation | Operator | Owner |
|---|---|---|
| open / close a shift | own point only | **never** (403) — §10.3 |
| reopen a shift | **never** (403) | any point, with a reason |
| create an intake / payout | own point's open shift | any point's open shift |
| void an intake / payout | **own document only**, while the shift is open | any point, any time |
| settle a payout return | **never** (403) | any point |
| read anything | own point only (`resolvePointFilter`) | anywhere |

**A document at another point is a 404, not a 403** — the same reasoning `SuppliersService`
recorded: these rows carry a named supplier and a money amount, and a 403 confirms the id exists.

**The shift close is the operator's freeze line.** Once a shift is closed, the operator can no
longer void a document in it; the owner still can. This is the same line a `PATCH` would have
used had one existed, reused for the one mutating verb that survived — and it is what makes
`close` mean something before `cash_counts` gives it a second meaning.

**An operator may void only a document they wrote themselves.** §9.4 is a table and its third
row is unambiguous — «чужа квитанція → приймальник НІКОЛИ, **навіть на своїй точці і в ту саму
зміну**» — so the check is `received_by_user_id === actor.id`, not merely "same point". §10.6
makes the forbidden case ordinary rather than hypothetical: Оксана leaves her account at 14:00,
Марія enters hers at 14:01, and both sign receipts inside **one** shift at **one** point. A
point-scoped rule would let Марія void Оксана's receipt.

**The owner cannot open or close a shift at all.** §10.3 is titled «Тільки приймальник — і це
не помилка» and gives its own reason: «Відкрити чужий робочий день і закрити його за людину
нема кому, а підпис під зведеною касою мусить належати тому, хто цю касу тримав у руках.» The
owner keeps `reopen`, which is a correction rather than a signature (§10.2 gives corrections to
the owner), and keeps the ability to write documents into a shift an operator opened.

---

## 6. Domain rules

### 6.1 `shifts` — a container, not a reconciliation

```
id · collection_point_id → collection_points
opened_by_user_id → users · closed_by_user_id → users (nullable)
business_date  date NOT NULL          -- server-derived, never in a request body
closed_at      timestamptz (nullable)
status         shift_status NOT NULL DEFAULT 'open'
explanation    text (nullable)        -- present, unwritten; see below
created_at · updated_at

UNIQUE (collection_point_id, business_date)                        -- §8.1, a divergence
UNIQUE (collection_point_id) WHERE closed_at IS NULL                -- partial, foundation §5.4
CHECK  (closed_at IS NULL) = (closed_by_user_id IS NULL)
CHECK  (status = 'closed') = (closed_at IS NOT NULL)
```

**Opening and closing belong to the operator, and to nobody else** (§10.3). `POST /shifts` and
`POST /shifts/:id/close` are `@Auth(UserRole.PointOperator)`; the point comes from the actor's
token and there is **no** `collection_point_id` in the open DTO. An owner with no point of their
own therefore has no shift to open, which is the intended outcome rather than a gap.

**`business_date` is derived at open time** from `TimeService.now()` in `APP_TIMEZONE`
(`Europe/Kyiv`), per foundation §5.2: server-derived, never editable, absent from every request
body. **This slice is where `TimeService` finally gets wired** — the prices spec deferred it
saying it «lands with `shifts`, which is the first table that genuinely has a business day», and
this is that.

`APP_TIMEZONE` already defaults to `Europe/Kyiv` in both `timezone.config.ts` and the Joi schema,
so nothing needs changing — **the foundation spec's §5.2 claim that it «currently defaults to `UTC`»
is stale** and should not be acted on. What does matter is that the zone is now load-bearing for the
first time: a document created at 23:30 Kyiv on 8 September must file under the 8th, and under `UTC`
it would file under the 9th. `TimeService` already validates the zone at boot.

**`status` moves `open → closed` and back on reopen.** `awaiting_explanation` is a **documented
dead value**: it exists solely to express a cash discrepancy, a discrepancy is
`counted − expected`, and `expected` comes from a five-table formula over `transfers`, `payouts`,
`crate_issuances`, `crate_returns` and `intakes`. Three of those five do not exist. `explanation`
is likewise a column nothing writes. Both stay in the migration — they are the schema of record —
and the entity documents that they are unreachable until `cash_counts`.

**`opened_at` is removed; `created_at` is the open instant.** The DBML gives the table both, but
with `opened_at` server-assigned they hold the same value in every row forever, and the file's own
header forbids that: «два примірники одного факту в цьому проєкті заборонені». This is exactly
the argument the prices spec used to remove `grade_prices.set_at`, applied to the same shape.
`closed_at` has no such twin and stays. See §8.3.

**Close does not inspect `business_date`.** An operator who forgets to close Friday's shift closes
it on Saturday morning and then opens Saturday's — no special path, no migration, no stuck point.
The only visible oddity is that Friday's `closed_at` reads Saturday, which is true and is what
happened.

**Reopen exists because of §8.1.** With one shift per point per day, `close` becomes a one-way door
that ends a point's trading day, and a mistaken close at 11:00 would otherwise strand a point with
cars still arriving. `POST /shifts/:id/reopen` is owner-only, takes a mandatory reason, writes an
audit entry, and is refused (409) if another shift is already open at that point or if the target
is not that point's newest shift.

The §2.7 objection — «те, що надруковано на папері, не рухається» — does not reach a shift. A shift
has no `code`, no receipt and no supplier copy; that is precisely why `intakes` and `payouts` carry
a `void_*` trio and `shifts` does not. Reopening a shift moves nothing anyone is holding.

### 6.2 Document codes — the operator types the number, the server composes it

`intakes.code` and `payouts.code` are `varchar NOT NULL UNIQUE` in the DBML, which never says where
the value comes from. **It comes from the paper.** The operator is filling in a pre-printed receipt
book; the number on that book is what a supplier reads back over the phone, and inventing a
parallel numbering alongside it would put two different numbers on one transaction.

The server composes the stored value:

```
{POINT_CODE}-{IN|PO}-{YYYYMMDD}-{typed}

  KPG-IN-20260908-04412
  KPG-PO-20260908-00031
```

- `POINT_CODE` — the new `collection_points.code` (§6.2.1).
- `IN` / `PO` — document type. Cheap legibility; the two tables have separate unique constraints
  so it is not load-bearing.
- `YYYYMMDD` — from `shifts.business_date`, not from the wall clock.
- `typed` — what the operator entered: trimmed, upper-cased, `^[A-Z0-9][A-Z0-9-]{0,15}$`, 400
  otherwise.

**Why the prefix is not optional.** The DBML's global `UNIQUE (code)` is only true with it. Two
points buying identical receipt books both have an `04412`, and a bare number would 409 the second
one mid-transaction with a car waiting. The date component closes the second collision source,
which is easy to miss: **paper books get replaced and restart at 00001**, so a point collides with
itself a season later.

With the full prefix, a 409 means one thing only — *same point, same day, same typed number* —
which is a genuine duplicate entry, and refusing it is correct.

**The raw typed part is not stored separately.** One column, one fact (DBML header). Recovering
what the operator typed is string surgery on `code`, which is fine, because nothing needs to.

#### 6.2.1 `collection_points.code` — a foundation table changes

```
code varchar NOT NULL UNIQUE
CHECK (code ~ '^[A-Z0-9]{2,8}$')
```

Owner-set, edited through the existing `PATCH /collection-points/:id`, upper-cased and trimmed by
the service. The migration backfills existing rows deterministically — `P01`, `P02`, … ordered by
`created_at` — so the constraint can be `NOT NULL` immediately, and the owner renames them to
something meaningful whenever they like.

This is the only change this slice makes outside its own five tables. It is a **dependency of a
decision, not an adjacent fix**: without it the receipt-code scheme has no point identifier and the
DBML's global unique constraint is unsatisfiable.

### 6.3 The intake aggregate — one document, one transaction

`intakes` is written by one `POST` carrying its items and their tare lines nested. §2.3: «один візит
із кількома сортами це ОДИН документ із кількома рядками». `intake_items` and
`intake_item_tare_types` are `ON DELETE CASCADE` compositions (foundation §5.5) with **no routes of
their own** — they are parts of a document and meaningless alone.

**Request:**

```jsonc
POST /intakes
{
  "code": "04412",                    // typed; server composes the full code
  "collection_point_id": "…",         // owner only; ignored for an operator
  "supplier_id": "…",
  "items": [
    { "product_grade_id": "…",
      "gross_kg": "42.00",
      "pallet_kg": "1.50",
      "bonus": "2.00",
      "tare": [ { "tare_type_id": "…", "units": 3 } ] }
  ]
}
```

Everything not in that body is **derived by the server**, and each derivation is a rule from the
schema rather than a convenience:

| Derived | From | Rule |
|---|---|---|
| `shift_id` | the open shift at the resolved point | 409 if none is open |
| `item_order` | position in the `items` array, 1-based | `UNIQUE (intake_id, item_order)` |
| `price` | `GradePricesService.currentFor(point, grade)` | §2.8 — a snapshot of the current price |
| `tare_weight_kg` | `Σ units × tare_types.weight_kg` | §2.5 — «вага тари підставляється сама» |
| `net_kg` | `(gross_kg − pallet_kg) − tare_weight_kg` | §2.4 — **pallet first, tare second** |
| `amount` (line) | `net_kg × (price + bonus)` | §2.8 |
| `amount` (document) | `Σ` line amounts | §2.3 — the number printed on the paper |

**The server looking up `price` is what makes §4.5 enforceable.** A grade with no price row at that
point is a 400, which is «сорт без ціни дня на прийомці не показується взагалі» expressed as a
refusal rather than as a hope about the client. It also guarantees the price the operator saw and
the price stored cannot disagree — they are the same read.

**Snapshot ≠ who supplies it.** `price` and `tare_weight_kg` are snapshots because they are frozen
once written (§2.7) — the owner may edit `tare_types.weight_kg` tomorrow and this document must not
move. That says nothing about who computes them, and having the client supply them would make
`grade_prices` decorative.

**Guards, all inside the one transaction:**

- `bonus` within `[−max_discount, +max_markup]` from the same price row — §2.9, «межа мережі
  ±30 ₴/кг обрізає bonus». The prices spec added those two columns for exactly this and recorded
  that «nothing in this slice reads them»; this is the slice that does. Two string comparisons,
  zero extra queries, and a 400 naming the permitted range.
- `net_kg > 0` — a 400 *and* a `CHECK`. Without it a pallet or tare heavier than the gross weight
  writes a negative net, therefore a negative amount, therefore a silent credit to the supplier's
  debt, frozen forever by §2.7.
- `price + bonus >= 0` — a 400, plus `CHECK (amount >= 0)`. `max_discount` is an independent
  magnitude, so a grade priced at 10.00 with a `max_discount` of 20.00 admits a legal `bonus` of
  −15.00 and an effective rate below zero. The clamp alone does not close this.
- `units > 0` on every tare line, and a `tare_type_id` may appear at most once per item — that is
  the composite primary key `(item_id, tare_type_id)`, so a repeated type is a 400 before it is a
  23505.
- At least one item (`@ArrayMinSize(1)`). A zero-line intake has an `amount` of `0.00` and no
  meaning.
- **At least one tare line per item** (`@ArrayMinSize(1)` on `tare`). §9.1 lists «позиція без
  тари» among the things the system «не дає провести взагалі», with the message «Вкажіть
  кількість тари — без неї брутто пішло б у чисту вагу цілком». The cost of the omission is
  quantified in §9.2: on a 701.5 kg load with 115 crates it is `115 × 1,20 = 138 кг × 145 ₴ =
  20 010,00 ₴` handed over for air, and §9.2 notes such an error «завжди на користь
  здавальника». **The source contradicts itself here** — §9.2 lists the same case as a warning
  rather than a refusal — and this slice takes the strict reading; §10.2 records the conflict.
- Inactive grade or inactive tare type → 400. Deactivation is this project's only removal verb;
  it has to actually stop something.

**Not enforced: §2.3's «стеля 5».** Deliberate; §8.7.

### 6.4 `intake_items` and `intake_item_tare_types`

```
intake_items
  id · intake_id → intakes (ON DELETE CASCADE) · item_order int NOT NULL
  product_grade_id → product_grades
  gross_kg · pallet_kg (DEFAULT 0) · tare_weight_kg · net_kg   numeric(10,2) NOT NULL
  price · bonus (DEFAULT 0)                                     numeric(10,2) NOT NULL
  amount                                                        numeric(12,2) NOT NULL
  UNIQUE (intake_id, item_order)
  CHECK gross_kg > 0 · pallet_kg >= 0 · tare_weight_kg >= 0 · net_kg > 0
  CHECK price >= 0 · amount >= 0
  -- NO CHECK on bonus: §2.8 makes a negative bonus meaningful
  --    («від'ємний bonus це м'ята чи цвіла ягода»)

intake_item_tare_types
  item_id → intake_items (ON DELETE CASCADE) · tare_type_id → tare_types
  units int NOT NULL
  PRIMARY KEY (item_id, tare_type_id)
  CHECK units > 0
```

Neither child has `created_at` or `updated_at`, matching the DBML. They are frozen with their
parent and have no independent lifecycle.

**No equality `CHECK` on computed money** — `amount = net_kg × (price + bonus)` is not written as a
constraint. Foundation §5.4 already ruled on this: stored values are rounded to two decimals, so an
exact check rejects legitimate rows, and loosening it to a tolerance would be the «допустима
розбіжність» the schema refuses to have.

### 6.5 Corrections are void, and only void

There is **no `PATCH`** on either document. §2.7: `intakes.amount` «після проведення не міняється
НІКОЛИ». §9.3: a correction is a new document, and the old one «лишається в журналі назавжди».

```
POST /intakes/:id/void   { reason }
POST /payouts/:id/void   { reason }

  voided_at, voided_by_user_id, void_reason
  CHECK (num_nulls(voided_at, voided_by_user_id, void_reason) IN (0, 3))
  409 if already voided
```

**An operator may void only their own document, and only while the shift is open** (§9.4, §5).
The owner may void anything, anywhere, at any time. §9.3 supplies the rest of the shape and this
slice implements it exactly: «спроба сторнувати той самий документ удруге → кнопки просто немає»
is the 409; «спроба сторнувати без причини → кнопка неактивна» is the mandatory reason; and
«**Часткового сторно немає**» is why there is no partial-void path and no `PATCH`.

The `CHECK` is foundation §5.4's void-trio completeness rule, reaching its first voidable tables.
The reason is mandatory because §9.3 makes it mandatory — that is the whole argument for why
voiding is a trio of columns and not a status value, and it is why `transfer_status` lost its
`void` member on 03.09.2026.

**Two things about voiding that read as bugs and are not:**

1. **Voiding an intake can drive a supplier's debt negative, and that is allowed.** The `suppliers`
   Note is explicit: «сторно КВИТАНЦІЇ… ДОЗВОЛЕНЕ, з попередженням: заборони немає, і інваріанта
   борг >= 0 в цій схемі теж немає». The negative is repaid by the person's next delivery, because
   «Разом» is just the balance. This slice therefore has **no** floor check on void.
2. **Voiding a payout does not return the cash.** §9.3: «каса НЕ виросла на 8 000… інакше сторно
   стає способом красти». The money left the drawer and comes back only when a human puts it back.

For the second, the gesture that records the money coming back:

```
POST /payouts/:id/settle-return   @Auth(NetworkOwner)   { note? }

  return_settled_at, return_settled_by_user_id, return_note
  409 unless voided_at IS NOT NULL
  409 if return_settled_at IS NOT NULL          -- once only
  CHECK ((return_settled_at IS NULL) = (return_settled_by_user_id IS NULL))
  CHECK (return_settled_at IS NULL OR voided_at IS NOT NULL)
```

The amount is never stored: it always equals `payouts.amount`, and storing it again would be the
second copy of one fact the DBML header forbids.

**Owner-only, and that is the point.** An operator who could both void their own payout and declare
the cash returned would close, alone and unobserved, exactly the loop §9.3 names as «спосіб красти».
The person who physically holds the drawer is not the person who certifies that it was refilled.

**Nothing in this slice reads `return_settled_at`.** It is consumed by the cash formula, which needs
`transfers` and `cash_counts`. Included anyway, on the same reasoning that put the bonus clamp in:
the column ships exercised rather than decorative, and its `CHECK`s go into the migration while the
argument for them is fresh.

### 6.6 `payouts` and the half-ceiling

```
id · code · shift_id → shifts · supplier_id → suppliers
amount numeric(12,2) NOT NULL · paid_by_user_id → users
void_* trio · return_settled_* trio
created_at · updated_at
index (supplier_id, created_at)
CHECK (amount > 0)
```

**The ceiling this slice enforces is `amount <= debt`, which is half of §3.6.** The full rule is
`min(Разом, каса за ягоду)`; the cash half needs `transfers`, `cash_counts`, `crate_issuances` and
`crate_returns`, none of which exist. Shipping the debt half means the `voided_at IS NULL` filter on
both histories is exercised from day one instead of being retrofitted against tables full of rows.

Shipping half a rule is stated here rather than hidden: **a payout can currently exceed the cash
physically in the drawer**, and nothing in this slice can notice.

`amount > 0` is beyond the DBML. §3.7 permits «будь-яка сума від 0 до "Разом"», but a payout of
exactly zero is a receipt for handing over nothing — a document with no event behind it. Recorded
in §8.6 as a divergence.

**The race, and the lock.** The check reads a sum over two tables and then inserts, and no `CHECK`
can express "not greater than a sum over two tables". Two payouts to one supplier in flight
together — two operators, or one double-tapped submit button, or a client retry on a slow
response — both read a debt of 380, both pass, both commit, 760 against a 380 debt. Nothing
downstream notices, because the schema has no `борг >= 0` invariant to violate.

So the payout transaction takes a row lock first:

```ts
await this.dataSource.transaction(async (m) => {
  await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [dto.supplier_id]);
  const debt = await this.balance.debtFor(dto.supplier_id, m);   // now stable
  if (Money.gt(dto.amount, debt)) throw new BadRequestException(/* names the debt */);
  await m.insert(Payout, { /* … */ });
});
```

The `suppliers` row is a mutex, not data being changed. Contention is per supplier; payouts to
different suppliers never block each other, and intakes are untouched. `SERIALIZABLE` was rejected:
it needs a retry loop for an expected `40001`, and this repo has no retry infrastructure — more new
machinery than one route justifies.

### 6.7 `supplier-balance` — one formula, one home

```sql
SELECT COALESCE((SELECT SUM(i.amount) FROM intakes i
                  WHERE i.supplier_id = $1 AND i.voided_at IS NULL), 0)
     - COALESCE((SELECT SUM(p.amount) FROM payouts p
                  WHERE p.supplier_id = $1 AND p.voided_at IS NULL), 0) AS debt
```

Copied from the `suppliers` Note, which also states why this may exist in exactly one place:

> фільтр `voided_at IS NULL` стоїть на ОБОХ історіях, і забути його на будь-якій означає або гасити
> борг грошима, яких не видали, або тримати борг за ягоду, якої не брали

Two callers need it today — the payout guard (§6.6) and the screen that shows «Разом» before anyone
submits — and a third arrives with `cash_counts`. One module owns it; `debtFor(supplierId, manager?)`
accepts an `EntityManager` so the guard's read joins the caller's transaction and sees the locked,
stable value.

**No point filter, and it must not be added.** `supplier_id` already means the point — §3.9 nails a
supplier row to one point — and the Note says filtering by point as well is «не треба й не можна».

**Nothing is cached and no balance is stored.** §3.2 forbids it, and the DBML gives the field
evidence for why: a stored balance is where the client's own workbook broke, **124 разриви з 1 473**.

### 6.8 `common/money.ts` — the arithmetic seam

This is the first slice that computes anything. Foundation §5.1 is the governing rule: numerics are
strings end to end, and **no arithmetic operator is ever applied to a monetary or weight value.**

`decimal.js` is **not** added in this slice — the owner's call, on the grounds that this is
temporary logic to be refined once the business rules land. What replaces it is not "use `Number`":
it is a single module that is the only place in the backend where a decimal string is taken apart,
with scaled-integer arithmetic inside and strings at both boundaries.

```ts
// common/money.ts — strings in, strings out, half-up at scale 2
export function sub(a: string, b: string): string
export function mul(kg: string, rate: string): string   // ROUND_HALF_UP, 2dp
export function sum(xs: string[]): string               // exact, no rounding
export function gt(a: string, b: string): boolean
```

**Rounding is applied per line, then the lines are summed — never the reverse.** The receipt prints
each line's amount and a total that must equal what is printed above it; `round(Σ unrounded)` can
differ from `Σ round(each)` by a kopiyka, and the schema's tolerance for that is «не зійшлося на
копійку — те саме, що на 350 ₴».

`net_kg` needs no rounding: all three inputs are `numeric(10,2)` and subtraction of two-decimal
values is exact at two decimals.

**Aggregates stay in SQL.** `SUM` over `numeric` in Postgres is exact decimal arithmetic; the debt
formula and every later cash formula are database-side and never pass through this module.

**Why this is a seam and not just a helper:** refining it later — swapping in `decimal.js`, changing
the rounding policy — must be a change to one file, not a hunt for `*` and `parseFloat` across four
services. An ESLint `no-restricted-syntax` rule keeping arithmetic operators out of the four new
services is the cheap way to keep that true, and is worth adding with it.

---

## 7. Migration

One migration, `1788600000007-YagodaIntakesAndPayouts`, creating the `shift_status` enum, the five
tables, and altering `collection_points`. `down()` drops them in dependency order and will fail once
`crate_issuances` references a shift — the safe direction, and the posture every earlier migration
takes.

Two constraints must be **hand-written**, because the DBML's index blocks are placeholders for them
rather than transcriptions (foundation §5.4 flagged both):

```sql
CREATE UNIQUE INDEX "UQ_shifts_open_per_point"
  ON "shifts" ("collection_point_id") WHERE "closed_at" IS NULL;
```

The DBML literally writes `(collection_point_id) [unique]`, which would forbid a point from ever
having a second shift. The partial form is what §7.8 actually argues for — «дві відкриті зміни це дві
книги на одну шухляду».

The migration header must carry, in the style the `YagodaSuppliersAndPrices` header established, the
list of things a later reader will try to "fix":

1. `shifts.explanation` and the `awaiting_explanation` enum value are **unwritten on purpose** —
   they land with `cash_counts`, and deleting them would diverge from the schema of record.
2. `intake_items` has **no** `created_at`/`updated_at` and **no** equality `CHECK` on `amount`.
3. `intake_items.bonus` has **no** non-negative `CHECK` — a negative bonus is «м'ята чи цвіла ягода».
4. `shifts` has **no** `void_*` trio, unlike the two document tables. A shift is not a paper
   document; it is reopened, not voided.
5. `UNIQUE (collection_point_id, business_date)` is a **deliberate addition** to the DBML, and
   `POST /shifts/:id/reopen` exists because of it. Removing one without the other strands a point
   for a day.

---

## 8. Divergences from `28-db-schema.dbml`

Seven, each a decision rather than an oversight.

### 8.1 `UNIQUE (collection_point_id, business_date)` on `shifts` — added

The DBML writes that index **non-unique**, which permits a point to open a second shift on a day it
already closed one. This slice makes it unique: a working day at a point is exactly one row.

**What it buys:** every later per-day report — and the cash formula is one — reads one shift per
point per day instead of aggregating an unbounded set. «День на точці» becomes a row, not a `SUM`.

**What it costs, and what pays for it:** `close` becomes a one-way door. A close at 11:00 with cars
still arriving would strand the point until tomorrow, and the schema has no reopen verb. §6.1 adds
one — owner-only, reasoned, audited. The two decisions are a pair and neither survives alone.

### 8.2 `POST /shifts/:id/reopen` — a verb the schema does not name

Invented, and only because of §8.1. Justified in §6.1: a shift has no paper twin, so §2.7's
immutability argument does not reach it.

### 8.3 `shifts.opened_at` — removed

`created_at` is the open instant. The DBML gives both; server-assigned, they hold the same value in
every row forever, and «два примірники одного факту в цьому проєкті заборонені». Identical to the
prices spec's removal of `grade_prices.set_at`. `closed_at` has no twin and stays.

### 8.4 `collection_points.code` — a new column

Not in the DBML at all. Required by §6.2: without a point identifier in the code, the DBML's own
global `UNIQUE (code)` is unsatisfiable for two points using identical receipt books.

### 8.5 The composition rule for `intakes.code` / `payouts.code`

The DBML declares both columns and never says what fills them. This slice decides: the operator
types the paper number, the server prefixes point, type and business date. Not a contradiction of
the schema — a filling-in of a hole in it — but recorded here because a future reader will find a
composed string in a column the DBML describes only as `varchar`.

### 8.6 `CHECK (payouts.amount > 0)` — stricter than §3.7

§3.7 permits «будь-яка сума від 0 до "Разом"». A zero payout is a receipt for handing over nothing.
The permissive reading is preserved everywhere it matters — any amount up to the debt is legal, and
there is no minimum beyond "something happened".

### 8.7 §2.3's five-line ceiling — not enforced

«стеля 5» is not implemented, by decision. It reads as a property of the paper form rather than of
the domain, and a form can be reprinted. If it is ever wanted it belongs in the DTO
(`@ArrayMaxSize(5)`) and not in a `CHECK`, so that relaxing it needs no migration. `@ArrayMinSize(1)`
**is** enforced, for a different reason: a zero-line intake is an `amount` of `0.00` with no meaning.

---

## 9. What this slice deliberately cannot do

Stated plainly, because each is a rule that exists and is not yet enforced anywhere:

- **A payout can exceed the cash in the drawer.** Only the debt half of §3.6 is built.
- **A closed shift proves nothing.** No count, no expected amount, no discrepancy. `close` is a
  timestamp.
- **`awaiting_explanation` is unreachable** and `shifts.explanation` is unwritten.
- **§7.7's role split on close is not built** — with no discrepancy detectable, there is nothing to
  escalate to the owner.
- **Nothing reads `payouts.return_settled_at`.** It is written correctly and consumed later.
- **A negative supplier balance is possible and unflagged.** By design (§6.5), but the «попередження»
  the `suppliers` Note calls for is a UI concern with no UI yet.
- **A grade priced last week is used as today's price.** §4.5's gate is not enforceable; §10.3.
- **No warning is ever raised, only refusals.** §9.2's four «перепитано» checks have no channel;
  §10.4.
- **A payout is not rounded and nothing is suggested.** §12.1; §10.4.

---

## 10. What `26-rules-by-example.md` changed

This slice was designed, specced and planned before the primary source was in the repository.
Reading it reversed four decisions and opened four gaps. Recording both here, because the next
reader's instinct on finding a rule stated twice will be to pick the convenient one.

### 10.1 Four decisions the source reversed

| Was | Is | Source |
|---|---|---|
| An operator may void any document at their own point while the shift is open | Only a document **they wrote** | §9.4 |
| The owner may open and close a shift at any point | Operator only; the owner has neither verb | §10.3 |
| A line may carry no tare | Every line carries at least one tare line | §9.1 |
| A bonus or payout over the limit is refused with the range hidden | Refused **naming the number** | §2.10, as clarified by the owner |

The last one is the smallest change and the most easily misread. §2.10 («межа працює як
обмеження, а не як підказка») looks like a rule that the limit must never be disclosed, and an
earlier draft of this spec treated it as one. **It is a UI/UX recommendation, not an access
rule** (owner's clarification, 2026-09-08): the number is not secret, the owner sees it, and it
is shown precisely when it becomes relevant — which is when someone exceeds it. So the 400 says
«maximum bonus for this grade is 30.00» rather than something the operator cannot act on.

### 10.2 Two places the source contradicts itself

Neither is resolved here; both are the owner's to settle.

**Who may void an intake.** §9.4's table gives the operator «своя квитанція, свій день →
приймальник, з причиною». §10.2's list puts «сторнувати квитанцію прийомки» under **ТІЛЬКИ
КЕРІВНИК**. This slice follows §9.4, on the grounds that it is the section devoted to the
question and states the case-by-case rule, while §10.2 is a summary list. If the owner meant
§10.2 literally, the change is one decorator and the operator branch disappears entirely.

**A line with no tare.** §9.1 lists it under «Заборонено — система не дає провести взагалі»;
§9.2 lists the same case under «Перепитано — дозволяємо, але вголос». This slice takes §9.1.
If §9.2 is meant, `@ArrayMinSize(1)` comes off the tare array and the case joins the warning
channel described in §10.4 — which does not exist yet, so taking the strict reading now is also
the reading that does not require machinery this slice has not built.

### 10.3 §4.5's daily price gate is not enforceable, and this slice is where that lands

> §4.5 — «04.08, 07:15, ціни ще не виставлені → замість форми прийомки стоїть пояснення і кнопка
> "Встановити ціни"». Дослівна причина клієнта: **«щоб ніхто не порахував по вчорашній»**.

The prices slice removed `business_date` from `grade_prices` (its §8.1), so a price carries over
until changed and `currentFor` will hand an intake on the 5th the price set on the 4th —
silently, and in the buyer's disfavour if the market moved. The prices spec recorded a cost; the
primary source shows the cost is the client's **stated reason for the rule existing.**

**Deliberately not fixed in this slice** (owner's decision, 2026-09-08), and recorded as
follow-up 1. The fix needs no migration: refuse a grade whose newest price row predates the
shift's `business_date`. What made it a decision rather than an oversight is the operational
dependency it creates — with the gate on, a morning where nobody sets prices is a morning the
point cannot trade, which is exactly what §4.5 describes and is a real change to how the
business must be run.

### 10.4 Three things the source requires that this slice does not build

- **§9.2's warning channel.** Four checks, all «дозволяємо, але вголос»: kg-per-crate outside
  2–14 («50,8 кг у ящику. Перевірте брутто або кількість тари.»), gross over 750 kg, pallet over
  50% of gross, and an identical line twice inside 60 seconds. The rule is that a warning «називає
  **число і причину**, а не "перевірте дані"». A 201 with no advisory field cannot carry any of
  them, and inventing one for a client that does not exist yet would be guessing at its shape.
  §9.2 itself carries «→ **Правка:** незрозуміло на кому відповідальність за валідацію».
- **§12.1's payout rounding.** «до цілої гривні, рівно 0,50 йде ВНИЗ» — 120,50 → 120, 120,80 →
  121 — with the system suggesting the rounded figure. It is filed under «Три місця, де
  відповіді ще немає» and carries «→ **Правка:** точно???», so it is unsettled at the source.
  Note it is a **different rounding from `money.ts`'s**: half-DOWN, at whole-hryvnia scale, on a
  suggested payout — not half-up at two decimals on a line amount. Both can coexist; neither is
  the other's default.
- **§07:30's two opening cash counts.** Opening a shift is «сума вводиться фактично порахована»,
  and the 03.09.2026 schema note makes it two records, one per book. Correctly deferred with
  `cash_counts`, but it means `POST /shifts` is **provisional in shape**, not only in its close
  path.

### 10.5 One earlier slice's reasoning rests on a quotation, and the source disagrees

The prices slice put `max_markup` and `max_discount` on the price row. The source's reference
table says the opposite — «жодне з цих порогових чисел у базі **не зберігається** … їх підставляє
код застосунку», and §2.9 states the limit as a single symmetric network-wide «−30 … +30 ₴/кг»
rather than two per-point numbers.

**No action, and the reason is dates.** That note is stamped 03.09.2026; the owner's decision to
put the limits on the price row, split into two independent magnitudes because they change day to
day, is 2026-09-07. The later decision stands, and this slice reads those columns exactly as the
prices slice intended. Recorded so the apparent contradiction is not re-discovered as a bug.

---

## 11. Tests

Following the existing split: co-located `*.service.spec.ts` for logic, `*.db-spec.ts` under
`migrations/` for schema facts.

**`intakes/intake-lines.spec.ts`** — the highest-value file in the slice, and the reason that module
is pure. No database:

- pallet subtracted **before** tare (§2.4); a spec that would pass under the other order fails.
- rounding **per line then summed**, with a case where `Σ round(each) ≠ round(Σ)`.
- a negative `bonus` reduces the line and does not error.
- `bonus` at exactly `+max_markup` and exactly `−max_discount` pass; one kopiyka beyond each fails.
- `price + bonus < 0` is refused even though `bonus` is within its clamp.
- `net_kg <= 0` is refused.

**`shifts.service.spec.ts`** — open derives `business_date` from `TimeService` in the app zone; a
second open at the same point is a 409; close is refused for another point's operator; reopen is 403
for an operator and 409 when another shift is open.

**`payouts.service.spec.ts`** — `amount` equal to the debt passes, one kopiyka more is a 400;
`settle-return` is refused on a payout that is not voided, and refused twice.

**`supplier-balance.service.spec.ts`** — a voided intake stops counting; a voided payout stops
counting; both filters proven independently, because that is the failure the DBML warns about.

**The four tests that exist because the primary source contradicted the design** — each named for
its rule so a future reader finds the argument rather than re-deciding it:

- an operator voiding a **colleague's** intake at their own point, in the same open shift, is a
  403 (§9.4, with §10.6's cashier swap as the scenario);
- an owner opening a shift is a 403, and the open DTO has no `collection_point_id` (§10.3);
- an item with an empty `tare` array is a 400 (§9.1);
- an over-limit `bonus` is a 400 **whose message contains the number** — asserted on the message,
  not just the status, because §10.1's fourth row is precisely about what the operator is told.

**`migrations/intakes-payouts-schema.db-spec.ts`** — schema facts, including the deliberate
**absences**, in the style of `suppliers-prices-schema.db-spec.ts`:

- the partial unique index exists and permits a second shift after close (and §8.1's unique index
  then refuses one on the same day);
- both void trios are all-or-nothing;
- `return_settled_at` cannot be set on a non-voided payout;
- deleting an intake cascades to items and tare lines (the constraint exists even though no route
  deletes);
- `intake_items` has **no** `created_at` and **no** equality `CHECK` on `amount`;
- `intake_items.bonus` accepts a negative value.

**A db-spec for the payout race** — two concurrent transactions against one supplier, proving the
second blocks and then fails. It is the only proof the `FOR UPDATE` is load-bearing, and a unit test
cannot express it.

---

## 12. Follow-ups this slice creates or unblocks

- **`collection-points.service.ts:205`** — the `TODO (when shifts lands)` is now buildable: refuse
  deactivating a point that has an open shift. **Left out of this slice as an adjacent fix**; it is a
  one-method change whenever it is wanted.
- **Warn when deactivating a supplier who carries non-zero debt** — the prices spec §5.9 parked this
  «when `intakes` and `payouts` exist». They now exist. A warning, never a refusal (правка 14,
  «заблокована кнопка вчить шукати обхід»), and note that «settle up first» is not well defined here
  because debt may legitimately be negative.
- **The close path gets revisited with `cash_counts`** — the role split, the mandatory `explanation`,
  and `awaiting_explanation` becoming reachable. Known and priced when `shifts` was scoped (§2.1).
- **The payout ceiling gets its second half** with `transfers` + `cash_counts`. The lock and the
  `supplier-balance` seam are already the right shape for it.
- **`decimal.js`** replaces the internals of `common/money.ts` when the arithmetic stops being
  provisional. One file.
- **The foundation spec's §5.2 is stale on one point** — it says `APP_TIMEZONE` «currently defaults
  to `UTC`»; it has defaulted to `Europe/Kyiv` since before this slice. Worth a one-line correction
  there so the next reader does not go «fix» a config that is already right.
- **§4.5's daily price gate** — refuse a grade whose newest price row predates the shift's
  `business_date`. No migration needed; §10.3 records what it costs operationally, which is why it
  was deferred rather than forgotten.
- **§9.2's warning channel** — an advisory field on a 201, and the four checks that would use it.
  Blocked on «на кому відповідальність за валідацію», which §9.2 itself marks unresolved.
- **§12.1's payout rounding** — whole hryvnia, 0.50 down, system-suggested. Blocked on the source's
  own «→ **Правка:** точно???».
- **Ask the owner to settle §9.4 vs §10.2** (who may void an intake) and **§9.1 vs §9.2** (whether a
  tare-less line is refused or warned). This slice picked a side of each; §10.2 records which and
  what changes if the other is meant.
- **The three earlier specs claim `26-rules-by-example.md` is not in the repository.** It is. Their
  reasoning was built on second-hand quotation and has not been re-checked; §10.5 is the one place
  already known to need it.
