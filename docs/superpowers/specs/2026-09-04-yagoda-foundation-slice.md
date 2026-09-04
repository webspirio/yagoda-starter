# Yagoda CRM — Foundation Slice Spec

**Date:** 2026-09-04
**Source:** `28-db-schema.dbml` (the schema of record) plus the decisions taken in the
`/grilling` session of 2026-09-04. Where the two disagree, this document says so explicitly.

**Status of the wider schema:** `28-db-schema.dbml` describes 17 tables and 8 enums. This
slice implements **two tables' worth of it** (`users` reshaped, `collection_points` new) and
nothing else. The money documents — `intakes`, `payouts`, `crate_*`, `cash_counts`,
`transfers`, `grade_prices`, `shifts`, `suppliers`, `products`, `product_grades`,
`tare_types` — are deliberately out of scope and get no entity, no table and no module here.

**Documents we do not have:** every `§N` reference in the DBML points at
`26-rules-by-example.md`, and every "правка N" at `26-правки-і-запитання.md`. Neither file is
in this repository, nor are `27-entities.dbml`, `28-tables.md`, or the prototype containing
`PointCashPage.tsx` / `AppConfig.cashBookFrom`. Every rule cited below was read from the
quotations inside the DBML's own `Note` blocks. If the source documents say something the
Notes do not quote, this spec has not seen it.

---

## 1. Goal

Establish the identity, authorization and network-topology substrate that every later Yagoda
module depends on: who the users are, what role they hold, which collection point they belong
to, and what a collection point is. Nothing in the schema can be built correctly before this
exists, because every table carries a `*_by_user_id` and almost every one is scoped to a point.

## 2. Scope

**In:**

- `users` reshaped: `first_name`, `last_name`, `role`, `collection_point_id`; `display_name` dropped.
- Real password hashing (scrypt), replacing the starter's plain-text placeholder.
- Public self-registration removed; owner-administered user management in its place.
- `collection_points` table and module, including the nullable targets and their rules.
- Role-aware route protection and point-scope assertions.
- Frontend repair only — enough that the app builds, logs in and runs.

**Out:**

- Every other table in `28-db-schema.dbml`.
- Any owner-facing admin UI (users list, points list, target editing screens).
- `decimal.js` and the shared money module: this slice stores and returns `numeric` values but
  performs no arithmetic on any of them, so the dependency is deferred to the first module
  that actually computes something. The *representation* rule (§5.1) applies from now on.

---

## 3. Identity model

### 3.1 The three-table seam is kept

The DBML draws `users` flat, carrying `login [unique]` and `password_hash` directly. The
starter instead splits identity across `users` (profile) + `user_identities`
(`provider`/`provider_user_id`, `UNIQUE`, the single login lookup path) + `user_credentials`
(the secret, isolated so no query that reads a user can serialize it).

**Decision: keep the seam.** `login` is `user_identities.provider_user_id` with
`provider = 'local'`; `password_hash` is `user_credentials.password` renamed. Uniqueness and
semantics are identical. The DBML's flat drawing is a layout convention — it argues at length
about column *names* and never once about this decomposition.

### 3.2 Passwords

The starter stores passwords in plain text as a recorded placeholder. The DBML names its
column `password_hash` precisely to say the opposite; its `users` Note calls the name "the
only place the schema says a hash must be stored". This slice ends the placeholder.

- Algorithm: `scrypt` from `node:crypto` (no new dependency), N=2^15, r=8, p=1, 64-byte key.
- Salt: 16 random bytes per credential.
- Stored form: `scrypt$<N>$<r>$<p>$<salt-base64>$<hash-base64>` — self-describing, so
  parameters can be raised later without a second column or a migration.
- Comparison: `timingSafeEqual`.
- `CredentialsService.set()` / `.verify()` remain the only two functions that touch a password.

**Lifecycle: the owner issues and reissues every password. There is no self-service.**
`PUT /users/:id/password` is `network_owner`-only and does not require the old password (the
owner is issuing, not changing). `/me` gets no password endpoint at all.

The rationale is the DBML's own: the `users` Note cites §17.2 — «пароль, який звіряють на
самій точці, не підтверджує нічого» — a password typed at the point, where the owner is not
standing, is an access control rather than a signature. Operators may have no email address
(the stated reason `login` exists instead of one), so there is no recovery channel but the
owner. The accepted consequence: **the owner knows every live password.**

