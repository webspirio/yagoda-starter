# Yagoda CRM — Suppliers & Prices Slice Spec

**Date:** 2026-09-07
**Source:** `28-db-schema.dbml` (the schema of record), the decisions taken in the `/grilling`
session of 2026-09-07, `docs/superpowers/specs/2026-09-04-yagoda-foundation-slice.md`
(hereafter **the foundation spec**), and
`docs/superpowers/specs/2026-09-06-yagoda-catalog-slice.md` (**the catalog spec**). The
foundation spec's §5 data conventions bind this slice, **with one exception that §8.1 states
outright**: this slice removes `business_date` from `grade_prices`, which foundation §5.2
named as that column's primary reason to exist.

**Position in the schema:** `28-db-schema.dbml` describes 17 tables. The foundation slice
implemented two (`users` reshaped, `collection_points` new); the catalog slice implemented
three (`products`, `product_grades`, `tare_types`). This slice implements **two more** —
`suppliers` and `grade_prices` — and nothing else. After it, ten tables remain: `shifts`,
`intakes`, `intake_items`, `intake_item_tare_types`, `payouts`, `crate_issuances`,
`crate_returns`, `crate_return_allocations`, `cash_counts`, `transfers`.

**Documents we do not have:** unchanged from both earlier specs. Every `§N` points at
`26-rules-by-example.md` and every «правка N» at `26-правки-і-запитання.md`; neither file is
in this repository. Every rule cited below was read from the quotations inside the DBML's own
`Note` blocks.

---

## 1. Goal

Give the intake screen the two things it cannot be built without: **who** brought the berries
and **what they are worth**. After this slice, `intake_items` has every foreign key target it
needs (`product_grades` ✅, `tare_types` ✅) and `intakes` has `suppliers` ✅ — leaving `shifts`
as the single remaining table between the network and its first document.

## 2. Scope

**In:**

- `suppliers` — its own module. Point-scoped, operator-writable, phone normalized to E.164.
- `grade_prices` — its own module. An append-only price journal, and the home for §2.9's
  markup and discount limits, which the DBML admits it has nowhere to put.
- `supplier_kind` as a native Postgres enum (foundation §5.3).

**Out:**

- **`shifts`.** See §2.1 — it was in the original proposal and was cut deliberately.
- Every other table in `28-db-schema.dbml`.
- **Any UI.** Backend only, as in both preceding slices. See §10, which restates a cost that is
  now larger than when the catalog spec named it.
- `decimal.js` and the shared money module. This slice stores and returns `numeric` values and
  performs no arithmetic on any of them, so the dependency stays deferred exactly as the two
  earlier slices deferred it. The *representation* rule (foundation §5.1) applies in full.
- **The bulk «поставити всім» price gesture.** Deferred to its own route. See §5.5.
- **Per-point grade acceptance.** A known, named gap; see §5.4.
- `TimeService` / `APP_TIMEZONE` wiring. Removing `business_date` (§8.1) removes this slice's
  only reason to need it. It lands with `shifts`, which is the first table that genuinely has
  a business day.

### 2.1 Why `shifts` was cut

`shifts` was in the proposed slice and is not in it. The reason is not size — it is that
**its close path cannot be built correctly yet, and building it incorrectly means building it
twice.**

`shift_status` has three values: `open | awaiting_explanation | closed`. The middle one exists
solely to express a cash discrepancy, and per the `cash_counts` Note a discrepancy is
`counted − expected` where `expected_amount` comes from a five-table formula over `transfers`,
`payouts`, `crate_issuances`, `crate_returns` and `intakes`. None of those tables exist. So a
`shifts` module built today can open a shift and stamp `closed_at`, but:

- `awaiting_explanation` is **dead state** — nothing can enter it;
- §7.7 + правка 2 («при розбіжності закриває КЕРІВНИК, обовʼязково з `explanation`») is
  unreachable, so the role split on close cannot be built or tested;
- `explanation` is a column nothing can write.

`shifts` and `cash_counts` are one aggregate — the partial unique index
`UNIQUE (shift_id, book, kind) WHERE kind <> 'midday'` lives on the seam between them — and
they belong in the same slice as each other.

**What the cut costs:** the `TODO (when shifts lands)` at `collection-points.service.ts:205`
(refuse deactivating a point with an open shift) stays open one slice longer. That is the whole
bill.

## 3. Module boundaries

Two modules, two tables. Neither reads the other; the pairing in one slice is scheduling, not
coupling.

| Module | Owns | Reads |
|---|---|---|
| `suppliers` | `suppliers` | `collection_points` (existence of a body-supplied point) |
| `grade-prices` | `grade_prices` | `product_grades` (validity of the target grade), `collection_points` (existence) |

`GradePricesService` needs to reject a `product_grade_id` that is unknown or inactive, so it
imports `ProductsModule` and calls its service rather than reaching for the repository
directly — the dependency points one way, and `products` stays the sole writer of its tables.
Both modules import `CollectionPointsModule` on the same terms, to turn a body-supplied
`collection_point_id` that names nothing into a 404 instead of letting the foreign key raise a
500. `assertOwnsPoint` cannot do that job: it is a pure id comparison and a no-op for an owner.

