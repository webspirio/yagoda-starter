# Yagoda Foundation Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the web-starter's generic identity layer into Yagoda CRM's foundation — hashed passwords, owner-administered accounts with roles and a home collection point, and the `collection_points` table itself — so every later module has a user, a role and a point to scope against.

**Architecture:** The starter's three-table identity seam (`users` + `user_identities` + `user_credentials`) is kept, not flattened to the DBML's drawing. `users` gains `first_name`, `last_name`, `role` and `collection_point_id` and loses `display_name` (derived in the response mapper). Public registration is deleted; the owner creates accounts. `JwtStrategy.validate()` starts reading the user row on every request, which is what makes role changes, point reassignment and deactivation take effect immediately. Authorization splits in two: `@Auth(UserRole.NetworkOwner)` for role-only route gates, and named `assert*` service methods for anything that has to read a row. `users` stays a domain module with no controller; a new `user-admin` operations module owns `/users`, mirroring how `current-user` already owns `/me`.

**Tech Stack:** NestJS 11 (Express), TypeORM 1.x + PostgreSQL 16, passport-jwt, class-validator, Jest (two configs: mocked `*.spec.ts` and Postgres-backed `*.db-spec.ts`), `node:crypto` scrypt (no new dependency). Frontend: React 19, Vite, TanStack Query v5, react-router v8, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-yagoda-foundation-slice.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Strict TypeScript.** `"strict": true`. No `@ts-ignore`, no `as any`. The one sanctioned `as any` in the repo is the two jsonb casts in `AuditService.record`; do not add more.
- **snake_case columns everywhere.** Any `@ManyToOne` needs an explicit `@JoinColumn({ name: '…' })` or TypeORM's naming strategy emits a quoted camelCase column.
- **`numeric` columns are `string` in TypeScript** — database, entity, DTO and JSON. Never add a number-converting transformer. No arithmetic on a money or weight value in this slice (there is none to do); `decimal.js` is deliberately not a dependency yet.
- **`timestamptz` for every instant.** New tables use `TIMESTAMP WITH TIME ZONE`.
- **Native Postgres enum types**, matching the existing `media_purpose` precedent. This slice creates `user_role` and `point_kind`.
- **`ON DELETE RESTRICT` on every foreign key** added here. No `DELETE` route on any controller — deactivation is the only removal verb.
- **`@Auth()` (with or without roles) is the only route-level protection mechanism.** Never `@UseGuards(...)` inline in a controller.
- **Migrations are hand-written**, in the commented style of `1788600000000-InitialSchema.ts`. Do not run `migration:generate` for this work.
- **TDD.** Every step block below is ordered test-first. Run the test and see it fail before writing the implementation.
- **Commit at the end of every task**, with the `git add` limited to the files that task touched.
- Backend commands run from `backend/`; frontend commands from `frontend/`.
- `npm run test:db` needs the throwaway database once: `docker compose exec postgres createdb -U app app_test`.

---

## File Structure

**Backend — created**

| Path | Responsibility |
|---|---|
| `src/users/password-hashing.ts` | Pure scrypt hash/verify. No Nest, no TypeORM, no I/O. |
| `src/users/password-hashing.spec.ts` | Its unit spec. |
| `src/users/user-role.enum.ts` | `UserRole` TS enum, mirroring the `user_role` PG type. |
| `src/collection-points/point-kind.enum.ts` | `PointKind` TS enum, mirroring `point_kind`. |
| `src/collection-points/collection-point.entity.ts` | The `collection_points` row. |
| `src/collection-points/collection-points.module.ts` | Domain + operations in one module (no external writers). |
| `src/collection-points/collection-points.service.ts` | Reads, writes, deactivation guard, audit. |
| `src/collection-points/collection-points.controller.ts` | `/collection-points`. |
| `src/collection-points/collection-point.mapper.ts` | `CollectionPointResponse` + `toCollectionPointResponse`. |
| `src/collection-points/dto/create-collection-point.dto.ts` | |
| `src/collection-points/dto/update-collection-point.dto.ts` | |
| `src/auth/guards/roles.guard.ts` | Reads `@Auth()`'s role metadata off the handler. |
| `src/auth/access/point-scope.ts` | `assertOwnsPoint`, `resolvePointFilter`. |
| `src/user-admin/user-admin.module.ts` | Operations module over the `users` domain. |
| `src/user-admin/user-admin.service.ts` | Create/update/deactivate/set-password + all guards. |
| `src/user-admin/users.controller.ts` | `/users`, owner-only. |
| `src/user-admin/user.mapper.ts` | `UserResponse` + `toUserResponse` (derives `display_name`). |
| `src/user-admin/dto/create-user.dto.ts`, `update-user.dto.ts`, `set-password.dto.ts` | |
| `src/migrations/1788600000002-YagodaFoundation.ts` | The whole schema change, hand-written. |
| `src/migrations/1788600000003-BootstrapOwner.ts` | First `network_owner` from env, no-op unless `users` is empty. |

**Backend — modified**

| Path | Change |
|---|---|
| `src/users/user.entity.ts` | +`first_name`, +`last_name`, +`role`, +`collection_point_id`, −`display_name`; `timestamptz`; role↔point `@Check`. |
| `src/users/user-credentials.entity.ts` | `password` → `password_hash`; the plain-text warning replaced by the scrypt contract. |
| `src/users/credentials.service.ts` | Delegates to `password-hashing.ts`. |
| `src/users/users.service.ts` | New create input; widened `update`; `findAuthContext`, `countActiveOwners`, `list`, `setLogin`. |
| `src/users/users.module.ts` | Nothing new to register (entities unchanged in count). |
| `src/auth/jwt.strategy.ts` | `validate()` becomes an async DB lookup; `AuthenticatedUser` reshaped. |
| `src/auth/auth.service.ts` | `register()` deleted; token payload narrows to `{ sub }`. |
| `src/auth/auth.controller.ts` | `POST /auth/register` deleted. |
| `src/auth/decorators/auth.decorators.ts` | `@Auth(...roles)`. |
| `src/current-user/current-user.service.ts` | `MeResponse` gains `role`/`collection_point_id`; `display_name` derived. |
| `src/current-user/dto/update-me.dto.ts` | `display_name` removed. |
| `src/audit/audit-log.entity.ts` | Domain actions added to `AUDIT_ACTIONS`. |
| `src/app.module.ts` | `CollectionPointsModule` + `UserAdminModule` imported; Joi gains the bootstrap vars; `APP_TIMEZONE` default. |
| `src/config/timezone.config.ts` | Default `Europe/Kyiv`. |
| `src/migrations/schema.db-spec.ts` | Existing raw inserts updated for the new columns; new constraint assertions. |
| `src/testing/pipeline.db-spec.ts` | No longer registers; adds the 403 and revocation tests. |

**Backend — deleted:** `src/auth/dto/register.dto.ts`.

**Frontend — modified:** `src/app/router.tsx`, `src/app/router.test.tsx`, `src/app/layouts/AppLayout.tsx`, `src/features/auth/index.ts`, `src/features/auth/api/authApi.ts`, `src/features/auth/api/authApi.test.ts`, `src/features/auth/ui/LoginForm.tsx`, `src/entities/user/model/types.ts`, `src/entities/user/api/useUpdateMeMutation.ts`, `src/pages/profile/ui/ProfilePage.tsx`, `src/pages/profile/ui/ProfilePage.test.tsx`, `src/shared/lib/i18n/locales/en.json`.

**Frontend — deleted:** `src/pages/register/`, `src/features/auth/ui/RegisterForm.tsx`, `src/features/auth/ui/RegisterForm.test.tsx`.

---

## Task Order and Why

1. **Password hashing** — a pure module with no consumers. Safe to land first, nothing depends on it yet.
2. **Registration removal** — independent of the schema; deleting it first keeps the big migration task smaller.
3. **Schema + entities** — the migration, the reshaped entities, and every edit needed to make the tree compile and the suites pass again. Necessarily one atomic change.
4. **Frontend repair** — possible only after `/me` stops accepting `display_name`.
5. **Auth plumbing** — `validate()` DB lookup, `RolesGuard`, `@Auth(...roles)`, `assertOwnsPoint`. Needs `role` to exist (task 3).
6. **`collection-points` module** — the first consumer of `@Auth(UserRole.NetworkOwner)`.
7. **`user-admin` module** — needs both the roles guard (5) and the points table (6, to validate an assignment).
8. **Bootstrap owner + config + docs** — last, because it depends on the final shape of everything above.

---

### Task 1: Password hashing module

**Files:**
- Create: `backend/src/users/password-hashing.ts`
- Test: `backend/src/users/password-hashing.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hashPassword(plain: string): Promise<string>` — returns `scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>`
  - `verifyPassword(plain: string, stored: string): Promise<boolean>` — never throws; returns `false` for any malformed or unknown-format stored value
  - `SCRYPT_N: number`, `SCRYPT_R: number`, `SCRYPT_P: number`, `SCRYPT_KEYLEN: number`

- [ ] **Step 1: Write the failing test**

Create `backend/src/users/password-hashing.spec.ts`:

```ts
import { scrypt as scryptCb, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { hashPassword, verifyPassword, SCRYPT_KEYLEN } from './password-hashing';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

describe('password-hashing', () => {
  it('produces a self-describing scrypt string carrying its own parameters', async () => {
    const stored = await hashPassword('hunter2!!');
    const [scheme, n, r, p, salt, hash] = stored.split('$');

    expect(scheme).toBe('scrypt');
    expect(Number(n)).toBe(16384);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(hash, 'base64')).toHaveLength(SCRYPT_KEYLEN);
  });

  it('salts each hash, so the same password never stores the same string twice', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toEqual(b);
  });

  it('verifies the password it hashed', async () => {
    const stored = await hashPassword('correct horse');
    await expect(verifyPassword('correct horse', stored)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse');
    await expect(verifyPassword('correct horse ', stored)).resolves.toBe(false);
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false);
  });

  // The stored format carries its own cost parameters precisely so they can be
  // raised later without a migration: an OLD hash must keep verifying against
  // the NEW defaults. Without this test, raising SCRYPT_N would silently lock
  // out every existing account.
  it('verifies a hash made with different parameters than the current defaults', async () => {
    const salt = randomBytes(16);
    const weakN = 1024;
    const key = await scrypt('legacy pw', salt, SCRYPT_KEYLEN, { N: weakN, r: 8, p: 1 });
    const stored = `scrypt$${weakN}$8$1$${salt.toString('base64')}$${key.toString('base64')}`;

    await expect(verifyPassword('legacy pw', stored)).resolves.toBe(true);
    await expect(verifyPassword('other pw', stored)).resolves.toBe(false);
  });

  // A malformed row must be a failed login, never a 500. The plain-text rows
  // this replaces look exactly like this, and so does any truncated value.
  it.each([
    ['', 'empty'],
    ['admin', 'a bare plain-text password'],
    ['scrypt$16384$8$1$onlyfivefields', 'too few fields'],
    ['bcrypt$16384$8$1$c2FsdA==$aGFzaA==', 'an unknown scheme'],
    ['scrypt$notanumber$8$1$c2FsdA==$aGFzaA==', 'a non-numeric cost'],
  ])('returns false rather than throwing for %s (%s)', async (stored) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm test -- password-hashing`
Expected: FAIL — `Cannot find module './password-hashing'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/users/password-hashing.ts`:

```ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * scrypt cost parameters. Raising them is safe WITHOUT a migration: every
 * stored value carries the parameters it was created with (see the format
 * below), so old hashes keep verifying against their own cost while new ones
 * use the current defaults.
 *
 * maxmem must exceed 128 * N * r bytes (16 MiB at these values); Node's
 * default is 32 MiB, so it is passed explicitly to keep the two from drifting
 * apart the moment N is raised.
 */
export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;
const SCHEME = 'scrypt';

const maxmemFor = (n: number, r: number): number => Math.max(32 * 1024 * 1024, 256 * n * r);

/**
 * Stored form: `scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>`.
 *
 * Self-describing on purpose — the alternative (parameters implied by the
 * code that happens to be deployed) makes any future cost increase a
 * lock-out of every existing account.
 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(plain, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: maxmemFor(SCRYPT_N, SCRYPT_R),
  });
  return [
    SCHEME,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * False — never a throw — for every failure: wrong password, malformed value,
 * unknown scheme, or a row still holding a plain-text password from before
 * this module existed. A throw here would turn a bad row into a 500 and would
 * distinguish "corrupt credential" from "wrong password" to an attacker.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [scheme, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (scheme !== SCHEME) return false;

  const n = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (n <= 1 || r < 1 || p < 1) return false;

  const salt = Buffer.from(rawSalt, 'base64');
  const expected = Buffer.from(rawHash, 'base64');
  if (salt.length === 0 || expected.length === 0) return false;

  try {
    const actual = await scrypt(plain, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: maxmemFor(n, r),
    });
    // Lengths are equal by construction (keylen === expected.length), but
    // timingSafeEqual throws on a mismatch, so the guard stays.
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test -- password-hashing`
Expected: PASS, 9 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add backend/src/users/password-hashing.ts backend/src/users/password-hashing.spec.ts
git commit -m "feat(backend): add self-describing scrypt password hashing"
```

---

### Task 2: Remove public self-registration

Backend and frontend together — this is one change ("registration no longer exists"), and splitting it would leave `main` with a page that 404s on submit.

**Files:**
- Delete: `backend/src/auth/dto/register.dto.ts`, `frontend/src/pages/register/` (whole directory), `frontend/src/features/auth/ui/RegisterForm.tsx`, `frontend/src/features/auth/ui/RegisterForm.test.tsx`
- Modify: `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.controller.ts`, `backend/src/auth/auth.service.spec.ts`, `backend/src/testing/pipeline.db-spec.ts`, `backend/src/audit/audit-log.entity.ts`, `frontend/src/app/router.tsx`, `frontend/src/app/router.test.tsx`, `frontend/src/app/layouts/AppLayout.tsx`, `frontend/src/features/auth/index.ts`, `frontend/src/features/auth/api/authApi.ts`, `frontend/src/features/auth/api/authApi.test.ts`, `frontend/src/features/auth/ui/LoginForm.tsx`, `frontend/src/shared/lib/i18n/locales/en.json`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `AuthService` with only `login(dto)` and `logout(actor)`. `POST /auth/login` and `POST /auth/logout` are the only auth routes. Frontend `features/auth` exports `RequireAuth`, `LoginForm`, `login`, `logout` and the `Credentials`/`TokenResponse` types — no `register`, no `RegisterForm`.

- [ ] **Step 1: Delete the backend register tests first, and watch the suite go red**

In `backend/src/auth/auth.service.spec.ts`, delete the whole `describe('register', …)` block (both cases: "creates the user, stores credentials in the same transaction, and returns a token" and "rejects a username that is already taken, with a machine-readable code").

In the same file's `describe('password length policy', …)`, delete the case `'rejects a short password on RegisterDto'` and its `RegisterDto` import; keep `'accepts the same short password on LoginDto'` — that asymmetry is deliberate and documented in `backend/CLAUDE.md`.

In `describe('login', …)`, the case `'signs the username and profile into the token, and never the password'` asserts the old token payload. Leave it for now — Task 5 rewrites it when the payload actually changes.

Run: `npm test -- auth.service`
Expected: FAIL to compile — `RegisterDto` is still imported by `auth.service.ts` and `auth.controller.ts`.

- [ ] **Step 2: Remove registration from the backend**

Delete the file:

```bash
rm backend/src/auth/dto/register.dto.ts
```

In `backend/src/auth/auth.service.ts`: delete the `register` method entirely, drop `RegisterDto` from the imports, and drop `ConflictException` from the `@nestjs/common` import (nothing else throws one). Keep `normalizeUsername`, `login`, `logout`, `deny` and `signToken` exactly as they are. Add this note above the class:

```ts
/**
 * There is no `register` here on purpose. Accounts are created by a
 * network_owner through `POST /users` (see `user-admin/`), because a
 * self-registered account would need a `role` and a `collection_point_id`
 * and there is no safe default for either: `point_operator` with no point
 * violates the users role↔point CHECK constraint, and any point assignment
 * hands a stranger that point's data.
 */
