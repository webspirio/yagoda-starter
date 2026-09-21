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
let oksanaToken: string;
let bohdanToken: string;
let pointAId: string;
let pointBId: string;

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
      providerUserId: `par-owner-${randomUUID()}`,
      first_name: 'Net',
      last_name: 'Owner',
      role: UserRole.NetworkOwner,
    },
    async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
  );
  ownerToken = tokenFor(owner.id);

  const pointARes = await request(app.getHttpServer())
    .post('/collection-points')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `par-point-a-${randomUUID()}`, code: pointCode() })
    .expect(201);
  pointAId = pointARes.body.id as string;

  const pointBRes = await request(app.getHttpServer())
    .post('/collection-points')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `par-point-b-${randomUUID()}`, code: pointCode() })
    .expect(201);
  pointBId = pointBRes.body.id as string;

  // The name the `received_by_name` assertion below relies on —
  // `displayNameOf` is `first last`, trimmed.
  const { user: oksana } = await users.createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `par-op-a-${randomUUID()}`,
      first_name: 'Оксана',
      last_name: 'Приймальник',
      role: UserRole.PointOperator,
      collection_point_id: pointAId,
    },
    async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
  );
  oksanaToken = tokenFor(oksana.id);

  const { user: bohdan } = await users.createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `par-op-b-${randomUUID()}`,
      first_name: 'Богдан',
      last_name: 'Сусід',
      role: UserRole.PointOperator,
      collection_point_id: pointBId,
    },
    async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
  );
  bohdanToken = tokenFor(bohdan.id);
}, 30_000);

afterAll(async () => {
  await app?.close();
});

/**
 * §2.1 ⑥ + §3.6 end to end, over real HTTP against a real database: `POST
 * /intakes` writing the receipt AND its payout in one transaction, and BOTH
 * halves of the ceiling `min(Разом, каса за ягоду)` — the debt half (point B,
 * a big drawer, a small debt) and the cash half (point A, a small drawer).
 * This is the only place the SQL behind `net_kg`/`lines_count`/`paid_amount`
 * on the list row, `payouts[]`/`received_by_name` on the detail, and
 * `intake_id` on a payout row is ever executed.
 */
