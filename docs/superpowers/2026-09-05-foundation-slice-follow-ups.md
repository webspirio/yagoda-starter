# Yagoda foundation slice — known follow-ups

Everything below was found during the eight-task build of
`docs/superpowers/plans/2026-09-04-yagoda-foundation-slice.md`, judged, and
deliberately deferred. None of it blocks the merge. Recorded here because the
build workspace is discarded and a finding nobody wrote down is a finding
nobody fixes.

Ordered by when it starts to matter, not by severity.

> **Status update, 2026-09-06 (catalog slice).** The two items under "Worth
> doing before the next module copies it" marked **CLOSED** below were closed by
> the catalog slice, which was the next module. The three items in this first
> section are now the **first task of the owner admin UI slice**, not open-ended
> follow-ups: that slice is what makes them reachable. Two new entries appear at
> the end.

## Blocks the users admin UI

**The active-owner count is a check-then-act with no serialisation.**
`user-admin.service.ts` — `countActiveOwners()` and `users.update()` are two
statements with no transaction and no row lock. Two concurrent PATCHes, each
demoting one of the last two owners, can both read "one remaining" and both
proceed, leaving zero owners. With registration deleted and `BootstrapOwner`
firing only on an empty `users` table, that state is unrecoverable short of a
manual `INSERT`.

Not reachable today: it needs ≥2 active owners (this domain has one by
construction), genuine concurrency in a millisecond window, and two *different*
targets — `SELF_LOCKOUT` already refuses an actor changing themselves. And
there is no admin UI in this slice, so the only way to fire it is two
hand-written concurrent `curl`s by the owner.

The moment a UI can issue concurrent PATCHes, this must be closed. Do it
together with the next two items — they are one transaction's worth of work,
and both `users.update()` and `setLogin()` already accept an `EntityManager`:

- **`setLogin()` is not atomic with `users.update()`.** The identity row is
  written first, outside any transaction. If the second call throws, the login
  has changed, nothing else has, and no audit entry is written.
- **Reactivating a user pinned to a deactivated point is not re-checked.**
  `assertPointUsable` runs only when the point *changes*. Deactivate a user,
  deactivate their point (allowed — only *active* users block it), reactivate
  the user, and you have an active operator at a dead point. Not a security
  failure; they simply see nothing.

While in there: the lockout rule is ~29 inline lines in `update()`, the one
place the codebase's own "guards decide from the request, `assert*` decides
from a row" convention isn't followed. Its three siblings are named methods.

## Worth doing before the next module copies it

- **CLOSED (catalog slice, `ca7809c`).** ~~`include_inactive` accepts values it
  then ignores.~~ Replaced by one shared `@BooleanQueryParam()` in
  `common/dto/boolean-query-param.ts`: `'true'`/`'1'` → true, `'false'`/`'0'` →
  false, anything else is a 400. Adopted by all four list DTOs that have the
  flag, and both services now read a typed boolean.
- **CLOSED (catalog slice, `d4771ba`).** ~~Field diffing is hand-rolled in four
  places.~~ Extracted to `common/diff-fields.ts`, returning `null` when nothing
  moved so every call site's "a no-op PATCH writes no audit entry" guard reads
  as `if (diff)`. All four original sites adopted it, and the three catalog
  services use it rather than growing a fifth, sixth and seventh copy.
  `assertTrimmedName` (`common/trimmed-name.ts`) was extracted in the same
  commit for the same reason.
- **`migration:generate` still proposes destructive churn for four inherited
  constraints** — `FK_user_identities_user`, `FK_audit_log_actor`,
  `FK_user_credentials_user`, `UQ_user_identities_provider` — because those
  entities declare no constraint names. Nothing this slice created drifts
  (verified: zero proposed changes). Extending the naming discipline to the
  four inherited ones makes the documented tool safe to run.
- **`APP_TIMEZONE` is now forwarded in both compose files**, but nothing
  consumes it yet. It becomes the join key for `business_date` in the first
  document module — wire `TimeService` into that module deliberately.

## Test gaps

- No unit spec for `toUserResponse` or `displayNameOf`. The latter is the
  function extracted *because* two sites had diverged on `.trim()`.
- `UserAdminService.list()` has no unit test; `create()`'s happy path is proven
  only end-to-end; no test combines demotion and deactivation in one PATCH
  (traced by hand — both guards fire on the union, correctly).
- `verifyPassword`'s boundary rejections (`n<=1`, `r<1`, `p<1`, empty base64)
  are covered by inspection and by the never-throw cases, not directly.
- The `excludeId` branch of `assertNameFree` is never exercised positively: the
  test that means to is short-circuited by `update()`'s `name !== point.name`
  guard before it reaches the assertion.
- `resolvePointFilter`'s `requested` parameter has no production caller — both
  list endpoints call it with one argument — so "ignored for an operator" is
  only unit-proven.
- The lowercase half of the self-lockout guard is no longer proven over HTTP
  (that assertion was redirected to the uppercase bypass case); unit tests
  still cover it.

## Cosmetic, fix opportunistically

- `pipeline.db-spec.ts`'s first test is still titled "registers, logs in, …"
  though the fixture no longer registers through an endpoint.
- `current-user.service.spec.ts` uses `language_code: 'uk'`, which
  `@IsIn(['en'])` rejects — a value that cannot arrive over HTTP. Swap it when
  a second locale exists, which for a Ukrainian product it should.
