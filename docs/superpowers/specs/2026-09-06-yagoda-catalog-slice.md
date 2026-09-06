# Yagoda CRM — Catalog Slice Spec

**Date:** 2026-09-06
**Source:** `28-db-schema.dbml` (the schema of record), the decisions taken in the `/grilling`
session of 2026-09-06, and `docs/superpowers/specs/2026-09-04-yagoda-foundation-slice.md`
(hereafter **the foundation spec**), whose §5 data conventions bind this slice unchanged.
Where this document and the DBML disagree, §8 below says so explicitly.

**Position in the schema:** `28-db-schema.dbml` describes 17 tables. The foundation slice
implemented two (`users` reshaped, `collection_points` new). This slice implements **three
more** — `products`, `product_grades`, `tare_types` — and nothing else. After it, twelve
tables remain: `suppliers`, `shifts`, `grade_prices`, `intakes`, `intake_items`,
`intake_item_tare_types`, `payouts`, `crate_issuances`, `crate_returns`,
`crate_return_allocations`, `cash_counts`, `transfers`.

**Documents we do not have:** unchanged from the foundation spec. Every `§N` points at
`26-rules-by-example.md` and every «правка N» at `26-правки-і-запитання.md`; neither file is in
this repository. Every rule cited below was read from the quotations inside the DBML's own
`Note` blocks.

---

## 1. Goal

Give the network its catalogs: what is bought (product → grade) and what it is carried in
(tare type). These three tables are the last purely-declarative data in the schema and the
direct dependency wall in front of everything that follows — `grade_prices` cannot price a
grade that does not exist, and `intake_items` cannot subtract a tare weight from a tare type
that does not exist.

## 2. Scope

**In:**

- `products` and `product_grades` — one module, one aggregate, two entities.
- `tare_types` — its own module.
- Case-insensitive uniqueness on every catalog name, **including a retrofit of
  `collection_points.name`**.
- Two deferred follow-ups closed before this slice copies their shape three more times: the
  `include_inactive` boolean-parsing bug, and the hand-rolled field diffing.

**Out:**

- Every other table in `28-db-schema.dbml`.
- **Any UI.** Backend only, as in the foundation slice. See §10.
- `decimal.js` and the shared money module. This slice stores and returns `numeric` values and
  performs no arithmetic on any of them, so the dependency stays deferred exactly as the
  foundation spec deferred it. The *representation* rule (foundation §5.1) applies in full.
- `display_order`. Removed from both tables — see §8.1.
- `suppliers`. It looks like a peer of these three and is not: it is scoped to a point (§3.9 —
  the same person delivering to two points is two rows and debt does not cross between them),
  its `phone` uniqueness is per-point with a deliberate "no phone" escape hatch, and its entire
  reason to exist is to be one half of `Σ intakes − Σ payouts`. A supplier row with no
  `intakes` module is a row nobody can act on. It is the natural next *backend* slice, sitting
  directly in front of `intakes`.

---

## 3. Module boundaries

Two modules, three tables.

| Module | Owns | Why |
|---|---|---|
| `products` | `products`, `product_grades` | One aggregate. A grade is meaningless without its product, and §4.1's visibility rule spans both tables — it can only be evaluated by something that can see both. |
| `tare-types` | `tare_types` | Unrelated data. Its only links in the schema are to `intake_item_tare_types` and the `is_crate` flag; neither touches products. |

Rejected: three modules (splits an aggregate — a `product_grades` module would read `products`
on every create and §4.1 would live across a boundary neither side owns); one `catalog` module
for all three (puts `tare_types` under a boundary it has no relationship to, leaving the module
with no single responsibility to name).

**Layout** follows the existing flat convention (`<name>.service.ts`, `<name>.controller.ts`,
`<name>.mapper.ts`, `dto/`, entity co-located), not the `commands/` + `queries/` layout in the
`nest-module-conventions` skill. That skill marks its directory names as conventions rather
than invariants and permits a consistent alternative; this repo has one, and introducing a
second style mid-project costs more than it buys. Every architectural invariant in the skill
still holds: each module is the sole writer of its own tables, dependencies point one way, and
controllers stay thin.

