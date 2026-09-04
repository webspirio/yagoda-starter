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
// MUST be imported before `../app.module`: this file's own top-level code
// loads `.env` into process.env as a side effect. `AppModule`'s `@Module()`
// decorator calls `ConfigModule.forRoot()` — including its Joi validation —
// EAGERLY, at import time (it's a plain function call inside the decorator's
// argument object, not something deferred to `compile()`). TypeScript hoists
// every `import` above other top-level statements when it compiles to
// CommonJS, so a `config()` call written after these imports would run too
// late regardless of where it sits in this file — the only lever left is
// import ORDER, which TypeScript does preserve.
import { resolveTestDatabaseName } from './db-harness';
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

    const tokenFor = async (username: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username, password: 'hunter2!!' })
        .expect(200);
      return res.body.access_token as string;
    };

    const ownerLogin = `owner-${randomUUID()}`;
    await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: ownerLogin,
        first_name: 'Net',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const ownerToken = await tokenFor(ownerLogin);

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
      .send({ name: `pipeline-point-${randomUUID()}` })
      .expect(201);
    const pointId = createRes.body.id as string;

    const operatorLogin = `op-${randomUUID()}`;
    await users.createWithIdentity(
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
   * `/auth/login`: that controller is capped at 10 requests/min per IP (see
   * AuthController) and the two tests above already spend three of them, so
   * two `npm run test:db` runs inside a minute would start 429-ing. The tokens
   * are real — JwtStrategy still reloads each user from the database on every
   * request below.
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
      .send({ name: `admin-point-${randomUUID()}` })
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
    const selfRes = await request(app.getHttpServer())
      .patch(`/users/${boss.id}`)
      .set('Authorization', `Bearer ${bossToken}`)
      .send({ is_active: false })
      .expect(403);
    expect(selfRes.body.message).toContain('your own account');
  }, 30_000);
});
