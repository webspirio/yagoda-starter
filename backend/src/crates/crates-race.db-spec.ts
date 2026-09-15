import { randomUUID } from 'crypto';
// `export = supertest`: this repo's tsconfig has no `esModuleInterop`, so a
// default import type-checks and then resolves to `undefined` at runtime.
import request = require('supertest');
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
// MUST be imported before `../app.module` — it loads `.env` as a side effect,
// and AppModule's decorator runs ConfigModule.forRoot() eagerly at import time.
import { relaxThrottleForTests, resolveTestDatabaseName } from '../testing/db-harness';

import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';

/**
 * UNVERIFIED AT WRITE TIME — no Postgres was reachable in this environment;
 * see `crates.db-spec.ts`'s own header for the same constraint and for which
 * source files backed every assertion here. It MUST be run —
 * `npm run test:db -w backend -- crates-race` — and pass before this slice
 * merges.
 *
 * Modelled on `payouts/payout-race.db-spec.ts` and the "two payouts in flight"
 * block of `testing/documents-pipeline.db-spec.ts`, but through the actual
 * crates routes rather than the bare locking primitive: two concurrent
 * `POST /crate-returns` for one supplier must not double-allocate the same
 * tranche capacity (`CratesService.returnCrates` locks the supplier row with
 * `SELECT ... FOR UPDATE` before reading `tranchesFor`), and two concurrent
 * `POST /crate-issuances` in one (shift, mode) must both succeed with
 * distinct codes (`nextIssuanceCode`'s `pg_advisory_xact_lock`, taken inside
 * the same transaction as the insert — see that function's own doc comment
 * for what breaks if the lock and the insert ever end up in different
 * transactions).
 */
describe('crates concurrency (HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let operatorToken: string;
  let pointId: string;

  const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    relaxThrottleForTests();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
    ds = app.get(DataSource);

    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);
    const tokenFor = (userId: string): string => jwt.sign({ sub: userId });

    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `crates-race-owner-${randomUUID()}`,
        first_name: 'Race',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const ownerToken = tokenFor(owner.id);

    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `crates-race-point-${randomUUID()}`, code: pointCode() })
      .expect(201);
    pointId = pointRes.body.id as string;

    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `crates-race-op-${randomUUID()}`,
        first_name: 'Гонка',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    operatorToken = tokenFor(operator.id);

    // Exactly one crate type must exist — `CratesService.issue` 409s
    // `NO_CRATE_TYPE` without it.
    await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Race-crate-${randomUUID()}`,
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/shifts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '0.00' })
      .expect(201);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('two concurrent returns for one supplier cannot double-allocate', async () => {
    const supplierRes = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Гонка', last_name: `Постачальник-${randomUUID()}` })
      .expect(201);
    const supplierId = supplierRes.body.id as string;

    const issuanceRes = await request(app.getHttpServer())
      .post('/crate-issuances')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierId, units: 20, mode: 'deposit' })
      .expect(201);
    const issuanceId = issuanceRes.body.id as string;

    const attempt = () =>
      request(app.getHttpServer())
        .post('/crate-returns')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, units: 20 });

    const [a, b] = await Promise.allSettled([attempt(), attempt()]);
    const statuses = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.status : 500));

    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 400)).toHaveLength(1);

    const refused = [a, b].find(
      (r): r is PromiseFulfilledResult<request.Response> =>
        r.status === 'fulfilled' && r.value.status === 400,
    );
    expect(refused?.value.body.code).toBe('RETURN_EXCEEDS_OUTSTANDING');

    const [{ n }] = (await ds.query(
      `SELECT COALESCE(SUM(units), 0)::int AS n FROM crate_return_allocations WHERE issuance_id = $1`,
      [issuanceId],
    )) as { n: number }[];
    expect(n).toBe(20);
  });

  it('two concurrent issuances in one shift and mode get distinct codes', async () => {
    const supplierRes = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Гонка', last_name: `Видача-${randomUUID()}` })
      .expect(201);
    const supplierId = supplierRes.body.id as string;

    const attempt = () =>
      request(app.getHttpServer())
        .post('/crate-issuances')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, units: 5, mode: 'deposit' });

    const results = await Promise.all([attempt(), attempt()]);

    expect(results.every((r) => r.status === 201)).toBe(true);
    const codes = results.map((r) => r.body.code as string);
    expect(new Set(codes).size).toBe(2);
  });
});