**Corrected after review.** This table previously showed `suppliers` reading `collection_points`
"FK only" and `grade-prices` not reading it at all.

**Layout** follows the existing flat convention (`<name>.service.ts`, `<name>.controller.ts`,
`<name>.mapper.ts`, `dto/`, entity co-located), for the reason the catalog spec §3 already
recorded: the `nest-module-conventions` skill marks its directory names as conventions rather
than invariants and permits a consistent alternative, and this repo has one.

## 4. Routes

```
GET    /suppliers      ?collection_point_id= &q= &include_inactive= &page= &limit=   @Auth()
GET    /suppliers/:id                                                                @Auth()
POST   /suppliers                                                                    @Auth()
PATCH  /suppliers/:id                                                                @Auth()

GET    /grade-prices/current ?collection_point_id= &include_inactive=                 @Auth()
GET    /grade-prices         ?collection_point_id= &product_grade_id= &page= &limit=  @Auth()
POST   /grade-prices                                                                 @Auth(NetworkOwner)
```

**No `DELETE`, anywhere, ever** — foundation §5.5, quoting the DBML's own §5.6 («видалення
немає, тільки `is_active`»).

**No `PATCH` on `grade_prices`.** A correction is a new row — §4.2, «записи не перетираються, а
додаються». There is nothing on that table an update could legitimately touch.

**Two read routes on `grade_prices`, not one flagged route.** They serve different readers with
different volumes and, decisively, **different pagination profiles**:

| Route | Reader | Shape | Pagination |
|---|---|---|---|
| `/grade-prices/current` | operator's intake screen | one row per grade, latest by `created_at` | `CatalogPaginationQueryDto` (default 100) |
| `/grade-prices` | owner auditing a price move | the raw journal, newest first | `PaginationQueryDto` (default 20) |

A single route with `?current=true` would return two shapes and switch its own pagination
default on a boolean. A handler whose meaning changes with a flag is the thing that gets
misread later.

**Responses** (mappers, mirroring `toCollectionPointResponse`):

```
Supplier   { id, collection_point_id, first_name, last_name, phone, note,
             kind, is_active, created_at }
GradePrice { id, collection_point_id, product_grade_id,
             base_price, max_markup, max_discount,
             created_by_user_id, reason, created_at }
```

`base_price`, `max_markup` and `max_discount` are **strings**, never numbers (foundation §5.1).
`created_at` only and no `updated_at`, matching every existing mapper.

## 5. Domain rules

### 5.1 `grade_prices` is a journal, and the day is gone

```
id · collection_point_id → collection_points · product_grade_id → product_grades
base_price · max_markup · max_discount    numeric(10,2) NOT NULL, CHECK (… >= 0)
created_by_user_id → users · reason (text, nullable) · created_at
index (collection_point_id, product_grade_id, created_at DESC)
```

Rows are appended and never updated or deleted. **The current price for a `(point, grade)` pair
is the row with the greatest `created_at`.** A price is good until changed, not good for one
day.

**`set_at` is removed; `set_by_user_id` becomes `created_by_user_id`.** The DBML gives the table
both `set_at` and `created_at`, but with `set_at` server-assigned they hold the same instant in
every row forever, and the file's own header forbids that: «два примірники одного факту в цьому
проєкті заборонені». One timestamp, and the author column is renamed to match it.

**`business_date` is removed.** This is the slice's largest divergence and §8.1 states it in
full, including what it costs.

**No `UNIQUE` on `(collection_point_id, product_grade_id)`**, deliberately, and for the DBML's
own stated reason: a unique key on the price target is exactly what «у колишній
`shift_grade_prices` забороняв історію», and §4.2 requires history literally («записи не
перетираються, а додаються»). The mechanical consequence is that a double-submitted save
appends two identical rows. This is **harmless** — latest wins and the values match — and it is
recorded here rather than fixed, because every mechanism for preventing it (a unique key, an
idempotency token, a dedupe-on-write) is either forbidden by §4.2 or larger than the problem.

### 5.2 `max_markup` and `max_discount` — a home for §2.9

The `intake_items` Note names a hole in the schema and leaves it open:

> §2.9 — межа мережі ±30 ₴/кг обрізає `bonus`, **але самої межі в цій схемі поки НЕМАЄ де
> зберігати.**

This slice closes it, on the price row, with two decisions that go beyond what the DBML says:

**The symmetric ±30 becomes two independent numbers.** A positive `bonus` is a premium; a
negative one is «мʼята чи цвіла ягода» — bruised or moldy fruit. There is no reason a network's
tolerance for paying extra equals its tolerance for docking, and the DBML never argues that
they are one number, it merely writes them as one. Recorded as a divergence in §8.2 so a future
reader does not "fix" them back into a single `±` column.

**Both are stored as positive magnitudes.** `max_markup = 30` means `bonus <= +30`;
`max_discount = 20` means `bonus >= -20`. Storing the discount as `-20` reads naturally at the
column and inverts a comparison at the call site; one of the two forms had to be picked and
written down, and the doc comment on the column is where it is written.

