import { randomUUID } from 'crypto';
// `export = supertest` (CommonJS export assignment, see @types/supertest) —
// this repo's tsconfig has no `esModuleInterop`, so a default import
// (`import request from 'supertest'`) type-checks (allowSyntheticDefaultImports)
// but resolves to `undefined` at runtime under ts-jest. `import ... = require(...)`
// is the interop-independent form for an `export =` module.
import request = require('supertest');
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
// MUST be imported before `../app.module`: this file's own top-level code
// loads `.env` into process.env as a side effect. `AppModule`'s `@Module()`
// decorator calls `ConfigModule.forRoot()` — including its Joi validation —
// EAGERLY, at import time (it's a plain function call inside the decorator's
// argument object, not something deferred to `compile()`). TypeScript hoists
// every `import` above other top-level statements when it compiles to
// CommonJS, so a `config()` call written after these imports would run too
// late regardless of where it sits in this file — the only lever left is
// import ORDER, which TypeScript does preserve.
import {
  ensureTestDatabase,
  relaxThrottleForTests,
  resolveTestDatabaseName,
} from './db-harness';

/** A unique, CHECK-valid `collection_points.code`. Required on create since the
 *  intakes & payouts slice — it is the first segment of every receipt code
 *  written at the point (spec §6.2). */
const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';

/**
 * The one HTTP-layer test (design review item I3): drives the real Nest
 * pipeline — controllers, guards, the global ValidationPipe,
 * ClassSerializerInterceptor, and AllExceptionsFilter — through supertest,
 * against a real Postgres. Nothing else in this repo would fail if `@Auth()`
 * stopped guarding `MeController` or if the global `ValidationPipe`'s
 * `forbidNonWhitelisted` were misconfigured; every other spec mocks its
 * collaborators and never sees the actual HTTP plumbing. It does NOT cover
 * `ClassSerializerInterceptor`: `CurrentUserService.getMe` returns a
 * hand-built plain `MeResponse`, not an entity with `@Exclude()`-annotated
 * fields, so the assertion below on `meRes.body` would pass identically with
 * the interceptor removed from `main.ts`.
 *
 * Lives beside `db-harness.ts` (a `*.db-spec.ts`, so `npm run test:db` picks
 * it up — see `jest.db.config.js`; the unit `testRegex` does not match this
 * filename) and reuses its guarded test-database name rather than
 * `openTestDataSource`'s `DataSource` itself: this spec needs the FULL Nest
 * app (controllers, guards, pipes), which builds its own TypeORM connection
 * via `AppModule`'s `TypeOrmModule.forRootAsync` — so instead of a bare
 * `DataSource`, `DB_NAME` is pointed at the same guarded database before the
 * app is compiled, and `AppModule` connects to it exactly as it would in
 * production. `migrationsRun: true` (app.module.ts) then applies the schema.
 *
 * No truncation and no `insertTestUser`/`applyMigrations` (removed as dead
 * code — see I7): every user this spec creates gets a random username, so
 * repeat runs against a persistent `app_test` database never collide and
 * there is nothing to clean up between runs, matching
 * `migrations/schema.db-spec.ts`'s own convention.
 */