### 3.3 No public registration

`POST /auth/register` is deleted. A self-registered account would need a `role` and a
`collection_point_id` and there is no safe default for either — `point_operator` with no point
violates the coherence constraint in §5.4, and any point assignment hands a stranger that
point's data.

Accounts are created by the owner: `POST /users`, writing user + identity + credentials +
role + point in one transaction. `POST /auth/login` becomes the only public route.

**Bootstrap:** a migration creates the first `network_owner` from `BOOTSTRAP_OWNER_LOGIN`,
`BOOTSTRAP_OWNER_PASSWORD`, `BOOTSTRAP_OWNER_FIRST_NAME`, `BOOTSTRAP_OWNER_LAST_NAME`, and
**no-ops unless the `users` table is empty**. `SeedDevAdmin` continues to cover development.

> **Known sharp edge, accepted:** a migration runs once. If a production database is first
> booted without those variables set, the migration records itself as applied and no owner is
> ever created; recovery is a manual `INSERT`. A boot-time idempotent bootstrap would not have
> this property. This was decided as a migration and is recorded here so the trade-off is
> visible rather than discovered.

### 3.4 Role and point reach the request from the database, not the token

`JwtStrategy.validate()` currently re-emits the JWT payload and never queries the database.
That is acceptable for a display name and unacceptable for `role`, `collection_point_id` and
`is_active`:

- a demoted operator would keep owner powers until the token expires (7 days);
- a reassigned operator would keep writing to their old point;
- a dismissed operator — someone who handles cash — would keep a working token for a week.

**Decision:** `validate()` loads the user on every request and returns
`{ sub, username, role, collection_point_id }`, rejecting a missing or inactive user. The JWT
payload shrinks to `{ sub }` alone, so nothing in it can go stale. The cost is one indexed
primary-key lookup per authenticated request, against a database holding a handful of users.