- `jwt.strategy.spec.ts` uses `auth as never`; typing the fake as
  `Pick<UsersService, 'findAuthContext'>` would remove it.
- `YagodaFoundation.down()` reconstructs `display_name` as `"Foo —"` for rows
  backfilled with the `—` placeholder. `down()` already declares itself
  irreversible in substance.
- `BootstrapOwner.down()` deletes by login match alone. It will also fail on
  `FK_audit_log_actor` once that owner has done anything — the safe direction.
- `GET /collection-points/:id` distinguishes 404 from 403, a weak existence
  oracle. Negligible against UUIDs; worth remembering before this shape is
  copied onto a guessable id.

## Two things that are decisions, not oversights

Do not "fix" these; both are argued for in the spec and commented in the code.

- **`useUpdateMeMutation` has no caller.** Kept as the reference TanStack
  mutation, exactly as `shared/lib/form-draft` and `shared/lib/url-state` are.
- **`'user.registered'` remains in `AUDIT_ACTIONS`** with no writer. Rows
  written before registration was removed still carry it and must type-check
  when read back.

## New, from the catalog slice (2026-09-06)

- **`CollectionPointsService` records its audit entries outside a transaction.**
  It saves, then calls `audit.record()` unwrapped, so a failed audit insert
  leaves a point with no entry. The three catalog services all use
  `AuditService.record`'s `EntityManager` seam inside `dataSource.transaction()`,
  which makes the correct shape the majority — three modules to one. Align
  `CollectionPointsService` during the admin UI slice, when that file is being
  touched anyway. Recorded as accepted debt in the catalog spec's §9.

- **The migration collision guard is observed but still not covered by a test.**
  `1788600000005-YagodaCatalog` aborts with a named-values error if
  `collection_points` already holds names colliding case-insensitively. The
  catalog spec recorded this branch as inspection-only. It has since fired for
  real: the TDD red step wrote a colliding pair into `app_test` while the old
  case-sensitive constraint was still in force, and the guard caught it on the
  next run and named the values. So the branch is proven to work — but only
  anecdotally. Covering it properly needs a fixture database the harness does
  not currently provide.

- **`down()`'s doc comment in `1788600000005-YagodaCatalog` overstates the
  risk.** It claims restoring the case-sensitive constraint can fail if
  case-variant names appeared meanwhile. It cannot: while the migration is
  applied, the case-insensitive index is strictly stronger, so anything passing
  it passes the weaker constraint too. Harmless, but it invites a future reader
  to handle an impossible case.

- **The `db-harness.ts` comment contradicts the db-specs.** It says "these specs
  TRUNCATE tables"; both `schema.db-spec.ts` and `catalog-schema.db-spec.ts`
  document that they never truncate and rely on per-run `randomUUID()` names
  instead. Pre-existing, surfaced during the catalog slice.

- **`assertNameFree` is a check-then-act in every catalog service.** Two
  concurrent creates can both pass the pre-check; the loser gets a 500 rather
  than a friendly 409. The unique index is the real guarantee, and this matches
  the pre-existing shape in `CollectionPointsService` and `UserAdminService` —
  recorded for consistency, not as a new defect.

## New, from the suppliers & prices slice (2026-09-07)

- **Per-point grade acceptance does not exist.** `product_grades.is_active` is
  network-wide, and with `business_date` removed there is no longer any
  per-point way to stop buying a grade: once priced at a point it is offered
  there forever. The DBML rejected an `is_enabled` field, but its reasoning
  («відсутність рядка і є вимкненням») depended on the daily row this slice
  removed. Closable additively — `is_accepted boolean NOT NULL DEFAULT true`
  on the price row, latest row per (point, grade) deciding both price and
  acceptance. Accepted because the network currently buys one assortment
  everywhere. Spec §5.4.

- **The §4.8 «поставити всім» bulk price route is not built.** When it is: the
  склад carve-out belongs SERVER-side. Take the target as intent
  (`{ kind: 'all_reception_points' }`, expanded to active `kind = 'reception'`
  points) rather than an array of point ids from the client, or the rule ends
  up in the browser where no test reaches it. Spec §5.5.

- **`max_markup` and `max_discount` are written and never read.** Nothing
  clamps `intake_items.bonus` against them because `intake_items` does not
  exist. They are proven stored and proven non-negative and nothing more; the
  `intakes` slice owes the test that they constrain anything. Spec §5.2.

- **Supplier search is a sequential scan within one point.** The phone suffix
  `LIKE` and the name substring `ILIKE` both ignore
  `IDX_suppliers_point_last_name`. Fine at hundreds of suppliers per point;
  the answer at low tens of thousands is a `pg_trgm` GIN index, which is
  additive. Judgement, not measurement — no benchmark was run. Spec §6.5.

- **`grade_prices` is a hole in the cross-cutting audit view.** It writes no
  `audit_log` entries, deliberately (the table is its own history — spec §9),
  so "what did this person change last Tuesday" misses price moves. Closable
  with an audit READER that unions the journal.

- **A supplier rename reassigns a money balance, unguarded.** Debt follows
  `supplier_id`, not the name, and правка 6 cancelled the merge tool. The
  audit before/after diff is the only trail. A guard was considered and
  rejected: every version also blocks fixing a typo, which is the common case.
  Spec §5.6.

- **`CollectionPointsService` still records audit entries outside a
  transaction.** Now five modules to one. `SuppliersService` uses the
  `EntityManager` seam like the three catalog services. Align during the admin
  UI slice.