```

In `backend/src/auth/auth.controller.ts`: delete the `@Post('register')` handler and the `RegisterDto` import. Update the class doc comment — it says "Both endpoints", which is now wrong:

```ts
/**
 * `login` is far more attractive to a brute-forcer than the rest of the API,
 * so this controller carries a tighter limit than the global 100/min: 10
 * requests per minute per IP, counted in Redis so the limit holds across
 * replicas. `logout` inherits it harmlessly — it already requires a token.
 */
```

In `backend/src/audit/audit-log.entity.ts`, keep `'user.registered'` in `AUDIT_ACTIONS` but mark it, since existing rows may still carry it:

```ts
export const AUDIT_ACTIONS = [
  // Historical: no writer since public registration was removed. Kept in the
  // union so rows written before that still type-check when read back.
  'user.registered',
  'user.logged-in',
  'user.logged-out',
  'user.updated',
  'user.avatar-changed',
] as const;
```

- [ ] **Step 3: Run the backend unit suite**

Run: `npm test`
Expected: PASS. `pipeline.db-spec.ts` is not picked up by this config (`testRegex` is `.*\.spec\.ts$`), so it is still red — Step 4 fixes it.

- [ ] **Step 4: Repoint the pipeline spec at a directly-created user**

`backend/src/testing/pipeline.db-spec.ts` currently obtains its token by POSTing to `/auth/register`. Replace that with a direct creation through the domain services the app already exposes. In the test body, replace the register block:

```ts
    const username = `pipeline-${randomUUID()}`;
    const password = 'hunter2!!';

    // Registration no longer exists as an endpoint, so the fixture user is
    // created through the same domain services `POST /users` uses. This is
    // still an end-to-end token: it is minted by the real /auth/login below.
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    await users.createWithIdentity(
      { provider: LOCAL_PROVIDER, providerUserId: username, display_name: username },
      async (created, manager) => credentials.set(created.id, password, manager),
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password })
      .expect(200);
```

and add the imports:

```ts
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
```

Delete the `registerRes` assertion block. Leave everything else — the `/me` 401, the `/me` 200 body assertion and the `forbidNonWhitelisted` 400 — untouched; Task 3 updates the body assertion when `MeResponse` changes.

- [ ] **Step 5: Run the DB suite**

Run: `npm run test:db`
Expected: PASS. If it errors with "Refusing to run db-specs against …", create the database: `docker compose exec postgres createdb -U app app_test`.

- [ ] **Step 6: Delete the frontend registration surface**

```bash
rm -r frontend/src/pages/register
rm frontend/src/features/auth/ui/RegisterForm.tsx frontend/src/features/auth/ui/RegisterForm.test.tsx
```

`frontend/src/features/auth/index.ts` becomes:

```ts
export { RequireAuth } from './ui/RequireAuth';
export { LoginForm } from './ui/LoginForm';
export { login, logout } from './api/authApi';
export type { Credentials, TokenResponse } from './api/authApi';
```

In `frontend/src/features/auth/api/authApi.ts`, delete the `register` function.

In `frontend/src/app/router.tsx`: delete the `RegisterPage` import and the `{ path: '/register', … }` route, and correct the doc comment's first line to `` `/login` is the only public route. ``

In `frontend/src/app/layouts/AppLayout.tsx`: `const CHROMELESS = ['/login'];` and drop `/register` from the comment above `useAppTheme()`.

In `frontend/src/features/auth/ui/LoginForm.tsx`: delete the trailing `<p>` with the sign-up link, and drop `Link` from the `react-router` import (leaving `useNavigate, useLocation`).

In `frontend/src/shared/lib/i18n/locales/en.json`, delete these now-unused keys from `auth`: `signUp`, `usernameTaken`, `noAccount`, `haveAccount`. Keep `usernameHint` (used by `LoginForm`) and `passwordHint`.

- [ ] **Step 7: Update the frontend tests**

In `frontend/src/app/router.test.tsx`, delete the case `'serves /register without a token'`.

In `frontend/src/features/auth/api/authApi.test.ts`, delete the case `'surfaces a 409 on a taken username'` and drop `register` from the import.

- [ ] **Step 8: Run the frontend suite and lint**

Run (from `frontend/`): `npm test && npm run lint`
Expected: PASS, with no unused-import or unused-key errors.

- [ ] **Step 9: Commit**

```bash
git add backend/src/auth backend/src/audit/audit-log.entity.ts backend/src/testing/pipeline.db-spec.ts \
        frontend/src/app frontend/src/features/auth frontend/src/pages frontend/src/shared/lib/i18n
git commit -m "feat: remove public self-registration; accounts are owner-created"
```

---

### Task 3: Schema — `collection_points`, reshaped `users`, hashed credentials

The single atomic schema change. It cannot be split: dropping `display_name` from the `User` entity breaks compilation everywhere that reads it, so the entity change, the migration and the call-site fixes land together.

**A correction to the approved design, made here deliberately:** the grilling session settled on "amend `SeedDevAdmin` in place". That is **wrong on ordering** — `SeedDevAdmin` (`…0001`) runs *before* this migration (`…0002`), so a version writing `first_name`/`role` would reference columns that do not exist yet and fail on every fresh database. `SeedDevAdmin` is therefore left **untouched**: it inserts `display_name` against the old schema, and this migration carries its row forward with everything else. That also handles existing dev databases, where an amended file would never re-run anyway. Same outcome, one fewer broken path.

**Files:**
- Create: `backend/src/users/user-role.enum.ts`, `backend/src/collection-points/point-kind.enum.ts`, `backend/src/collection-points/collection-point.entity.ts`, `backend/src/collection-points/collection-points.module.ts`, `backend/src/migrations/1788600000002-YagodaFoundation.ts`
- Modify: `backend/src/users/user.entity.ts`, `backend/src/users/user-credentials.entity.ts`, `backend/src/users/credentials.service.ts`, `backend/src/users/users.service.ts`, `backend/src/current-user/current-user.service.ts`, `backend/src/current-user/dto/update-me.dto.ts`, `backend/src/app.module.ts`
- Test: `backend/src/migrations/schema.db-spec.ts`, `backend/src/users/credentials.service.spec.ts`, `backend/src/users/users.service.spec.ts`, `backend/src/current-user/current-user.service.spec.ts`, `backend/src/testing/pipeline.db-spec.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword` from Task 1.
- Produces:
  - `enum UserRole { NetworkOwner = 'network_owner', PointOperator = 'point_operator' }` (`users/user-role.enum.ts`)
  - `enum PointKind { Reception = 'reception', Base = 'base' }` (`collection-points/point-kind.enum.ts`)
  - `class CollectionPoint` with `id, name, kind, target_cash: string | null, target_crates: number | null, is_active, created_at, updated_at`
  - `class User` with `id, first_name, last_name, avatar_url, language_code, role, collection_point_id, is_active, created_at, updated_at, identities`
  - `UsersService.createWithIdentity(input: CreateUserInput, onCreated?)` where `CreateUserInput = { provider, providerUserId, first_name, last_name, role, collection_point_id?, language_code?, providerData? }`
  - `UsersService.update(id, dto: UpdatableUserFields, manager?)` where `UpdatableUserFields = Partial<Pick<User, 'first_name' | 'last_name' | 'avatar_url' | 'language_code' | 'role' | 'collection_point_id' | 'is_active'>>`
  - `MeResponse = { id, username, display_name, avatar_url, language_code, role, collection_point_id }`

- [ ] **Step 1: Write the failing schema tests**

Append to `backend/src/migrations/schema.db-spec.ts` a second `describe` block (keep the existing one; Step 6 fixes its now-stale inserts):

```ts
describe('YagodaFoundation', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const owner = async (): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO users (first_name, last_name, role) VALUES ('Net', 'Owner', 'network_owner') RETURNING id`,
    );
    return row.id;
  };

  const point = async (name: string): Promise<string> => {
    const [row] = await ds.query(`INSERT INTO collection_points (name) VALUES ($1) RETURNING id`, [
      name,
    ]);
    return row.id;
  };

  it('creates the collection_points table', async () => {
    const [row] = await ds.query(`SELECT to_regclass('public.collection_points') IS NOT NULL AS present`);
    expect(row.present).toBe(true);
  });

  it.each(['user_role', 'point_kind'])('creates the %s enum type', async (typeName) => {
    const [row] = await ds.query(`SELECT to_regtype($1) IS NOT NULL AS present`, [typeName]);
    expect(row.present).toBe(true);
  });

  it('rejects a value outside the user_role enum', async () => {
    await expect(
      ds.query(`INSERT INTO users (first_name, last_name, role) VALUES ('X', 'Y', 'point_manager')`),
    ).rejects.toThrow(/invalid input value for enum/);
  });

  // A unique name per run: `app_test` persists between runs and is never
  // truncated, so a fixed literal would fail with "duplicate key" on the
  // SECOND run for the wrong reason. Same convention as pipeline.db-spec.ts.
  it('enforces one collection point per name', async () => {
    const name = `Копайгород-${randomUUID()}`;
    await point(name);
    await expect(point(name)).rejects.toThrow(/duplicate key/);
  });

  // §6.9 and §7.10: an unset target means "not known", NOT zero. A default of 0
  // would make the two indistinguishable; this asserts the column really does
  // come back NULL rather than 0.
  it('leaves both targets NULL when they are not given', async () => {
    const id = await point(`no-targets-${Date.now()}`);
    const [row] = await ds.query(
      `SELECT target_cash, target_crates FROM collection_points WHERE id = $1`,
      [id],
    );
    expect(row.target_cash).toBeNull();
    expect(row.target_crates).toBeNull();
  });

  it.each([
    ['target_cash', "'-1'"],
    ['target_crates', '-1'],
  ])('rejects a negative %s', async (column, value) => {
    await expect(
      ds.query(
        `INSERT INTO collection_points (name, ${column}) VALUES ('neg-${column}', ${value})`,
      ),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('refuses a point_operator with no collection point', async () => {
    await expect(
      ds.query(`INSERT INTO users (first_name, last_name, role) VALUES ('No', 'Point', 'point_operator')`),
    ).rejects.toThrow(/violates check constraint "CHK_users_role_point"/);
  });

  it('refuses a network_owner pinned to a collection point', async () => {
    const pointId = await point(`owner-pinned-${Date.now()}`);
    await expect(
      ds.query(
        `INSERT INTO users (first_name, last_name, role, collection_point_id)
         VALUES ('Pinned', 'Owner', 'network_owner', $1)`,
        [pointId],
      ),
    ).rejects.toThrow(/violates check constraint "CHK_users_role_point"/);
  });

  it('accepts a point_operator that has a collection point', async () => {
    const pointId = await point(`operator-home-${Date.now()}`);
    const [row] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, collection_point_id)
       VALUES ('Оксана', 'Приймальник', 'point_operator', $1) RETURNING id`,
      [pointId],
    );
    expect(row.id).toEqual(expect.any(String));
  });

  it('refuses to delete a collection point that still has a user', async () => {
    const pointId = await point(`restricted-${Date.now()}`);
    await ds.query(
      `INSERT INTO users (first_name, last_name, role, collection_point_id)
       VALUES ('Held', 'Back', 'point_operator', $1)`,
      [pointId],
    );
    await expect(ds.query(`DELETE FROM collection_points WHERE id = $1`, [pointId])).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });

  it('renamed the credential column and dropped display_name', async () => {
    const columns = await ds.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('user_credentials','password'), ('user_credentials','password_hash'), ('users','display_name')
          )`,
    );
    const found = columns.map((c: { table_name: string; column_name: string }) =>
      `${c.table_name}.${c.column_name}`,
    );
    expect(found).toEqual(['user_credentials.password_hash']);
  });

  it('stores instants as timestamptz on the reshaped tables', async () => {
    const rows = await ds.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('created_at','updated_at')
          AND table_name IN ('users','user_identities','collection_points')`,
    );
    expect(rows).not.toHaveLength(0);
    for (const row of rows) expect(row.data_type).toBe('timestamp with time zone');
  });

  // Proves the entity metadata agrees with the hand-written DDL — a raw insert
  // above would still pass against a column TypeORM itself would never emit.
  it('round-trips a CollectionPoint and an operator through the repositories', async () => {
    const pointRepo = ds.getRepository(CollectionPoint);
    const userRepo = ds.getRepository(User);

    const savedPoint = await pointRepo.save(
      pointRepo.create({ name: `round-trip-${Date.now()}`, kind: PointKind.Base, target_crates: 800 }),
    );
    const savedUser = await userRepo.save(
      userRepo.create({
        first_name: 'Round',
        last_name: 'Trip',
        role: UserRole.PointOperator,
        collection_point_id: savedPoint.id,
      }),
    );

    const found = await userRepo.findOne({ where: { id: savedUser.id } });
    expect(found?.role).toBe(UserRole.PointOperator);
    expect(found?.collection_point_id).toBe(savedPoint.id);

    const foundPoint = await pointRepo.findOne({ where: { id: savedPoint.id } });
    // numeric arrives as a string, and is expected to: see the spec's §5.1.
    expect(foundPoint?.target_cash).toBeNull();
    expect(foundPoint?.target_crates).toBe(800);
    expect(foundPoint?.kind).toBe(PointKind.Base);
  });
});
```

Add the imports this block needs at the top of the file:

```ts
import { randomUUID } from 'crypto';
import { CollectionPoint } from '../collection-points/collection-point.entity';
import { PointKind } from '../collection-points/point-kind.enum';
import { UserRole } from '../users/user-role.enum';
```

- [ ] **Step 2: Run the DB suite and watch it fail**

Run: `npm run test:db -- schema`
Expected: FAIL — `Cannot find module '../collection-points/collection-point.entity'`.

- [ ] **Step 3: Add the enums and the CollectionPoint entity**

Create `backend/src/users/user-role.enum.ts`:

```ts
/**
 * §10.1 knows exactly two roles: the person at the point who receives berries,
 * and the person who runs the network.
 *
 * The values are `point_operator` / `network_owner`, NOT `point_manager` /
 * `network_admin` — the earlier names called the person AT THE POINT a
 * "manager" and the person running the network an "administrator", which is
 * neither what they are nor what the rules call them. Renamed 02.09.2026;
 * recorded here so it is not "corrected" back.
 */
export enum UserRole {
  NetworkOwner = 'network_owner',
  PointOperator = 'point_operator',
}
```

Create `backend/src/collection-points/point-kind.enum.ts`:

```ts
/**
 * §4.8 — a warehouse (`base`) is an ordinary reception point with its own,
 * higher price, which the "set for everyone" gesture does NOT touch.
 * §8.1 — re-weighing happens AT THE BASE, and the document distinguishes the
 * point the berries came FROM from the base they were weighed AT. Neither
 * statement is expressible without this column.
 */
