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

- **The db suite now exceeds the production rate limit on its own.** Every
  request in an HTTP spec comes from 127.0.0.1, so one run looks like a single
  abusive client; the documents pipeline pushed the total past 100 req/min and
  the failure appeared as scattered 429s in unrelated specs.
  `relaxThrottleForTests()` raises `THROTTLE_LIMIT` for the test process only.
  Worth revisiting if CI ever runs the suites in parallel against one Redis —
  the counter is shared, so two concurrent runs would re-create the problem at
  a higher number.
