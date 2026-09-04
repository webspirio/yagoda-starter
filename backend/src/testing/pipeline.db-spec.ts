import { randomUUID } from 'crypto';
// `export = supertest` (CommonJS export assignment, see @types/supertest) —
// this repo's tsconfig has no `esModuleInterop`, so a default import
// (`import request from 'supertest'`) type-checks (allowSyntheticDefaultImports)
// but resolves to `undefined` at runtime under ts-jest. `import ... = require(...)`
// is the interop-independent form for an `export =` module.
import request = require('supertest');
import { Test } from '@nestjs/testing';
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
});