export enum PointKind {
  Reception = 'reception',
  Base = 'base',
}
```

Create `backend/src/collection-points/collection-point.entity.ts`:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { PointKind } from './point-kind.enum';

/**
 * A point in the network. `target_cash` and `target_crates` are the daily
 * orientation figures the owner sets.
 *
 * BOTH TARGETS ARE NULLABLE WITH NO DEFAULT, AND THAT IS LOAD-BEARING.
 * §6.9 requires "—" for a point with no target rather than a zero ("нуль
 * стверджував би, що ящиків немає, тоді як ми просто не знаємо, скільки їх
 * має бути"), and §7.10 requires that a point with no cash target not appear
 * in the network-debt table at all. `default: 0` would make "not set"
 * indistinguishable from zero and break both rules at once.
 *
 * There is NO target history and no `effective_from`, by the owner's decision
 * of 03.09.2026: a target is an orientation figure for the day, not a fact
 * about the past. The mechanical consequence is accepted: changing a target
 * applies to every day, including past ones.
 *
 * An unset `target_crates` does NOT block issuing crates — it shows a warning
 * (правка 14, which overrides §9.1's "the issue button is inactive"). A target
 * lower than what is already out with people is likewise allowed WITH A
 * WARNING, not a refusal (§6.1): a target is a management decision.
 *
 * `name` is UNIQUE — AN ADDITION THIS PROJECT MAKES; `28-db-schema.dbml` does
 * not specify it. The DBML marks `products.name` and `tare_types.name` unique
 * explicitly and is silent here with no Note defending the silence, so this
 * reads as an oversight: two points both called "Копайгород" would be a live
 * hazard on the transfer screen, where a mistaken transfer is money in dispute.
 */
@Entity('collection_points')
@Unique('UQ_collection_points_name', ['name'])
@Check('CHK_collection_points_target_cash', `"target_cash" IS NULL OR "target_cash" >= 0`)
@Check('CHK_collection_points_target_crates', `"target_crates" IS NULL OR "target_crates" >= 0`)
export class CollectionPoint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'enum', enum: PointKind, enumName: 'point_kind', default: PointKind.Reception })
  kind: PointKind;

  /** `numeric` — a STRING in TypeScript, never a number. See the spec's §5.1. */
  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  target_cash: string | null;

  @Column({ type: 'int', nullable: true })
  target_crates: number | null;

  /** §5.6 — there is no deletion, only deactivation. */
  @Column({ type: 'bool', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

Create `backend/src/collection-points/collection-points.module.ts` — entity registration only for now; Task 6 adds the service and controller:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionPoint } from './collection-point.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CollectionPoint])],
  exports: [TypeOrmModule],
})
export class CollectionPointsModule {}
```

Register it in `backend/src/app.module.ts`: add `import { CollectionPointsModule } from './collection-points/collection-points.module';` and put `CollectionPointsModule` in the `imports` array after `UsersModule`. `autoLoadEntities: true` only picks up entities passed to some module's `forFeature`, so without this the table exists but TypeORM never learns about it.

- [ ] **Step 4: Reshape the User and UserCredentials entities**

`backend/src/users/user.entity.ts` — replace the whole file:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserIdentity } from './user-identity.entity';
import { UserRole } from './user-role.enum';
import { CollectionPoint } from '../collection-points/collection-point.entity';

/**
 * There is no `display_name` column, on purpose: keeping one alongside
 * `first_name`/`last_name` would be two copies of one fact. It is DERIVED in
 * the response mappers, so `GET /me` and the frontend's `Me` type keep working.
 *
 * `login` and `password_hash` are not here either — they live on
 * `user_identities.provider_user_id` (the single login lookup path) and
 * `user_credentials.password_hash` (isolated so no query that reads a user can
 * serialize the secret). `28-db-schema.dbml` draws all three on one table; that
 * is a layout convention, and the decomposition is unchanged in meaning.
 *
 * `is_active` is NOT in the DBML's `users`, and is kept deliberately: every
 * other people-shaped table there has one, the `suppliers` Note says
 * "видалення немає, тільки is_active", and JwtStrategy.validate() now depends
 * on it for real token revocation.
 *
 * `avatar_url` and `language_code` are likewise not in the DBML. They duplicate
 * nothing and the media/i18n plumbing already uses them.
 */
@Entity('users')
@Check(
  'CHK_users_role_point',
  `("role" = 'point_operator' AND "collection_point_id" IS NOT NULL)
    OR ("role" = 'network_owner' AND "collection_point_id" IS NULL)`,
)
@Index('IDX_users_collection_point', ['collection_point_id'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  first_name: string;

  @Column({ type: 'varchar' })
  last_name: string;

  @Column({ type: 'varchar', nullable: true })
  avatar_url: string | null;

  @Column({ type: 'varchar', nullable: true })
  language_code: string | null;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role' })
  role: UserRole;

  /**
   * NULL for a network_owner, NOT NULL for a point_operator — enforced by
   * CHK_users_role_point above, not by convention. An operator without a point
   * would make every scoping assertion downstream scope to nothing, silently.
   */
  @Column({ type: 'uuid', nullable: true })
  collection_point_id: string | null;

  // The relation exists so TypeORM knows about the foreign key. Without it a
  // future `migration:generate` would propose DROPping a constraint the
  // hand-written migration created.
  @ManyToOne(() => CollectionPoint, { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'collection_point_id' })
  collection_point: CollectionPoint | null;

  /**
   * Checked on the login path AND on every authenticated request:
   * JwtStrategy.validate() reloads this row, so deactivating a user takes
   * effect immediately rather than when their token expires.
   */
  @Column({ type: 'bool', nullable: false, default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  @OneToMany(() => UserIdentity, (identity) => identity.user)
  identities: UserIdentity[];
}
```

In `backend/src/users/user-identity.entity.ts`, change both date columns to `@CreateDateColumn({ type: 'timestamptz' })` / `@UpdateDateColumn({ type: 'timestamptz' })`.

In `backend/src/users/user-credentials.entity.ts`, replace the class doc comment and rename the column:

```ts
/**
 * The stored password verifier. `password_hash`, not `password`: the name is
 * the one place the schema states that a hash — never a password — is what
 * lives here.
 *
 * The value is produced and checked ONLY by `password-hashing.ts`, through
 * `CredentialsService.set()` / `.verify()`. Its format is self-describing
 * (`scrypt$N$r$p$salt$hash`), so raising the cost parameters later needs no
 * migration and locks nobody out.
 *
 * The column lives in its own table rather than on `users` so that no query
 * which reads a user can accidentally serialize the secret.
 */
@Entity('user_credentials')
export class UserCredentials {
  @PrimaryColumn({ type: 'uuid' })
  user_id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Exclude()
  @Column({ type: 'varchar' })
  password_hash: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
```

- [ ] **Step 5: Write the migration**

Create `backend/src/migrations/1788600000002-YagodaFoundation.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { hashPassword } from '../users/password-hashing';

/**
 * The Yagoda CRM foundation: collection points, roles, and real password
 * hashing.
 *
 * `SeedDevAdmin` (…0001) is deliberately NOT amended to write the new columns:
 * it runs BEFORE this migration, so a version referencing `first_name` or
 * `role` would fail on every fresh database. It keeps writing `display_name`
 * against the old schema and this migration carries its row forward — which
 * also covers existing dev databases, where an amended file would never
 * re-run anyway.
 *
 * Importing `hashPassword` from application code is normally something a
 * migration should not do, because a later change to that module changes what
 * this frozen migration means. It is safe HERE precisely because the stored
 * format is self-describing: whatever parameters this produces today stay
 * verifiable forever, even after the defaults are raised.
 */
export class YagodaFoundation1788600000002 implements MigrationInterface {
  name = 'YagodaFoundation1788600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_role" AS ENUM('network_owner', 'point_operator')`,
    );
    await queryRunner.query(`CREATE TYPE "public"."point_kind" AS ENUM('reception', 'base')`);

    // target_cash / target_crates are NULLABLE WITH NO DEFAULT on purpose —
    // §6.9 wants "—" rather than 0 for a point with no target, and §7.10 wants
    // such a point excluded from the network-debt table entirely. A default of
    // 0 would break both. See CollectionPoint's doc comment.
    await queryRunner.query(`
      CREATE TABLE "collection_points" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "kind" "public"."point_kind" NOT NULL DEFAULT 'reception',
        "target_cash" numeric(12,2),
        "target_crates" integer,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_points" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_collection_points_name" UNIQUE ("name"),
        CONSTRAINT "CHK_collection_points_target_cash"
          CHECK ("target_cash" IS NULL OR "target_cash" >= 0),
        CONSTRAINT "CHK_collection_points_target_crates"
          CHECK ("target_crates" IS NULL OR "target_crates" >= 0)
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "first_name" character varying,
        ADD COLUMN "last_name" character varying,
        ADD COLUMN "role" "public"."user_role",
        ADD COLUMN "collection_point_id" uuid
    `);

    // Backfill. In practice this touches only the dev-seeded admin: production
    // has no users before this migration, because public registration is gone
    // and the bootstrap owner is created by the NEXT migration.
    await queryRunner.query(`
      UPDATE "users" SET
        "first_name" = COALESCE(NULLIF(split_part(COALESCE("display_name", ''), ' ', 1), ''), 'User'),
        "last_name"  = CASE
                         WHEN COALESCE("display_name", '') LIKE '% %'
                           THEN substr("display_name", strpos("display_name", ' ') + 1)
                         ELSE '—'
                       END,
        "role" = 'network_owner'
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ALTER COLUMN "first_name" SET NOT NULL,
        ALTER COLUMN "last_name" SET NOT NULL,
        ALTER COLUMN "role" SET NOT NULL,
        DROP COLUMN "display_name"
    `);

    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "FK_users_collection_point"
        FOREIGN KEY ("collection_point_id") REFERENCES "collection_points"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    // An operator with no point would make every downstream scoping assertion
    // scope to nothing, silently; an owner pinned to a point contradicts §10.1.
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "CHK_users_role_point" CHECK (
          ("role" = 'point_operator' AND "collection_point_id" IS NOT NULL)
          OR ("role" = 'network_owner' AND "collection_point_id" IS NULL)
        )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_users_collection_point" ON "users" ("collection_point_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "user_credentials" RENAME COLUMN "password" TO "password_hash"`,
    );

    // Convert every plain-text value left by the starter (and by SeedDevAdmin)
    // into a real scrypt verifier. Row by row because each needs its own salt.
    const rows: { user_id: string; password_hash: string }[] = await queryRunner.query(
      `SELECT "user_id", "password_hash" FROM "user_credentials"`,
    );
    for (const row of rows) {
      await queryRunner.query(`UPDATE "user_credentials" SET "password_hash" = $1 WHERE "user_id" = $2`, [
        await hashPassword(row.password_hash),
        row.user_id,
      ]);
    }

    // The starter created these as bare `timestamp`, while audit_log and
    // media_files already use `timestamptz`. One convention from here on: the
    // stored values came from now() on a UTC container, so interpreting them
    // as UTC is correct rather than merely convenient.
    for (const table of ['users', 'user_identities']) {
      for (const column of ['created_at', 'updated_at']) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP WITH TIME ZONE
             USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['users', 'user_identities']) {
      for (const column of ['created_at', 'updated_at']) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TIMESTAMP
             USING "${column}" AT TIME ZONE 'UTC'`,
        );
      }
    }

    // Irreversible in substance: the plain-text passwords are gone for good.
    // Reverting leaves scrypt strings in a column named `password`, so every
    // login fails until credentials are reset. Named, not hidden.
    await queryRunner.query(
      `ALTER TABLE "user_credentials" RENAME COLUMN "password_hash" TO "password"`,
    );

    await queryRunner.query(`DROP INDEX "public"."IDX_users_collection_point"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_role_point"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_users_collection_point"`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN "display_name" character varying`);
    await queryRunner.query(
      `UPDATE "users" SET "display_name" = btrim("first_name" || ' ' || "last_name")`,
    );
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "collection_point_id",
        DROP COLUMN "role",
        DROP COLUMN "last_name",
        DROP COLUMN "first_name"
    `);

    await queryRunner.query(`DROP TABLE "collection_points"`);
    await queryRunner.query(`DROP TYPE "public"."point_kind"`);
    await queryRunner.query(`DROP TYPE "public"."user_role"`);
  }
}
```

- [ ] **Step 6: Fix the existing schema db-spec's stale inserts**

In the original `describe('InitialSchema', …)` block, every `INSERT INTO users (display_name) VALUES ('…')` now fails — the column is gone and three others are NOT NULL. Replace each with:

```ts
INSERT INTO users (first_name, last_name, role) VALUES ('Dupe', 'User', 'network_owner')
```

(varying the names per test: `Dupe`, `Cascade`, `Actor`, `Round`/`Trip`). In the same block's `user_credentials` insert, rename the column: `INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, 'pw')`. In its repository round-trip test, replace `userRepo.create({ display_name: 'Round Trip', is_active: true })` with `userRepo.create({ first_name: 'Round', last_name: 'Trip', role: UserRole.NetworkOwner, is_active: true })`.

- [ ] **Step 7: Run the DB suite**

Run: `npm run test:db -- schema`
Expected: PASS, both describe blocks.

If it fails with "type user_role already exists", the test database has a half-applied migration from a previous attempt — drop and recreate it: `docker compose exec postgres dropdb -U app app_test && docker compose exec postgres createdb -U app app_test`.

- [ ] **Step 8: Wire the hashing into CredentialsService**

`backend/src/users/credentials.service.ts` — replace the class doc comment and both methods:

```ts
/**
 * THE ONLY PLACE PASSWORDS ARE READ OR WRITTEN. The hashing itself lives in
 * `password-hashing.ts`; this class is the persistence seam around it.
 *
 * The owner issues and reissues every password — there is no self-service
 * change (see `user-admin/`). §17.2's reading is that a password checked at
 * the point, where the owner is not standing, is an access control rather
 * than a signature.
 */
@Injectable()
export class CredentialsService {
  constructor(
    @InjectRepository(UserCredentials)
    private readonly repo: Repository<UserCredentials>,
  ) {}

  /** Create or replace the credential for a user. Accepts a manager so account
   *  creation can enlist it in the user-creation transaction. */
  async set(userId: string, password: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserCredentials) : this.repo;
    const password_hash = await hashPassword(password);
    await repo.upsert({ user_id: userId, password_hash }, { conflictPaths: ['user_id'] });
  }

  /**
   * False for a wrong password AND for a user with no credential — callers
   * must not distinguish the two, or the endpoint leaks which usernames exist.
   *
   * No timing equalisation for the missing-credential case: `AuthService.login`
   * already returns early for an unknown username, and a user with an identity
   * but no credential cannot be created (both are written in one transaction).
   */
  async verify(userId: string, password: string): Promise<boolean> {
    const row = await this.repo.findOne({ where: { user_id: userId } });
    if (!row) return false;
    return verifyPassword(password, row.password_hash);
  }
}
```

with `import { hashPassword, verifyPassword } from './password-hashing';`.

- [ ] **Step 9: Update CredentialsService's spec to assert hashing, not equality**

In `backend/src/users/credentials.service.spec.ts`, the existing five cases keep their names but the fixture must now hold a hash. Add one case that is the whole point of the change:

```ts
  it('never stores the password itself', async () => {
    await service.set('user-1', 'hunter2!!');
    const stored = upsert.mock.calls[0][0].password_hash as string;

    expect(stored).not.toContain('hunter2!!');
    expect(stored.startsWith('scrypt$')).toBe(true);
  });