## 4. Routes

Flat, not nested. `grade_prices.product_grade_id` and `intake_items.product_grade_id` both
point straight at a grade and never mention its product — the grade id is globally
self-sufficient everywhere the rest of the schema uses it, so an API that demanded a parent id
it never needs would be a shape unique to this one module.

```
GET    /products                                        @Auth()
POST   /products                                        @Auth(NetworkOwner)
PATCH  /products/:id                                    @Auth(NetworkOwner)

GET    /product-grades ?product_id= &include_inactive=   @Auth()
POST   /product-grades                                  @Auth(NetworkOwner)
PATCH  /product-grades/:id                              @Auth(NetworkOwner)

GET    /tare-types ?include_inactive=                   @Auth()
POST   /tare-types                                      @Auth(NetworkOwner)
PATCH  /tare-types/:id                                  @Auth(NetworkOwner)
```

**No `DELETE`, anywhere, ever** — foundation §5.5, which states it for the whole API and quotes
the DBML's own §5.6 («видалення немає, тільки `is_active`»). Deactivation is the only removal
verb this domain has, and for `products` there is not even that; see §5.1.

**No `GET /:id`, on any table.** Every list returns the complete catalog in one request (§6.4),
so no client needs a single-row read: the owner UI holds the object before it opens an edit
form, and the intake screen holds the whole picker. `/collection-points/:id` exists because
points are point-scoped and that read has a real caller. Additionally, the foundation
follow-ups note that `GET /collection-points/:id` distinguishing 404 from 403 is a weak
existence oracle — a shape whose only recorded note is a caveat is not one to repeat. Trivially
additive if a caller ever appears.

**Responses** (mappers, mirroring `toCollectionPointResponse`):

```
Product      { id, name, created_at }
ProductGrade { id, product_id, name, is_active, created_at }
TareType     { id, name, weight_kg, deposit_price, is_crate, is_active, created_at }
```

`weight_kg` and `deposit_price` are **strings**, never numbers (foundation §5.1). `created_at`
only and no `updated_at`, matching `toCollectionPointResponse`; "when did this change" is the
audit log's question. `product_id` appears on the grade response — the client builds its tree
from it — but never in the update DTO (§5.3).

## 5. Domain rules

### 5.1 `products` has no `is_active`, and that is load-bearing

The foundation spec already recorded this decision, under §5.5, as a "related rough edge, left
alone" — including the consequence named below. This section is where it becomes load-bearing
rather than hypothetical, and it does not re-open it.

The DBML is emphatic and gives its reason: «видимість товару ВИВОДИТЬСЯ, а не зберігається».
§4.1 states the mechanism literally — «Товар без жодного АКТИВНОГО сорту приймальнику не
показується» — and the worked example is Кизил, which has no grades at all and is therefore
invisible without anything being switched off.

Consequences, all deliberate:

- No `is_active` column on `products`, no flag in any DTO, no `include_inactive` filter on
  `/products`.
- A product is retired by deactivating its grades. Deactivating the *last* active grade is
  therefore **never blocked** — that is the retirement mechanism, not an error state.
- A product with no active grade still exists forever, because `intake_items` will read it back
  from a five-year-old receipt.
- **Accepted cost, already named in foundation §5.5:** a mistyped product is invisible to
  operators but clutters the owner's own list permanently. Smuggling `is_active` back in to fix
  that would contradict a decision the DBML argues for at length.

**Nothing derived is exposed.** No `active_grade_count`, no `has_active_grades`. §4.1 is a rule
about what the operator's *intake screen* renders, and that screen is gated by §4.5 anyway —
«сорт без ціни дня на прийомці не показується взагалі» — so its real enforcement point is
`grade_prices`, a module that does not exist. A derived field here would be a second
representation of a rule enforced elsewhere, in a schema built end to end on refusing two copies
of one fact. Until the intake module lands, "Кизил leads nowhere" is a client-side join across
the two lists. Adding a count later breaks nothing.

### 5.2 `tare_types`

Both numbers are owner-editable and both are **snapshotted downstream** — `intake_items
.tare_weight_kg` and `crate_issuances.deposit_per_unit`, per §2.7. That is what lets this
module edit money while owning no money logic: raising a crate from 120 to 130 cannot move a
July issuance.