describe('auth + me pipeline (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    // This suite boots the whole AppModule rather than opening a DataSource through
    // `openTestDataSource()`, so nothing here creates the database the app is about to
    // connect to — it just expects it to be there. It was, on a laptop (created once by
    // hand, kept by pg_data) and on the Actions `services:` Postgres (POSTGRES_DB:
    // app_test), which is why this line was missing for as long as it was. It is NOT
    // there on the Compose Postgres the `verify` job now brings up, nor on any laptop
    // after `docker compose down -v`, and the failure is a 3-second retry loop that ends
    // in every test here timing out and jest never exiting. Creates, never resets: this
    // file's fixtures are uuid-scoped precisely because app_test persists.
    await ensureTestDatabase();
    relaxThrottleForTests();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();

    // Mirrors main.ts exactly: this spec exists to prove these two lines
    // matter, so it has to actually run under them.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('registers, logs in, and reads/guards the profile through the real pipeline', async () => {
    // Random per run: no truncation, so a fixed username would collide with
    // a prior run against the same persistent app_test database.
    const username = `pipeline-${randomUUID()}`;
    const password = 'hunter2!!';

    // Registration no longer exists as an endpoint, so the fixture user is
    // created through the same domain services `POST /users` uses. This is
    // still an end-to-end token: it is minted by the real /auth/login below.
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: username,
        first_name: 'Pipeline',
        last_name: 'User',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, password, manager),
    );

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password })
      .expect(200);
    expect(loginRes.body).toEqual({ access_token: expect.any(String) });

    const token = loginRes.body.access_token as string;

    // No @Auth() left standing in for a check: this is the actual guard.
    await request(app.getHttpServer()).get('/me').expect(401);

    const meRes = await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(meRes.body).toEqual({
      id: expect.any(String),
      username,
      display_name: 'Pipeline User',
      avatar_url: null,
      language_code: null,
      role: 'network_owner',
      collection_point_id: null,
    });

    // The global ValidationPipe's forbidNonWhitelisted: true, exercised for
    // real rather than asserted against a mocked pipe.
    await request(app.getHttpServer())
      .patch('/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ not_a_real_property: 'x' })
      .expect(400);

    // The token stays cryptographically valid — nothing revokes it. What
    // changes is that JwtStrategy.validate() now reads the user row, so the
    // very next request with the SAME token is rejected. This is the only
    // test in the repo that proves deactivation actually does anything.
    await users.update(meRes.body.id, { is_active: false });

    await request(app.getHttpServer())
      .get('/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('refuses an operator an owner-only route, and allows the owner', async () => {
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);

    // Signed with the app's own JwtService, NOT minted through `/auth/login`.
    // AuthController caps that route at 10 requests/min per IP (see its own
    // comment), and `npm run test:db` is not idempotent within a minute:
    // every test in this file shares that one Redis-backed counter, so two
    // runs inside 60s would 429 here instead of asserting 403/200 — a
    // misleading failure in an AUTHORIZATION test, which is the worst place
    // to teach a team that red means noise. The one exception is the first
    // test above, which is the only end-to-end proof that scrypt
    // verification actually works over a real `/auth/login` POST; every
    // other token in this file is minted this way, matching the newest test
    // below (which never had this problem, because it always did this).
    // The token is still real: JwtStrategy.validate() reloads the user from
    // the database on every request below regardless of how it was signed.
    const tokenFor = (userId: string): string => jwt.sign({ sub: userId });

    const ownerLogin = `owner-${randomUUID()}`;
    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: ownerLogin,
        first_name: 'Net',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const ownerToken = tokenFor(owner.id);

    // The owner CAN create a point — over the REAL pipeline (login, then this
    // POST with the minted token), not a direct service call. Without this
    // half, a RolesGuard that denied every role would also pass this test:
    // the "allows the owner" half of its name has to actually exercise the
    // allow path, not just the deny path below. `pipeline-point-${randomUUID()}`
    // keeps the name unique on every run — `collection_points.name` is UNIQUE
    // and `app_test` is never truncated.
    const createRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `pipeline-point-${randomUUID()}`, code: pointCode() })
      .expect(201);
    const pointId = createRes.body.id as string;

    const operatorLogin = `op-${randomUUID()}`;
    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: operatorLogin,
        first_name: 'Оксана',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const operatorToken = tokenFor(operator.id);

    // The operator can READ points…
    await request(app.getHttpServer())
      .get('/collection-points')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    // …and cannot create one. This is the RolesGuard, running for real.
    await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: 'forbidden', code: pointCode() })
      .expect(403);
  }, 30_000);

  /**
   * The owner-administered user surface, over the real pipeline. Everything it
   * proves is invisible to `user-admin.service.spec.ts`, which hands the
   * service plain object literals and never sees the ValidationPipe:
   *
   *  - `@Auth(UserRole.NetworkOwner)` on the CLASS (the repo's first) actually
   *    reaches every handler, including ones carrying no decorator of their own;
   *  - a PATCH that does not mention `collection_point_id` leaves it alone.
   *    `useDefineForClassFields` (ES2023 target) puts every declared field on
   *    the transformed instance as `undefined`, so an `in` check here would be
   *    permanently true and this PATCH would 400 on OPERATOR_NEEDS_POINT;
   *  - an explicit `null` is a 400 on a NOT NULL field and an APPLIED value on
   *    the nullable `collection_point_id` — the asymmetry, both directions;
   *  - promotion moves `role` and `collection_point_id` in ONE update, so
   *    CHK_users_role_point never sees the intermediate row. Nothing but a real
   *    Postgres can fail this one.
   *
   * Tokens are signed with the app's own JwtService rather than minted through
   * `/auth/login`, same as the "refuses an operator" test above and for the
   * same reason: that controller is capped at 10 requests/min per IP (see
   * AuthController), and this file's very first test already spends the only
   * `/auth/login` call it needs — it is the one end-to-end proof that scrypt
   * verification works over real HTTP, so it stays a real login. Minting the
   * rest avoids two `npm run test:db` runs inside a minute 429-ing on a route
   * this test isn't even about. The tokens are still real — JwtStrategy still
   * reloads each user from the database on every request below.
   */
  it('administers accounts through POST/PATCH/PUT /users, owner-only', async () => {
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);

    const { user: boss } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `boss-${randomUUID()}`,
        first_name: 'Головний',
        last_name: 'Власник',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const bossToken = jwt.sign({ sub: boss.id });

    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ name: `admin-point-${randomUUID()}`, code: pointCode() })
      .expect(201);
    const pointId = pointRes.body.id as string;

    // Staff are HIRED, not signed up: this endpoint is the only way an account
    // comes into existence now that registration is gone.
    const login = `hired-${randomUUID()}`;
    const createRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${bossToken}`)
      .send({
        first_name: 'Оксана',
        last_name: 'Приймальник',
        login,
        password: 'hunter2!!',
        role: 'point_operator',
        collection_point_id: pointId,
      })
      .expect(201);
    expect(createRes.body).toMatchObject({
      login,
      display_name: 'Оксана Приймальник',
      role: 'point_operator',
      collection_point_id: pointId,
      is_active: true,
    });
    const hiredId = createRes.body.id as string;

    // The class-level role, running for real. The handler carries no decorator
    // of its own — the guard has to find the role on the controller class.
    const hiredToken = jwt.sign({ sub: hiredId });
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${hiredToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${bossToken}`)
      .expect(200);

    // ABSENT collection_point_id: leave it alone. This is the assertion that
    // fails if anyone reintroduces `'collection_point_id' in dto`.
    const renamed = await request(app.getHttpServer())
      .patch(`/users/${hiredId}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ first_name: 'Оксана-Марія' })
      .expect(200);
    expect(renamed.body).toMatchObject({
      first_name: 'Оксана-Марія',
      collection_point_id: pointId,
    });

    // NULL on a NOT NULL field: 400, not a 500 from the database.
    await request(app.getHttpServer())
      .patch(`/users/${hiredId}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ first_name: null })
      .expect(400);

    // NULL on the nullable one: accepted by the DTO, APPLIED by the service —
    // and refused by the invariant, because an operator must have a point.
    const cleared = await request(app.getHttpServer())
      .patch(`/users/${hiredId}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ collection_point_id: null })
      .expect(400);
    expect(cleared.body.message).toContain('collection point');

    // Promotion: role and point move together, in one UPDATE. Two statements
    // here would trip CHK_users_role_point and return a 500.
    const promoted = await request(app.getHttpServer())
      .patch(`/users/${hiredId}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ role: 'network_owner' })
      .expect(200);
    expect(promoted.body).toMatchObject({ role: 'network_owner', collection_point_id: null });

    // The owner ISSUES a password; nothing about it comes back in the response.
    await request(app.getHttpServer())
      .put(`/users/${hiredId}/password`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ password: 'nova-parolya' })
      .expect(204);
    expect(await credentials.verify(hiredId, 'nova-parolya')).toBe(true);

    // Self-lockout, refused outright — there are plenty of other active owners
    // in this database, and it is still refused.
    //
    // UPPERCASED on purpose, against a real Postgres: `uuid` comparison is
    // case-insensitive and ParseUUIDPipe accepts this form, so the row loads
    // and every SQL-side check behaves — which is exactly what made comparing
    // the raw route param to `actor.sub` (the one case-sensitive step in the
    // chain) a way to walk straight past SELF_LOCKOUT. If this 403 ever
    // becomes a 200, that comparison has regressed to the route param.
    const selfRes = await request(app.getHttpServer())
      .patch(`/users/${boss.id.toUpperCase()}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ is_active: false })
      .expect(403);
    expect(selfRes.body.message).toContain('your own account');
  }, 30_000);
});

describe('suppliers + grade prices (HTTP)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let operatorToken: string;
  // The audit assertions below check `actor_id`, which is the user id — not the
  // token — so the fixture keeps both.
  let operatorUserId: string;
  let pointA: string;
  let pointB: string;
  // Built in Task 4; consumed by Task 6's grade-price tests below, which
  // reuse it rather than duplicating this fixture's ~60 lines of setup.
  let gradeId: string;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    // This suite boots the whole AppModule rather than opening a DataSource through
    // `openTestDataSource()`, so nothing here creates the database the app is about to
    // connect to — it just expects it to be there. It was, on a laptop (created once by
    // hand, kept by pg_data) and on the Actions `services:` Postgres (POSTGRES_DB:
    // app_test), which is why this line was missing for as long as it was. It is NOT
    // there on the Compose Postgres the `verify` job now brings up, nor on any laptop
    // after `docker compose down -v`, and the failure is a 3-second retry loop that ends
    // in every test here timing out and jest never exiting. Creates, never resets: this
    // file's fixtures are uuid-scoped precisely because app_test persists.
    await ensureTestDatabase();
    relaxThrottleForTests();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();

    const jwt = app.get(JwtService);
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const run = randomUUID();

    // Points and a grade, created through the API's own owner so the fixture
    // exercises nothing this suite is not already testing elsewhere.
    const bootstrapOwner = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `sup-owner-${run}`,
        first_name: 'Ціно',
        last_name: 'Ставник',
        role: UserRole.NetworkOwner,
        collection_point_id: null,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    ownerToken = jwt.sign({ sub: bootstrapOwner.user.id });

    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Точка А-${run}`, kind: 'reception', code: pointCode() })
      .expect(201);
    pointA = pointRes.body.id;

    const pointBRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Точка Б-${run}`, kind: 'reception', code: pointCode() })
      .expect(201);
    pointB = pointBRes.body.id;

    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Малина-${run}` })
      .expect(201);

    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: `1 сорт-${run}` })
      .expect(201);
    gradeId = gradeRes.body.id;

    const op = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `sup-op-${run}`,
        first_name: 'Оксана',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointA,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    operatorUserId = op.user.id;
    operatorToken = jwt.sign({ sub: op.user.id });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  const uniquePhone = () => `067${String(Math.floor(1e6 + Math.random() * 9e6))}`;

  it('lets an OPERATOR create a supplier at their own point, deriving the point from the token', async () => {
    const res = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Коваль-${randomUUID()}`, phone: uniquePhone() })
      .expect(201);

    expect(res.body.collection_point_id).toBe(pointA);
    expect(res.body.phone).toMatch(/^\+380\d{9}$/);
  });

  it('refuses an operator creating at another point', async () => {
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        collection_point_id: pointB,
        first_name: 'Іван',
        last_name: `Чужий-${randomUUID()}`,
      })
      .expect(403);
  });

  it('400s on a phone it cannot canonicalize', async () => {
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Кривий-${randomUUID()}`, phone: '067123' })
      .expect(400);
  });

  it('finds a supplier by the last four digits of their phone', async () => {
    const phone = uniquePhone();
    const last = `Пошук-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: last, phone })
      .expect(201);

    // The NEGATIVE control. Everything at this point fits inside one page, so
    // `.some(...)` alone proves «found», never «narrowed» — deleting the whole
    // `q` branch would leave it green. A supplier with NO phone can never
    // match `s.phone LIKE`, so this is deterministic rather than a 1-in-10⁴
    // collision.
    const decoy = `Ігнор-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: decoy })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/suppliers?limit=100&q=${phone.slice(-4)}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const names = res.body.data.map((s: { last_name: string }) => s.last_name);
    expect(names).toContain(last);
    expect(names).not.toContain(decoy);
  });

  it('finds a supplier by a Cyrillic fragment of their name', async () => {
    // A FRAGMENT, not the whole name — proving the ILIKE substring match, and
    // Cyrillic to prove it against real Postgres collation on non-ASCII text,
    // which nothing else here checks. §12's "by partial phone and by name
    // fragment" is otherwise only proven at the unit level against a mocked
    // query builder.
    const last = `Гончаренко-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Марія', last_name: last, phone: uniquePhone() })
      .expect(201);

    // Negative control, same reasoning as the phone-fragment test above. The
    // uuid suffix is hex, so «Мельник-…» can never contain «ончарен».
    const decoy = `Мельник-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Марія', last_name: decoy, phone: uniquePhone() })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/suppliers?limit=100&q=ончарен')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const names = res.body.data.map((s: { last_name: string }) => s.last_name);
    expect(names).toContain(last);
    expect(names).not.toContain(decoy);
  });

  it('scopes an operator’s list to their own point even when another is requested', async () => {
    // The pointB supplier is created HERE rather than relied on from a later
    // test. Without it the requested point holds no rows at all, so the
    // honour-the-request bug this test exists to catch returns `[]` — and
    // `[].every(...)` is TRUE. The assertion has to have something to reject.
    const elsewhere = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointB,
        first_name: 'Оксана',
        last_name: `Чужа-Список-${randomUUID()}`,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/suppliers?limit=100&collection_point_id=${pointB}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    // Non-empty is an ASSERTION, not an assumption: it is what stops
    // everything below it from passing vacuously.
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.map((s: { id: string }) => s.id)).not.toContain(elsewhere.body.id);
    expect(
      res.body.data.every((s: { collection_point_id: string }) => s.collection_point_id === pointA),
    ).toBe(true);
  });

  it('returns 404, NOT 403, for another point’s supplier', async () => {
    const created = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointB,
        first_name: 'Петро',
        last_name: `Інший-${randomUUID()}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(404);
  });

  it('rejects collection_point_id in a PATCH body — the point is immutable', async () => {
    const created = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Незмінний-${randomUUID()}` })
      .expect(201);

    // `forbidNonWhitelisted: true` turns an unknown property into a 400 — which
    // is what makes "absent from the DTO" an enforced rule rather than a note.
    await request(app.getHttpServer())
      .patch(`/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ collection_point_id: pointB })
      .expect(400);
  });

  it('lets the OWNER set a price and the OPERATOR read it back as the current one', async () => {
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: gradeId,
        base_price: '52',
        max_markup: '30',
        max_discount: '20',
        reason: 'конкуренти підняли',
      })
      .expect(201);

    // A second row for the same pair — §4.2's history. No UNIQUE forbids it,
    // and the LATER one must win.
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: gradeId,
        base_price: '55',
        max_markup: '30',
        max_discount: '20',
      })
      .expect(201);

    const current = await request(app.getHttpServer())
      .get('/grade-prices/current')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const row = current.body.data.find(
      (p: { product_grade_id: string }) => p.product_grade_id === gradeId,
    );
    // '55' in, '55.00' out — @CanonicalDecimal() plus numeric(10,2), carried
    // as a STRING the whole way.
    expect(row).toMatchObject({ base_price: '55.00', max_markup: '30.00' });
    expect(typeof row.base_price).toBe('string');

    // Both rows survive in the journal; nothing was overwritten.
    const journal = await request(app.getHttpServer())
      .get(`/grade-prices?product_grade_id=${gradeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(journal.body.total).toBeGreaterThanOrEqual(2);
    expect(journal.body.data[0].base_price).toBe('55.00');
  });

  it('403s an operator trying to set a price', async () => {
    // The one assertion proving the owner-only split reached the decorators.
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: gradeId,
        base_price: '99',
        max_markup: '30',
        max_discount: '20',
      })
      .expect(403);
  });

  it('400s on a negative limit before it reaches the CHECK constraint', async () => {
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: gradeId,
        base_price: '52',
        max_markup: '-1',
        max_discount: '20',
      })
      .expect(400);
  });

  it('rejects a duplicate phone at the same point — canonically — and allows it at another', async () => {
    const phone = uniquePhone();
    // The same number as a human would retype it at 06:40: spaces, no country
    // code. `canonicalizePhone` folds both to one `+380…`, which is the ONLY
    // reason `UQ_suppliers_point_phone` on raw text is worth anything.
    const spaced = `${phone.slice(0, 3)} ${phone.slice(3, 6)} ${phone.slice(6, 8)} ${phone.slice(8)}`;

    await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Перший-${randomUUID()}`, phone })
      .expect(201);

    const conflict = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Інший', last_name: `Дублікат-${randomUUID()}`, phone: spaced })
      .expect(409);
    expect(conflict.body.code).toBe('SUPPLIER_PHONE_TAKEN');

    // The SAME number at another point is a DIFFERENT person as far as this
    // table is concerned — the unique index is on the PAIR. One human bringing
    // berries to two points has two supplier rows and two balances, and §5.5's
    // merge tool was cancelled by правка 6, so this is permanent, intended, and
    // worth a test that fails loudly if the index is ever narrowed to `phone`.
    const elsewhere = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointB,
        first_name: 'Іван',
        last_name: `Той-Самий-${randomUUID()}`,
        phone,
      })
      .expect(201);
    expect(elsewhere.body.collection_point_id).toBe(pointB);
    expect(elsewhere.body.phone).toBe(`+38${phone}`);
  });

  it('treats % and _ in the search box as literal characters, not wildcards', async () => {
    // Without the ESCAPE clause in `SuppliersService.list`, `?q=%` matches
    // every supplier at the point and `?q=_` any single character — a search
    // box that silently dumps the whole customer list. Unit-proven against a
    // mocked query builder; this is the same claim against real Postgres.
    const run = randomUUID();
    const wildcard = `Сто%Відсотків-${run}`;
    const underscore = `Іва_н-${run}`;
    const plain = `Звичайний-${run}`;

    for (const last_name of [wildcard, underscore, plain]) {
      await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ first_name: 'Пошук', last_name })
        .expect(201);
    }

    const lastNames = async (q: string): Promise<string[]> => {
      const res = await request(app.getHttpServer())
        .get(`/suppliers?limit=100&q=${encodeURIComponent(q)}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      return res.body.data.map((s: { last_name: string }) => s.last_name);
    };

    const percent = await lastNames('%');
    expect(percent).toContain(wildcard);
    expect(percent).not.toContain(plain);

    const under = await lastNames('_');
    expect(under).toContain(underscore);
    expect(under).not.toContain(plain);
  });

  it('answers a cross-point PATCH with 403 and a cross-point GET with 404 — deliberately different', async () => {
    // §8.3: `findOne` hides the row's existence because suppliers are real
    // people's names and phone numbers, while `update` goes through
    // `assertOwnsPoint` and says plainly that the point is not yours. Asserted
    // TOGETHER so the asymmetry reads as the intent it is, and so narrowing
    // either one to match the other fails here.
    const created = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointB,
        first_name: 'Оксана',
        last_name: `Чужа-${randomUUID()}`,
      })
      .expect(201);

    const patch = await request(app.getHttpServer())
      .patch(`/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Перейменована' })
      .expect(403);
    expect(patch.body.code).toBe('WRONG_COLLECTION_POINT');

    await request(app.getHttpServer())
      .get(`/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(404);
  });

  it('audits a supplier create and update, narrows the diff, and writes nothing for a no-op', async () => {
    // Read straight from `audit_log`: there is no audit READ route, and §9's
    // whole argument for wrapping these two writes in a transaction is that
    // the row lands. Nothing else in this repo checks that it does.
    const ds = app.get(DataSource);
    const entries = (targetId: string) =>
      ds.query(
        `SELECT action, actor_id, target_type, before, after
           FROM audit_log WHERE target_id = $1 ORDER BY at, action`,
        [targetId],
      ) as Promise<
        {
          action: string;
          actor_id: string;
          target_type: string;
          before: Record<string, unknown> | null;
          after: Record<string, unknown> | null;
        }[]
      >;

    const phone = uniquePhone();
    const created = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Аудит-${randomUUID()}`, phone })
      .expect(201);

    const afterCreate = await entries(created.body.id);
    expect(afterCreate).toHaveLength(1);
    expect(afterCreate[0]).toMatchObject({
      action: 'supplier.created',
      // The OPERATOR, not the owner — the actor is taken from the token, and
      // suppliers is the one domain module both roles can write.
      actor_id: operatorUserId,
      target_type: 'supplier',
      before: null,
    });
    expect(afterCreate[0].after).toMatchObject({
      collection_point_id: pointA,
      first_name: 'Іван',
      phone: `+38${phone}`,
    });

    await request(app.getHttpServer())
      .patch(`/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Петро' })
      .expect(200);

    const afterUpdate = await entries(created.body.id);
    expect(afterUpdate).toHaveLength(2);
    expect(afterUpdate[1].action).toBe('supplier.updated');
    // `diffFields` narrows to what MOVED: the phone and the surname are
    // untouched and must not appear. A rename reassigns a money balance
    // (see `SuppliersService.update`) and this diff is the only trail of it,
    // so a diff padded with unchanged fields is a trail nobody reads.
    expect(afterUpdate[1].before).toEqual({ first_name: 'Іван' });
    expect(afterUpdate[1].after).toEqual({ first_name: 'Петро' });

    // The same value again is not a change. `diffFields` returns null and the
    // service skips the write — an audit log full of no-op rows is one nobody
    // reads, which is the reason that branch exists.
    await request(app.getHttpServer())
      .patch(`/suppliers/${created.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Петро' })
      .expect(200);

    expect(await entries(created.body.id)).toHaveLength(2);
  });

  it('keeps one current price per (point, grade) PAIR, not one per grade', async () => {
    // The collapse `GradePricesService.current` warns about: keying DISTINCT ON
    // the grade alone would fold every point's price for a grade into one
    // arbitrary row, and an owner reading the network-wide screen would see a
    // price that belongs to some other point. A fresh grade of its own so the
    // earlier price tests' rows cannot mask the result.
    const run = randomUUID();
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Полуниця-${run}` })
      .expect(201);
    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: `Вищий-${run}` })
      .expect(201);
    const pairGradeId: string = gradeRes.body.id;

    for (const [point, base_price] of [
      [pointA, '40'],
      [pointB, '60'],
    ] as const) {
      await request(app.getHttpServer())
        .post('/grade-prices')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          collection_point_id: point,
          product_grade_id: pairGradeId,
          base_price,
          max_markup: '30',
          max_discount: '20',
        })
        .expect(201);
    }

    // Paged rather than read in one shot: an owner with no point filter spans
    // every point, and `app_test` is never truncated, so the number of current
    // prices grows with every run of this suite and this run's two rows are not
    // guaranteed to be on page one.
    const mine: { collection_point_id: string; base_price: string }[] = [];
    // Driven purely off `total`. A hard page cap would be a trap with a long
    // fuse here: `app_test` is never truncated and this read spans every point
    // ever created, so the pair count grows every run and the cap would one day
    // turn this red for a reason unrelated to the code.
    for (let page = 1; ; page++) {
      const res = await request(app.getHttpServer())
        .get(`/grade-prices/current?page=${page}&limit=100`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      mine.push(
        ...res.body.data.filter(
          (p: { product_grade_id: string }) => p.product_grade_id === pairGradeId,
        ),
      );
      if (res.body.page * res.body.limit >= res.body.total) break;
    }

    expect(mine).toHaveLength(2);
    const byPoint = Object.fromEntries(mine.map((p) => [p.collection_point_id, p.base_price]));
    expect(byPoint[pointA]).toBe('40.00');
    expect(byPoint[pointB]).toBe('60.00');
  });

  it('scopes BOTH price reads to an operator’s own point', async () => {
    // Prices for one grade at TWO points, so "sees only their own" is a claim
    // about ROWS rather than about a `params` array handed to a mock. Until
    // this test, `/grade-prices/current` was only read by an operator via
    // `.find()` on its own grade — never asserting another point's row was
    // absent — and `GET /grade-prices` was never read by an operator at all,
    // on any layer above a `jest.fn()`.
    const run = randomUUID();
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Смородина-${run}` })
      .expect(201);
    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: `Перший-${run}` })
      .expect(201);
    const scopedGradeId: string = gradeRes.body.id;

    for (const [point, base_price] of [
      [pointA, '40'],
      [pointB, '60'],
    ] as const) {
      await request(app.getHttpServer())
        .post('/grade-prices')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          collection_point_id: point,
          product_grade_id: scopedGradeId,
          base_price,
          max_markup: '30',
          max_discount: '20',
        })
        .expect(201);
    }

    // Both reads ASK for pointB. An operator must get their own point anyway.
    const current = await request(app.getHttpServer())
      .get(`/grade-prices/current?limit=100&collection_point_id=${pointB}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const mine = current.body.data.filter(
      (p: { product_grade_id: string }) => p.product_grade_id === scopedGradeId,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ collection_point_id: pointA, base_price: '40.00' });

    const journal = await request(app.getHttpServer())
      .get(`/grade-prices?limit=100&product_grade_id=${scopedGradeId}&collection_point_id=${pointB}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(journal.body.total).toBe(1);
    expect(journal.body.data[0]).toMatchObject({
      collection_point_id: pointA,
      base_price: '40.00',
    });
  });

  it('drops a deactivated grade from /current, and returns it with include_inactive', async () => {
    // §4.5's whole mechanism, and the one that carries the most weight after
    // `business_date` was removed — a retired grade must not be offered at
    // intake. It was asserted only against generated SQL text (`pg.is_active =
    // true` appearing in the string), which still matches when the clause is
    // built wrong; nothing observed a row appearing or disappearing.
    const run = randomUUID();
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Ожина-${run}` })
      .expect(201);
    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: `Другий-${run}` })
      .expect(201);
    const retiredGradeId: string = gradeRes.body.id;

    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointA,
        product_grade_id: retiredGradeId,
        base_price: '77',
        max_markup: '10',
        max_discount: '10',
      })
      .expect(201);

    const visible = await request(app.getHttpServer())
      .get(`/grade-prices/current?limit=100&collection_point_id=${pointA}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      visible.body.data.map((p: { product_grade_id: string }) => p.product_grade_id),
    ).toContain(retiredGradeId);

    await request(app.getHttpServer())
      .patch(`/product-grades/${retiredGradeId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ is_active: false })
      .expect(200);

    const afterRetire = await request(app.getHttpServer())
      .get(`/grade-prices/current?limit=100&collection_point_id=${pointA}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(
      afterRetire.body.data.map((p: { product_grade_id: string }) => p.product_grade_id),
    ).not.toContain(retiredGradeId);

    const withInactive = await request(app.getHttpServer())
      .get(`/grade-prices/current?limit=100&collection_point_id=${pointA}&include_inactive=true`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const back = withInactive.body.data.find(
      (p: { product_grade_id: string }) => p.product_grade_id === retiredGradeId,
    );
    expect(back).toMatchObject({ base_price: '77.00' });
  });
});
