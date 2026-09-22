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

import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

let app: INestApplication;
let ownerToken: string;
let operatorToken: string;
let pointId: string;

beforeAll(async () => {
  process.env.DB_NAME = resolveTestDatabaseName();
  // See `testing/documents-pipeline.db-spec.ts` for the full story on why this
  // line has to be here: the app expects `app_test` to already exist rather
  // than creating it, and this suite's fixtures are uuid-scoped because that
  // database persists between runs.
  await ensureTestDatabase();
  relaxThrottleForTests();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
  await app.init();

  const users = app.get(UsersService);
  const credentials = app.get(CredentialsService);
  const jwt = app.get(JwtService);
  const tokenFor = (userId: string): string => jwt.sign({ sub: userId });

  const { user: owner } = await users.createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `exp-owner-${randomUUID()}`,
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
    .send({ name: `exp-point-${randomUUID()}`, code: pointCode() })
    .expect(201);
  pointId = pointRes.body.id as string;

  const { user: operator } = await users.createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `exp-op-${randomUUID()}`,
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
 * `expand=items` (Task 1 of the supplier-card-history slice, #148) — the ONE
 * place `IntakesService.list`'s second query (`IntakeItem` `In` the page's
 * ids, joined to `product_grade`/`product`) is ever executed against real
 * Postgres, and the ONE place the default list's shape is pinned so this
 * change cannot silently grow it for every other consumer of `GET /intakes`.
 */
describe('GET /intakes?expand=items (HTTP, Postgres)', () => {
  let supplierId: string;
  let gradeId: string;
  let secondGradeId: string;
  let tareId: string;
  let createResponse: { body: { items: { product_name: string; grade_name: string }[] } };

  beforeAll(async () => {
    // The catalog this suite's receipt is built from. Names carry a per-run
    // uuid: app_test persists between runs and is never truncated.
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Полуниця-${randomUUID()}` })
      .expect(201);

    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: `Альба-${randomUUID()}` })
      .expect(201);
    gradeId = gradeRes.body.id as string;

    const secondGradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id, name: `Хоней-${randomUUID()}` })
      .expect(201);
    secondGradeId = secondGradeRes.body.id as string;

    const tareRes = await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `exp-tare-${randomUUID()}`, weight_kg: '2.50', deposit_price: '0.00' })
      .expect(201);
    tareId = tareRes.body.id as string;

    for (const product_grade_id of [gradeId, secondGradeId]) {
      await request(app.getHttpServer())
        .post('/grade-prices')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          collection_point_id: pointId,
          product_grade_id,
          base_price: '120.00',
          max_markup: '30.00',
          max_discount: '20.00',
        })
        .expect(201);
    }

    const s = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Ніна', last_name: `Ільчук-${randomUUID()}` })
      .expect(201);
    supplierId = s.body.id;

    await request(app.getHttpServer())
      .post('/shifts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '0.00' })
      .expect(201);

    // Two lines, so the assertions below can check BOTH the count and the
    // ordering `item_order` promises — a single-line receipt would pass a
    // broken sort just as easily as a correct one.
    createResponse = await request(app.getHttpServer())
      .post('/intakes')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        supplier_id: supplierId,
        items: [
          {
            product_grade_id: gradeId,
            gross_kg: '86.50',
            pallet_kg: '0.00',
            bonus: '0.00',
            tare: [{ tare_type_id: tareId, units: 1 }],
          },
          {
            product_grade_id: secondGradeId,
            gross_kg: '20.00',
            pallet_kg: '0.00',
            bonus: '0.00',
            tare: [{ tare_type_id: tareId, units: 1 }],
          },
        ],
      })
      .expect(201);
  }, 30_000);

  // Review round 1 (#148): `create`'s response used to take its `items` from
  // the cascade save, which never loads `product_grade` — every line named
  // '' for both fields while `GET /intakes/:id` on the SAME receipt, a
  // moment later, returned the real names. Pins the fix at its source rather
  // than only downstream on `GET /intakes`.
  it('POST /intakes itself names each line — not just a later read of it', () => {
    expect(createResponse.body.items[0]).toMatchObject({
      product_name: expect.stringMatching(/^Полуниця-/),
      grade_name: expect.stringMatching(/^Альба-/),
    });
    expect(createResponse.body.items[1]).toMatchObject({
      product_name: expect.stringMatching(/^Полуниця-/),
      grade_name: expect.stringMatching(/^Хоней-/),
    });
  });

  it('nests the lines, ordered like the paper, when asked', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/intakes')
      .query({ supplier_id: supplierId, expand: 'items' })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    expect(body.data[0].items).toHaveLength(2);
    expect(body.data[0].items[0].item_order).toBe(1);
    expect(body.data[0].items[0]).toMatchObject({
      product_name: expect.stringMatching(/^Полуниця-/),
      grade_name: expect.stringMatching(/^Альба-/),
      net_kg: '84.00',
      price: '120.00',
    });
    expect(body.data[0].items[1]).toMatchObject({
      item_order: 2,
      grade_name: expect.stringMatching(/^Хоней-/),
      net_kg: '17.50',
    });
  });

  it('returns exactly today’s shape when nobody asks', async () => {
    const { body } = await request(app.getHttpServer())
      .get('/intakes')
      .query({ supplier_id: supplierId })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    expect(body.data[0].items).toBeUndefined();
    expect(Object.keys(body.data[0]).sort()).toEqual(
      [
        'amount',
        'business_date',
        'code',
        'collection_point_id',
        'created_at',
        'id',
        'lines_count',
        'net_kg',
        'paid_amount',
        'received_by_user_id',
        'shift_id',
        'supplier_id',
        'supplier_name',
        'void_reason',
        'voided_at',
        'voided_by_user_id',
      ].sort(),
    );
  });
});