- `weight_kg` and `deposit_price` are **both required on create**. The DBML gives neither a
  default, and a tare type that does not say what it weighs is unusable by §2.5's automatic
  subtraction.
- Carried as strings: `@Matches(/^\d{1,8}(\.\d{1,2})?$/)` for `weight_kg` (`numeric(10,2)` — 8
  integer digits) and `/^\d{1,10}(\.\d{1,2})?$/` for `deposit_price` (`numeric(12,2)`), the
  same shape already used for `target_cash`.
- `CHECK (weight_kg >= 0)` and `CHECK (deposit_price >= 0)`, mirroring the two CHECKs on
  `collection_points`. Zero is permitted, negative is not: a negative `weight_kg` would *add*
  weight in §2.4's `net = (gross − pallet) − tare`, while a genuine zero-weight row (a
  supplier's own bucket) and a zero-deposit non-crate tare are both plausible entries.

**No cross-field constraint between `is_crate` and `deposit_price`.** The tempting rule is
`is_crate = false ⇒ deposit_price = 0`, since §6.3's завдаток is a crate concept. It is
deliberately absent: no rule states it, `is_crate` is documented only as "which tare counts as a
ящик for targets and deposits", and a CHECK encoding an unstated rule is the exact trap the DBML
warns about repeatedly — «читач, який бачить голий nullable int, відтворить заборону, якої
правило не просить». A nonsense row here is inert; a wrong constraint blocks a real one later.

**Not resolved here:** ЗАПИТАННЯ 12 — whether «Ящик» and «Чешка» are one unit for counting —
remains open in the schema, and its answer would split `target_crates` by tare type. It does not
block this module: `tare_types` only holds rows, and the counting question lives in
`crate_issuances` and the target, neither of which exists.

### 5.3 What is immutable after create

**`product_grades.product_id` is immutable and absent from the update DTO.** Re-parenting a
grade rewrites history silently: `intake_items` stores `product_grade_id` and nothing else,
and §4.1 makes the **product** the reporting key while the grade is the price key. Moving
"1 сорт" from Малина to Полуниця retroactively moves every receipt line ever written against it
into a different product's totals — a report correct last month becomes wrong with no document
changing and no trail explaining it. A grade under the wrong product is deactivated and
recreated, not moved.

**Names stay mutable, and a rename is retroactive by construction.** Nothing downstream
snapshots a product or grade name — `intake_items` carries the id alone — so renaming Малина →
Полуниця rewrites what every past receipt *means* while every number stays identical. The
schema accepts this: it snapshots prices and weights religiously and names nowhere. Blocking a
rename would invent a rule the schema declined to have, and typo fixes are the common case.
Recorded in the entity doc comments and here: **a rename corrects spelling, it does not change
identity; a different berry is a new product.**

### 5.4 Deactivation is never blocked in this slice

No analogue of `assertNoActiveUsers`. Two `TODO`s go in, in the style of the existing
"TODO (when `shifts` lands)" in `CollectionPointsService`:

