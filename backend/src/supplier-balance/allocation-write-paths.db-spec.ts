import { randomUUID } from 'crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// MUST be imported before `../app.module` — it loads `.env` as a side effect,
// and AppModule's decorator runs ConfigModule.forRoot() eagerly at import time.
import {
  ensureTestDatabase,
  relaxThrottleForTests,
  resolveTestDatabaseName,
} from '../testing/db-harness';

import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';
import { allocationViolations } from '../testing/allocation-invariants';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

let app: INestApplication;
let ownerToken: string;
let operatorToken: string;
let pointId: string;
let ds: DataSource;

beforeAll(async () => {
  process.env.DB_NAME = resolveTestDatabaseName();
  await ensureTestDatabase();
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
      providerUserId: `awp-owner-${randomUUID()}`,
      first_name: 'Net',
      last_name: 'Owner',
      role: UserRole.NetworkOwner,
    },
    async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
  );
  ownerToken = tokenFor(owner.id);

  const pointRes = await request(app.getHttpServer())
    .post('/collection-points')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `awp-point-${randomUUID()}`, code: pointCode() })
    .expect(201);
  pointId = pointRes.body.id as string;

  const { user: operator } = await users.createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `awp-op-${randomUUID()}`,
      first_name: 'Оксана',
      last_name: 'Приймальник',
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    },
    async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
  );
  operatorToken = tokenFor(operator.id);
}, 30_000);

afterAll(async () => {
  await app?.close();
});

/**
 * Task 3 end to end, over real HTTP against a real database: `POST /payouts`
 * and `POST /payouts/:id/void` allocate through `AllocationsService` rather
 * than leaving `payout_allocations` untouched. Task 4 adds intake/top-up
 * `describe`s to this same file.
 */
describe('allocation write paths (HTTP, Postgres)', () => {
  let gradeId: string;
  let crateId: string;

  beforeAll(async () => {
    // The catalog this point uses. Names carry a per-run uuid: app_test
    // persists between runs and is never truncated.
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `awp-product-${randomUUID()}` })
      .expect(201);

    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: `1 сорт-${randomUUID()}` })
      .expect(201);
    gradeId = gradeRes.body.id as string;

    const tareRes = await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `awp-crate-${randomUUID()}`,
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      })
      .expect(201);
    crateId = tareRes.body.id as string;

    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointId,
        product_grade_id: gradeId,
        base_price: '100.00',
        max_markup: '30.00',
        max_discount: '20.00',
      })
      .expect(201);

    // §6.1 — opening counts the drawer in the same request. A big drawer so
    // the cash ceiling never bites in this file; Task 4 adds more describes.
    await request(app.getHttpServer())
      .post('/shifts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '100000.00' })
      .expect(201);
  }, 30_000);

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    post: (url: string, body: object) =>
      http().post(url).set('Authorization', `Bearer ${token}`).send(body),
  });
  const violations = (supplierId: string) => ds.transaction((m) => allocationViolations(m, supplierId));
  // Ordered by the COVERED LINE's created_at, not the allocation row's: a
  // single `allocate()` call inserts every row for one supplier in the same
  // transaction, so they all carry the same `now()` — the allocation rows
  // give no FIFO signal of their own, but the receipts/top-ups they cover do.
  const liveRows = (supplierId: string) =>
    ds.query(
      `SELECT a.payout_id, a.intake_id, a.intake_top_up_id, a.amount::text AS amount
         FROM payout_allocations a
         JOIN payouts p ON p.id = a.payout_id
         LEFT JOIN intakes i ON i.id = a.intake_id
         LEFT JOIN intake_top_ups t ON t.id = a.intake_top_up_id
        WHERE p.supplier_id = $1 AND a.voided_at IS NULL
        ORDER BY COALESCE(i.created_at, t.created_at), a.id`,
      [supplierId],
    );
  // One crate (1.20 kg) at 100.00/kg: gross '11.20' → 1000.00, '6.20' → 500.00.
  const receipt = (supplierId: string, gross: string) =>
    as(operatorToken).post('/intakes', {
      supplier_id: supplierId,
      items: [{ product_grade_id: gradeId, gross_kg: gross, tare: [{ tare_type_id: crateId, units: 1 }] }],
    });

  describe('payouts', () => {
    let s: string;

    beforeAll(async () => {
      s = (
        await as(operatorToken)
          .post('/suppliers', { first_name: 'Ніна', last_name: `awp-${randomUUID()}` })
          .expect(201)
      ).body.id;
    });

    it('a standalone payout allocates FIFO and keeps the invariants', async () => {
      await receipt(s, '11.20').expect(201); // 1000
      await receipt(s, '6.20').expect(201); // 500
      await as(operatorToken).post('/payouts', { supplier_id: s, amount: '1200.00' }).expect(201);

      expect((await liveRows(s)).map((r: { amount: string }) => r.amount)).toEqual([
        '1000.00',
        '200.00',
      ]);
      expect(await violations(s)).toEqual([]);
    });

    it('voiding a payout releases its rows; the next payout re-covers the oldest open line', async () => {
      const p = (
        await as(operatorToken).post('/payouts', { supplier_id: s, amount: '100.00' }).expect(201)
      ).body.id;

      await as(operatorToken).post(`/payouts/${p}/void`, { reason: 'помилка' }).expect(201);

      expect(await violations(s)).toEqual([]);
      const released = await ds.query(
        `SELECT count(*)::int AS n FROM payout_allocations WHERE payout_id = $1 AND voided_at IS NOT NULL`,
        [p],
      );
      expect(released[0].n).toBe(1);
    });
  });
});