```

Adjust the other cases so the stubbed `findOne` returns `{ user_id, password_hash: await hashPassword('…') }` rather than a plain string, and so `upsert` is asserted on `password_hash`. These specs are slower now (scrypt is deliberately expensive); if the suite complains, raise this file's timeout with `jest.setTimeout(20_000)` at the top rather than weakening the cost parameters.

- [ ] **Step 10: Update UsersService for the new columns**

In `backend/src/users/users.service.ts`:

```ts
export interface CreateUserInput {
  provider: string;
  /** Already normalised by the caller (lowercased for local logins). */
  providerUserId: string;
  first_name: string;
  last_name: string;
  role: UserRole;
  /** NULL for a network_owner, required for a point_operator — see
   *  CHK_users_role_point. Passing the wrong combination is a 500 from the
   *  database, so callers validate first. */
  collection_point_id?: string | null;
  language_code?: string | null;
  providerData?: Record<string, unknown> | null;
}

export type UpdatableUserFields = Partial<
  Pick<
    User,
    | 'first_name'
    | 'last_name'
    | 'avatar_url'
    | 'language_code'
    | 'role'
    | 'collection_point_id'
    | 'is_active'
  >
>;
```

In `createWithIdentity`, replace the `em.create(User, …)` payload:

```ts
      const user = em.create(User, {
        first_name: input.first_name,
        last_name: input.last_name,
        role: input.role,
        collection_point_id: input.collection_point_id ?? null,
        language_code: input.language_code ?? null,
        avatar_url: null,
        is_active: true,
      });
```

Change `update`'s signature to take `UpdatableUserFields`. Everything else in the file stays.

- [ ] **Step 11: Update CurrentUserService and UpdateMeDto**

`backend/src/current-user/dto/update-me.dto.ts` — `display_name` is gone; the owner names staff:

```ts
import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * `display_name` is deliberately absent: it is no longer a column, and an
 * operator does not rename themselves — the owner names staff through
 * PATCH /users/:id.
 */
export class UpdateMeDto {
  /** Kept in step with the locales `frontend/src/shared/lib/i18n` registers.
   *  Adding a locale means extending BOTH lists — nothing enforces that
   *  across the stack, so the two can silently drift. */
  @IsOptional()
  @IsString()
  @IsIn(['en'])
  language_code?: string;
}
```

In `backend/src/current-user/current-user.service.ts`, add `import { UserRole } from '../users/user-role.enum';`, then widen `MeResponse` and derive the name:

```ts
export interface MeResponse {
  id: string;
  username: string;
  /** DERIVED from first_name + last_name — there is no such column. */
  display_name: string;
  avatar_url: string | null;
  language_code: string | null;
  role: UserRole;
  collection_point_id: string | null;
}
```

and in `toResponse`:

```ts
  private toResponse(user: User, username: string): MeResponse {
    return {
      id: user.id,
      username,
      display_name: `${user.first_name} ${user.last_name}`.trim(),
      avatar_url: user.avatar_url,
      language_code: user.language_code,
      role: user.role,
      collection_point_id: user.collection_point_id,
    };
  }
```

- [ ] **Step 12: Update the affected unit specs**

- `users.service.spec.ts` — `createWithIdentity`'s cases now pass `first_name`/`last_name`/`role` and assert them on the created user.
- `current-user.service.spec.ts` — `'reads the profile, taking the username from the token'` asserts the derived `display_name` plus `role`/`collection_point_id`; `'records what changed when the profile is updated'` and `'does not record an audit entry when nothing actually changed'` switch from `display_name` to `language_code`.
- `pipeline.db-spec.ts` — the fixture user gains `first_name: 'Pipeline'`, `last_name: 'User'`, `role: UserRole.NetworkOwner`, and the `/me` body assertion becomes:

```ts
    expect(meRes.body).toEqual({
      id: expect.any(String),
      username,
      display_name: 'Pipeline User',
      avatar_url: null,
      language_code: null,
      role: 'network_owner',
      collection_point_id: null,
    });
```

- [ ] **Step 13: Run everything**

Run: `npm test && npm run test:db && npm run lint`
Expected: all PASS.

- [ ] **Step 14: Commit**

```bash
git add backend/src
git commit -m "feat(backend): add collection_points, user roles and hashed credentials"
```

---

### Task 4: Frontend repair for the reshaped `/me`

`display_name` is still in the response — derived — so the type still compiles. What breaks is *editing* it: `PATCH /me` now rejects the field, and with `forbidNonWhitelisted: true` that is a 400, not a silent ignore.

**Files:**
- Modify: `frontend/src/entities/user/model/types.ts`, `frontend/src/entities/user/api/useUpdateMeMutation.ts`, `frontend/src/pages/profile/ui/ProfilePage.tsx`, `frontend/src/pages/profile/ui/ProfilePage.test.tsx`, `frontend/src/pages/dashboard/ui/DashboardPage.tsx`, `frontend/src/shared/lib/i18n/locales/en.json`

**Interfaces:**
- Consumes: `MeResponse` from Task 3.
- Produces: `Me = { id, username, display_name: string, avatar_url: string | null, language_code: string | null, role: 'network_owner' | 'point_operator', collection_point_id: string | null }`; `UpdateMeInput = { language_code?: string }`.

- [ ] **Step 1: Update the ProfilePage test to describe the new screen**

In `frontend/src/pages/profile/ui/ProfilePage.test.tsx`:

- Update the `ME` fixture to `{ id: 'u1', username: 'alice', display_name: 'Alice Operator', avatar_url: null, language_code: null, role: 'point_operator', collection_point_id: 'p1' }`.
- Delete the three display-name cases: `'…'` that PATCHes `display_name`, `'omits display_name from the PATCH when the field is cleared'`, and `'trims display_name before sending it'`.
- Add:

```ts
  it('shows the name as read-only text, with no field to edit it', async () => {
    renderPage();
    expect(await screen.findByText('Alice Operator')).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
```

Keep every avatar case exactly as it is — that path is unchanged.

- [ ] **Step 2: Run the frontend suite and watch it fail**

Run (from `frontend/`): `npm test -- ProfilePage`
Expected: FAIL — the Save button and the display-name field are still rendered.

- [ ] **Step 3: Update the types**

`frontend/src/entities/user/model/types.ts`:

```ts
export type UserRole = 'network_owner' | 'point_operator';

export interface Me {
  id: string;
  username: string;
  /** Server-derived from first_name + last_name. Read-only: the owner names
   *  staff through the users admin API, not the profile screen. */
  display_name: string;
  avatar_url: string | null;
  language_code: string | null;
  role: UserRole;
  /** null for a network_owner — they belong to the network, not a point. */
  collection_point_id: string | null;
}
```

Export the new type from `frontend/src/entities/user/index.ts`: `export type { Me, UserRole } from './model/types';`

`frontend/src/entities/user/api/useUpdateMeMutation.ts` — narrow the input and record why the hook survives with no caller:

```ts
/**
 * `display_name` is gone: it is derived server-side and the owner, not the
 * user, sets the underlying names. `language_code` is all that is left, and
 * nothing writes it yet — the language preference lives in localStorage
 * (`shared/lib/i18n/language-preference`).
 *
 * Kept anyway, the same way `shared/lib/form-draft` and `shared/lib/url-state`
 * are kept: it is this project's reference TanStack mutation, seeding the
 * cache from the response instead of invalidating. Do not delete it as dead
 * code, and do not invent a caller to justify it.
 */
export interface UpdateMeInput {
  language_code?: string;
}
```

- [ ] **Step 4: Rewrite the profile screen**

In `frontend/src/pages/profile/ui/ProfilePage.tsx`, delete the whole `<form>`, the `displayName` / `syncedDisplayName` state and the render-time sync block, the `useUpdateMeMutation` call, and the now-unused imports (`useUpdateMeMutation`, `Field`, `TextInput`, `Button`, `toastSuccess`). Replace the trailing `<p>{data.username}</p>` with a read-only identity block:

```tsx
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">{t('profile.name')}</dt>
        <dd>{data.display_name}</dd>

        <dt className="text-muted-foreground">{t('profile.login')}</dt>
        <dd>{data.username}</dd>

        <dt className="text-muted-foreground">{t('profile.role')}</dt>
        <dd>{t(`profile.roles.${data.role}`)}</dd>
      </dl>
```

Keep the avatar block and its `data.display_name` usages — now that `display_name` is a non-nullable string, `data.display_name ?? data.username` simplifies to `data.display_name` in both the `alt` and the `AvatarFallback`.

- [ ] **Step 5: Update the dashboard and the locale file**

`frontend/src/pages/dashboard/ui/DashboardPage.tsx`: `data?.display_name ?? data?.username` becomes `data?.display_name`.

In `frontend/src/shared/lib/i18n/locales/en.json`, replace `profile.displayName` with:

```json
    "name": "Name",
    "login": "Login",
    "role": "Role",
    "roles": {
      "network_owner": "Network owner",
      "point_operator": "Point operator"
    },
```

- [ ] **Step 6: Run the suite and lint**

Run (from `frontend/`): `npm test && npm run lint && npm run build`
Expected: all PASS. `npm run build` is what catches a `Me` field someone still reads.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): make the profile identity read-only; carry role and point on Me"
```

---

### Task 5: Role-aware auth — DB-backed `validate()`, `RolesGuard`, point scope

**Files:**
- Create: `backend/src/auth/guards/roles.guard.ts`, `backend/src/auth/guards/roles.guard.spec.ts`, `backend/src/auth/access/point-scope.ts`, `backend/src/auth/access/point-scope.spec.ts`, `backend/src/auth/jwt.strategy.spec.ts`
- Modify: `backend/src/auth/jwt.strategy.ts`, `backend/src/auth/decorators/auth.decorators.ts`, `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.service.spec.ts`, `backend/src/users/users.service.ts`, `backend/src/users/users.service.spec.ts`, `backend/src/testing/pipeline.db-spec.ts`

**Interfaces:**
- Consumes: `UserRole` and the reshaped `User` from Task 3.
- Produces:
  - `interface AuthenticatedUser { sub: string; username: string; role: UserRole; collection_point_id: string | null }` (`auth/jwt.strategy.ts`)
  - `interface JwtPayload { sub: string }` (`auth/jwt.strategy.ts`)
  - `Auth(...roles: UserRole[])` (`auth/decorators/auth.decorators.ts`)
  - `ROLES_KEY: string` (`auth/guards/roles.guard.ts`)
  - `assertOwnsPoint(actor: AuthenticatedUser, pointId: string): void` and `resolvePointFilter(actor: AuthenticatedUser, requested?: string): string | undefined` (`auth/access/point-scope.ts`)
  - `UsersService.findAuthContext(userId: string): Promise<{ user: User; login: string } | null>`

- [ ] **Step 1: Write the failing specs**

Create `backend/src/auth/access/point-scope.spec.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import { assertOwnsPoint, resolvePointFilter } from './point-scope';
import type { AuthenticatedUser } from '../jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};
const operator: AuthenticatedUser = {
  sub: 'u-op',
  username: 'oksana',
  role: UserRole.PointOperator,
  collection_point_id: 'point-a',
};

describe('assertOwnsPoint', () => {
  it('lets an operator through for their own point', () => {
    expect(() => assertOwnsPoint(operator, 'point-a')).not.toThrow();
  });

  it('refuses an operator another point', () => {
    expect(() => assertOwnsPoint(operator, 'point-b')).toThrow(ForbiddenException);
  });

  it('lets the owner through for any point', () => {
    expect(() => assertOwnsPoint(owner, 'point-a')).not.toThrow();
    expect(() => assertOwnsPoint(owner, 'point-b')).not.toThrow();
  });
});

describe('resolvePointFilter', () => {
  // The whole point of the "derive, never accept" rule: an operator's request
  // cannot widen or redirect its own scope, so a forged query parameter is not
  // an error to report — it is simply not read.
  it('pins an operator to their own point, ignoring what they asked for', () => {
    expect(resolvePointFilter(operator, 'point-b')).toBe('point-a');
    expect(resolvePointFilter(operator, undefined)).toBe('point-a');
  });

  it('honours the owner’s filter, and returns undefined when they give none', () => {
    expect(resolvePointFilter(owner, 'point-b')).toBe('point-b');
    expect(resolvePointFilter(owner, undefined)).toBeUndefined();
  });
});
```

Create `backend/src/auth/guards/roles.guard.spec.ts`:

```ts
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user-role.enum';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from '../jwt.strategy';

const contextFor = (user: AuthenticatedUser | undefined): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guardWith = (roles: UserRole[] | undefined) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  const operator: AuthenticatedUser = {
    sub: 'u-op',
    username: 'oksana',
    role: UserRole.PointOperator,
    collection_point_id: 'point-a',
  };

  it('allows any authenticated user when no role is required', () => {
    expect(guardWith(undefined).canActivate(contextFor(operator))).toBe(true);
    expect(guardWith([]).canActivate(contextFor(operator))).toBe(true);
  });

  it('allows a user holding a required role', () => {
    expect(guardWith([UserRole.PointOperator]).canActivate(contextFor(operator))).toBe(true);
  });

  it('refuses a user without the required role', () => {
    expect(() => guardWith([UserRole.NetworkOwner]).canActivate(contextFor(operator))).toThrow(
      ForbiddenException,
    );
  });

  // Defence in depth: @Auth() always applies JwtAuthGuard first, so this
  // should be unreachable. If it ever IS reached, a missing user must not be
  // read as "no role required".
  it('refuses when no user is on the request at all', () => {
    expect(() => guardWith([UserRole.NetworkOwner]).canActivate(contextFor(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
```

Create `backend/src/auth/jwt.strategy.spec.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { JwtStrategy } from './jwt.strategy';
import type { UsersService } from '../users/users.service';
import type { User } from '../users/user.entity';

describe('JwtStrategy.validate', () => {
  const auth = { jwtSecret: 'x'.repeat(32), jwtExpiresIn: '7d' };

  const strategyFor = (context: { user: Partial<User>; login: string } | null) => {
    const users = { findAuthContext: jest.fn().mockResolvedValue(context) } as unknown as UsersService;
    return { strategy: new JwtStrategy(auth as never, users), users };
  };

  it('returns role and point read from the database, not from the token', async () => {
    const { strategy } = strategyFor({
      user: {
        id: 'u-1',
        role: UserRole.PointOperator,
        collection_point_id: 'point-a',
        is_active: true,
      },
      login: 'oksana',
    });

    await expect(strategy.validate({ sub: 'u-1' })).resolves.toEqual({
      sub: 'u-1',
      username: 'oksana',
      role: UserRole.PointOperator,
      collection_point_id: 'point-a',
    });
  });

  // THE revocation test. Without this, deactivating someone does nothing until
  // their token expires, and no other spec would notice.
  it('rejects a token whose user has since been deactivated', async () => {
    const { strategy } = strategyFor({
      user: { id: 'u-1', role: UserRole.PointOperator, collection_point_id: 'p', is_active: false },
      login: 'oksana',
    });
    await expect(strategy.validate({ sub: 'u-1' })).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token whose user no longer exists', async () => {
    const { strategy } = strategyFor(null);
    await expect(strategy.validate({ sub: 'gone' })).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npm test -- point-scope roles.guard jwt.strategy`
Expected: FAIL — the two new modules don't exist and `JwtStrategy`'s constructor takes one argument.

- [ ] **Step 3: Implement the point-scope helpers**

Create `backend/src/auth/access/point-scope.ts`:

```ts
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../jwt.strategy';

/**
 * Row-level access rules for the point a caller belongs to. These are NOT
 * guards: a guard answers "may this role call this operation" from the request
 * alone, while these need to know which row is being touched. Keeping them in
 * one module is what stops four endpoints each implementing the rule slightly
 * differently.
 *
 * THE RULE: the point is DERIVED from the actor (or from the shift a document
 * references), never accepted from a request body. An operator's request
 * simply has no point field to forge.
 */

/** Throws unless the actor may act on `pointId`. The owner may act on any. */
export function assertOwnsPoint(actor: AuthenticatedUser, pointId: string): void {
  if (actor.role === UserRole.NetworkOwner) return;
  if (actor.collection_point_id === pointId) return;
  throw new ForbiddenException({
    message: 'That collection point is not yours',
    code: 'WRONG_COLLECTION_POINT',
  });
}

/**
 * The point id a list query should filter on.
 *
 * An operator is pinned to their own point and `requested` is IGNORED rather
 * than rejected — there is nothing meaningful to report, because the parameter
 * can neither widen nor redirect their scope. An owner gets what they asked
 * for, or `undefined` meaning "every point".
 */
export function resolvePointFilter(
  actor: AuthenticatedUser,
  requested?: string,
): string | undefined {
  if (actor.role === UserRole.NetworkOwner) return requested;
  return actor.collection_point_id ?? undefined;
}
```

- [ ] **Step 4: Implement the RolesGuard and extend `@Auth()`**

Create `backend/src/auth/guards/roles.guard.ts`:

```ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../jwt.strategy';

export const ROLES_KEY = 'auth:roles';

/**
 * The role half of `@Auth()`. Applied after JwtAuthGuard, so `request.user` is
 * already populated by JwtStrategy.validate() — which read it from the
 * database this request, not from the token. A role change therefore takes
 * effect on the caller's very next request.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    // Unreachable while @Auth() always applies JwtAuthGuard first. If it ever
    // becomes reachable, "no user" must not read as "no role required".
    if (!user) throw new UnauthorizedException();

    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        message: 'This action is restricted',
        code: 'INSUFFICIENT_ROLE',
      });
    }
    return true;
  }
}
```

Replace `backend/src/auth/decorators/auth.decorators.ts`:

```ts
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ROLES_KEY, RolesGuard } from '../guards/roles.guard';
import { UserRole } from '../../users/user-role.enum';

/**
 * The one blessed way to protect a route:
 *
 *   @Auth()                          // any authenticated user
 *   @Auth(UserRole.NetworkOwner)     // owner only
 *
 * Guard order matters and is not incidental: JwtAuthGuard runs first and
 * populates request.user, which RolesGuard then reads.
 *
 * This decorator is for ROLE-ONLY rules — ones decidable from the request
 * alone (§10.2 "only the owner changes a target", §9.4 "only the owner
 * voids"). A rule that has to read a row (§7.7's "the operator closes the
 * shift unless it fails to reconcile", §7.9's "only the owning point may
 * accept") is NOT a guard: it belongs in a named assert* method on the
 * service, next to the invariant it protects. See `auth/access/point-scope.ts`.
 */
export function Auth(...roles: UserRole[]) {
  return applyDecorators(SetMetadata(ROLES_KEY, roles), UseGuards(JwtAuthGuard, RolesGuard));
}
```

- [ ] **Step 5: Make `validate()` read the database**

Add to `backend/src/users/users.service.ts`:

```ts
  /**
   * Everything an authenticated request needs about its caller, in one query.
   * Called on EVERY authenticated request by JwtStrategy.validate(), which is
   * what makes deactivation, demotion and point reassignment take effect
   * immediately instead of when the token expires.
   *
   * Returns null for a user with no local identity — a future OAuth-only
   * account would land here, and rejecting it is the safe default until that
   * case actually exists.
   */
  async findAuthContext(userId: string): Promise<{ user: User; login: string } | null> {
    const identity = await this.identityRepo.findOne({
      where: { provider: LOCAL_PROVIDER, user: { id: userId } },
      relations: { user: true },
    });
    if (!identity?.user) return null;
    return { user: identity.user, login: identity.provider_user_id };
  }
```

with `import { LOCAL_PROVIDER } from './user-identity.entity';`.

Replace `backend/src/auth/jwt.strategy.ts`:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { authConfig } from '../config/auth.config';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.enum';

/** Everything the token carries. Deliberately just the subject: anything else
 *  in here would be a copy of a database row that can go stale for as long as
 *  JWT_EXPIRES_IN. */
export interface JwtPayload {
  sub: string;
}

/** What every guard, controller and service sees as the caller. Assembled from
 *  the database on each request — see validate(). */
export interface AuthenticatedUser {
  sub: string;
  username: string;
  role: UserRole;
  collection_point_id: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @Inject(authConfig.KEY)
    auth: ConfigType<typeof authConfig>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: auth.jwtSecret,
      algorithms: ['HS256'],
    });
  }

  /**
   * ONE INDEXED LOOKUP PER AUTHENTICATED REQUEST, ON PURPOSE.
   *
   * The starter's version re-emitted the payload and never queried anything,
   * which is fine for a display name and unacceptable for `role`,
   * `collection_point_id` and `is_active`: a demoted operator would keep owner
   * powers for a week, a reassigned one would keep writing to their old point,
   * and a dismissed one — someone who handles cash — would keep a working
   * token until it expired. There is no revocation list in this schema, so
   * this lookup is the revocation mechanism.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const context = await this.users.findAuthContext(payload.sub);
    if (!context || !context.user.is_active) throw new UnauthorizedException();

    return {
      sub: context.user.id,
      username: context.login,
      role: context.user.role,
      collection_point_id: context.user.collection_point_id,
    };
  }
}
```

- [ ] **Step 6: Shrink the token payload**

In `backend/src/auth/auth.service.ts`, `signToken` no longer needs the username or the profile:

```ts
  /** The token carries the subject and nothing else: every other fact about
   *  the caller is read from the database on each request (JwtStrategy). */
  private signToken(user: User): string {
    const payload: JwtPayload = { sub: user.id };
    return this.jwt.sign(payload);
  }