- when `grade_prices` exists — decide whether deactivating a grade that has a price set for
  today deserves a warning (expectation: no; §4.5 already hides it from the intake screen, but
  that is the module's call);
- when `crate_issuances` exists — decide whether deactivating a `tare_type` with outstanding
  deposits deserves a warning.

Both are warnings at most, never refusals, per the schema's repeated stance that a management
decision gets a warning and not a locked button (§6.1, правка 14).

## 6. Data conventions applied

### 6.1 Case-insensitive uniqueness — new, and it also fixes `collection_points`

`normalize-login.ts` already decided, explicitly "so the next table doesn't have to re-derive
it": a display value is **trimmed but never lowercased**, because rewriting «Копайгород» →
«копайгород» on save is data loss rather than normalization.

That rule governs *storage* and says nothing about *comparison* — and every `UNIQUE` in the
codebase today is a case-sensitive Postgres default. So `products.name` would accept «Малина»
and «малина» as two products, and the DBML contains the exact evidence that this is what
happens to hand-typed catalog data. It is the argument that killed the `villages` table: in the
client's working book one village is written four ways — «копайгород» 571 rows, «Копайгород»
175, «Копайгород » with a trailing space 45, «Копай».

**Decision: store exactly as typed, compare case-insensitively.**

- `UQ_products_name_lower` on `lower(name)`.
- `UQ_tare_types_name_lower` on `lower(name)`.
- `UQ_product_grades_product_name_lower` on `(product_id, lower(name))`.
- `collection_points`: `UQ_collection_points_name` is **replaced** by a `lower(name)` index in
  the same migration. Otherwise the codebase holds two different answers to one question and
  the next module copies whichever it reads first. The migration **fails loudly** if existing
  rows already collide on case, naming the colliding values rather than dropping data.
- Services still trim, still preserve the owner's capitalization in the column, and the
  friendly-409 pre-check queries `lower(name) = lower(:name)`. The index is the real guarantee;
  the pre-check only produces the nice error, exactly as `assertNameFree` already documents.

`lower()` handles Cyrillic correctly in a UTF-8 database. `citext` would also work but needs an
extension for no added benefit.

**Mechanical consequence, and it is not optional:** a `lower(name)` unique index **cannot be
expressed in TypeORM entity metadata**. These indexes live only in the hand-written migration,
the entities carry **no** `@Unique` on those columns — *including removing
`@Unique('UQ_collection_points_name')` from `CollectionPoint`* — and each entity's doc comment
names where its uniqueness actually lives. Leaving the decorator in place would make
`migration:generate` propose re-creating a plain case-sensitive constraint on every run,
forever.

### 6.2 Ordering

`ORDER BY name ASC` on all three lists. There is no `display_order` — see §8.1.

### 6.3 Names

`@Length(1, 128)` on every name, matching `CreateCollectionPointDto`. Trimmed before both the
uniqueness check and the save, with an all-whitespace name rejected as a 400 — the
`assertNameValid` shape already in `CollectionPointsService`.

### 6.4 Pagination — the envelope is kept, the default is not

`PaginationQueryDto` defaults to `limit=20` and its doc comment says to copy it for every list
endpoint, because "an unpaginated `find()` works in a demo and melts down at real row counts".
That reasoning does not hold here, and the failure mode is quiet. These are bounded reference
tables — the DBML's example has ten products with a few grades each — and their consumer is a
**dropdown on the intake screen**, not a scrollable table. Ten products at three grades apiece
is 30 rows against a default of 20: the operator opens the grade picker, the last third of the
catalog is not there, and nothing errors.

- All three list DTOs extend `PaginationQueryDto` and return `Paginated<T>`; the convention,
  the client code and the `total` field are untouched.
- Each overrides `limit` to **default 100**, `@Max(100)` unchanged. One request returns the
  entire catalog for any plausible state of this business, and the guard rail against an
  unbounded query remains.
- The client (next slice) compares `data.length` against `total` and surfaces a warning if they
  differ. If this business ever exceeds 100 grades the assumption has broken and someone must
  know; silent truncation is the one outcome that is not acceptable.

### 6.5 Filters

- `/product-grades`: `?product_id=` (the filter the owner UI's tree needs) and
  `?include_inactive=`.
- `/tare-types`: `?include_inactive=`.
- `/products`: neither — it has no `is_active` at all (§5.1).
- **No free-text `q` search** on any of them. Nothing has asked for one and a 30-row list does
  not need it.

## 7. Authorization

These tables are network-wide: no `collection_point_id`, so none of the point-scope machinery
(`resolvePointFilter` / `assertOwnsPoint`) applies.

- **Reads: `@Auth()` — both roles.**
- **Writes: `@Auth(UserRole.NetworkOwner)`.**
- `include_inactive` is not role-gated; no rule says an operator may not see a retired grade.

The write side is stated outright: `tare_types`'s Note says «Обидва числа РЕДАГУЮТЬСЯ
керівником», and §10.1 knows exactly two roles, with everything configurable belonging to the
керівник.

The read side is opened now rather than later because the operator's intake screen needs all
three catalogs — product and grade to pick a line, `tare_types.weight_kg` for §2.5's automatic
tare subtraction, `deposit_price` for §6.3's завдаток. Gating then ungating is churn with a
window in which the intake module is blocked on a permission change. **Named consequence:** an
operator can read `tare_types.deposit_price`. That is money they physically collect, so they are
meant to see it.

## 8. Divergences from `28-db-schema.dbml`

Recorded here in the same spirit as the foundation spec's divergences (the identity seam, the
`collection_points.name` uniqueness the DBML does not specify).

### 8.1 `display_order` is not implemented

The DBML gives `products` and `product_grades` a nullable `int display_order`. **It is not
implemented in this slice.** Nothing consumes it, no rule anywhere cites it, and there is no UI
that could set it. Ordering is `name ASC` everywhere until a real ordering requirement appears.

Reversible at zero cost: adding a nullable column with no default is a purely additive
migration, and the decision about what null means and how a reorder is applied (per-row `PATCH`
versus a transactional bulk `PUT /products/order`) is better made against a real screen than
against a guess.

### 8.2 Case-insensitive name uniqueness is an addition

The DBML marks `products.name` and `tare_types.name` `unique` and `product_grades` unique on
`(product_id, name)`. Making those comparisons case-insensitive goes beyond what it says, for
the reason in §6.1 — which is the DBML's own argument, applied to a table it did not apply it
to. `collection_points` is brought into line at the same time.

## 9. Audit

Six new entries in `AUDIT_ACTIONS`: `product.created`, `product.updated`,
`product-grade.created`, `product-grade.updated`, `tare-type.created`, `tare-type.updated`.
`target_type` values `'product'`, `'product_grade'`, `'tare_type'`.

**No separate `tare-type.price-changed`.** The points module splits `point.target-changed` out
of `point.updated` because a target has its own §6.1 rationale. Tare numbers are different in
kind: `weight_kg` and `deposit_price` *are* the row, so splitting them would leave
`tare-type.updated` meaning "someone renamed it" while the `before`/`after` diff already says
which fields moved.

**The number changes are nonetheless audited properly, and that is the point.** `tare_types`
keeps no history of its own, and because §2.7 snapshots its values downstream, *nothing* in the
database records that a crate deposit went 120 → 130 or when. The audit log is the only place
that fact can live — the same argument that put `point.target-changed` there.

**No `reason` field on these DTOs.** `UpdateCollectionPointDto` has one because §6.1 shows a
worked example carrying a reason. Nothing asks for one here; it is additive later.

**Each write is wrapped in a transaction and passes the `EntityManager` to `audit.record()`.**
`AuditService.record()` accepts one specifically so "an entry recording a write that then rolled
back" cannot happen, and `CollectionPointsService` does not use it — it saves, then records,
unwrapped, so a failed audit insert leaves a point with no entry. The three new modules use the
seam. **Accepted cost:** this is a second shape until `CollectionPointsService` is aligned, which
should happen during the UI slice when that file is being touched anyway.

## 10. Frontend

**None.** Backend only, as in the foundation slice.

After this slice the owner-facing backlog is five screens over endpoints unreachable from a
browser: users, collection points, products, product grades, tare types. That is the point at
which "UI later" starts costing real money, because a five-screen UI designed all at once makes
shape decisions that should have been made three modules ago, none of them grilled.

**The next slice is therefore the owner admin UI over all five — not another backend module.**
It starts by closing the three foundation follow-ups filed under "Blocks the users admin UI":
the active-owner check-then-act race, the non-atomic `setLogin()`, and reactivating a user
pinned to a deactivated point. Aligning `CollectionPointsService` on the transactional audit
seam (§9) belongs there too.

## 11. Follow-ups closed here

From `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`, section "Worth doing before
the next module copies it" — this slice is that module, and it copies the shape three more
times.

**Closed:**

- **`include_inactive` accepts values it then ignores.** `@IsBooleanString()` passes `'1'`,
  `'0'`, `'TRUE'` while the services test `=== 'true'`, so `?include_inactive=1` is accepted and
  silently means *false*. Replaced by one shared boolean query param in `common/dto` that maps
  `'true'`/`'1'` → `true`, `'false'`/`'0'` → `false`, and **400s on anything else**, typed
  `boolean` at the service. Applied to both existing list DTOs (`list-users.query.ts`,
  `list-collection-points.query.ts`) and the two new ones — `/products` has no such filter — so
  **four** DTOs share one answer instead of four copies of a bug. The two call sites that
  currently re-derive it, `UserAdminService.list()` and `CollectionPointsService.list()`, drop
  their `=== 'true'` comparisons and read the typed boolean.
- **`diffFields(before, after, keys)`.** Hand-rolled in four places today; the three new
  `update()` methods would make it seven. Extracted now.

**Carried, with a reason:**

- The active-owner race, non-atomic `setLogin()`, and the reactivation gap — moved from
  "someday" to the first task of the UI slice (§10).
- Naming the four inherited constraints so `migration:generate` stops proposing destructive
  churn. This slice's migration is hand-written SQL, as `YagodaFoundation` was, so the tool is
  not on its critical path; the fix is a rename migration across `user_identities`,
  `user_credentials` and `audit_log` for no behavioural gain here.
- `APP_TIMEZONE` / `TimeService` wiring. Not this slice's — a catalog has no `business_date`.
  It lands with the first document module.

## 12. Testing

Test-driven, both suites, per the project's stated workflow.

**`*.spec.ts`** (`npm test`, mocked repositories, mirroring
`collection-points.service.spec.ts`) — one per service, covering: trim-and-reject-blank, the
friendly 409 pre-check, absent-versus-null on `PATCH`, `product_id` absent from the update path,
the audit calls and their diffs, `include_inactive` defaulting. Plus a spec each for the two
extracted helpers — the boolean query param (**including that `'2'` is a 400**, which is the
actual bug being closed) and `diffFields`.

**`*.db-spec.ts`** (`npm run test:db`, real Postgres, migrations applied) — everything that
exists **only** in hand-written SQL and is invisible to a mocked repository:

- Case-insensitive uniqueness per table: inserting a case-variant duplicate raises a unique
  violation. **This is the slice's most important guarantee and cannot be unit-tested at all** —
  a unit test of `assertNameFree` proves only that the pre-check queries what we told it to.
- `collection_points` now rejects case-variant duplicates, and the old case-sensitive constraint
  is gone.
- `CHECK (weight_kg >= 0)` and `CHECK (deposit_price >= 0)` reject `-1`.
- The `product_grades → products` foreign key rejects an orphan.

**HTTP level**, extending the `pipeline.db-spec.ts` pattern: the owner creates a product, a
grade and a tare type; the operator lists all three successfully and gets **403 on every
write** — the one assertion proving §7's split actually reached the decorators.

**One gap accepted and recorded rather than closed:** the migration's guard that fails loudly on
pre-existing case collisions. Migrations run once inside the test harness, so exercising that
branch needs a bespoke fixture database. Verified by inspection, with a failure message that
names the colliding values — the same treatment `verifyPassword`'s boundary cases received.

> **Observed in practice during implementation.** The guard is no longer merely inspected. The
> TDD red step ran the new db-spec against `app_test` before the migration existed, and because
> the old constraint was still case-SENSITIVE, both halves of the "rejects a case-variant
> duplicate" assertion inserted successfully and persisted — the suite never truncates. The
> guard then caught exactly that pair on the next run, aborted, and named the colliding values,
> which is the behaviour this section could not test for. It remains uncovered by an automated
> test; it is no longer unproven. Anyone repeating this pattern for a future case-insensitivity
> retrofit should expect the same red-step trap.

## 13. Migration

One hand-written migration, `1788600000005-YagodaCatalog.ts`:

- `CREATE TABLE products`, `product_grades`, `tare_types` with the columns, CHECKs and foreign
  key above.
- The three `lower(...)` unique indexes.
- Replace `UQ_collection_points_name` with `UQ_collection_points_name_lower`, aborting with a
  named-values error if existing rows collide.

`down()` drops the three tables and restores the plain `UQ_collection_points_name` — which will
fail if case-variant point names were created in the meantime. That is the safe direction, and
it is the same posture `BootstrapOwner.down()` already takes.
