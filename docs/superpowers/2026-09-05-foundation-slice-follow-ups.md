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

## New, from the verify layer (2026-09-10)

Task 20 of `docs/superpowers/sdd/2026-09-10-verify-layer/` rebuilt
`.github/workflows/ci.yml` around `scripts/verify/registry.mjs` — one `verify`
job running `npm run verify:ci`, the exact command a laptop runs. One
follow-up is required by that rebuild itself; the other four are unrelated
findings the layer surfaced while it was being built and verified, all out of
scope for this task, recorded here so they are not lost.

- **The required status check must be renamed in repository settings —
  `checks`/`db-checks`/`docker` → `verify`.** The old workflow's three jobs no
  longer exist; any branch-protection rule still naming them as required
  guards a PR against a context that can never report again, which is
  equivalent to no required check at all. Cheap once someone with admin rights
  runs it:

  ```bash
  gh api repos/webspirio/yagoda-starter/branches/main/protection/required_status_checks \
    --method PATCH \
    -f strict=true \
    -f 'contexts[]=verify'
  ```

  This needs **admin rights on the repository** (classic branch protection is
  an admin-only write). It could not be verified end-to-end from this task:
  `gh api repos/webspirio/yagoda-starter/branches/main/protection` currently
  returns `403 Upgrade to GitHub Pro or make this repository public to enable
  this feature` — this private repo's current plan does not expose branch
  protection (or the newer rulesets API: `gh api
  repos/webspirio/yagoda-starter/rulesets` returns the identical 403) at all
  today, to any token. Whoever runs the rename should confirm first (`gh api
  repos/webspirio/yagoda-starter/branches/main/protection` returning something
  other than that 403) that a required check exists to rename; if the plan
  still blocks it, there is nothing to rename yet, and the `verify` job simply
  is not a required check until branch protection becomes available and one is
  configured, naming `verify` from the start.

- **`backend/src/seed/dev-seed.ts` reimplements `money.ts`'s `add()` with a
  private `addMoney()`/`toCents()` pair built on `Number()`, and writes the
  result into real `grade_prices.base_price` values.** The root `CLAUDE.md` is
  unqualified: "every arithmetic operation on a `numeric` value goes through
  `backend/src/common/money.ts`" — no seed-script carve-out. `ratchet:money`
  (`scripts/verify/checks/ratchets/money-rounding.mjs` — see
  `scripts/verify/registry.mjs`'s `ratchet:money` entry) already finds and
  baselines this exact site (3 of the baseline's 29 keys), so it is a KNOWN,
  tracked deviation, not a silent one — but it is still a real duplicate of the
  one authorised rounding seam, in a script whose output lands in a real
  table. Not cheap to fix blind: `dev-seed.ts` is intentionally decoupled from
  `backend/src` (the `seam` check's rule 2 treats any import from `seed/` into
  the rest of `backend/src` as a finding, precisely so the seed stays a
  standalone CLI), so pulling in the real `add()` needs either lifting
  `money.ts` outside that boundary or accepting a documented, reviewed
  exception to it — a real design decision, not a one-line swap.

- **`ms` and `express` are imported in `backend/src`
  (`auth/auth.module.ts`, `common/filters/all-exceptions.filter.ts`) but
  declared in neither `backend/package.json`'s `dependencies` nor
  `devDependencies`** — they resolve today only because `@nestjs/jwt` and
  `@nestjs/platform-express` pull them in transitively. A future bump of
  either package that drops or re-versions its own dependency on `ms`/
  `express` breaks these two backend files with no changed line in either of
  them, and `npm ls ms`/`npm ls express` already show them un-hoisted-to-root
  today. Cheap: add both as direct `dependencies` at the versions already
  resolved (`npm ls ms express` prints the exact installed versions), which
  changes nothing about behaviour, only about what is declared.

- **The dev seed is NOT idempotent across calendar days, though
  `backend/CLAUDE.md`'s "Dev seed" section states it is idempotent with no
  qualification.** `dev-seed.ts` opens a fresh shift per point for "today"
  (`business_date` = the literal current date) but never closes yesterday's;
  shifts are keyed `(point, business_date)` under
  `UQ_shifts_open_per_point`. A `db:seed` run today, followed by a second one
  tomorrow with yesterday's shift still open, collides on that constraint
  instead of no-opping. `e2e/global-setup.ts` already works around exactly
  this (it closes any shift still open from a previous day, in Postgres,
  before calling `db:seed` — see that file and the `smoke` row's registry
  entry) — the fix that file applies at the point of use should move into
  `dev-seed.ts` itself so every caller gets it, and `backend/CLAUDE.md`'s
  claim should gain the qualification ("idempotent within one calendar day")
  until it does. Cheap to document, a real design decision to fix at the
  source (does the seed close yesterday's shift itself, or refuse to run
  against one).

- **`docker-compose.yml` hardcodes `name: web-starter`, so the Compose project
  is shared across every git worktree of this repo AND the main checkout.** A
  bare `docker compose down` (with or without `-v`) run from ANY of them tears
  down the one shared `postgres`/`redis`/`backend`/`frontend` set of
  containers — including this task's own `docker compose up -d --wait postgres
  redis` step, run from inside a worktree. `-v` additionally destroys the
  shared `pg_data`/`uploads_dev` volumes, which is real data loss for whoever
  owns the main checkout's dev database. Every command this task and the
  `smoke` row run against Compose is deliberately `up`/`stop`, never `down`,
  for exactly this reason — but that discipline lives in doc comments and task
  instructions, not in anything Compose itself enforces. Cheap fix: a
  worktree-aware project name (e.g. `COMPOSE_PROJECT_NAME` derived from the
  worktree path, or `docker compose -p "web-starter-$(git rev-parse
  --show-toplevel | xargs basename)"`) or, at minimum, a comment on the `name:`
  line itself warning that `down`/`down -v` here affects every worktree, not
  just the one it's run from.