This is the upgrade path the root `CLAUDE.md` already names ("Revoking a live token means
checking the user in `JwtStrategy.validate()`, at the cost of a database query per
authenticated request"). This domain is the requirement that justifies paying it.

---

## 4. Authorization

### 4.1 Two mechanisms, one boundary between them

Some rules are role-shaped and decidable from the request alone; others need to read a row.

- **Role-only → the decorator.** `@Auth()` grows an optional role list:
  `@Auth(UserRole.NetworkOwner)`, backed by a `RolesGuard`. It stays the single route-level
  gate the starter promises, so "what protects this route" has one answer.
  Covers §10.2 (only the owner changes a target) and §9.4 (only the owner voids).
- **Anything reading a row → a named `assert*` service method** throwing `ForbiddenException`,
  unit-testable without HTTP.
  Covers §7.7 (the operator closes a shift, but a discrepancy makes it the owner's job),
  §7.9 (only the owning point may accept a transfer) and §6.2 (the screen asks again but does
  not block). None of those is in this slice; the seam is established here for them.

### 4.2 Point scope is derived, never accepted

An operator's request body carries no `collection_point_id` — there is nothing to forge. The
point comes from the actor, or from the shift the document references. `assertOwnsPoint(actor,
pointId)` and a shared list-scoping helper are the only two places the rule lives.

Postgres row-level security was considered and rejected: it fights TypeORM's connection
pooling (`SET LOCAL` inside every request transaction), complicates the migration and db-spec
harness, and moves authorization out of the TypeScript a reviewer reads.

### 4.3 Route shape

Flat resources, implicit scope. `/suppliers`, `/shifts`, `/collection-points` — no point id in
the path. Operators are silently scoped to their own point; owners may narrow with
`?collection_point_id=`, which is **ignored** for an operator. Nesting under
`/collection-points/:pointId/…` was rejected because it puts the security-critical id in a
client-controlled position that every controller then has to re-validate.

---

## 5. Data conventions

These bind every later module, not just this slice.

### 5.1 Money and weight

`numeric` columns are `string` end to end — database, entity, DTO, JSON. TypeORM already
returns `numeric` as a string; that default is correct and must not be "fixed" with a
number-converting transformer.

All arithmetic goes through a `decimal.js`-backed money module with an explicit rounding
policy (half-up, 2 decimals, applied where paper shows a number). **No arithmetic operator is
ever applied to a monetary or weight value.** The schema forbids stored derived sums, so
Postgres aggregates exactly; but the application still computes `net = (gross − pallet) −
tare`, `amount = net × (price + bonus)`, `deposit = units × per_unit`, and the payout ceiling
`min(Разом, каса)`. The tolerance for error is stated outright: «не зійшлося на копійку — те
саме, що на 350 ₴». Binary floating point manufactures exactly those discrepancies, and a
wrong `intakes.amount` is frozen forever by §2.7 and printed on the supplier's receipt.

Integer kopiykas were rejected: they contradict the DBML's `numeric(12,2)` convention and
invalidate the SQL formulas written into the `suppliers` and `cash_counts` Notes.

### 5.2 Time

`timestamptz` for every instant; `date` for `business_date`; `APP_TIMEZONE=Europe/Kyiv`. The
DBML writes bare `timestamp` throughout, but that is a diagram default — it never argues about
time zones, the starter is already inconsistent (`users` uses `TIMESTAMP`, `audit_log` uses
`TIMESTAMP WITH TIME ZONE`), and `TimeService` already documents "storage stays UTC
(`timestamptz`)". `APP_TIMEZONE` currently defaults to `UTC`, which is wrong by 2–3 hours for
this business and would misfile any document created late in the evening.

`business_date` is **server-derived and never editable** — today's date in the app zone,
computed at write time, absent from every request body. It is the join key for the daily price
(§2.8's day + point + grade), the cash-book boundary, and the unique key of a working day. It
is written by two actors at two times (the owner sets prices at 07:10, the operator opens the
shift at 07:30 — which is exactly why `grade_prices` has no `shift_id`), and if they disagree
the intake screen shows no prices at all (§4.5). No backdating path exists; if one is ever
needed it is a deliberate, owner-only, audited feature, not a date field on a form.

### 5.3 Enums

Native Postgres enum types for all eight, consistent with the existing `media_purpose`. Each
is a closed domain of two or three values that the DBML argues for explicitly — unlike
`AUDIT_ACTIONS`, which is an open registry and correctly stays a `varchar` + TS union.

This matters most for `cash_book` and `cash_count_kind`, which are structure rather than
labels: a typo'd `'berries'` in a `varchar` column silently creates a third cash book that no
query sums, and a misspelled `'closing'` slips past the `WHERE kind <> 'midday'` partial index
instead of violating it. This slice creates `user_role` and `point_kind`.

### 5.4 Constraints

Written as `CHECK` wherever it is mechanically safe:

- `void_*` trio completeness (all three NULL or all three NOT NULL) on every voidable table —
  §9.3 makes the reason mandatory. *(No voidable table exists in this slice.)*
- `role` ↔ `collection_point_id` coherence: `point_operator` ⇒ point NOT NULL;
  `network_owner` ⇒ point NULL.
- Receipt mode carries no money: `mode='receipt'` ⇒ `deposit_* = 0`; `mode='deposit'` ⇒
  `receipt_no IS NULL`. *(Not in this slice.)*
- Sign and range: `units > 0`, weights `> 0`, amounts `>= 0`.

**Deliberately excluded:**

- The `transfers` state-coherence CHECK. Its own Note forbids it: an "ІНВАРІАНТ ЗАСТОСУНКУ,
  якого схема не перевіряє… CHECK під це не написаний навмисно, бо стан документа міняється
  в часі".
- Any equality CHECK on computed money (`amount = net × (price + bonus)`). Stored values are
  rounded to two decimals, so an exact-arithmetic check rejects legitimate rows; loosening it
  to a tolerance would be the «допустима розбіжність» the schema refuses.

Two constraints in the wider schema cannot be expressed in DBML and must be hand-written; the
DBML's index blocks are placeholders for them, not transcriptions:

- `shifts`: `UNIQUE (collection_point_id) WHERE closed_at IS NULL` — the DBML literally says
  `(collection_point_id) [unique]`, which would forbid a point from ever having a second shift.
- `cash_counts`: `UNIQUE (shift_id, book, kind) WHERE kind <> 'midday'`.

And one relies on Postgres NULL semantics: `suppliers (collection_point_id, phone) UNIQUE`
works only because NULLs do not collide, which is what lets any number of phone-less suppliers
coexist at one point (§5.7 + правка 8). PG15's `NULLS NOT DISTINCT` must **not** be used there.

### 5.5 Deletion

`ON DELETE RESTRICT` on every reference; `CASCADE` only on the three composition children
(`intake_items`, `intake_item_tare_types`, `crate_return_allocations`), which are parts of a
document and meaningless alone. **No `DELETE` route anywhere in the API** — deactivation is the
only removal verb the domain has (§5.6 «видалення немає, тільки `is_active`»; §9.3 a voided
document «лишається в журналі назавжди»).

Consequence, accepted: a user who has ever touched anything is permanently undeletable. That
is correct — deleting them would erase who received the berries.

Related rough edge, left alone: `products` has no `is_active` by explicit decision (visibility
is *derived* — a product with no active grade is not shown, §4.1, with Кизил as the worked
example). A mistyped product is therefore already invisible to operators but clutters the
owner's own list forever. Smuggling `is_active` back in would contradict a decision the DBML
argues for at length.

### 5.6 Responses

Controllers return explicit response interfaces produced by pure mappers, following the
existing `MeResponse` / `toResponse()` precedent and the `nest-module-conventions` skill.
Returning entities was rejected: the wire format would become a side effect of entity
definitions and TypeORM relation loading, money's string representation would be accidental
rather than contractual, and an eagerly- or accidentally-loaded relation would hand a caller
rows from a table they have no business seeing.

---

## 6. Domain rules for this slice

### 6.1 `collection_points`

- `kind` (`reception` | `base`) — §4.8: a warehouse is an ordinary point with its own, higher
  price that the "set for everyone" gesture does not touch; §8.1: re-weighing happens at the
  base, and the document distinguishes the point the berries came *from* from the base they
  were weighed *at*. Editable by the owner and audited: a point genuinely can be promoted.
- `target_cash numeric(12,2)` and `target_crates int` — **nullable with no default, on
  purpose.** §6.9 requires "—" for a point with no target rather than zero («нуль стверджував
  би, що ящиків немає, тоді як ми просто не знаємо, скільки їх має бути»), and §7.10 requires
  that a point with no cash target not appear in the network-debt table at all. `default: 0`
  would make "not set" indistinguishable from zero and break both.
- A target **below** what is already out with people is allowed **with a warning, not a
  refusal** (§6.1) — a target is a management decision.
- An unset `target_crates` does **not** block issuing crates; it shows a warning (правка 14,
  which overrides §9.1's "the issue button is inactive").
- Only the owner changes a target (§10.2) — and for an operator the control **does not exist**
  rather than appearing disabled: «заблокована кнопка вчить шукати обхід, відсутня не вчить
  нічого». That is a UI rule this slice records but does not implement (no admin UI here).
- Targets carry **no history and no `effective_from`**, by the owner's decision of 03.09.2026:
  «наділ це лише показник, на який клієнт орієнтується всередині дня… а наділ — орієнтир». A
  target is not a fact about the past. Consequence, accepted: changing one applies to every
  day including past ones.
- `name` is **UNIQUE** — *an addition this spec makes; the DBML does not specify it.* The DBML
  marks `products.name` and `tare_types.name` unique explicitly and is silent here, with no
  Note defending the silence, so this reads as an oversight rather than an argument. Two points
  both called "Копайгород" would be a live hazard on the transfer screen, where a mistaken
  transfer is real money in dispute. Flagged in a code comment so the next reader knows it did
  not come from the schema.
- Deactivation returns `409` while any **active user** is assigned, naming them. A future guard
  must also refuse while an open shift exists; `shifts` does not exist yet, so that check is a
  named seam, not a silent omission.

### 6.2 `users`

Final column set: `id`, `first_name`, `last_name`, `avatar_url`, `language_code`, `role`,
`collection_point_id`, `is_active`, `created_at`, `updated_at`.

- `display_name` is **dropped**. Keeping it alongside `first_name`/`last_name` is two copies of
  one fact, which the DBML's Notes forbid on nearly every page. It is **derived in the response
  mapper**, so `GET /me` and the frontend's `Me` type keep working unchanged.
- Consequently `UpdateMeDto` loses `display_name`: an operator does not rename themselves; the
  owner names staff via `PATCH /users/:id`.
- `avatar_url` / `language_code` are kept. The DBML does not model them, but they duplicate
  nothing and the media, profile and i18n plumbing already work.
- `is_active` is kept although the DBML omits it. Its absence there reads as an oversight —
  every other people-shaped table has one, and the `suppliers` Note says «видалення немає,
  тільки is_active». §3.4 above now depends on it for revocation.
- `login` is **editable** by the owner (normalized, unique, audited). Users can never be
  deleted, so a login typed wrong at creation would otherwise be permanent — and the person
  types it every morning.
- **Lockout guards:** refuse any change that would leave zero active `network_owner`s; refuse
  self-demotion and self-deactivation outright, even when another owner exists. With
  registration removed and the bootstrap migration no-oping unless `users` is empty, there is
  no recovery from lockout short of direct database access — and no other owner to call, since
  passwords are owner-issued (§3.2).
- Role and point change **in one statement**, so the coherence CHECK cannot be transiently
  violated: promoting to owner clears the point, demoting to operator requires one.
- Point reassignment takes effect **immediately**, because `validate()` reads the row every
  request. An operator mid-session simply starts seeing the other point.

### 6.3 Audit

The administrative surface is audited; documents are not. Documents already carry their author
and void reason **in the row**, so auditing them would be a second copy of a fact.

Audited here, as five actions rather than a dozen:

- `user.created`, `user.password-changed` (a *fact* — never the value, no `before`/`after`)
- `user.updated` — one action for every field change on a user (login, names, role, home point,
  `is_active`), with `before`/`after` naming exactly the fields that moved. Six separate actions
  would have to be kept in step with each other and carry no information the payload does not.
- `point.created`, `point.updated`, `point.target-changed`

A no-op write records nothing: a log full of empty entries is one nobody reads.

`point.target-changed` carries `before`, `after` and the reason as `note`. This deliberately
recovers something the DBML declares lost:

> «разом із таблицями зникли АВТОР І ПРИЧИНА зміни цільового значення, які §6.1 показує у
> своєму ж прикладі («15.07.2026 цільове значення 600 → 800, керівник, причина: розширили
> точку»). `set_by_user_id` і `reason` жили в `cash_floats`/`crate_allotments` і більше не
> існують ніде: хто підняв наділ і чому — у схемі не зберігається.»

**Read carefully:** the Note frames this as a *consequence of the owner's decision*, not an
oversight. Logging the change does not reintroduce `effective_from` and does not touch any
calculation — "не вистачає до цільового" for a past date still uses the current number,
exactly as decided. The reading taken here is that the owner rejected *target history as
computed state*, not *a record of who pressed the button*. If that reading is wrong, remove
the `note`/`before`/`after` payload; nothing else depends on it.

---

## 7. Frontend

**Repair only.** Enough that the application builds, logs in and runs; no admin UI.

- Delete `pages/register/`, `features/auth/ui/RegisterForm.tsx`, its tests, the `/register`
  route, `authApi.register`, and the "Don't have an account?" link on `LoginForm`.
- `Me` gains `role` and `collection_point_id`; `display_name` remains in the response but is
  now **server-derived and read-only**.
- `ProfilePage` loses the display-name form; it keeps the avatar upload and shows identity
  read-only.
- `useUpdateMeMutation` narrows to `{ language_code?: string }` and is left in place though
  currently unconsumed — the same treatment `shared/lib/form-draft` and `shared/lib/url-state`
  already get, and it remains the documented TanStack mutation exemplar.

Deferred with the admin UI: users list with create/edit/deactivate/reset-password, points list
with targets rendered as "—" when unset, role-conditional navigation, and the §10.2 rule that
the target control is *absent* rather than disabled for an operator. That last one is a rule
the API cannot express and deserves its own design conversation.

---

## 8. Testing

Test-driven, both suites, per the project's stated workflow.

- `*.spec.ts` (`npm test`, everything mocked): the hashing module, `CredentialsService`,
  `RolesGuard`, `assertOwnsPoint`, the lockout guards, both mappers, both services.
- `*.db-spec.ts` (`npm run test:db`, real Postgres, serial, migrations applied): everything
  that exists **only** in hand-written SQL — the `role`↔point CHECK, `UNIQUE
  (collection_points.name)`, the target range CHECKs, the `RESTRICT` on
  `users.collection_point_id`, the column rename, and the enum types. A mocked spec cannot see
  any of it, and a typo in a `CHECK` expression would pass `npm test` completely.
- Extend `pipeline.db-spec.ts`: an operator's token gets `403` on an owner-only route, and a
  deactivated user's **already-issued** token stops working. That second test is the only proof
  that §3.4 actually took effect — get it wrong and revocation silently does not happen, and
  nothing else in the suite notices.