- **`PATCH /suppliers/:id` reopens the existence oracle that `GET` closed.**
  `findOne` returns 404 for another point's supplier (spec §8.3), but `update`
  returns 403 for the same row and 404 for an unknown id — so an empty,
  fully-whitelisted `PATCH {}` is a zero-side-effect probe distinguishing
  "exists at another point" from "does not exist", on rows holding real names
  and phone numbers. Deliberately not changed: spec §7's authorization table
  prescribes `assertOwnsPoint` for PATCH, and §8.3's argument is scoped to a
  *guessable* id while these are UUIDv4. Close it by routing `update`'s
  ownership failure through the same 404 when that file is next opened.

- **A deactivated supplier blocks re-creation with their own phone.**
  `UQ_suppliers_point_phone` has no `WHERE is_active` predicate, so a supplier
  deactivated by mistake cannot be re-created with their number — they must be
  reactivated instead. That is what spec §5.7 specifies and reactivation is
  the better path, but the 409 message ("A supplier with that phone already
  exists at this point") does not say the blocker is deactivated and
  therefore invisible in the default list. Consider naming the deactivated
  case in that error.

- **A `+38`-shaped mistype is a second supplier row, and no server-side rule
  can catch it.** `'+38 67 123 45 67'` — the conventional Ukrainian written
  form minus the national `0` — canonicalizes to `+38671234567`, satisfies
  `CHK_suppliers_phone_e164`, and becomes a distinct row from
  `+380671234567`. Dropping the `3` or the `8` instead leaks the same way
  (`+80671234567`, `+30671234567`). This is not a hole in `phone.ts`'s
  `UA_CLAIMED` guard: it is the direct consequence of spec §5.7 choosing an
  E.164 *shape* test, and the near-miss families that CAN be closed already
  are (`38671234567`, `+3800…`, `00380…`, legacy trunk `8…` all 400).
  **Do not "fix" this by rejecting `+38` + 9 digits.** Ukraine's national
  number is 9 digits and its seven `+38x` neighbours' are 8, so that rule
  rejects every 11-digit `+38x` number — 100% of Slovenia, Bosnia,
  Montenegro, Kosovo and North Macedonia. `+38671234567` is simultaneously a
  Ukrainian mistype and a well-formed Slovenian landline; they are the same
  string. `libphonenumber-js` does not separate them either — a leading `+`
  makes it read the country code and parse the value as Slovenia. The fix
  belongs at ENTRY: an input mask or a `+380` prefill on the supplier form,
  which does not exist yet. Documented in `phone.ts` at the code itself.

- **Neither `suppliers` nor `grade_prices` checks that the collection point is
  ACTIVE.** Both now 404 a point that does not exist, but an owner can still
  create a supplier at — or append a price to — a *deactivated* point, and
  `/grade-prices/current` serves that price afterwards.
  `UserAdminService.assertPointUsable` rejects exactly this with a 400 and
  `POINT_UNUSABLE`, so the codebase already holds both answers. Deliberately
  not changed during review: the two new modules agree with each other, no
  spec section decides it, and "a retired point stops accepting new data" is
  a product call rather than a defect to be fixed silently. Decide it, then
  make all three agree.

- **`GradePricesService.current` runs its `DISTINCT ON` subquery twice per
  request** — once for the count, once for the page. The doc comment's
  argument for why `findAndCount` is wrong here is correct, but a
  `count(*) OVER ()` window column would produce the same `total` in one pass
  and halve the work on this module's hot read. The two statements are also
  not in one transaction, so `total` and `data` can disagree under a
  concurrent insert — consistent with `findAndCount` everywhere else in the
  repo, hence recorded rather than fixed.

## New, from the intakes & payouts slice (2026-09-08)

This is the first slice written with `26-rules-by-example.md` actually in the
repository. The first four items come from reading it; the rest are ordinary
follow-ups.

- **§4.5's daily price gate is not enforceable, and this slice is where that
  starts to cost money.** The prices slice removed `grade_prices.business_date`
  (its §8.1), so a price carries over until changed and
  `GradePricesService.currentFor` will hand an intake on the 5th the price set
  on the 4th — silently, and in the buyer's disfavour if the market moved. The
  client's literal reason for the rule is «щоб ніхто не порахував по
  вчорашній». **Closing it needs no migration:** refuse a grade whose newest
  price row predates the shift's `business_date`. Deferred deliberately
  (owner, 2026-09-08) because the gate means a morning with no prices set is a
  morning the point cannot trade — which is exactly what §4.5 describes, but is
  a real change to how the business runs. Recorded on `currentFor` itself so
  whoever closes it finds the argument.

- **§9.2's warning channel does not exist.** Four checks, all «дозволяємо, але
  вголос»: kg per crate outside 2…14 («50,8 кг у ящику. Перевірте брутто або
  кількість тари.»), gross over 750 kg, pallet over 50 % of gross, and an
  identical line twice inside 60 seconds. The rule is that a warning «називає
  ЧИСЛО І ПРИЧИНУ, а не "перевірте дані"». A 201 with no advisory field cannot
  carry any of them. §9.2 itself is unresolved on «на кому відповідальність за
  валідацію», so the shape of the answer is a product call first.

- **§12.1's payout rounding.** «до цілої гривні, рівно 0,50 йде ВНИЗ» —
  120,50 → 120, 120,80 → 121 — with the system suggesting the figure. Note it
  is a DIFFERENT rounding from `common/money.ts`'s half-up at scale 2 on a line
  amount, not a replacement for it; both can coexist. Filed at the source under
  «Три місця, де відповіді ще немає» with «→ **Правка:** точно???», so it is
  unsettled there too.

- **Two contradictions in `26-rules-by-example.md` need the owner's answer.**
  §9.4 vs §10.2 — whether an operator may void their own intake at all (§9.4's
  table says yes for their own same-day receipt; §10.2's summary list puts
  voiding under ТІЛЬКИ КЕРІВНИК). §9.1 vs §9.2 — whether a tare-less line is
  refused or merely warned. This slice took §9.4 and §9.1; the intakes spec
  §10.2 records what changes if the other reading was meant. The first is one
  decorator.

- **`SuppliersService` still has its own private `resolveWritePoint`.** The
  shared one now lives in `auth/access/point-scope.ts` and the three new
  services use it. Switching suppliers over is a three-line change covered by
  its existing spec — left alone here to keep the slice inside its own tables.

- **`collection-points.service.ts` — refuse deactivating a point with an open
  shift.** The `TODO (when shifts lands)` is now buildable: `shifts` exists and
  `ShiftsService.findOpenAtPoint` is exported. Left out deliberately as an
  adjacent fix.

- **Warn when deactivating a supplier who carries non-zero debt.** Parked by the
  prices slice «when `intakes` and `payouts` exist». They now exist, and
  `SupplierBalanceService.debtFor` answers it in one call. A WARNING, never a
  refusal (правка 14, «заблокована кнопка вчить шукати обхід») — and note that
  "settle up first" is not well defined, since a balance may legitimately be
  negative.

- **`POST /shifts` is provisional in SHAPE, not only in its close path.** §07:30
  makes opening a shift «сума вводиться фактично порахована», which the
  03.09.2026 schema note turns into TWO `cash_counts` records, one per book.
  Today the route takes no body at all. It grows a DTO with `cash_counts`, at
  the same time the close path grows §7.7's role split and mandatory
  `explanation`.

- **The payout ceiling is half a rule.** `min(Разом, каса за ягоду)` (§3.6):
  the debt half is enforced under a row lock, the cash half needs `transfers`
  and `cash_counts`. **A payout can currently exceed the cash physically in the
  drawer and nothing notices.** The lock and the `supplier-balance` seam are
  already the right shape for the second half.

- **`decimal.js` replaces the internals of `common/money.ts`** when the
  arithmetic stops being provisional. One file, by construction — that is the
  reason the seam exists. The eslint rule scoped to the four money modules is
  what keeps it true in the meantime.

- **`migration:generate` cannot report "no changes" in this repo, and could not
  before this slice.** It proposes renaming every hand-written foreign-key
  constraint to a TypeORM-generated hash, including `FK_user_identities_user`,
  `FK_audit_log_actor` and `UQ_product_grades_product_name_lower` from earlier
  slices. Hand-written names are this repo's convention. What IS worth checking
  after a schema change is that no COLUMN, type or constraint-body drift
  appears — filter the generated file with `grep -v '"FK_'` and read what is
  left. Verified clean for all five tables in this slice.

- **The foundation spec's §5.2 is stale on one point** — it says `APP_TIMEZONE`
  «currently defaults to `UTC`». It has defaulted to `Europe/Kyiv` since before
  this slice, in both `timezone.config.ts` and the Joi schema. One-line
  correction, worth making so nobody "fixes" a config that is already right.

- **The three earlier specs state that `26-rules-by-example.md` is not in the
  repository.** It is. Their reasoning was built on second-hand quotation from
  the DBML's own `Note` blocks and has not been re-checked against the source;
  the intakes spec §10.5 is the one divergence already known.

- **The db suite is close to the production rate limit.** Every request in an
  HTTP spec comes from 127.0.0.1, so one run looks like a single abusive
  client. Measured at `THROTTLE_LIMIT=100` the full suite still PASSES — peak
  `x-ratelimit-remaining` dips to 79 — so the earlier claim here that it
  "exceeds" the limit was wrong; the next HTTP spec is roughly where it stops
  fitting, and the failure would appear as scattered 429s in unrelated specs.
  `relaxThrottleForTests()` raises `THROTTLE_LIMIT` for the test process only,
  unconditionally (`db-harness.ts` runs `dotenv` at module load, so a value
  copied from `.env.example` would otherwise win and re-create the scatter).
  Worth revisiting if CI ever runs the suites in parallel against one Redis —
  the counter is shared, so two concurrent runs would re-create the problem at
  a higher number.

## Raised by the intakes & payouts code review (2026-09-08)

Four Important findings and two Minor ones were fixed in the slice itself.
These are the rest — each one verified by the reviewer against a live database,
and each one deliberately left because it belongs to a table this slice does
not own or to a report nothing calls yet.

- **`intake_items.product_grade_id` is unindexed.** Harmless today: there is no
  `DELETE` route, and the detail read is already covered because
  `UQ_intake_items_order (intake_id, item_order)` leads with `intake_id`. But
  `intake_items` will be the largest table in the schema and the first
  per-grade report will want this index. Add it with whichever slice writes
  that report, so the index ships with a query that uses it.

- **`snapshotPrices` runs one query per distinct grade.**
  `intakes.service.ts` — `Promise.all(gradeIds.map(...))`, bounded by the
  number of lines on one document, inside the create transaction. Spec §8.7
  declined `@ArrayMaxSize(5)`, so it is formally unbounded. One
  `product_grade_id = ANY($2)` with `DISTINCT ON (product_grade_id)` collapses
  it to a single round trip. Not urgent at real document sizes; worth doing if
  a bulk-import route ever appears.

- **Two clocks in one slice.** `IntakesService.void` and `PayoutsService`
  stamp `new Date()`; `ShiftsService` goes through `this.time.now()`. The
  instants are identical for a `timestamptz`, so nothing is wrong — but
  `TimeService` is described as *the* seam for timezone-aware time, and this is
  the slice that wired it. Route the document timestamps through it when the
  cash slice touches these services anyway.

- **Two comments claim more than their checks do.** `intakes.service.ts` and
  `payouts.service.ts` label the `shift.closed_at` test «квитанція минулого
  дня → тільки керівник», but it tests *shift closed*, not *previous day*: an
  operator who forgot to close Friday can still void a Friday receipt on
  Saturday morning. Spec §5 deliberately makes the close the freeze line, so
  the BEHAVIOUR is right and must not be "fixed" — the comments are what needs
  correcting.

- **The throttler bypasses the config convention.** `app.module.ts` reads
  `process.env.THROTTLE_*` directly, the only place in the app that skips the
  typed namespaced factories in `src/config/`. A four-line `throttle.config.ts`
  would make the rule uniform.

- **Spec §6.3's request annotation contradicts the code, and the code is
  right.** It says `collection_point_id` is «ignored for an operator» on
  `POST /intakes`; `resolveWritePoint` 403s instead. Failing closed is the
  better behaviour — correct the spec and the DTO comment, not the service.
  (`resolvePointFilter` on the LIST routes really does ignore it, which is now
  covered by a test.)

- **The `shifts` CHECK constraint diverges from spec §6.1 without being listed
  in §8.** The spec writes `CHECK (status = 'closed') = (closed_at IS NOT
  NULL)`; the migration implements `("status" = 'open') = ("closed_at" IS
  NULL)`. The implemented form is the right one — it keeps
  `awaiting_explanation` storable alongside a `closed_at` when `cash_counts`
  lands, avoiding a migration — and it is documented in the entity, the
  migration and a db-spec. It is simply missing from §8's list of divergences.

- **Consider extending the eslint money ban to `-`.** `'1.00' - '2.00'`
  coerces through `Number`, which is exactly what §5.1 forbids, and unlike `+`
  (legitimate for string building) a `-` on a decimal string is never right. It
  needs an exception for `intake.mapper.ts`'s `a.item_order - b.item_order`,
  which argues for a small `sortByOrder` helper rather than a disable comment.

- **`supplier-balance.service.spec.ts` asserts against SQL strings.**
  Reformatting the query reds the tests with no behaviour change. They pair
  with real coverage in `documents-pipeline.db-spec.ts`, so they could be
  demoted to one "both `voided_at` filters are present" check and let the
  db-spec own the behaviour.

## Learned from the demo scaffolding (2026-09-08, since removed)

A seed migration and a throwaway `/dev` page were built to eyeball this slice
in a browser, then deleted once it had been checked. Two findings outlive them:

- **A dev seed must guard on `NODE_ENV === 'development'`, not on
  `!== 'production'`.** `SeedDevAdmin` uses the latter, which is right for one
  account but wrong for anything that inserts domain rows: the `*.db-spec.ts`
  suites run every migration against `app_test` with `NODE_ENV=test`, so specs
  asserting what a catalog list contains would fail on rows they never created.

- **`/grade-prices/current` is documented as the intake picker read but
  returns no labels** — only `product_grade_id`, so a caller needs
  `/product-grades` and `/products` as well and has to join all three
  client-side. The real intake screen will want either the product and grade
  names on that response or a purpose-built picker read. Worth deciding when
  that slice is specced rather than discovering it in the UI again.

- **The whole slice was exercised by hand and behaved.** §2.4's own worked row
  (552,30 − 14,30 − 100 × 1,20 = 418,00 × 65,00) produced `27170.00` through
  the route; a repeated tare type answered `400 TARE_TYPE_DUPLICATED`; a payout
  one kopiyka over the balance answered `400 PAYOUT_EXCEEDS_DEBT` naming the
  balance; a second operator voiding a colleague's receipt in the same open
  shift answered `403 NOT_YOUR_DOCUMENT`; and an operator at the other point
  saw both journals empty.

## Learned from the day and reception screens (2026-09-08)

Findings from the final review of `feat/yagoda-day-screen` that no plan
schedules yet — a kit/consistency pass, not a feature:

- **`Badge` has no amber or leaf tone**, so the day feed's «очікує пояснення»
  badge wears `destructive` where §5.1 wants amber. Add the two tones to
  `shared/ui/badge.tsx` and switch the callers.
- **`DateStepper`'s aria-labels are hard-coded Ukrainian** (`shared/ui/date-stepper.tsx`);
  the English test suite finds the buttons by Ukrainian names. Give it label
  props with the current strings as defaults and translate at the call site.
- **`Paginated<T>` is hand-written five times** (intake, payout, catalog, points,
  users). It is a transport envelope, not a domain type — move it to
  `shared/api` and delete the copies. The ESLint layer rule only checks
  direction, so nothing stops a sixth copy today.
- **`pages/day/api/shiftActions.ts` has no test** for the invalidation trio
  (`shifts`, `intakes`, `payouts`) that every later screen relies on; ~30 lines
  with a real `QueryClient` would lock it.
- **The day page's truncation notice counts the merged feed**, while the cap
  is 100 per journal — 100 intakes + 5 payouts reads «перші 105 документів».
- **A refused close banner survives navigation** on the day page (step to another
  day, switch point); clear it in the date/point setters.

## Learned from the debts and overview screens (2026-09-09)

- **`DataTable`'s `onRowClick` lands on a bare `<tr>`** with no role, no
  `tabIndex` and no key handler, so a row-click page is unreachable by
  keyboard — and axe cannot flag it. Six pages do it now (users, catalog,
  suppliers, points, debts, journal). Fix it once in `shared/ui/data-table.tsx`
  (a focusable row with Enter/Space) rather than per page; `/debts` and
  `/suppliers` carry a per-row `Link` as the interim path.
- **`usePointScope().isLoading` is ignored** by the day, reception and debts
  pages: an operator's first render fires the read with `pointId: null`, then
  again under the real point once `me` resolves. Harmless (the server pins the
  operator) but one wasted request per cold load; gate with `enabled`.
- **Spec drift recorded, all deliberate:** §5.3's «card list, not accordion»
  became a `DataTable`; §5.3's supplier kind badge was dropped because
  `SupplierBalanceRow` carries no `kind`; §5.4's «Показати ще» became a fixed
  `limit: 100` with a «перші 100» hint; the card's «Здач за сезон» is the
  envelope `total` (voided included) while «Нараховано» excludes voided.
- **Operators void from the supplier card far more often against closed
  shifts** than anywhere else — the `SHIFT_CLOSED` banner is the backstop, but
  it is a spec question whether the card should hide «Анулювати» on rows from
  closed shifts for an operator.
- **The journal's supplier picker** is capped at the entity's `limit: 100`
  without search, and table names fall back to an 8-char id past the first
  100 balance rows on «Усі точки». Fine for a season's network; revisit with
  a server-side name lookup if the directory grows.

## Learned from the transfers and cash slice (2026-09-09)

- **The Friday/Saturday question is slice 2's**, and is stated in spec §12.
  `cashFor`'s `asOf` exists so slice 2 can express either answer.
- ~~**Go-live needs a ceremony**: one transfer per point for its opening
  balance, each accepted by its operator (spec §6.6).~~ **RETIRED 2026-09-09 by
  the cash counts slice (§3.2). Do not action this at deploy.** A point's
  opening balance is now its FIRST CASH COUNT: the first count at a point sets
  `expected = counted`, so the counted figure becomes the starting balance.
  Sending an opening-balance transfer as well would DOUBLE the money — the
  count establishes the baseline and the transfer is then added to it as a
  movement of the shift that accepted it.
- **`PointKind` is still read by nothing.** Spec §8.3 declines to make this
  slice the first. If a later slice branches on it, §7.3 versus §4.8 must be
  settled with the client first.

Found by the reviews during that slice's execution, judged and deferred:

- **`CHK_transfers_no_self_correction` has no test.** The constraint is present
  in both the entity and the migration; nothing watches it reject anything. A
  gap in the plan's spec, not in the implementation.
- ~~**`VoidDocumentDto` accepts a whitespace-only reason.**~~ **FIXED
  2026-09-09 on the cash counts branch (commit `371680d`).** `@Length(1, 500)`
  passed `"   "`, which the service then trimmed to empty, so §9.3's mandatory
  reason was not actually enforced. The transfers slice fixed its own two DTOs
  (`carrier`, `dispute_note`) with `@Matches(/\S/)` and left `VoidDocumentDto`
  — shared by `intakes` and `payouts` — for a decision across all three
  modules. That decision was taken and applied: the shared DTO now carries the
  same non-whitespace guard.
- **`transfers` has no CHECK requiring `reported_cash` when `status =
  'disputed'`.** Such a row contributes NULL to the cash formula and vanishes
  from the drawer silently rather than erroring. NOT reachable through the API
  — `DisputeTransferDto` makes the field mandatory — so it needs hand-written
  SQL to occur. Deferred rather than spend a second migration in the slice.
  **Do not "fix" it with a `COALESCE` in the formula**: that would mask the bad
  row instead of refusing it.
- **`.env` sets `APP_TIMEZONE=UTC`** while `.env.example` and the Joi default
  both say `Europe/Kyiv`. `ShiftsService.open`'s own comment warns that under
  UTC an evening shift and every document in it is silently misfiled by a day.
  The cash database specs pin their own timezone rather than inherit this, so
  the slice is unaffected — but local env setup is not.
- **`point-cash.db-spec.ts` scenario 12 pins only half of `asOfSql`.** It
  covers the `COALESCE` (drop it and the result changes) but not the
  `AT TIME ZONE` inside it — any timezone puts "today" past the fixture's date.
  Worth knowing if `asOfSql` is ever refactored.
- **`unexplained_difference` (task 8) is NOT scoped by `as_of`, unlike the
  `cash`/`shortfall` columns on the same row.** It is a running total over
  every count a point has ever had, computed the same way whatever `as_of` the
  caller passes — deliberately, per the brief and spec §3.1, but it means one
  row in the list response can mix a point-in-time figure (`cash`) with an
  all-time one (`unexplained_difference`). Worth a second look if a future
  screen implies otherwise.
- **`unexplained_difference` is exposed on `GET /point-cash` (the list) but
  not on `GET /point-cash/:pointId`**, which still returns only `cashFor`'s
  bare `{ cash }`. Not a bug — the brief scoped this task to `list` — but the
  single-point read and the list row now disagree about what fields a point's
  cash carries; worth deciding whether the single read should grow the same
  field before the frontend task builds against it.

## Learned from the cash counts slice (2026-09-09)

Raised by the final whole-branch review and deferred with the fix wave, rather
than by the slice's own tasks — these are the ones that would otherwise have
been lost with the working ledger.

- **`settle-return` on a day the point had no shift silently strands the
  returned cash.** Since the cash counts slice a returned payout is credited to
  the shift whose `business_date` matches the settlement's local date at that
  point (cash counts spec §3.3). Settle on a day the point never opened and the
  money credits NO shift's movements: it is gone from every expectation, and
  the next count reports a surplus nobody can explain. This is the same class of
  hole §4.1 closed for transfers, and the symmetric fix — refuse the settlement
  without an open shift — does not transfer: `POST /payouts/:id/settle-return`
  is OWNER-only and an owner cannot open a shift (§10.3), so it would make the
  owner wait for the point to open before handing money back. **Needs a client
  decision** between that wait, a back-dating field, and accepting the
  stranding. Meanwhile the cost is one spurious incident per no-shift
  settlement, re-baselined by the next count.

- **`unexplained_difference` is an all-time sum sitting beside two
  point-in-time ones.** On a `GET /point-cash` row, `cash` and `shortfall`
  honour `as_of`; `unexplained_difference` is `Σ (counted − expected)` over
  every non-midday count the point has ever had, whatever `as_of` says. It is
  also absent from `GET /point-cash/:pointId`, which still returns a bare
  `{ cash }` — so the list and the single read disagree about what a point's
  cash carries. **And the name asserts something it does not check:** an
  explained incident stays in the sum (deliberately — an explanation changes
  what is OPEN, never what is TRUE), so «unexplained» is wrong on its face.
  Renaming it — `accumulated_difference`, or `count_drift` — is cheap now and
  gets more expensive with every screen built on it. (Supersedes the two
  narrower notes on the same field in the transfers-slice section above.)

- **The §6.2 gap: the shift-close response does not carry the discrepancy.**
  Cash counts spec §6.2 said the discrepancy «appears in the response, after the
  write»; `POST /shifts/:id/close` returns a plain `ShiftResponse` with no
  `counted_amount`, `expected_amount` or discrepancy, so the frontend makes a
  second request to learn whether the drawer balanced. The values are already in
  hand where the count is written — `ShiftsService.close` holds both inside the
  transaction — so this is a mapper change. **The spec was amended to match the
  code rather than the other way round**, since a spec promising a behaviour the
  code lacks is the part that must not ship; growing the response is still the
  better end state and should be done before another screen works around it.

- **`ShiftsService` injects `CollectionPointsService` and never calls it.**
  A dead constructor dependency: `grep points shifts.service.ts` finds the
  import and the parameter and nothing else. Harmless, but it makes
  `ShiftsModule`'s import of `CollectionPointsModule` look load-bearing when it
  is not, and `shift-close.db-spec.ts` passes `null` for it with a comment
  explaining why that is currently safe.

## From the code review of the transfers & cash counts branch (10.09.2026)

Two reviewers went over `0b296d2..3cd05da` — one on domain correctness, one on
architecture and tests. Neither found a Critical issue. What they did find split
cleanly in two: things inside this branch's own tables, which were **fixed on the
branch**, and the entries below, which reach into `intakes`, `payouts`, `shifts`'
neighbours or the test harness and are therefore deferred by the same rule every
earlier slice followed.

Fixed on the branch, listed only so nobody re-reports them: the unlocked
check-then-act in `ShiftsService.close`/`reopen`; the `only_discrepancies` list
double-counting a reopen; the blank-reason hole in `ReopenShiftDto`; six stale
comments (including one on `point-cash.mapper.ts` that argued at length *for* a
bug b5952bb had removed, and one in migration `…0008` whose advice would have
doubled every point's starting cash); the un-anchored formula still standing in
`28-db-schema.dbml`; and a dev seed that wrote no `cash_counts` and no
`transfers`.

### Reaches other modules

- **`settle-return` strands cash whenever the day's shift is already closed.**
  The recorded case was a day with no shift at all; the likelier one is an owner
  settling at 20:00 against a point that closed at 19:00. `movementsSql` credits
  the money to that day's shift, whose `expected_amount` is a frozen snapshot,
  and `cashFor` anchors on that shift's *closing* count — so the money is
  invisible in the cash figure too. `expectedForOpening` then hands the next
  shift the previous closing figure and the operator's count reports a surplus
  nobody can explain. `payouts.service.ts` stamps `new Date()` with no shift
  check. Needs a client decision, not just code: either `settle-return` requires
  an open shift the way accepting a transfer now does, or a settlement lands on
  the next shift to open. **Note the wording of the earlier entry on this: it
  says «a day with no shift», and that undersells it — most evenings qualify.**

- **The void reason is trimmed by one service out of three.**
  `TransfersService.void` writes `dto.reason.trim()`; `IntakesService.void` and
  `PayoutsService.void` write `dto.reason` as it arrived. `VoidDocumentDto`'s
  `@Matches(/\S/)` now guarantees all three store a reason with something in it,
  so nothing is broken — but the stored value differs by module, and the DTO's
  comment had to be corrected because it claimed trimming was a codebase-wide
  invariant. Make the three agree; it is a three-line change to two services and
  a fixture or two.

- **`transfers.service.ts` audits the untrimmed reason while storing the
  trimmed one.** `:430` writes `dto.reason.trim()`, `:441` logs `dto.reason`.
  Twelve lines above, the dispute path carries an explicit comment for the
  opposite rule — «the audit log's whole job is to be quotable against the
  document later». The dispute path's argument is the better one; fold this into
  the item above.

### Reaches the test harness

- **No transport-level spec exists for any of the eight new endpoints.**
  `transfers`, `point-cash`, `cash-counts` and `PUT /shifts/:id/explanation` are
  all proven by constructing the service directly, so the `@Auth` decorators
  themselves are verified only by reading — a service spec cannot catch a
  missing decorator. This is a **scheduling** problem rather than a «just add
  it» one: `backend/CLAUDE.md` measures the throttle headroom at 79 of 100 and
  warns that the next HTTP spec is roughly where it stops fitting. When that
  budget is revisited, spend it first on the owner-only routes of a money-moving
  table (`POST /transfers`, `resolve`, `void`).

- **The dev seed is not idempotent across days.** Keyed on
  `(point, business_date)`, it inserts today's shift without noticing yesterday's
  is still open, and collides with `UQ_shifts_open_per_point`. This is what made
  `dev-seed.db-spec.ts` fail on any `app_test` carrying a previous day's run —
  both reviewers hit it and both correctly diagnosed it as pre-existing rather
  than a branch regression. Recreating `app_test` clears it, and the suite is
  green after that, so this is latent rather than blocking. The seed should
  either close a stale open shift or adopt the one it finds.

- **Production DI signatures are shaped by positional test construction.**
  `transfers.service.ts:58-74` documents two constructor parameters as
  appended-not-inserted «because `transfers.service.spec.ts` constructs this
  service POSITIONALLY in four blocks; a new argument in the middle would
  silently re-bind `audit` to a clock». The hazard is real and the constraint is
  a property of the test, not of Nest. A `buildTransfersService({ … })` helper,
  or `Test.createTestingModule` with overrides, retires it and lets the
  constructor be ordered for readers. `shifts.service.spec.ts` and
  `shift-close.db-spec.ts` have the same shape.

### Smaller, and only worth doing when the file is open anyway

- **`GET /point-cash/:pointId` answers 403 where its siblings answer 404**, and
  returns `{"cash":"0.00"}` for a point id that does not exist. It also takes
  `ListPointCashQueryDto`, so a detail route accepts and silently ignores
  `page`, `limit` and a second `collection_point_id`. The transfers spec §5
  states the 404 convention in as many words.

- **The cash expression has two hand-maintained copies** inside
  `point-cash.service.ts` — `:210-215` for the single read and `:311-316`
  correlated per row for the list — behind a comment promising the list «cannot
  grow a formula of its own». A `cashSql(point, asOf, tz)` builder alongside the
  three that already exist would close it; the file's own style has the seam.

- **`cash_counts` is registered in two modules and written from the one that
  does not own it.** `ShiftsService` calls `m.save(CashCount, …)` directly and
  both modules `forFeature([CashCount])`. The behaviour is right — a count that
  can be written alone can be skipped — but a `CashCountsService.record(m, …)`
  write seam taking the caller's `EntityManager` would express that without the
  duplicate registration, and would give the reopen demotion an audit entry that
  the next writer cannot forget.

- **The reopen demotion is the one place this codebase mutates a posted row,
  and the audit entry does not say so.** `shifts.service.ts` rewrites a closing
  count's `kind` to `midday`; the `shift.reopened` entry carries the shift's
  `closed_at` and `status` and never names the count row or the transition.
  `m.update`'s `affected` is discarded, so how many rows moved is unrecoverable.

- **`ShiftsService.close` absorbs a missing opening count into a fake zero
  discrepancy.** `expectedForClosing(...) ?? dto.counted_amount` — the method's
  own doc calls `null` «a signal that something wrote a shift without going
  through `open`», but it is not a signal, it is silence: `expected = counted`,
  `d = 0`, and any real drift on that shift leaves `Σ (counted − expected)`
  forever. A `409 SHIFT_HAS_NO_OPENING_COUNT` is the honest answer. **This only
  became safe to add once the seed started writing counts (done on this
  branch)** — before that it would have refused every seeded shift.

- **`ShiftsService` still injects `CollectionPointsService` and never calls
  it** (already recorded above; re-confirmed by both reviewers).

- **`open` reads the clock twice** — `business_date` and `counted_at` come from
  separate `this.time.now()` calls, so a shift opened at 23:59:59.9 can take
  `business_date = N` with `counted_at = N+1`. `transfers.service.spec.ts:177`
  asserts the single-read discipline for `accepted_at`/`accepted_date`; `open`
  does not follow it. `close` now reads once, after the lock.

- **`setExplanation` writes its row and its audit entry outside any
  transaction**, unlike every other verb on `shifts`.

- **`SetExplanationDto` refuses a blank string, so there is no un-explain
  path.** An owner who explains the wrong shift cannot reopen the incident,
  since `is_open` keys on a non-empty `explanation`.

- **The reopen demotion does not filter `book`**, so it will demote the crates
  closing count too once that book exists. Probably intended; nothing says so.
