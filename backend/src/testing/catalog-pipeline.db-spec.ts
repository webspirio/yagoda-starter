import { randomUUID } from 'crypto';
// `export = supertest`: this repo's tsconfig has no `esModuleInterop`, so a
// default import type-checks and then resolves to `undefined` at runtime.
import request = require('supertest');
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// MUST be imported before `../app.module` — it loads `.env` as a side effect,
// and AppModule's decorator runs ConfigModule.forRoot() eagerly at import time.
import { relaxThrottleForTests, resolveTestDatabaseName } from './db-harness';

/** A unique, CHECK-valid `collection_points.code`. Required on create since the
 *  intakes & payouts slice — it is the first segment of every receipt code
 *  written at the point (spec §6.2). */
const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';

describe('catalog pipeline (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    relaxThrottleForTests();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    // Mirrors main.ts: this spec exists to run under the real pipe chain.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('lets the owner write all three catalogs and refuses the operator every write', async () => {
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);

    // Signed directly, not through /auth/login: that route is rate-limited at
    // 10/min per IP and `npm run test:db` is not idempotent within a minute.
    // The token is still real — JwtStrategy.validate() reloads the user row on
    // every request below.
    const tokenFor = (userId: string): string => jwt.sign({ sub: userId });

    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `cat-owner-${randomUUID()}`,
        first_name: 'Net',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const ownerToken = tokenFor(owner.id);

    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `cat-point-${randomUUID()}`, code: pointCode() })
      .expect(201);

    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `cat-op-${randomUUID()}`,
        first_name: 'Оксана',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointRes.body.id as string,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const operatorToken = tokenFor(operator.id);

    // Names are unique per RUN: app_test persists and is never truncated.
    const productName = `Малина-${randomUUID()}`;
    const tareName = `Ящик-${randomUUID()}`;

    // --- the owner writes ---
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: productName })
      .expect(201);
    expect(productRes.body).toEqual({
      id: expect.any(String),
      name: productName,
      created_at: expect.any(String),
    });

    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: '1 сорт' })
      .expect(201);
    expect(gradeRes.body.product_id).toBe(productRes.body.id);
    expect(gradeRes.body.is_active).toBe(true);

    const tareRes = await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: tareName, weight_kg: '1.20', deposit_price: '120.00', is_crate: true })
      .expect(201);
    // Strings on the wire, not numbers — the money representation rule, proved
    // through the real serializer rather than asserted against a mapper.
    expect(tareRes.body.weight_kg).toBe('1.20');
    expect(tareRes.body.deposit_price).toBe('120.00');

    // --- the operator reads all three ---
    for (const path of ['/products', '/product-grades', '/tare-types']) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({ data: expect.any(Array), total: expect.any(Number) }),
      );
      // The bounded-catalog default, not PaginationQueryDto's 20.
      expect(res.body.limit).toBe(100);
    }

    // --- and is refused every write. This is the RolesGuard, running for real ---
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `nope-${randomUUID()}` })
      .expect(403);

    await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ product_id: productRes.body.id, name: '2 сорт' })
      .expect(403);

    await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ name: `nope-${randomUUID()}`, weight_kg: '1.00', deposit_price: '0.00' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/tare-types/${tareRes.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ deposit_price: '999.00' })
      .expect(403);

    // --- and no DELETE route exists for anyone ---
    await request(app.getHttpServer())
      .delete(`/products/${productRes.body.id}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(404);
  });

  it('treats collection point names as case-insensitive, matching the unique index', async () => {
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);

    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `cat-ci-${randomUUID()}`,
        first_name: 'CI',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const token = jwt.sign({ sub: owner.id });

    const pointName = `Копайгород-${randomUUID()}`;

    await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: pointName, code: pointCode() })
      .expect(201);

    // Same name, only the case differs. `UQ_collection_points_name_lower`
    // folds case, so this must land as a friendly 409 from the service's own
    // pre-check — never a 500 raw stack trace from the index rejecting a
    // case-blind pre-check that let it through.
    await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: pointName.toLowerCase(), code: pointCode() })
      .expect(409);
  });

  it('rejects a query flag that used to be accepted and ignored', async () => {
    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);

    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `cat-flag-${randomUUID()}`,
        first_name: 'Flag',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const token = jwt.sign({ sub: owner.id });

    // '1' now MEANS true rather than silently meaning false…
    await request(app.getHttpServer())
      .get('/tare-types?include_inactive=1')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // …and '2' is a 400 rather than a silent false.
    await request(app.getHttpServer())
      .get('/tare-types?include_inactive=2')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });
});