```

Update both call sites to `this.signToken(identity.user)` and swap the `AuthenticatedUser` import for `JwtPayload`.

In `auth.service.spec.ts`, the case `'signs the username and profile into the token, and never the password'` is now wrong by design. Replace it with:

```ts
    it('signs only the subject into the token — never the password, and never a stale profile', async () => {
      // …arrange as before…
      await service.login({ username: 'alice', password: 'hunter2!!' });
      expect(jwt.sign).toHaveBeenCalledWith({ sub: 'user-1' });
    });
```

- [ ] **Step 7: Prove revocation over real HTTP**

Append to the existing test in `backend/src/testing/pipeline.db-spec.ts`, after the `forbidNonWhitelisted` assertion:

```ts
    // The token stays cryptographically valid — nothing revokes it. What
    // changes is that JwtStrategy.validate() now reads the user row, so the
    // very next request with the SAME token is rejected. This is the only
    // test in the repo that proves deactivation actually does anything.
    await users.update(meRes.body.id, { is_active: false });

    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run test:db && npm run lint`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/auth backend/src/users backend/src/testing
git commit -m "feat(backend): read role and point from the database on every request"
```

---

### Task 6: `collection-points` module

Single module — it owns its data, has one write path and no external writers, so the domain/operations split the `nest-module-conventions` skill describes is not earned here (splitting a module with one responsibility just adds indirection).

**Files:**
- Create: `backend/src/collection-points/collection-points.service.ts`, `collection-points.service.spec.ts`, `collection-points.controller.ts`, `collection-point.mapper.ts`, `dto/create-collection-point.dto.ts`, `dto/update-collection-point.dto.ts`, `dto/list-collection-points.query.ts`
- Modify: `backend/src/collection-points/collection-points.module.ts`, `backend/src/users/users.service.ts`, `backend/src/audit/audit-log.entity.ts`, `backend/src/testing/pipeline.db-spec.ts`

**Interfaces:**
- Consumes: `CollectionPoint`, `PointKind` (Task 3); `Auth`, `AuthenticatedUser`, `assertOwnsPoint`, `resolvePointFilter` (Task 5); `PaginationQueryDto`, `Paginated<T>`, `AuditService`.
- Produces:
  - `CollectionPointResponse = { id, name, kind, target_cash: string | null, target_crates: number | null, is_active, created_at: string }`
  - `toCollectionPointResponse(point: CollectionPoint): CollectionPointResponse`
  - `CollectionPointsService` with `list(actor, query)`, `findOne(actor, id)`, `create(actor, dto)`, `update(actor, id, dto)`
  - `UsersService.findActiveAtPoint(pointId: string): Promise<User[]>`

- [ ] **Step 1: Write the failing service spec**

Create `backend/src/collection-points/collection-points.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { PointKind } from './point-kind.enum';
import { CollectionPointsService } from './collection-points.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('CollectionPointsService', () => {
  let repo: {
    find: jest.Mock;
    findAndCount: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let users: { findActiveAtPoint: jest.Mock };
  let audit: { record: jest.Mock };
  let service: CollectionPointsService;

  const point = (over: Record<string, unknown> = {}) => ({
    id: 'p-1',
    name: 'Копайгород',
    kind: PointKind.Reception,
    target_cash: null,
    target_crates: null,
    is_active: true,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    updated_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[point()], 1]),
      findOne: jest.fn().mockResolvedValue(point()),
      save: jest.fn().mockImplementation((p) => Promise.resolve(p)),
      create: jest.fn().mockImplementation((p) => p),
    };
    users = { findActiveAtPoint: jest.fn().mockResolvedValue([]) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CollectionPointsService(repo as never, users as never, audit as never);
  });

  it('creates a point with both targets unset — NOT zero', async () => {
    await service.create(owner, { name: 'Нова точка' });

    const saved = repo.save.mock.calls[0][0];
    expect(saved.target_cash).toBeNull();
    expect(saved.target_crates).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'point.created', actor_id: 'u-owner' }),
    );
  });

  it('records who changed a target, from what, to what, and why', async () => {
    repo.findOne.mockResolvedValue(point({ target_crates: 600 }));

    await service.update(owner, 'p-1', { target_crates: 800, reason: 'розширили точку' });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'point.target-changed',
        actor_id: 'u-owner',
        target_type: 'collection_point',
        target_id: 'p-1',
        before: { target_crates: 600 },
        after: { target_crates: 800 },
        note: 'розширили точку',
      }),
    );
  });

  // §6.9: clearing a target means "not known", and must not collapse to 0.
  it('clears a target when given an explicit null', async () => {
    repo.findOne.mockResolvedValue(point({ target_crates: 800 }));

    await service.update(owner, 'p-1', { target_crates: null });

    expect(repo.save.mock.calls[0][0].target_crates).toBeNull();
  });

  it('leaves a target alone when the field is simply absent', async () => {
    repo.findOne.mockResolvedValue(point({ target_crates: 800 }));

    await service.update(owner, 'p-1', { name: 'Копайгород-2' });

    expect(repo.save.mock.calls[0][0].target_crates).toBe(800);
    expect(audit.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'point.target-changed' }),
    );
  });

  it('refuses to deactivate a point that still has active users, naming them', async () => {
    repo.findOne.mockResolvedValue(point());
    users.findActiveAtPoint.mockResolvedValue([
      { first_name: 'Оксана', last_name: 'П' },
      { first_name: 'Марія', last_name: 'К' },
    ]);

    await expect(service.update(owner, 'p-1', { is_active: false })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.update(owner, 'p-1', { is_active: false })).rejects.toThrow(/Оксана П/);
  });

  it('allows deactivating a point with no active users', async () => {
    repo.findOne.mockResolvedValue(point());
    await expect(service.update(owner, 'p-1', { is_active: false })).resolves.toBeDefined();
  });

  it('throws NotFound for an unknown point', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.findOne(owner, 'nope')).rejects.toThrow(NotFoundException);
  });

  it('returns only their own point to an operator', async () => {
    const operator: AuthenticatedUser = {
      sub: 'u-op',
      username: 'oksana',
      role: UserRole.PointOperator,
      collection_point_id: 'p-1',
    };

    await service.list(operator, { page: 1, limit: 20 });

    expect(repo.findAndCount).toHaveBeenCalledWith(
      // objectContaining on `where` too: it also carries is_active, and a
      // strict literal here would assert the filter is the ONLY one applied.
      expect.objectContaining({ where: expect.objectContaining({ id: 'p-1' }) }),
    );
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- collection-points`
Expected: FAIL — `Cannot find module './collection-points.service'`.

- [ ] **Step 3: Add the audit actions and the users helper**

In `backend/src/audit/audit-log.entity.ts`, extend `AUDIT_ACTIONS` with the domain actions. Documents are NOT audited — they carry their author and void reason in the row, so an entry would be a second copy of a fact:

```ts
  'user.created',
  'user.password-changed',
  'point.created',
  'point.updated',
  'point.target-changed',
```

`'user.updated'` already exists and is reused for every field change on a user (login, role, point, is_active, names) with `before`/`after` naming exactly the fields that moved — one action rather than six that would have to be kept in step.

Add to `backend/src/users/users.service.ts`:

```ts
  /** Active users whose home point is `pointId`. Used to refuse deactivating a
   *  point out from under someone: an orphaned operator would keep a valid
   *  token whose every scoping assertion silently matches nothing. */
  async findActiveAtPoint(pointId: string): Promise<User[]> {
    return this.userRepo.find({ where: { collection_point_id: pointId, is_active: true } });
  }
```

- [ ] **Step 4: Write the DTOs and the mapper**

Create `backend/src/collection-points/dto/create-collection-point.dto.ts`:

```ts
import { IsEnum, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { PointKind } from '../point-kind.enum';

/**
 * `target_cash` is a STRING, not a number: `numeric(12,2)` is carried as a
 * string end to end so no value ever passes through a binary float. The regex
 * is the column's own shape — up to 10 integer digits and at most 2 decimals.
 *
 * Neither target is required, and NEITHER GETS A DEFAULT. §6.9 wants "—" for a
 * point with no target rather than a zero, and §7.10 wants such a point left
 * out of the network-debt table entirely.
 */
export class CreateCollectionPointDto {
  @IsString()
  @Length(1, 128)
  name: string;

  @IsOptional()
  @IsEnum(PointKind)
  kind?: PointKind;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'target_cash must be a decimal string with at most 2 decimal places',
  })
  target_cash?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  target_crates?: number | null;
}
```

Create `backend/src/collection-points/dto/update-collection-point.dto.ts`:

```ts
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';
import { PointKind } from '../point-kind.enum';

/**
 * ABSENT and NULL mean different things here, and the service tells them apart
 * with `in`: an absent target is left alone, an explicit `null` CLEARS it back
 * to "not known" (§6.9). `@IsOptional()` permits both, which is exactly what
 * is wanted — a `@ValidateIf` dance would only re-derive the same behaviour.
 *
 * A target LOWER than what is already out with people is allowed here on
 * purpose: §6.1 makes that a warning on screen, not a refusal, because a
 * target is a management decision.
 */
export class UpdateCollectionPointDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsEnum(PointKind)
  kind?: PointKind;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'target_cash must be a decimal string with at most 2 decimal places',
  })
  target_cash?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  target_crates?: number | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  /** §6.1's worked example is "15.07.2026 цільове значення 600 → 800, керівник,
   *  причина: розширили точку". The reason is not stored on the row — targets
   *  keep no history — it becomes the audit entry's note. */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}
```