**Both are `NOT NULL`.** This is not a formality — it is what keeps the `target_crates` trap
shut. If they were nullable, `null` would have to mean either "no limit" or "inherit a network
default", and the DBML warns about exactly this class of ambiguity twice, at length: «читач,
який бачить голий nullable int, відтворить заборону, якої правило не просить». Required on
create means every row states its own bounds and inherits nothing from anywhere. `0` is legal
and unambiguously means "no adjustment permitted"; "unlimited" becomes inexpressible, which is
correct — §2.9 asserts a limit exists.

**They live on the price row because they are a daily trading decision, not a standing policy**
(owner's answer, 2026-09-07: they change day to day). The alternative homes were considered and
rejected: a network-wide singleton contradicts §4.8's established fact that a `base` point runs
its own list, and a column on `product_grades` would make a per-point limit inexpressible. On
the price row, the intake screen fetches `price` and its two bounds **in one read of one row**,
with no fallback rule and therefore no "what if it is missing" case to answer.

**Nothing in this slice reads them.** The clamp lives in `intake_items`, which does not exist.
They are columns the owner fills in and no code consumes. This is correct — the price row is
their only sensible home and adding the column later would leave every existing price row
needing a backfill value nobody can supply — but it means **no test in this slice can prove
they do anything**, and §12 says so rather than pretending otherwise.

### 5.3 What replaced §4.5, and what did not

§4.5 — «сорт без ціни дня на прийомці не показується взагалі» — is what made the *absence* of a
row a disabling mechanism. With `business_date` gone, absence is now permanent rather than
daily, so the rule still holds but its meaning narrows: a grade never priced at a point is
invisible there forever, and a grade priced once is visible there forever.

Day-to-day availability therefore rests entirely on **`product_grades.is_active`**, which is
network-wide.

### 5.4 Per-point grade acceptance is a named gap, not an oversight

`product_grades` has no `collection_point_id`. So once a grade has been priced at a point,
**there is no way to stop buying it at that point alone** — no `DELETE`, no expiry, and
appending another row only changes the number. Deactivating the grade hides it at every point.

The DBML anticipated the field that fixes this and rejected it — but its reasoning is
conditional on the premise this slice removed:

> §4.5 — сорт без ціни дня на прийомці не показується взагалі, **тому ВІДСУТНІСТЬ рядка і є
> вимкненням: поля `is_enabled` немає**, довговічне вимкнення тримає `product_grades.is_active`

"There is no `is_enabled` field *because* the absence of a daily row already does that job."
Remove the daily row and the conclusion no longer follows from the premise. The gap is
therefore real and is accepted for one reason: the network currently buys the same assortment
everywhere, and the seasonal case ("raspberries are over") is network-wide anyway.

**Closable additively whenever a point wants a different list:** add
`is_accepted boolean NOT NULL DEFAULT true` to the price row, and let the latest row for
`(point, grade)` decide both the price and whether it is bought there. One column, one filter,
no data migration, append-only preserved, nothing rewritten. Written down here so the next
reader knows this was decided rather than missed.

### 5.5 The bulk gesture is deferred, and the carve-out is written down

§4.8 states that a «поставити всім» gesture exists and that it must skip the склад:

> §4.8 — склад це звичайний пункт прийому зі своєю, вищою ціною, **якого жест «поставити всім»
> НЕ чіпає**

`POST /grade-prices` in this slice writes **one row**. The bulk gesture gets its own route when
something asks for it (owner's decision, 2026-09-07).

The rule is recorded here, and in the controller's doc comment, because it is the part that
gets lost: **the carve-out belongs on the server.** A bulk route that takes an explicit array
of point ids pushes §4.8 into the client, where no test can reach it and the second caller
re-derives it or forgets. The shape to build is a target expressed as *intent* —
`{ kind: 'all_reception_points' }` expanded server-side to active points with
`kind = 'reception'` — so that one db-spec proves the склад is excluded.

### 5.6 `suppliers` — operators write

```
id · collection_point_id → collection_points · first_name · last_name
phone (nullable, E.164) · note · kind (supplier_kind, default 'none') · is_active
created_at · updated_at
UNIQUE (collection_point_id, phone)
index (collection_point_id, last_name)
CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{7,14}$')
```

**This is the first module in the project whose writes are not owner-only.** Every write built
so far — users, points, products, grades, tare types, and `grade_prices` above — is
`@Auth(UserRole.NetworkOwner)`. `suppliers` breaks that pattern because the alternative blocks
the business: a car arrives at a roadside point with 40 kg of raspberries and a person the
operator has never seen, and under owner-only writes the delivery cannot be taken until someone
elsewhere creates the record. §3.9 nails the supplier to the point precisely because this is a
point-level, in-the-moment act.

An operator creates, edits and deactivates suppliers **at their own point**; the owner may act
anywhere. `kind` does not justify a split rule: §2.11 is explicit that «базова ціна від маркера
не залежить ніколи», so `wholesale` is a reporting marker with no effect on money and there is
nothing for a stricter role to protect.

**This is the first module to derive the point from the actor for SOME of its writes rather
than always taking it from the body.** When the actor is an operator, `point-scope.ts` applies
as written — the point comes from their token, and a body value naming a different point is
refused. An owner has no point of their own, so the DTO still accepts `collection_point_id` for
that case and validates it with `assertOwnsPoint` (a no-op for an owner, since they own every
point). `grade_prices` is owner-only end to end (§7), so it always takes the point from the
body — there is no actor point to derive it from.

**Accepted cost, recorded rather than guarded:** an operator can rename a supplier, and debt
follows `supplier_id`, not the name. Editing «Іван Коваль» into «Петро Мельник» silently
reassigns a real money balance to a different human, there is no delete, and §5.5 (duplicate
merging) was cancelled by правка 6 — **there is no merge tool and there will not be one**. The
audit `before`/`after` diff is the only trail. A guard was considered and rejected: every
version of it also blocks the common case, which is fixing a typo in a name typed at 06:40.

### 5.7 `phone` is normalized, and the constraint is only meaningful because of it

`UNIQUE (collection_point_id, phone)` on raw text is worth nothing, and the DBML supplies the
proof itself. The same Note that defines this table kills the `villages` table with this
evidence:

> у робочій книзі клієнта одне село написане чотирма способами: «копайгород» 571 рядок,
> «Копайгород» 175, «Копайгород » з пробілом 45, «Копай»

Applied to a phone number typed on a keypad at 06:40:

```
0671234567     +380671234567     380671234567
067 123 45 67  (067) 123-45-67   067-123-45-67
```

Six strings, one human, and a plain `UNIQUE` accepts all six — six supplier rows, six
independent `Σ intakes − Σ payouts` balances for one person, permanently, because §5.4 and §5.5
(duplicate detection and merging) were cancelled by правки 5 and 6. It also defeats правка 5,
which is the entire reason the constraint exists: search by phone would not match across
formats.

**Decision: normalize on write, store canonical only, and let a `CHECK` make the database the
guarantee.**

- The service accepts `0XXXXXXXXX`, `380…` and `+380…`, with any spaces, dashes or parentheses,
  and canonicalises to **E.164** (`+380671234567`). Anything it cannot parse is a **400 naming
  the accepted forms** — never a silent pass-through.
- `CHECK (phone IS NULL OR phone ~ '^\+[1-9]\d{7,14}$')` — the E.164 *shape*, not `+380`
  specifically, so a foreign supplier is possible without a migration while the service's
  *expansion* rule stays Ukrainian.
- `UNIQUE (collection_point_id, phone)` on the raw column — exactly what the DBML specifies, no
  divergence, and now meaningful.

**This deliberately diverges from the catalog slice's "store exactly as typed, compare
case-insensitively" pattern**, and the reason is that phones are not names. «Копайгород» →
«копайгород» is data loss; `067 123 45 67` → `+380671234567` is not. A name's capitalization is
content; a phone's dashes are presentation, and a phone number has a canonical form. The
catalog pattern's principle — **the index is the real guarantee, the service pre-check only
produces the friendly error** — is preserved exactly: the `CHECK` rejects a non-canonical value
even if a future code path forgets to normalize.

**`libphonenumber-js` is not added.** One country with one expansion rule is a short function
with a table-driven spec, and this repo's stated posture is to add a dependency when something
real needs it (`decimal.js` is deferred on the same reasoning). Named here as the upgrade path
if a second country ever appears.

**The "no phone" escape hatch needs no special machinery.** Postgres unique indexes treat
`NULL`s as distinct by default (`NULLS DISTINCT`), so any number of phone-less suppliers
coexist at one point under the plain `UNIQUE`. правка 8's «без номеру телефону» checkbox is
pure UI — the server sees `phone: null` and, per the Note, «окремого поля під цей факт немає
навмисно», so the server cannot and must not distinguish "checkbox ticked" from "field
omitted".

**Consequence, accepted:** a family sharing one phone — mother and son both delivering —
cannot both hold it; the second must be entered with no phone. That is правка 5's trade-off,
already decided when it chose phone-search over free text. The operator has to know the escape
hatch exists, or they will invent something worse.

### 5.8 What is immutable after create

**`suppliers.collection_point_id` is immutable and absent from the update DTO.** The argument
is stronger than the one that froze `product_grades.product_id`. §3.9:

> запис прибитий до ТОЧКИ: людина, яка возить на дві точки, заводиться на кожній окремо, і
> **борг з однієї не гаситься на іншій**

Debt is filtered by `supplier_id` alone — the Note states the point filter is «не треба й не
можна», because `supplier_id` already means the point. So re-pointing a supplier row silently
moves a money balance from one point's books to another's, with no document changing and no
trail explaining it. Re-parenting a grade rewrote a report; re-parenting a supplier rewrites a
debt. A supplier entered at the wrong point is deactivated and recreated, not moved.

**Every column of `grade_prices` is immutable**, because the table has no update path at all
(§4).

### 5.9 Deactivation is never blocked in this slice

No analogue of `assertNoActiveUsers`. One `TODO` goes in, in the style of the existing
"TODO (when `shifts` lands)" in `CollectionPointsService`:

- when `intakes` and `payouts` exist — decide whether deactivating a supplier carrying non-zero
  debt deserves a **warning**.

A warning at most, never a refusal, per the schema's repeated stance that a management decision
gets a warning and not a locked button (§6.1, правка 14, «заблокована кнопка вчить шукати
обхід»). And "settle up first" is not even a well-defined precondition here: the `suppliers`
Note establishes that debt can legitimately be **negative** after a voided receipt, and that
«інваріанта `борг >= 0` в цій схемі теж немає».

**Deactivating a collection point remains unblocked by suppliers.**
`CollectionPointsService` refuses on active *users* only, and its pending TODO is about open
shifts. Suppliers are data at a point, not people who work there.

**No point-usability check on supplier create or reactivate.** The foreign key guarantees the
point exists, and that is the whole check (owner's decision, 2026-09-07: closing the related
`assertPointUsable` gap in `user-admin` is out of this slice's scope and stays on the UI
slice's list).

## 6. Data conventions applied

### 6.1 Money — representation only

`base_price`, `max_markup` and `max_discount` are `numeric(10,2)`, `string` end to end, carried
in DTOs as `@Matches(/^\d{1,8}(\.\d{1,2})?$/)` — the same shape `target_cash` and
`tare_types.weight_kg` already use. `CHECK (… >= 0)` on all three, mirroring the CHECKs on
`collection_points` and `tare_types`. No arithmetic is performed on any of them in this slice,
so `decimal.js` stays deferred (foundation §5.1, catalog §2).

### 6.2 Enums

`supplier_kind` (`none | wholesale | farmer`) is created as a **native Postgres enum type**,
per foundation §5.3 and consistent with `user_role`, `point_kind` and `media_purpose`. It is a
closed domain of three values the DBML argues for explicitly.

### 6.3 Names

`@Length(1, 128)` on `first_name` and `last_name`, trimmed before save, all-whitespace rejected
as a 400 — via the existing `assertTrimmedName` (`common/trimmed-name.ts`).

**No uniqueness on supplier names, case-insensitive or otherwise.** Two different people
legitimately share a name, and the catalog slice's `lower(name)` indexes exist for *catalog*
rows, which are concepts rather than people. Phone is the only unique key on this table.

`note` is free text, `@MaxLength(1000)` as a DoS guard rather than a domain rule.

### 6.4 Ordering and pagination

| List | Order | Pagination |
|---|---|---|
| `/suppliers` | `last_name, first_name, id ASC` | `PaginationQueryDto` (default 20) |
| `/grade-prices/current` | `collection_point_id, product_grade_id` | `CatalogPaginationQueryDto` (default 100) |
| `/grade-prices` | `created_at DESC, id DESC` | `PaginationQueryDto` (default 20) |

The `/current` order is on the PAIR, matching the `DISTINCT ON` key — ordering on the grade
alone would not be a total order once an owner spans several points. Every list here carries an
`id` tiebreaker for the same reason `ProductGradesService` does: Postgres promises no order
among tied rows, and `skip`/`take` over a tie can repeat a row on one page and drop it from the
next. On `suppliers` that tie is ordinary (§6.3 refuses name uniqueness) and on `grade_prices`
it arrives with §4.8's bulk gesture, whose rows will share one `created_at` exactly —
`now()` is transaction start time.

**`/suppliers` uses the 20-default deliberately**, and it is worth stating because the previous
three modules all used the catalog DTO. Suppliers is unbounded and grows forever — a busy point
accumulates hundreds and there is no delete — so it is a browsable list, not a dropdown. The
`CatalogPaginationQueryDto` doc comment says its 100-default is for bounded reference tables.

`/grade-prices/current` is bounded by the grade count and *is* a picker, so it takes the
catalog default. **Named limit:** an owner calling it with no point filter gets
`points × grades` rows — 5 points × 30 grades is 150, above the `@Max(100)` ceiling for ONE
PAGE. That screen therefore pages, or narrows to one point; it is not forced to the latter, and
the pair test in `pipeline.db-spec.ts` pages through this route network-wide. `total` in the
`Paginated<T>` envelope makes a client that ignores paging visible rather than silent, which is
the convention the catalog spec established.

**Corrected after review.** This paragraph previously said the owner's screen *must* fetch one
point at a time. It must not — that read the `@Max(100)` per-page ceiling as a total.

### 6.5 Filters and search

- `/suppliers`: `?collection_point_id=`, `?include_inactive=` (the shared
  `@BooleanQueryParam()`), and `?q=`.
- `/grade-prices/current`: `?collection_point_id=`, `?include_inactive=` (so the owner's price
  screen still shows the last price of a grade retired mid-season).
- `/grade-prices`: `?collection_point_id=`, `?product_grade_id=`. No `include_inactive` — the
  journal is history and history is not filtered by the target's current state.

**`?q=` is one box, sniffed into two lanes.** правка 5 is why phone uniqueness exists at all,
and the DBML also indexes `last_name`, so both lanes are wanted; one box matches the physical
situation, where a person is standing there and the operator types whatever they know.

- **Phone lane** — the trimmed value contains only digits, `+`, spaces, dashes or parentheses.
  Strip to digits; a full number normalizes to E.164 and matches exactly, a **partial** number
  does a suffix match (`phone LIKE '%' || digits`). The suffix match is not an optimization
  detail — «останні чотири цифри?» is how this is asked out loud, and an exact-only search
  would be useless for it.
- **Name lane** — case-insensitive substring across **both** `first_name` and `last_name`.
  People mistype which field is which, and «Коваль» must find «Іван Коваль» either way.

**The performance cost is stated, not buried.** A suffix `LIKE` and a substring `ILIKE` both
ignore the btree index; these are sequential scans within one point. That is fine at hundreds
of suppliers per point and stops being fine somewhere in the low tens of thousands, at which
point the answer is a `pg_trgm` GIN index — additive, no schema rewrite. The threshold goes in
the service's doc comment so whoever hits it does not have to rediscover why.

## 7. Authorization

| Operation | Rule |
|---|---|
| `GET /suppliers`, `GET /suppliers/:id` | `@Auth()`; `resolvePointFilter` / `assertOwnsPoint` |
| `POST`/`PATCH /suppliers` | `@Auth()`; point derived from actor, `assertOwnsPoint` |
| `GET /grade-prices*` | `@Auth()`; `resolvePointFilter` |
| `POST /grade-prices` | `@Auth(UserRole.NetworkOwner)`; `assertOwnsPoint` on the body's point |

**`resolvePointFilter(actor, requested)` gets its first production caller with two arguments.**
The foundation follow-ups record that `requested` currently has none — «both list endpoints
call it with one argument» — so "ignored for an operator" is only unit-proven. Three list
endpoints here pass it, closing that gap.

**Documented exception on `POST /grade-prices`.** `point-scope.ts` states the rule in capitals:

> THE RULE: the point is DERIVED from the actor (or from the shift a document references),
> **never accepted from a request body.**

Price writes are owner-only and the owner has no point, so `collection_point_id` **must** come
from the body, validated by `assertOwnsPoint` (which already permits an owner to act on any
point). This is the first caller to take that branch. It needs a doc comment saying so, or the
next reader will file it as a violation of the rule rather than the case the rule's parenthesis
did not cover.

**An operator can read `max_markup` and `max_discount`.** That is intended — they are the
bounds the operator must respect when entering a `bonus`, and until `intake_items` enforces
them server-side the operator's screen is the only thing that can.

## 8. Divergences

Recorded in the same spirit as the two earlier specs.

### 8.1 `business_date` is removed from `grade_prices` — and this overrides foundation §5.2

The DBML keys the price on the trio (day, point, grade) — §2.8 — and foundation §5.2 names
`business_date` as «the join key for the daily price». **This slice removes it.** Prices carry
over until changed; the current price is simply the newest row for the `(point, grade)` pair
(owner's decision, 2026-09-07: «creating a new price won't be a frequent operation»).

**What it buys:** the day is derivable from `created_at`, so keeping both would be two copies of
one fact. The historical question is still answerable — "the price at point X on 15 July" is the
last row with `created_at <=` end of that day — and now answerable at any *instant*, not only
per day. The owner is not forced to retype every price at every point before 07:00 each morning,
and there is no daily cliff where a forgotten point leaves an operator facing an empty screen
with suppliers queueing.

**What it costs, stated plainly:**

- **§4.5 stops being a daily mechanism.** "We are not buying 2 сорт today" no longer has a
  per-day expression; it is now `product_grades.is_active`, which is network-wide (§5.3, §5.4).
- **A stale price fails silently and in the buyer's disfavour.** Nothing expires, so a price
  set in July is still live in September unless someone changes it. Under the daily scheme the
  absence of a row was loud (the grade vanished from the intake screen); now it is invisible.
- **A price takes effect the instant it is written, and cannot be staged.** This is the twin of
  the stale-price cost above and of equal size, and it was missing from the first draft of this
  list. There is no future-dating and no batch atomicity, so an owner cannot prepare tomorrow's
  numbers the night before, and re-pricing 30 grades at a point is 30 separate `POST`s that an
  operator's intake screen can observe HALF-APPLIED mid-shift. It bites hardest on exactly the
  two columns §5.2 justifies as *daily trading decisions* that «change day to day»:
  `max_markup` and `max_discount`. The daily scheme's `business_date` gave staging for free.
  Carry this into §4.8's bulk route when it is built — that route must be ONE transaction, which
  is also what makes the `id` tiebreaker on the journal (§6.4) load-bearing rather than
  defensive.
- **Foundation §5.2's `business_date` paragraph no longer describes this table.** It remains
  correct and binding for `shifts`, `intakes`, `payouts` and the cash book, which is where it
  actually matters. The sentence naming the daily price as its primary consumer is superseded
  by this section.
- The consequential removal of `set_at` (§5.1) follows from the same "no second copy" argument
  and is not separately contested.

### 8.2 §2.9's symmetric limit becomes two asymmetric columns

The DBML writes «межа мережі ±30 ₴/кг» — one number, applied both ways, and calls it the
**network's** limit. This slice stores two independent numbers, per point and per grade, on the
price row. §5.2 gives the reasoning. Recorded here so the columns are not merged back into a
single `±` value by a reader who finds the DBML phrasing and not this paragraph.

### 8.3 `GET /suppliers/:id` returns 404, not 403, across points

`GET /collection-points/:id` distinguishes them, and the foundation follow-ups flag that as a
weak existence oracle «worth remembering before this shape is copied onto a guessable id».
**This is the copy.** Suppliers are a list of real people's names and phone numbers, so a
cross-point request returns 404 rather than confirming the row exists. A deliberate divergence
from the points module, stated here so it does not read as an accidental inconsistency — and a
small argument for aligning `collection-points` the same way when that file is next touched.

### 8.4 Phone storage diverges from the catalog slice's naming pattern

Covered in §5.7: canonical-only storage rather than "store as typed, compare normalized". The
principle the catalog pattern exists to protect — the database is the guarantee, the service
pre-check only produces the friendly error — is preserved by the `CHECK`.

## 9. Audit

**`suppliers` is audited. `grade_prices` is not.** The asymmetry is the point, and it follows
the catalog spec's own reasoning rather than contradicting it.

The catalog spec's argument for auditing `tare_types` is explicitly conditional:

> `tare_types` **keeps no history of its own**, and because §2.7 snapshots its values
> downstream, *nothing* in the database records that a crate deposit went 120 → 130 or when.
> **The audit log is the only place that fact can live.**

For `suppliers` the condition holds — no history of its own, and now two classes of writer. Two
new entries in `AUDIT_ACTIONS`: `supplier.created`, `supplier.updated`, with
`target_type: 'supplier'`. Each write wrapped in `dataSource.transaction()` with the
`EntityManager` passed to `audit.record()`, matching the three catalog services.

For `grade_prices` the condition fails: **the table is the history.** An `audit_log` row would
carry the actor (already `created_by_user_id`), the timestamp (already `created_at`), the reason
(already `reason`) and a before/after diff reconstructible from two adjacent journal rows —
four duplicated facts in a schema whose header declares «два примірники одного факту в цьому
проєкті заборонені». No `price.*` action is added to `AUDIT_ACTIONS`, and `GradePricesService` carries the doc
comment saying why the absence is deliberate, in the same voice as `products`' missing
`is_active`. (The entity's own three-absences comment covers the missing `updated_at`, `UNIQUE`
and update path; the audit argument is on the service, where the writes are.)

**The named cost:** `audit_log` is the single cross-cutting "what did this person change last
Tuesday" view, and prices are now a hole in it. Cheap to close later with an audit *reader* that
unions the journal — additive, whereas duplicated rows written today can never be un-written.

**`POST /grade-prices` therefore needs no transaction at all** — one `insert`, no second write
to keep atomic. The transactional-audit shape does not apply.

**No `reason` field on the supplier DTOs.** `grade_prices.reason` exists because §4.2 shows a
worked example carrying one («конкуренти підняли»). Nothing asks for one on a supplier; it is
additive later.

## 10. Frontend

**None.** Backend only, as in both preceding slices.

The catalog spec ended by arguing that the owner admin UI should come next, over the five
screens then unreachable from a browser. That was overruled, twice, and this slice makes it
**seven** unreachable backends: users, collection points, products, product grades, tare types,
suppliers, grade prices.

The argument is not weaker for having been declined; it is stronger, and it is restated here
without re-litigating the decision. A seven-screen UI designed all at once makes shape
decisions that should have been made module by module, none of them grilled. The bill grows
with each slice, and it is a real bill: `suppliers` in particular has a form (правка 8's «без
номеру телефону» checkbox, §5.7) and a search box (§6.5) whose behaviour was specified here
against no screen at all.

## 11. Follow-ups this slice does not close

Nothing from `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` is closed here.
Carried forward unchanged, with reasons:

- **The active-owner race, non-atomic `setLogin()`, and the reactivation gap.** Still the first
  task of the UI slice. Explicitly ruled out of this slice's scope (owner's decision,
  2026-09-07).
- **`CollectionPointsService` records audit entries outside a transaction.** Still a
  four-modules-to-one minority shape; `suppliers` makes it five to one. Align when that file is
  touched.
- **Naming the four inherited constraints** so `migration:generate` stops proposing destructive
  churn. This slice's migration is hand-written SQL, as its two predecessors were, so the tool
  is not on its critical path.
- **`APP_TIMEZONE` / `TimeService` wiring.** Removing `business_date` (§8.1) removes this
  slice's WRITE-side need for it entirely. Not the read side: the historical query §8.1
  advertises in the same breath — «the last row with `created_at <=` end of that day» — still
  needs a timezone to define where that day ends. Nothing in this slice issues that query, so
  nothing here is wrong today. It lands with `shifts`.
- **`assertNameFree`-style check-then-act.** The friendly-409 pre-check on
  `(collection_point_id, phone)` is the same shape: two concurrent creates can both pass it and
  the loser gets a 500 rather than a 409. The unique index is the real guarantee. Recorded for
  consistency with the four existing instances, not as a new defect.

New, filed by this slice:

- **Per-point grade acceptance** (§5.4) — the `is_accepted` column, when a point wants a
  different assortment.
- **The bulk «поставити всім» route** (§5.5) — with the §4.8 склад carve-out server-side.
- **`max_markup` / `max_discount` are unread** (§5.2) — the clamp lands with `intake_items`,
  and `intakes` must be the thing that proves them.
- **`pg_trgm` on supplier search** (§6.5) — at low tens of thousands of suppliers per point.

## 12. Testing

Test-driven, both suites, per the project's stated workflow.

**`*.spec.ts`** (`npm test`, mocked repositories, mirroring `collection-points.service.spec.ts`)
— one per service, covering:

- **Phone canonicalisation as a table-driven spec of its own.** Every accepted input form maps
  to the expected E.164 output; every rejected form is a 400. This is the single highest-value
  unit test in the slice, because §5.7's whole argument collapses if the function is wrong.
- `?q=` lane sniffing: which inputs take the phone lane, which take the name lane, and that a
  partial number produces a suffix match rather than an exact one.
- trim-and-reject-blank on both name fields; the friendly 409 pre-check on phone;
  absent-versus-null on `PATCH`; `collection_point_id` absent from the supplier update path;
  the audit calls and their diffs; `include_inactive` defaulting.
- `grade_prices`: rejection of an unknown or **inactive** `product_grade_id` (rejected, never
  silently skipped — a dropped grade that looks like success is the failure mode worth a test);
  that `POST` never updates an existing row; that `/current` returns the newest row per grade.

**`*.db-spec.ts`** (`npm run test:db`, real Postgres, migrations applied) — everything that
exists **only** in hand-written SQL and is invisible to a mocked repository:

- `UNIQUE (collection_point_id, phone)` rejects a duplicate at the same point and **permits the
  same number at a different point** (§3.9 — the same person at two points is two rows).
- **Multiple `NULL` phones coexist at one point.** This is правка 8's escape hatch, it depends
  entirely on Postgres' `NULLS DISTINCT` default, and a unit test cannot reach it.
- `CHECK (phone ~ …)` rejects `'067123'`, `'not-a-phone'` and `'+3806712345678901'`.
- `CHECK (base_price >= 0)`, `CHECK (max_markup >= 0)`, `CHECK (max_discount >= 0)` each reject
  `-1`.
- The `supplier_kind` enum type rejects an unknown value.
- The `grade_prices → product_grades` and `suppliers → collection_points` foreign keys reject
  orphans.
- **No unique constraint exists on `(collection_point_id, product_grade_id)`** — two rows for
  the same pair insert successfully. This is an *inverted* assertion, proving the absence §5.1
  argues for; without it, a future `migration:generate` run that helpfully adds the constraint
  would silently destroy §4.2's history.
- `numeric` round-trips as `string` for all three price columns.

**HTTP level**, extending the `pipeline.db-spec.ts` pattern — mint tokens with the app's own
`JwtService` rather than adding `/auth/login` calls, per that file's throttle note:

- The **operator** creates a supplier at their own point, lists it, finds it by partial phone
  and by name fragment, and gets **403 creating one at another point**.
- The operator gets **403 on `POST /grade-prices`** — the one assertion proving §7's split
  reached the decorators.
- The **owner** creates a price at any point and reads both price routes.
- `GET /suppliers/:id` for another point's supplier returns **404, not 403** (§8.3).

**Gaps accepted and recorded rather than closed:**

- **`max_markup` and `max_discount` are provably stored and provably non-negative, and nothing
  more.** No test can show they constrain anything, because the code that clamps `bonus` does
  not exist. §5.2 names this; the `intakes` slice owes the test.
- **The `pg_trgm` threshold** (§6.5) is a judgement, not a measurement. No benchmark is run.

## 13. Migration

One hand-written migration, `1788600000006-YagodaSuppliersAndPrices.ts`:

- `CREATE TYPE supplier_kind AS ENUM ('none', 'wholesale', 'farmer')`.
- `CREATE TABLE suppliers` with the columns, the E.164 `CHECK`, the
  `UNIQUE (collection_point_id, phone)`, the `(collection_point_id, last_name)` index and the
  foreign key.
- `CREATE TABLE grade_prices` with the columns, three `>= 0` CHECKs, the three foreign keys and
  the `(collection_point_id, product_grade_id, created_at DESC)` index.
- **No unique constraint on `(collection_point_id, product_grade_id)`** — §5.1, with a SQL
  comment in the migration saying why, because its absence is the kind of thing a later reader
  "fixes".

`down()` drops both tables and the enum type. It will fail once any `intakes` row references a
supplier — the safe direction, and the same posture `BootstrapOwner.down()` already takes.

**Entity metadata declares everything TypeORM can express faithfully, with explicit names.**
Unlike the catalog slice's `lower(name)` indexes — which are invisible to TypeORM and therefore
live only in SQL — every constraint in this slice is expressible: `@Unique('UQ_suppliers_point_phone',
['collection_point_id', 'phone'])`, `@Check('CHK_suppliers_phone_e164', ...)`, the three
`@Check`s on `grade_prices`, and `@Index` on both lookup indexes. `tare_types` already carries
`@Check` decorators for exactly this reason. Naming each one explicitly is what keeps
`migration:generate` from proposing to create them a second time under a generated name — the
churn the foundation follow-ups record for the four inherited constraints that have no names.
