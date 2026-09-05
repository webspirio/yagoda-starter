# Yagoda foundation slice — known follow-ups

Everything below was found during the eight-task build of
`docs/superpowers/plans/2026-09-04-yagoda-foundation-slice.md`, judged, and
deliberately deferred. None of it blocks the merge. Recorded here because the
build workspace is discarded and a finding nobody wrote down is a finding
nobody fixes.

Ordered by when it starts to matter, not by severity.

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

- **`include_inactive` accepts values it then ignores.** `@IsBooleanString()`
  passes `'1'`, `'0'`, `'TRUE'`; the services test `=== 'true'`. So
  `?include_inactive=1` is accepted and silently means "false". Both list DTOs.
- **Field diffing is hand-rolled in four places** now
  (`CollectionPointsService.update`, `UserAdminService.update`,
  `CurrentUserService.updateMe`, and the target-diff block). A
  `diffFields(before, after, keys)` helper is overdue.
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