describe('paid at reception (HTTP, Postgres)', () => {
  let gradeId: string;
  let crateId: string;

  beforeAll(async () => {
    // The catalog both points share. Names carry a per-run uuid: app_test
    // persists between runs and is never truncated.
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `par-product-${randomUUID()}` })
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
        name: `par-crate-${randomUUID()}`,
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      })
      .expect(201);
    crateId = tareRes.body.id as string;

    // A price at EACH point — grade prices are per (point, grade), so one row
    // at point A says nothing about what point B charges.
    for (const collection_point_id of [pointAId, pointBId]) {
      await request(app.getHttpServer())
        .post('/grade-prices')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          collection_point_id,
          product_grade_id: gradeId,
          base_price: '100.00',
          max_markup: '30.00',
          max_discount: '20.00',
        })
        .expect(201);
    }
  }, 30_000);

  // A crate of 1.20 kg and gross 11.20 kg make a 10.00 kg line at 100.00 ₴/kg
  // = 1000.00 ₴ — the one figure both ceiling scenarios below are built on.
  const line = () => ({
    product_grade_id: gradeId,
    gross_kg: '11.20',
    tare: [{ tare_type_id: crateId, units: 1 }],
  });

  // ORDER-DEPENDENT, DELIBERATELY: the paid receipt below spends the drawer,
  // and every later test in this describe relies on it staying spent (or, for
  // the last test, on voiding NOT giving it back) — so these tests must run
  // in the order they're written, and the void test in particular must run
  // LAST.
  describe('point A — the drawer holds 500.00', () => {
    let supplierId: string;
    let shiftId: string;
    let paidIntakeId: string;
    let paidPayoutId: string;

    beforeAll(async () => {
      const s = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ first_name: 'Ніна', last_name: `Ільчук-${randomUUID()}` })
        .expect(201);
      supplierId = s.body.id;
      // §6.1 — opening counts the drawer in the same request, and it is the
      // point's first count, so 500.00 IS the drawer with nothing else moved.
      const sh = await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ counted_amount: '500.00' })
        .expect(201);
      shiftId = sh.body.id;
    });

    it('refuses 600.00 against 500.00 in the drawer, and writes NO intake', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '600.00' })
        .expect(400);
      expect(res.body.code).toBe('PAYOUT_EXCEEDS_CASH');

      const journal = await request(app.getHttpServer())
        .get('/intakes')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(journal.body.total).toBe(0);
    });

    it('writes the receipt AND the payout together, and the reads carry both', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '500.00' })
        .expect(201);

      expect(res.body.amount).toBe('1000.00');
      expect(res.body.net_kg).toBe('10.00');
      expect(res.body.lines_count).toBe(1);
      expect(res.body.paid_amount).toBe('500.00');
      expect(res.body.received_by_name).toBe('Оксана Приймальник');
      expect(res.body.supplier_name).toMatch(/^Ніна Ільчук-/);
      expect(res.body.payouts).toHaveLength(1);
      expect(res.body.payouts[0].code).toMatch(/-PO-\d{8}-\d+$/);
      expect(res.body.payouts[0].amount).toBe('500.00');
      paidIntakeId = res.body.id as string;
      paidPayoutId = res.body.payouts[0].id as string;

      const row = await request(app.getHttpServer())
        .get('/intakes')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(row.body.data[0]).toMatchObject({
        id: res.body.id,
        net_kg: '10.00',
        lines_count: 1,
        paid_amount: '500.00',
      });

      const payouts = await request(app.getHttpServer())
        .get('/payouts')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(payouts.body.data[0].intake_id).toBe(res.body.id);

      const balance = await request(app.getHttpServer())
        .get(`/suppliers/${supplierId}/balance`)
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(balance.body.debt).toBe('500.00');
    });

    it('a standalone payout is capped by the drawer too — it is now empty', async () => {
      const res = await request(app.getHttpServer())
        .post('/payouts')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ supplier_id: supplierId, amount: '100.00' })
        .expect(400);
      expect(res.body.code).toBe('PAYOUT_EXCEEDS_CASH');
    });

    it('a preview ignores paid_amount and writes nothing', async () => {
      const before = await request(app.getHttpServer())
        .get('/intakes')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/intakes/preview')
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '999999.00' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get('/intakes')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(after.body.total).toBe(before.body.total);
    });

    it('voiding the paid-at-reception payout zeroes paid_amount but keeps the trail — and never returns the cash', async () => {
      // MUST RUN LAST (see the describe-level comment above): this voids the
      // 500.00 payout the second test wrote. §9.3 — voiding does NOT return
      // the cash, and `point-cash` keeps a voided payout SUBTRACTED, so every
      // earlier test's «the drawer is now empty» reading keeps holding after
      // this one runs too, not just before it.
      await request(app.getHttpServer())
        .post(`/payouts/${paidPayoutId}/void`)
        .set('Authorization', `Bearer ${oksanaToken}`)
        .send({ reason: 'помилка' })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/intakes/${paidIntakeId}`)
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      expect(detail.body.paid_amount).toBe('0.00');
      expect(detail.body.payouts).toHaveLength(1);
      expect(detail.body.payouts[0].voided_at).not.toBeNull();

      const journal = await request(app.getHttpServer())
        .get('/intakes')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${oksanaToken}`)
        .expect(200);
      const row = (journal.body.data as { id: string; paid_amount: string }[]).find(
        (r) => r.id === paidIntakeId,
      );
      expect(row?.paid_amount).toBe('0.00');
    });
  });

  describe('point B — the drawer holds 100000.00', () => {
    let supplierId: string;
    let shiftId: string;
    let paidInFullId: string;
    let unpaidId: string;
    let paidAboveOwnAmountId: string;

    beforeAll(async () => {
      const s = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ first_name: 'Тарас', last_name: `Гринюк-${randomUUID()}` })
        .expect(201);
      supplierId = s.body.id;
      const sh = await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ counted_amount: '100000.00' })
        .expect(201);
      shiftId = sh.body.id;
    });

    it('refuses more than «Разом» — the debt half', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '1000.01' })
        .expect(400);
      expect(res.body.code).toBe('PAYOUT_EXCEEDS_DEBT');
    });

    it('pays «Разом» in full — the receipt reads «розраховано повністю»', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '1000.00' })
        .expect(201);
      expect(res.body.paid_amount).toBe('1000.00');
      paidInFullId = res.body.id as string;
      const balance = await request(app.getHttpServer())
        .get(`/suppliers/${supplierId}/balance`)
        .set('Authorization', `Bearer ${bohdanToken}`)
        .expect(200);
      expect(balance.body.debt).toBe('0.00');
    });

    it('«Разом» includes the previous balance: an unpaid receipt, then a second visit paid above its own amount', async () => {
      const unpaid = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ supplier_id: supplierId, items: [line()] })
        .expect(201); // debt 1000
      unpaidId = unpaid.body.id as string;
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${bohdanToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount: '1500.00' })
        .expect(201); // Разом = 2000, paid 1500
      expect(res.body.paid_amount).toBe('1500.00');
      paidAboveOwnAmountId = res.body.id as string;
      const balance = await request(app.getHttpServer())
        .get(`/suppliers/${supplierId}/balance`)
        .set('Authorization', `Bearer ${bohdanToken}`)
        .expect(200);
      expect(balance.body.debt).toBe('500.00');
    });

    it("lists the shift's receipts with each row's own paid_amount", async () => {
      // THE PROOF the raw↔entity fix asked for: three rows with three
      // DIFFERENT paid_amounts in one response, checked by id rather than by
      // position — the exact mistake a `raw[n]` read could make invisible.
      const journal = await request(app.getHttpServer())
        .get('/intakes')
        .query({ shift_id: shiftId })
        .set('Authorization', `Bearer ${bohdanToken}`)
        .expect(200);

      const expected = new Map<string, string>([
        [paidInFullId, '1000.00'],
        [unpaidId, '0.00'],
        [paidAboveOwnAmountId, '1500.00'],
      ]);
      const rows = journal.body.data as { id: string; paid_amount: string }[];
      expect(rows).toHaveLength(expected.size);
      // Newest first (`list`'s own order) — asserted so the map lookup below
      // isn't hiding an order bug too.
      expect(rows.map((r) => r.id)).toEqual([paidAboveOwnAmountId, unpaidId, paidInFullId]);
      for (const row of rows) {
        expect(row.paid_amount).toBe(expected.get(row.id));
      }
    });
  });
});