Create `backend/src/collection-points/dto/list-collection-points.query.ts`:

```ts
import { IsBooleanString, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListCollectionPointsQueryDto extends PaginationQueryDto {
  /** Deactivated points are hidden by default — they exist for history, not
   *  for picking from a list. */
  @IsOptional()
  @IsBooleanString()
  include_inactive?: string;
}
```

Create `backend/src/collection-points/collection-point.mapper.ts`:

```ts
import { CollectionPoint } from './collection-point.entity';
import { PointKind } from './point-kind.enum';

export interface CollectionPointResponse {
  id: string;
  name: string;
  kind: PointKind;
  /** `numeric` — a string, or null for "not set". NEVER 0, and never a number:
   *  a client that receives 0 cannot tell an unset target from a zero one, and
   *  §6.9 needs exactly that distinction to render "—". */
  target_cash: string | null;
  target_crates: number | null;
  is_active: boolean;
  created_at: string;
}

export function toCollectionPointResponse(point: CollectionPoint): CollectionPointResponse {
  return {
    id: point.id,
    name: point.name,
    kind: point.kind,
    target_cash: point.target_cash,
    target_crates: point.target_crates,
    is_active: point.is_active,
    created_at: point.created_at.toISOString(),
  };
}
```

- [ ] **Step 5: Write the service**

Create `backend/src/collection-points/collection-points.service.ts`:

```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CollectionPoint } from './collection-point.entity';
import { CreateCollectionPointDto } from './dto/create-collection-point.dto';
import { UpdateCollectionPointDto } from './dto/update-collection-point.dto';
import { ListCollectionPointsQueryDto } from './dto/list-collection-points.query';
import { CollectionPointResponse, toCollectionPointResponse } from './collection-point.mapper';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { assertOwnsPoint, resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const TARGET_FIELDS = ['target_cash', 'target_crates'] as const;

@Injectable()
export class CollectionPointsService {
  constructor(
    @InjectRepository(CollectionPoint)
    private readonly repo: Repository<CollectionPoint>,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: ListCollectionPointsQueryDto,
  ): Promise<Paginated<CollectionPointResponse>> {
    const pointId = resolvePointFilter(actor);
    const where: Record<string, unknown> = {};
    // An operator sees exactly one row: their own point. Derived from the
    // actor, never from a query parameter.
    if (pointId) where.id = pointId;
    if (query.include_inactive !== 'true') where.is_active = true;

    const [data, total] = await this.repo.findAndCount({
      where,
      order: { name: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });

    return { data: data.map(toCollectionPointResponse), total, page: query.page, limit: query.limit };
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<CollectionPointResponse> {
    const point = await this.repo.findOne({ where: { id } });
    if (!point) throw new NotFoundException('Collection point not found');
    assertOwnsPoint(actor, point.id);
    return toCollectionPointResponse(point);
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreateCollectionPointDto,
  ): Promise<CollectionPointResponse> {
    const point = await this.repo.save(
      this.repo.create({
        name: dto.name,
        kind: dto.kind,
        // ?? null, never ?? 0 — see CollectionPoint's doc comment.
        target_cash: dto.target_cash ?? null,
        target_crates: dto.target_crates ?? null,
      }),
    );

    await this.audit.record({
      action: 'point.created',
      actor_id: actor.sub,
      target_type: 'collection_point',
      target_id: point.id,
      after: { name: point.name, kind: point.kind },
    });

    return toCollectionPointResponse(point);
  }

  async update(
    actor: AuthenticatedUser,
    id: string,
    dto: UpdateCollectionPointDto,
  ): Promise<CollectionPointResponse> {
    const point = await this.repo.findOne({ where: { id } });
    if (!point) throw new NotFoundException('Collection point not found');

    if (dto.is_active === false && point.is_active) await this.assertNoActiveUsers(point.id);

    const targetsBefore = this.targetsOf(point);
    const before = { name: point.name, kind: point.kind, is_active: point.is_active };

    // `in`, not a truthiness check: an explicit null CLEARS a target back to
    // "not known", while an absent field leaves it alone (§6.9).
    if ('name' in dto && dto.name !== undefined) point.name = dto.name;
    if ('kind' in dto && dto.kind !== undefined) point.kind = dto.kind;
    if ('is_active' in dto && dto.is_active !== undefined) point.is_active = dto.is_active;
    if ('target_cash' in dto) point.target_cash = dto.target_cash ?? null;
    if ('target_crates' in dto) point.target_crates = dto.target_crates ?? null;

    const saved = await this.repo.save(point);
    const targetsAfter = this.targetsOf(saved);

    const movedTargets = TARGET_FIELDS.filter((f) => targetsBefore[f] !== targetsAfter[f]);
    if (movedTargets.length > 0) {
      // The DBML says outright that author and reason for a target change are
      // "не зберігається" anywhere in the schema, since targets carry no
      // history. They are recorded HERE instead: the audit log is not target
      // state, it does not feed any calculation, and §6.1's own worked example
      // shows exactly this information.
      await this.audit.record({
        action: 'point.target-changed',
        actor_id: actor.sub,
        target_type: 'collection_point',
        target_id: saved.id,
        before: Object.fromEntries(movedTargets.map((f) => [f, targetsBefore[f]])),
        after: Object.fromEntries(movedTargets.map((f) => [f, targetsAfter[f]])),
        note: dto.reason ?? null,
      });
    }

    const after = { name: saved.name, kind: saved.kind, is_active: saved.is_active };
    const movedFields = (Object.keys(before) as (keyof typeof before)[]).filter(
      (k) => before[k] !== after[k],
    );
    if (movedFields.length > 0) {
      await this.audit.record({
        action: 'point.updated',
        actor_id: actor.sub,
        target_type: 'collection_point',
        target_id: saved.id,
        before: Object.fromEntries(movedFields.map((k) => [k, before[k]])),
        after: Object.fromEntries(movedFields.map((k) => [k, after[k]])),
        note: dto.reason ?? null,
      });
    }

    return toCollectionPointResponse(saved);
  }

  private targetsOf(point: CollectionPoint): Record<(typeof TARGET_FIELDS)[number], unknown> {
    return { target_cash: point.target_cash, target_crates: point.target_crates };
  }

  /**
   * A point cannot be deactivated while someone still calls it home: their
   * token stays valid and every scoping assertion would silently match
   * nothing. The error names them so the owner knows what to reassign.
   *
   * TODO (when `shifts` lands): also refuse while an open shift exists at this
   * point. §7.8 — two open shifts are two books for one drawer; a point that
   * disappears under an open one is the same class of problem.
   */
  private async assertNoActiveUsers(pointId: string): Promise<void> {
    const assigned = await this.users.findActiveAtPoint(pointId);
    if (assigned.length === 0) return;

    const names = assigned.map((u) => `${u.first_name} ${u.last_name}`).join(', ');
    throw new ConflictException({
      message: `Reassign these users before deactivating this point: ${names}`,
      code: 'POINT_HAS_ACTIVE_USERS',
    });
  }
}
```

- [ ] **Step 6: Write the controller and wire the module**

Create `backend/src/collection-points/collection-points.controller.ts`:

```ts
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { CollectionPointsService } from './collection-points.service';
import { CreateCollectionPointDto } from './dto/create-collection-point.dto';
import { UpdateCollectionPointDto } from './dto/update-collection-point.dto';
import { ListCollectionPointsQueryDto } from './dto/list-collection-points.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * There is no DELETE here and there never will be — §5.6, deactivation is the
 * only removal verb the domain has.
 *
 * The literal route is declared before the parameterised one: HTTP resolves
 * handlers in registration order.
 */
@Controller('collection-points')
export class CollectionPointsController {
  constructor(private readonly points: CollectionPointsService) {}

  @Get()
  @Auth()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListCollectionPointsQueryDto) {
    return this.points.list(actor, query);
  }

  @Get(':id')
  @Auth()
  findOne(@CurrentUser() actor: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.points.findOne(actor, id);
  }

  @Post()
  @Auth(UserRole.NetworkOwner)
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateCollectionPointDto) {
    return this.points.create(actor, dto);
  }

  /** §10.2 — only the owner changes a target. On the operator's screen the
   *  control does not EXIST rather than appearing disabled: «заблокована кнопка
   *  вчить шукати обхід, відсутня не вчить нічого». That is the UI's half of
   *  this rule; this decorator is the API's. */
  @Patch(':id')
  @Auth(UserRole.NetworkOwner)
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectionPointDto,
  ) {
    return this.points.update(actor, id, dto);
  }
}
```

Update `backend/src/collection-points/collection-points.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CollectionPoint } from './collection-point.entity';
import { CollectionPointsService } from './collection-points.service';
import { CollectionPointsController } from './collection-points.controller';
import { UsersModule } from '../users/users.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([CollectionPoint]), UsersModule, AuditModule],
  controllers: [CollectionPointsController],
  providers: [CollectionPointsService],
  exports: [TypeOrmModule, CollectionPointsService],
})
export class CollectionPointsModule {}
```

- [ ] **Step 7: Prove the role gate over real HTTP**

Add a second test to `backend/src/testing/pipeline.db-spec.ts`:

```ts
  it('refuses an operator an owner-only route, and allows the owner', async () => {
    const points = app.get(CollectionPointsService);
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);

    const ownerActor = { sub: '', username: '', role: UserRole.NetworkOwner, collection_point_id: null };
    const { user: ownerUser } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `owner-${randomUUID()}`,
        first_name: 'Net',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    ownerActor.sub = ownerUser.id;

    const point = await points.create(ownerActor, { name: `pipeline-point-${randomUUID()}` });

    const operatorLogin = `op-${randomUUID()}`;
    await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: operatorLogin,
        first_name: 'Оксана',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: point.id,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );

    const tokenFor = async (username: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: 'hunter2!!' })
        .expect(200);
      return res.body.access_token as string;
    };

    const operatorToken = await tokenFor(operatorLogin);

    // The operator can READ points…
    await request(app.getHttpServer())
      .get('/collection-points')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    // …and cannot create one. This is the RolesGuard, running for real.
    await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'forbidden' })
      .expect(403);
  }, 30_000);
```

with the added imports for `CollectionPointsService` and `UserRole`.

- [ ] **Step 8: Run everything**

Run: `npm test && npm run test:db && npm run lint`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/collection-points backend/src/users/users.service.ts \
        backend/src/audit/audit-log.entity.ts backend/src/testing/pipeline.db-spec.ts
git commit -m "feat(backend): add the collection-points module with owner-only targets"
```

---

### Task 7: `user-admin` module — owner-administered accounts

`users` stays a **domain** module (entities, invariants, write seams, no controller). The admin scenarios live in a separate **operations** module, exactly as `current-user` already does for `/me`. That split is earned here and not elsewhere: three modules read and write `users` data (`auth`, `current-user`, `user-admin`), so "who may write this" becomes a matter of module structure rather than of discipline.

**Files:**
- Create: `backend/src/users/normalize-login.ts`, `backend/src/user-admin/user-admin.module.ts`, `user-admin.service.ts`, `user-admin.service.spec.ts`, `users.controller.ts`, `user.mapper.ts`, `dto/create-user.dto.ts`, `dto/update-user.dto.ts`, `dto/set-password.dto.ts`, `dto/list-users.query.ts`
- Modify: `backend/src/users/users.service.ts`, `backend/src/auth/auth.service.ts`, `backend/src/auth/auth.service.spec.ts`, `backend/src/app.module.ts`, `backend/src/collection-points/collection-points.service.ts` (adds the `findOneRaw` read seam — see Step 6)

**Interfaces:**
- Consumes: everything from Tasks 3, 5 and 6, plus `CollectionPointsService` (to validate an assignment).
- Produces:
  - `normalizeLogin(raw: string): string` (`users/normalize-login.ts`) — moved verbatim from `AuthService.normalizeUsername`
  - `UserResponse = { id, login, first_name, last_name, display_name, role, collection_point_id, is_active, avatar_url, created_at }`
  - `toUserResponse(user: User, login: string): UserResponse`
  - `UsersService.countActiveOwners(excludeUserId?: string): Promise<number>`
  - `UsersService.list(opts: { page; limit; collection_point_id?; include_inactive? }): Promise<[User[], number]>`
  - `UsersService.setLogin(userId: string, login: string, manager?: EntityManager): Promise<void>`
  - `UsersService.findLogin(userId: string): Promise<string | null>`

- [ ] **Step 1: Write the failing service spec**

Create `backend/src/user-admin/user-admin.service.spec.ts`:

```ts
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { UserAdminService } from './user-admin.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const owner: AuthenticatedUser = {
  sub: 'u-owner',
  username: 'owner',
  role: UserRole.NetworkOwner,
  collection_point_id: null,
};

describe('UserAdminService', () => {
  let users: Record<string, jest.Mock>;
  let credentials: Record<string, jest.Mock>;
  let points: Record<string, jest.Mock>;
  let audit: Record<string, jest.Mock>;
  let service: UserAdminService;

  const target = (over: Record<string, unknown> = {}) => ({
    id: 'u-target',
    first_name: 'Оксана',
    last_name: 'Приймальник',
    role: UserRole.PointOperator,
    collection_point_id: 'p-1',
    is_active: true,
    avatar_url: null,
    created_at: new Date('2026-07-15T06:00:00.000Z'),
    ...over,
  });

  beforeEach(() => {
    users = {
      findById: jest.fn().mockResolvedValue(target()),
      findByIdentity: jest.fn().mockResolvedValue(null),
      findLogin: jest.fn().mockResolvedValue('oksana'),
      countActiveOwners: jest.fn().mockResolvedValue(2),
      createWithIdentity: jest.fn(),
      update: jest.fn().mockImplementation((_id, dto) => Promise.resolve(target(dto))),
      setLogin: jest.fn(),
      list: jest.fn().mockResolvedValue([[target()], 1]),
    };
    credentials = { set: jest.fn() };
    points = { findOneRaw: jest.fn().mockResolvedValue({ id: 'p-1', is_active: true }) };
    audit = { record: jest.fn() };
    service = new UserAdminService(
      users as never,
      credentials as never,
      points as never,
      audit as never,
    );
  });

  describe('role ↔ point coherence', () => {
    it('refuses to create an operator with no collection point', async () => {
      await expect(
        service.create(owner, {
          first_name: 'A',
          last_name: 'B',
          login: 'ab',
          password: 'hunter2!!',
          role: UserRole.PointOperator,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses to create an owner pinned to a collection point', async () => {
      await expect(
        service.create(owner, {
          first_name: 'A',
          last_name: 'B',
          login: 'ab',
          password: 'hunter2!!',
          role: UserRole.NetworkOwner,
          collection_point_id: 'p-1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears the point when promoting an operator to owner', async () => {
      await service.update(owner, 'u-target', { role: UserRole.NetworkOwner });
      expect(users.update).toHaveBeenCalledWith(
        'u-target',
        expect.objectContaining({ role: UserRole.NetworkOwner, collection_point_id: null }),
      );
    });

    it('refuses to demote an owner to operator without giving them a point', async () => {
      users.findById.mockResolvedValue(target({ role: UserRole.NetworkOwner, collection_point_id: null }));
      await expect(
        service.update(owner, 'u-target', { role: UserRole.PointOperator }),
      ).rejects.toThrow(BadRequestException);
    });

    // A DIFFERENT point than the one the user already has: `update` only
    // validates a point it is actually moving them to, so reassigning someone
    // to the point they are already at must not re-run the check.
    it('refuses a move to a point that is deactivated', async () => {
      points.findOneRaw.mockResolvedValue({ id: 'p-2', is_active: false });
      await expect(
        service.update(owner, 'u-target', { collection_point_id: 'p-2' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('lockout guards', () => {
    it('refuses to demote the last active owner', async () => {
      users.findById.mockResolvedValue(target({ id: 'u-last', role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(0); // none left once u-last is excluded

      await expect(
        service.update(owner, 'u-last', { role: UserRole.PointOperator, collection_point_id: 'p-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to deactivate the last active owner', async () => {
      users.findById.mockResolvedValue(target({ id: 'u-last', role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(0);

      await expect(service.update(owner, 'u-last', { is_active: false })).rejects.toThrow(
        ConflictException,
      );
    });

    // Even with another owner standing by: the recovery cost is total, and
    // nobody demotes themselves on purpose.
    it('refuses self-demotion outright', async () => {
      users.findById.mockResolvedValue(target({ id: owner.sub, role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(5);

      await expect(
        service.update(owner, owner.sub, { role: UserRole.PointOperator, collection_point_id: 'p-1' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses self-deactivation outright', async () => {
      users.findById.mockResolvedValue(target({ id: owner.sub, role: UserRole.NetworkOwner, collection_point_id: null }));
      users.countActiveOwners.mockResolvedValue(5);

      await expect(service.update(owner, owner.sub, { is_active: false })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows an owner to edit their own name', async () => {
      users.findById.mockResolvedValue(target({ id: owner.sub, role: UserRole.NetworkOwner, collection_point_id: null }));
      await expect(service.update(owner, owner.sub, { first_name: 'Новий' })).resolves.toBeDefined();
    });
  });

  describe('login', () => {
    // '  OKSANA2 ' normalises to 'oksana2', which DIFFERS from the current
    // 'oksana' — a value normalising back to the user's own login is a no-op
    // and is deliberately not checked, so it would prove nothing here.
    it('normalises and rejects a taken login', async () => {
      users.findByIdentity.mockResolvedValue({ user: { id: 'someone-else' } });
      await expect(service.update(owner, 'u-target', { login: '  OKSANA2 ' })).rejects.toThrow(
        ConflictException,
      );
      expect(users.findByIdentity).toHaveBeenCalledWith('local', 'oksana2');
    });

    it('does not touch the identity row when the login normalises to the current one', async () => {
      await service.update(owner, 'u-target', { login: '  OKSANA ' });
      expect(users.setLogin).not.toHaveBeenCalled();
    });

    it('allows a login change to a free value, and audits it', async () => {
      await service.update(owner, 'u-target', { login: 'Oksana2' });
      expect(users.setLogin).toHaveBeenCalledWith('u-target', 'oksana2');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'user.updated',
          before: expect.objectContaining({ login: 'oksana' }),
          after: expect.objectContaining({ login: 'oksana2' }),
        }),
      );
    });
  });

  describe('setPassword', () => {
    it('stores the new password and audits the fact without the value', async () => {
      await service.setPassword(owner, 'u-target', { password: 'nova-parolya' });

      expect(credentials.set).toHaveBeenCalledWith('u-target', 'nova-parolya');
      const entry = audit.record.mock.calls[0][0];
      expect(entry.action).toBe('user.password-changed');
      expect(entry.before).toBeUndefined();
      expect(entry.after).toBeUndefined();
      expect(JSON.stringify(entry)).not.toContain('nova-parolya');
    });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- user-admin`
Expected: FAIL — `Cannot find module './user-admin.service'`.

- [ ] **Step 3: Move login normalisation into the users domain**

Create `backend/src/users/normalize-login.ts` with the body of `AuthService.normalizeUsername`, renamed:

```ts
/**
 * Logins are compared case-insensitively and stored lowercased, so `Оксана`
 * and `оксана` can never be two accounts. Done here rather than in the
 * database so the existing UNIQUE (provider, provider_user_id) index keeps
 * working for every provider without a functional index.
 *
 * Lives in the users domain rather than in `auth` because two modules now
 * normalise: `auth` on the login path, and `user-admin` when the owner
 * creates an account or changes someone's login. Two copies of this rule
 * would eventually disagree, and the disagreement would look like a login
 * that exists but cannot sign in.
 */
export function normalizeLogin(raw: string): string {
  return raw.trim().toLowerCase();
}
```

In `backend/src/auth/auth.service.ts`, delete the local `normalizeUsername` and import `normalizeLogin` instead. There is exactly one call site left — `login` — since Task 2 deleted `register`. In `auth.service.spec.ts`, move the `describe('normalizeUsername', …)` block into a new `backend/src/users/normalize-login.spec.ts` testing `normalizeLogin` with the same assertions.

- [ ] **Step 4: Extend UsersService with the admin seams**

Add to `backend/src/users/users.service.ts`:

```ts
  /** How many ACTIVE owners exist, optionally ignoring one user — the shape the
   *  lockout guard needs: "if I change this person, is anyone left?" */
  async countActiveOwners(excludeUserId?: string): Promise<number> {
    const qb = this.userRepo
      .createQueryBuilder('u')
      .where('u.role = :role', { role: UserRole.NetworkOwner })
      .andWhere('u.is_active = true');
    if (excludeUserId) qb.andWhere('u.id != :excludeUserId', { excludeUserId });
    return qb.getCount();
  }

  async list(opts: {
    page: number;
    limit: number;
    collection_point_id?: string;
    include_inactive?: boolean;
  }): Promise<[User[], number]> {
    const where: Record<string, unknown> = {};
    if (opts.collection_point_id) where.collection_point_id = opts.collection_point_id;
    if (!opts.include_inactive) where.is_active = true;

    return this.userRepo.findAndCount({
      where,
      order: { last_name: 'ASC', first_name: 'ASC' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    });
  }

  /**
   * The write seam for the login itself, which lives on the identity row.
   * Callers normalise and check availability first — the UNIQUE index is the
   * real guarantee, and a race loses with a 500 rather than a duplicate.
   *
   * A query builder rather than `repo.update({ user: { id } }, …)`: TypeORM's
   * `update()` does NOT resolve a nested relation in its criteria, and would
   * silently match no rows. `findOne` does support that form — which is why
   * `findAuthContext` above can use it and this cannot.
   */
  async setLogin(userId: string, login: string, manager?: EntityManager): Promise<void> {
    const repo = manager ? manager.getRepository(UserIdentity) : this.identityRepo;
    const result = await repo
      .createQueryBuilder()
      .update(UserIdentity)
      .set({ provider_user_id: login })
      .where('provider = :provider AND user_id = :userId', {
        provider: LOCAL_PROVIDER,
        userId,
      })
      .execute();
    if (result.affected === 0) throw new NotFoundException('User has no local login');
  }

  async findLogin(userId: string): Promise<string | null> {
    const context = await this.findAuthContext(userId);
    return context?.login ?? null;
  }
```

with `import { UserRole } from './user-role.enum';` added.

- [ ] **Step 5: Write the DTOs and the mapper**

Create `backend/src/user-admin/user.mapper.ts`:

```ts
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.enum';

export interface UserResponse {
  id: string;
  login: string;
  first_name: string;
  last_name: string;
  /** DERIVED — there is no display_name column. */
  display_name: string;
  role: UserRole;
  collection_point_id: string | null;
  is_active: boolean;
  avatar_url: string | null;
  created_at: string;
}

export function toUserResponse(user: User, login: string): UserResponse {
  return {
    id: user.id,
    login,
    first_name: user.first_name,
    last_name: user.last_name,
    display_name: `${user.first_name} ${user.last_name}`.trim(),
    role: user.role,
    collection_point_id: user.collection_point_id,
    is_active: user.is_active,
    avatar_url: user.avatar_url,
    created_at: user.created_at.toISOString(),
  };
}
```

Create `backend/src/user-admin/dto/create-user.dto.ts`:

```ts
import { IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { UserRole } from '../../users/user-role.enum';

export class CreateUserDto {
  @IsString()
  @Length(1, 64)
  first_name: string;

  @IsString()
  @Length(1, 64)
  last_name: string;

  /** Not an email: §5.7's own reasoning applies to staff too — a point
   *  operator may have no address at all, and a login is what they actually
   *  type. Whitespace is excluded so two logins can never differ by an
   *  invisible character. */
  @IsString()
  @Length(3, 64)
  @Matches(/^\S+$/, { message: 'login must not contain whitespace' })
  login: string;

  /** The password policy for NEW credentials. Tighten it freely — LoginDto
   *  deliberately has no length rule, so tightening never locks out an
   *  existing account. */
  @IsString()
  @Length(8, 128)
  password: string;

  @IsEnum(UserRole)
  role: UserRole;

  /** Required for a point_operator, forbidden for a network_owner — see
   *  CHK_users_role_point. UserAdminService checks it before the database has
   *  to. */
  @IsOptional()
  @IsUUID()
  collection_point_id?: string | null;
}
```

Create `backend/src/user-admin/dto/update-user.dto.ts`:

```ts
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';
import { UserRole } from '../../users/user-role.enum';

/**
 * `login` is editable on purpose: users can never be deleted (§5.6), so a
 * login typed wrong at creation would otherwise be permanent — and the person
 * types it every morning.
 *
 * There is no `password` field here; issuing a password is its own endpoint
 * so that it can be audited as a distinct fact.
 */
export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  first_name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  last_name?: string;

  @IsOptional()
  @IsString()
  @Length(3, 64)
  @Matches(/^\S+$/, { message: 'login must not contain whitespace' })
  login?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsUUID()
  collection_point_id?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
```

Create `backend/src/user-admin/dto/set-password.dto.ts`:

```ts
import { IsString, Length } from 'class-validator';

/**
 * No `current_password`: the owner is ISSUING a password, not changing their
 * own. There is no self-service change endpoint — §17.2's reading is that a
 * password checked at the point, where the owner is not standing, is an
 * access control rather than a signature, so the owner administers it.
 */
export class SetPasswordDto {
  @IsString()
  @Length(8, 128)
  password: string;
}
```

Create `backend/src/user-admin/dto/list-users.query.ts`:

```ts
import { IsBooleanString, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  collection_point_id?: string;

  @IsOptional()
  @IsBooleanString()
  include_inactive?: string;
}
```

- [ ] **Step 6: Write the service**

Create `backend/src/user-admin/user-admin.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { AuditService } from '../audit/audit.service';
import { UserRole } from '../users/user-role.enum';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { normalizeLogin } from '../users/normalize-login';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { ListUsersQueryDto } from './dto/list-users.query';
import { UserResponse, toUserResponse } from './user.mapper';
import { Paginated } from '../common/dto/paginated';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

@Injectable()
export class UserAdminService {
  constructor(
    private readonly users: UsersService,
    private readonly credentials: CredentialsService,
    private readonly points: CollectionPointsService,
    private readonly audit: AuditService,
  ) {}

  async list(actor: AuthenticatedUser, query: ListUsersQueryDto): Promise<Paginated<UserResponse>> {
    const [rows, total] = await this.users.list({
      page: query.page,
      limit: query.limit,
      collection_point_id: query.collection_point_id,
      include_inactive: query.include_inactive === 'true',
    });

    const data = await Promise.all(
      rows.map(async (u) => toUserResponse(u, (await this.users.findLogin(u.id)) ?? '')),
    );
    return { data, total, page: query.page, limit: query.limit };
  }

  async create(actor: AuthenticatedUser, dto: CreateUserDto): Promise<UserResponse> {
    const login = normalizeLogin(dto.login);
    const pointId = dto.collection_point_id ?? null;

    this.assertRolePointCoherent(dto.role, pointId);
    if (pointId) await this.assertPointUsable(pointId);
    await this.assertLoginFree(login);

    const { user } = await this.users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: login,
        first_name: dto.first_name,
        last_name: dto.last_name,
        role: dto.role,
        collection_point_id: pointId,
      },
      // Credentials are written inside the creation transaction: a user row
      // with no credential row could never log in and could never be created
      // again, because the login would already be taken.
      async (created, manager) => this.credentials.set(created.id, dto.password, manager),
    );

    await this.audit.record({
      action: 'user.created',
      actor_id: actor.sub,
      target_type: 'user',
      target_id: user.id,
      after: { login, role: dto.role, collection_point_id: pointId },
    });

    return toUserResponse(user, login);
  }

  async update(
    actor: AuthenticatedUser,
    userId: string,
    dto: UpdateUserDto,
  ): Promise<UserResponse> {
    const user = await this.users.findById(userId);
    const currentLogin = (await this.users.findLogin(userId)) ?? '';

    const nextRole = dto.role ?? user.role;
    const nextActive = dto.is_active ?? user.is_active;

    // Promotion clears the home point, demotion demands one — computed here so
    // role and point always move in a single UPDATE and CHK_users_role_point
    // is never transiently violated.
    const nextPoint =
      nextRole === UserRole.NetworkOwner
        ? null
        : 'collection_point_id' in dto
          ? (dto.collection_point_id ?? null)
          : user.collection_point_id;

    this.assertRolePointCoherent(nextRole, nextPoint);
    if (nextPoint && nextPoint !== user.collection_point_id) await this.assertPointUsable(nextPoint);

    const demoting = user.role === UserRole.NetworkOwner && nextRole !== UserRole.NetworkOwner;
    const deactivating = user.is_active && !nextActive;

    if (userId === actor.sub && (demoting || deactivating)) {
      // Refused even when another owner exists: nobody does this on purpose,
      // and the recovery cost is total.
      throw new ForbiddenException({
        message: 'You cannot demote or deactivate your own account',
        code: 'SELF_LOCKOUT',
      });
    }

    if (user.role === UserRole.NetworkOwner && (demoting || deactivating)) {
      // Registration is gone and the bootstrap migration only fires on an empty
      // users table, so zero active owners means no way back in short of
      // direct database access — and no other owner to call, since passwords
      // are owner-issued.
      const remaining = await this.users.countActiveOwners(userId);
      if (remaining === 0) {
        throw new ConflictException({
          message: 'This is the last active network owner; promote someone else first',
          code: 'LAST_OWNER',
        });
      }
    }

    let nextLogin = currentLogin;
    if (dto.login !== undefined) {
      nextLogin = normalizeLogin(dto.login);
      if (nextLogin !== currentLogin) {
        await this.assertLoginFree(nextLogin);
        await this.users.setLogin(userId, nextLogin);
      }
    }

    const updated = await this.users.update(userId, {
      ...(dto.first_name !== undefined ? { first_name: dto.first_name } : {}),
      ...(dto.last_name !== undefined ? { last_name: dto.last_name } : {}),
      role: nextRole,
      collection_point_id: nextPoint,
      is_active: nextActive,
    });

    const before = {
      login: currentLogin,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      collection_point_id: user.collection_point_id,
      is_active: user.is_active,
    };
    const after = {
      login: nextLogin,
      first_name: updated.first_name,
      last_name: updated.last_name,
      role: updated.role,
      collection_point_id: updated.collection_point_id,
      is_active: updated.is_active,
    };
    const moved = (Object.keys(before) as (keyof typeof before)[]).filter(
      (k) => before[k] !== after[k],
    );

    // A no-op PATCH must not write an entry: an audit log full of noise is one
    // nobody reads.
    if (moved.length > 0) {
      await this.audit.record({
        action: 'user.updated',
        actor_id: actor.sub,
        target_type: 'user',
        target_id: userId,
        before: Object.fromEntries(moved.map((k) => [k, before[k]])),
        after: Object.fromEntries(moved.map((k) => [k, after[k]])),
      });
    }

    return toUserResponse(updated, nextLogin);
  }

  /** Issues a password. No old password is required — the owner is not
   *  changing theirs, they are setting someone else's. */
  async setPassword(
    actor: AuthenticatedUser,
    userId: string,
    dto: SetPasswordDto,
  ): Promise<void> {
    await this.users.findById(userId);
    await this.credentials.set(userId, dto.password);

    // THE FACT, NEVER THE VALUE. No before/after: there is nothing about a
    // password that belongs in a queryable log.
    await this.audit.record({
      action: 'user.password-changed',
      actor_id: actor.sub,
      target_type: 'user',
      target_id: userId,
    });
  }

  private assertRolePointCoherent(role: UserRole, pointId: string | null): void {
    if (role === UserRole.PointOperator && !pointId) {
      throw new BadRequestException({
        message: 'A point operator must have a collection point',
        code: 'OPERATOR_NEEDS_POINT',
      });
    }
    if (role === UserRole.NetworkOwner && pointId) {
      throw new BadRequestException({
        message: 'A network owner belongs to the network, not to a collection point',
        code: 'OWNER_HAS_NO_POINT',
      });
    }
  }

  private async assertPointUsable(pointId: string): Promise<void> {
    // Read through the owning module rather than querying its table directly:
    // reads across domains are open, but they still go through the owner.
    const point = await this.points.findOneRaw(pointId);
    if (!point || !point.is_active) {
      throw new BadRequestException({
        message: 'That collection point does not exist or is deactivated',
        code: 'POINT_UNUSABLE',
      });
    }
  }

  /** A pre-check for a friendly 409. The UNIQUE index is still the real
   *  guarantee — two simultaneous writes both pass this, and the loser gets a
   *  500 rather than a silent duplicate. */
  private async assertLoginFree(login: string): Promise<void> {
    if (await this.users.findByIdentity(LOCAL_PROVIDER, login)) {
      throw new ConflictException({ message: 'That login is taken', code: 'LOGIN_TAKEN' });
    }
  }
}
```

Add the read seam this depends on to `backend/src/collection-points/collection-points.service.ts`:

```ts
  /** The entity, unmapped and unscoped — for other modules that need to
   *  validate a point exists and is usable. Reads across domains are open;
   *  going through the owner keeps them from growing their own query. */
  async findOneRaw(id: string): Promise<CollectionPoint | null> {
    return this.repo.findOne({ where: { id } });
  }
```

- [ ] **Step 7: Write the controller and the module**

Create `backend/src/user-admin/users.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Auth } from '../auth/decorators/auth.decorators';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user-role.enum';
import { UserAdminService } from './user-admin.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { ListUsersQueryDto } from './dto/list-users.query';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * Every route here is owner-only, so the role sits on the CLASS rather than
 * being repeated per handler — one place to read, and a new handler cannot
 * forget it.
 *
 * There is no DELETE: users are deactivated, never removed (§5.6), and every
 * document carries their id under ON DELETE RESTRICT anyway.
 */
@Controller('users')
@Auth(UserRole.NetworkOwner)
export class UsersController {
  constructor(private readonly admin: UserAdminService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: ListUsersQueryDto) {
    return this.admin.list(actor, query);
  }

  @Post()
  create(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateUserDto) {
    return this.admin.create(actor, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.admin.update(actor, id, dto);
  }

  @Put(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  setPassword(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetPasswordDto,
  ): Promise<void> {
    return this.admin.setPassword(actor, id, dto);
  }
}
```

Create `backend/src/user-admin/user-admin.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CollectionPointsModule } from '../collection-points/collection-points.module';
import { AuditModule } from '../audit/audit.module';
import { UserAdminService } from './user-admin.service';
import { UsersController } from './users.controller';

/**
 * The operations module over the `users` domain — it owns no data of its own
 * and writes users only through UsersService/CredentialsService, the seams
 * that module exposes. Mirrors how `current-user` owns `/me`.
 */
@Module({
  imports: [UsersModule, CollectionPointsModule, AuditModule],
  controllers: [UsersController],
  providers: [UserAdminService],
})
export class UserAdminModule {}
```

Register `UserAdminModule` in `backend/src/app.module.ts`'s `imports`, after `CurrentUserModule`.

- [ ] **Step 8: Run everything**

Run: `npm test && npm run test:db && npm run lint`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/user-admin backend/src/users backend/src/auth backend/src/collection-points \
        backend/src/app.module.ts
git commit -m "feat(backend): add owner-administered user management"
```

---

### Task 8: Bootstrap owner, timezone, and documentation

**Files:**
- Create: `backend/src/migrations/1788600000003-BootstrapOwner.ts`
- Modify: `backend/src/app.module.ts`, `backend/src/config/timezone.config.ts`, `.env.example`, `README.md`, `CLAUDE.md`, `backend/CLAUDE.md`, `backend/src/migrations/schema.db-spec.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no new code interfaces — four new environment variables (`BOOTSTRAP_OWNER_LOGIN`, `BOOTSTRAP_OWNER_PASSWORD`, `BOOTSTRAP_OWNER_FIRST_NAME`, `BOOTSTRAP_OWNER_LAST_NAME`) and a changed `APP_TIMEZONE` default.

- [ ] **Step 1: Write the failing db-spec**

Append to `backend/src/migrations/schema.db-spec.ts`, inside the `YagodaFoundation` describe block or a new `BootstrapOwner` one:

```ts
describe('BootstrapOwner', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  // The test database is not empty (SeedDevAdmin ran), and BOOTSTRAP_OWNER_*
  // is unset here. Both are reasons to no-op, and this asserts the migration
  // took neither as licence to invent an account.
  it('creates no owner when the users table is not empty', async () => {
    const rows = await ds.query(
      `SELECT 1 FROM user_identities WHERE provider = 'local' AND provider_user_id = 'bootstrap-owner'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('left the dev admin as a usable network owner', async () => {
    const [row] = await ds.query(
      `SELECT u.role, u.collection_point_id, c.password_hash
         FROM user_identities i
         JOIN users u ON u.id = i.user_id
         JOIN user_credentials c ON c.user_id = u.id
        WHERE i.provider = 'local' AND i.provider_user_id = 'admin'`,
    );
    expect(row.role).toBe('network_owner');
    expect(row.collection_point_id).toBeNull();
    // The migration re-hashed the plain-text seed value in place.
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch the second case fail**

Run: `npm run test:db -- schema`
Expected: the second case FAILS if the test database predates Task 3 — recreate it (`dropdb`/`createdb` as in Task 3, Step 7) so all migrations apply from scratch, then it should pass; the first case passes trivially until the migration exists.

- [ ] **Step 3: Write the bootstrap migration**

Create `backend/src/migrations/1788600000003-BootstrapOwner.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';
import { hashPassword } from '../users/password-hashing';

/**
 * Creates the first network_owner from the environment, so a fresh production
 * database is reachable at all: public registration is gone, and only an owner
 * can create accounts.
 *
 * NO-OPS unless the users table is EMPTY. It will therefore not fire in
 * development (SeedDevAdmin already ran) and cannot overwrite anything.
 *
 * ⚠️ KNOWN SHARP EDGE, ACCEPTED: a migration runs once. If a production
 * database is first booted WITHOUT these variables set, this records itself as
 * applied and no owner is ever created — recovery is a manual INSERT. Set
 * BOOTSTRAP_OWNER_LOGIN and BOOTSTRAP_OWNER_PASSWORD before the first boot.
 * A boot-time idempotent bootstrap would not have this property; it was
 * decided as a migration deliberately, and the trade-off is named rather than
 * discovered.
 */
export class BootstrapOwner1788600000003 implements MigrationInterface {
  name = 'BootstrapOwner1788600000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const login = process.env.BOOTSTRAP_OWNER_LOGIN?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
    if (!login || !password) return;

    const [{ count }] = await queryRunner.query(`SELECT count(*)::int AS count FROM "users"`);
    if (count > 0) return;

    const firstName = process.env.BOOTSTRAP_OWNER_FIRST_NAME?.trim() || 'Network';
    const lastName = process.env.BOOTSTRAP_OWNER_LAST_NAME?.trim() || 'Owner';

    const [user] = await queryRunner.query(
      `INSERT INTO "users" ("first_name", "last_name", "role", "is_active")
       VALUES ($1, $2, 'network_owner', true) RETURNING "id"`,
      [firstName, lastName],
    );
    await queryRunner.query(
      `INSERT INTO "user_identities" ("provider", "provider_user_id", "user_id")
       VALUES ('local', $1, $2)`,
      [login, user.id],
    );
    await queryRunner.query(
      `INSERT INTO "user_credentials" ("user_id", "password_hash") VALUES ($1, $2)`,
      [user.id, await hashPassword(password)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const login = process.env.BOOTSTRAP_OWNER_LOGIN?.trim().toLowerCase();
    if (!login) return;
    await queryRunner.query(
      `DELETE FROM "users" WHERE "id" IN (
         SELECT "user_id" FROM "user_identities"
         WHERE "provider" = 'local' AND "provider_user_id" = $1
       )`,
      [login],
    );
  }
}
```

- [ ] **Step 4: Update config and environment**

In `backend/src/app.module.ts`'s Joi schema, change the timezone default and add the bootstrap variables:

```ts
        APP_TIMEZONE: Joi.string().default('Europe/Kyiv'),
        // Read ONLY by the BootstrapOwner migration, and only when the users
        // table is empty. Unset in development, where SeedDevAdmin covers it.
        BOOTSTRAP_OWNER_LOGIN: Joi.string().optional(),
        BOOTSTRAP_OWNER_PASSWORD: Joi.string().min(8).optional(),
        BOOTSTRAP_OWNER_FIRST_NAME: Joi.string().optional(),
        BOOTSTRAP_OWNER_LAST_NAME: Joi.string().optional(),
```

In `backend/src/config/timezone.config.ts`, change the fallback to `'Europe/Kyiv'` and update the comment to name the new default (the file already documents that this must stay in step with the Joi default).

In `.env.example`, set `APP_TIMEZONE=Europe/Kyiv` and add the four bootstrap variables, commented, with a line saying they are read once and only when the database has no users. Tell the developer to update their own `.env` — it is not committed, so nothing else will.

- [ ] **Step 5: Update the documentation**

In the root `CLAUDE.md`:
- Delete the "⚠️ Before you deploy this" section about plain-text passwords — it is no longer true, and a stale warning trains people to ignore warnings.
- In **Auth**, replace the description: login + password, JWT (HS256, 7 days) carrying only `sub`; `JwtStrategy.validate()` reloads the user each request, so deactivation, demotion and point reassignment take effect immediately; two roles (`network_owner`, `point_operator`); `@Auth()` / `@Auth(UserRole.NetworkOwner)`; no public registration.
- In **Architecture**, add a **Domain** line: the schema of record is `28-db-schema.dbml`; this slice implements `users` and `collection_points`; the spec lives at `docs/superpowers/specs/2026-09-04-yagoda-foundation-slice.md`.

In `backend/CLAUDE.md`:
- Replace the "Password storage is a deliberate placeholder" bullet with the scrypt contract and the self-describing format.
- Update the "Route protection" bullet for `@Auth(...roles)` and add the guard-vs-`assert*` boundary.
- Update **Structure** with `collection-points/`, `user-admin/`, and `users/password-hashing.ts`.
- Add a bullet: `numeric` is a string end to end; no arithmetic on money in this slice; `decimal.js` arrives with the first module that computes something.
- Note in **Migrations** that `SeedDevAdmin` is deliberately not amended (ordering) and that `BootstrapOwner` must have its env vars set before the first production boot.

In `README.md`: replace any "register an account" getting-started step with the dev admin credentials, and document the four bootstrap variables in the deployment section.

- [ ] **Step 6: Run everything one last time**

```bash
npm test && npm run test:db && npm run lint && npm run build
cd ../frontend && npm test && npm run lint && npm run build
```
Expected: all PASS.

- [ ] **Step 7: Verify the whole stack actually boots**

```bash
cd .. && docker compose up -d --build
curl -sf localhost:3000/health/ready
curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}'
```
Expected: `/health/ready` returns 200, and login returns an `access_token` — proving the migration re-hashed the seeded plain-text password in place rather than orphaning it.

- [ ] **Step 8: Commit**

```bash
git add backend/src .env.example README.md CLAUDE.md backend/CLAUDE.md
git commit -m "feat: bootstrap the first network owner; document the Yagoda foundation"
```

---

## Verification Checklist

Run before calling this done. Every line is a decision from the spec that would otherwise be provable only by reading code.

- [ ] `npm test` passes in both workspaces.
- [ ] `npm run test:db` passes.
- [ ] `npm run lint` and `npm run build` pass in both workspaces.
- [ ] `docker compose up` boots and `admin`/`admin` can log in.
- [ ] `POST /auth/register` returns 404.
- [ ] An operator's token gets 403 from `POST /collection-points` and 200 from `GET /collection-points`.
- [ ] `GET /collection-points` returns exactly one row for an operator, all rows for the owner.
- [ ] Deactivating a user makes their **existing** token return 401 on the next request.
- [ ] A point created with no targets returns `"target_cash": null`, not `"0.00"` or `0`.
- [ ] `PATCH /collection-points/:id` with `{"target_crates": null}` clears it; without the field, leaves it.
- [ ] `SELECT password_hash FROM user_credentials` shows only `scrypt$…` values.
- [ ] `grep -rn "display_name" backend/src` finds only derived-value sites, never a column.
- [ ] Demoting the last active owner returns 409; demoting yourself returns 403.

---

## Open Questions and Deferred Work

Recorded so they are decisions rather than discoveries.

1. **`collection_points.name UNIQUE` is not in the DBML.** Added here on the reasoning in the spec's §6.1. If the schema's silence turns out to be deliberate, dropping the constraint is a one-line migration.
2. **The bootstrap migration's once-only nature** (spec §3.3). If the first production boot happens without the env vars set, recovery is a manual `INSERT`.
3. **The open-shift guard on point deactivation** is a `TODO` in `CollectionPointsService.assertNoActiveUsers`'s doc comment, not an omission — `shifts` does not exist yet.
4. **Audit action granularity.** Role, point, login and activation changes all record as `user.updated` with `before`/`after` naming the fields that moved, rather than as six separate actions. Identical information, one thing to keep in step instead of six. If a consumer ever needs to filter on "role changes only", splitting them is a code change with no migration — `AUDIT_ACTIONS` is a TS union stored as `varchar`.
5. **`useUpdateMeMutation` has no caller** after Task 4. Kept deliberately, as `shared/lib/form-draft` and `shared/lib/url-state` are.
6. **No admin UI.** Points and users are managed over the API until their screens are designed — including §10.2's rule that the target control must be *absent*, not disabled, for an operator.
7. **`decimal.js` is not yet a dependency.** The representation rule (`numeric` → `string`) is in force from now on; the arithmetic module arrives with the first module that computes something.
8. **The API calls the same thing two names.** `POST /auth/login` takes `username` (the starter's wording, mirrored in the frontend's `Credentials` type and `LoginForm`), while `POST /users` and `PATCH /users/:id` take `login` (the DBML's wording, and what the person on the point actually calls it). Unifying on `login` is the right end state and is deliberately NOT done here: it changes the public auth contract and every frontend caller, which is a rename worth doing on its own rather than buried in a foundation slice. Flagged so it is a scheduled decision, not drift.
