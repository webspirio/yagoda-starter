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
import { sum } from '../common/money';
import { stockPoint } from '../testing/crate-stock-fixture';

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
 * than leaving `payout_allocations` untouched; Task 4 adds the intake and
 * top-up paths and the races between them.
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
    // Spec 2026-09-30: a receipt's crate tare leaves the point's empties. 1000 is far above
    // the crate tare this file weighs, and the transfer carries no cash.
    await stockPoint(app, ownerToken, operatorToken, pointId, 1000);
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
  // One crate (1.20 kg) at 100.00/kg: gross '11.20' → 1000.00, '6.20' → 500.00,
  // '4.20' → 300.00, '3.20' → 200.00. `paid` is the cash handed over with it (§2.1 ⑥).
  const receipt = (supplierId: string, gross: string, paid?: string) =>
    as(operatorToken).post('/intakes', {
      supplier_id: supplierId,
      items: [{ product_grade_id: gradeId, gross_kg: gross, tare: [{ tare_type_id: crateId, units: 1 }] }],
      ...(paid ? { paid_amount: paid } : {}),
    });
  const newSupplier = async (): Promise<string> =>
    (
      await as(operatorToken)
        .post('/suppliers', { first_name: 'Ніна', last_name: `awp-${randomUUID()}` })
        .expect(201)
    ).body.id;
  type Row = { payout_id: string; intake_id: string | null; intake_top_up_id: string | null; amount: string };

  describe('payouts', () => {
    let s: string;

    beforeAll(async () => {
      s = await newSupplier();
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

      // The released cover reopened a line; the next payout must cover that same line again.
      const [{ intake_id: reopened }] = await ds.query(
        `SELECT intake_id FROM payout_allocations WHERE payout_id = $1`,
        [p],
      );
      const next = (
        await as(operatorToken).post('/payouts', { supplier_id: s, amount: '100.00' }).expect(201)
      ).body.id;
      expect((await liveRows(s)).filter((r: Row) => r.payout_id === next)).toEqual([
        expect.objectContaining({ intake_id: reopened, amount: '100.00' }),
      ]);
      expect(await violations(s)).toEqual([]);
    });
  });

  describe('intakes and top-ups', () => {
    let s: string;
    beforeEach(async () => {
      s = await newSupplier();
    });

    it('a reception payout larger than its receipt covers that receipt first, then older debt', async () => {
      const old = (await receipt(s, '11.20').expect(201)).body.id; // 1000
      const r = (await receipt(s, '6.20', '1200.00').expect(201)).body.id; // 500, paid 1200

      expect(await liveRows(s)).toEqual([
        expect.objectContaining({ intake_id: old, amount: '700.00' }),
        expect.objectContaining({ intake_id: r, amount: '500.00' }),
      ]);
      expect(await violations(s)).toEqual([]);
    });

    it('a receipt written when no money is free stays open', async () => {
      await receipt(s, '4.20').expect(201); // 300
      await as(operatorToken).post('/payouts', { supplier_id: s, amount: '300.00' }).expect(201);
      const r = (await receipt(s, '3.20').expect(201)).body.id; // 200

      expect((await liveRows(s)).some((x: Row) => x.intake_id === r)).toBe(false);
      expect(await violations(s)).toEqual([]);
    });

    it('voiding a receipt frees a standalone payout, and the next receipt picks that money up', async () => {
      const r1 = (await receipt(s, '6.20').expect(201)).body; // 500
      const p1 = (
        await as(operatorToken).post('/payouts', { supplier_id: s, amount: '500.00' }).expect(201)
      ).body.id as string;
      // Not bound to r1, so the payout outlives its void.
      await as(operatorToken).post(`/intakes/${r1.id}/void`, { reason: 'x' }).expect(201);
      expect(await liveRows(s)).toEqual([]);
      expect(await violations(s)).toEqual([]);

      const r2 = (await receipt(s, '6.20').expect(201)).body.id; // 500, no cash handed over
      expect(await liveRows(s)).toEqual([
        expect.objectContaining({ payout_id: p1, intake_id: r2, amount: '500.00' }),
      ]);
      expect(await violations(s)).toEqual([]);
    });

    it('void with payout void releases both documents', async () => {
      const r = (await receipt(s, '6.20', '500.00').expect(201)).body.id;
      // Open shift: the bound payout goes with the receipt, no decision taken.
      await as(operatorToken).post(`/intakes/${r}/void`, { reason: 'x' }).expect(201);

      expect(await liveRows(s)).toEqual([]);
      expect(await violations(s)).toEqual([]);
    });

    it('a top-up is covered like a receipt, and voiding it frees that money for the next line', async () => {
      const r = (await receipt(s, '6.20').expect(201)).body.id; // 500
      const t = (
        await as(ownerToken)
          .post('/intake-top-ups', { intake_id: r, amount: '50.00', reason: 'ціна' })
          .expect(201)
      ).body.id;
      expect(await violations(s)).toEqual([]);
      const p = (
        await as(operatorToken).post('/payouts', { supplier_id: s, amount: '550.00' }).expect(201)
      ).body.id;
      expect(await liveRows(s)).toEqual([
        expect.objectContaining({ intake_id: r, amount: '500.00' }),
        expect.objectContaining({ intake_top_up_id: t, amount: '50.00' }),
      ]);

      await as(ownerToken).post(`/intake-top-ups/${t}/void`, { reason: 'x' }).expect(201);
      expect((await liveRows(s)).some((x: Row) => x.intake_top_up_id === t)).toBe(false);
      expect(await violations(s)).toEqual([]);

      const r2 = (await receipt(s, '3.20').expect(201)).body.id; // 200 picks up the freed 50
      expect((await liveRows(s)).filter((x: Row) => x.intake_id === r2)).toEqual([
        expect.objectContaining({ payout_id: p, amount: '50.00' }),
      ]);
      expect(await violations(s)).toEqual([]);
    });
  });

  describe('open_amount on the receipt', () => {
    let s: string;
    beforeEach(async () => {
      s = await newSupplier();
    });

    const openOf = async (intakeId: string): Promise<string> =>
      (await http().get(`/intakes/${intakeId}`).set('Authorization', `Bearer ${operatorToken}`).expect(200))
        .body.open_amount;
    // The card's lines for this receipt (itself + its top-ups) — open_amount must equal their Σ open.
    const cardOpenOf = async (intakeId: string): Promise<string> => {
      const { body } = await http()
        .get(`/suppliers/${s}/settlement`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
      return sum(
        (body.lines as { intake_id: string; open: string }[])
          .filter((l) => l.intake_id === intakeId)
          .map((l) => l.open),
      );
    };

    it('a partly paid receipt shows what is still open', async () => {
      const r = (await receipt(s, '6.20').expect(201)).body.id; // 500
      await as(operatorToken).post('/payouts', { supplier_id: s, amount: '300.00' }).expect(201);

      expect(await openOf(r)).toBe('200.00');
      expect(await cardOpenOf(r)).toBe('200.00');
    });

    it('a receipt closed by money left over from before is not open, though nothing was paid with it', async () => {
      const r1 = (await receipt(s, '6.20').expect(201)).body.id; // 500
      await as(operatorToken).post('/payouts', { supplier_id: s, amount: '500.00' }).expect(201);
      // The leftover money: a standalone payout outlives the receipt it covered.
      await as(operatorToken).post(`/intakes/${r1}/void`, { reason: 'x' }).expect(201);
      const r2 = (await receipt(s, '6.20').expect(201)).body; // 500, no cash with it

      expect(r2.paid_amount).toBe('0.00');
      expect(r2.open_amount).toBe('0.00');
      expect(await cardOpenOf(r2.id)).toBe('0.00');
    });

    it('counts the open part of its live top-ups, and may exceed the printed amount', async () => {
      const r = (await receipt(s, '6.20').expect(201)).body.id; // 500
      await as(ownerToken)
        .post('/intake-top-ups', { intake_id: r, amount: '200.00', reason: 'ціна' })
        .expect(201);
      expect(await openOf(r)).toBe('700.00');

      await as(operatorToken).post('/payouts', { supplier_id: s, amount: '300.00' }).expect(201);
      expect(await openOf(r)).toBe('400.00');
      expect(await cardOpenOf(r)).toBe('400.00');
    });

    it('a voided top-up drops out, and the money it freed shows on the next receipt', async () => {
      const r = (await receipt(s, '6.20').expect(201)).body.id; // 500
      const t = (
        await as(ownerToken)
          .post('/intake-top-ups', { intake_id: r, amount: '200.00', reason: 'ціна' })
          .expect(201)
      ).body.id;
      await as(operatorToken).post('/payouts', { supplier_id: s, amount: '700.00' }).expect(201);
      expect(await openOf(r)).toBe('0.00');

      await as(ownerToken).post(`/intake-top-ups/${t}/void`, { reason: 'x' }).expect(201);
      expect(await openOf(r)).toBe('0.00');
      expect(await cardOpenOf(r)).toBe('0.00');

      const r2 = (await receipt(s, '4.20').expect(201)).body; // 300, picks up the freed 200
      expect(r2.open_amount).toBe('100.00');
      expect(await cardOpenOf(r2.id)).toBe('100.00');
    });

    it('a voided receipt is 0.00', async () => {
      const r = (await receipt(s, '6.20').expect(201)).body.id;
      const voided = (
        await as(operatorToken).post(`/intakes/${r}/void`, { reason: 'x' }).expect(201)
      ).body;

      expect(voided.open_amount).toBe('0.00');
    });

    it('the journal row carries the same figure as the single read', async () => {
      const r = (await receipt(s, '6.20', '100.00').expect(201)).body.id;
      const { body } = await http()
        .get(`/intakes?supplier_id=${s}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(body.data.find((row: { id: string }) => row.id === r).open_amount).toBe('400.00');
      expect(await openOf(r)).toBe('400.00');
    });
  });

  describe('concurrency', () => {
    let s: string;
    beforeEach(async () => {
      s = await newSupplier();
      await receipt(s, '11.20').expect(201); // 1000 of debt to pay against
    });

    it('two payouts at once: both land, no double allocation', async () => {
      const [a, b] = await Promise.all([
        as(operatorToken).post('/payouts', { supplier_id: s, amount: '400.00' }),
        as(operatorToken).post('/payouts', { supplier_id: s, amount: '400.00' }),
      ]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(await violations(s)).toEqual([]);
    });

    it('two receipts at once: both land, invariants hold', async () => {
      await as(operatorToken).post('/payouts', { supplier_id: s, amount: '1000.00' }).expect(201);
      const [a, b] = await Promise.all([receipt(s, '4.20'), receipt(s, '3.20')]);
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(await violations(s)).toEqual([]);
    });

    it('a receipt void against a new payout: no deadlock, invariants hold', async () => {
      const r = (await receipt(s, '6.20', '500.00').expect(201)).body.id;
      const [v, p] = await Promise.all([
        as(operatorToken).post(`/intakes/${r}/void`, { reason: 'x' }),
        as(operatorToken).post('/payouts', { supplier_id: s, amount: '100.00' }),
      ]);
      expect([v.status, p.status]).toEqual([201, 201]); // debt is ≥ 500 whichever lands first
      expect(await violations(s)).toEqual([]);
    });

    it('a receipt void against a void of its bound payout: no deadlock, one payout.voided', async () => {
      const r = (await receipt(s, '6.20', '500.00').expect(201)).body;
      const p = r.payouts[0].id as string;
      const [iv, pv] = await Promise.all([
        as(operatorToken).post(`/intakes/${r.id}/void`, { reason: 'x' }),
        as(operatorToken).post(`/payouts/${p}/void`, { reason: 'x' }),
      ]);
      // Receipt first: it takes the payout with it and the payout void 409s. Payout first: the
      // receipt has nothing bound left and voids alone. Never a 500 — that would be a deadlock.
      expect([
        [201, 409],
        [201, 201],
      ]).toContainEqual([iv.status, pv.status]);
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE target_id = $1 AND action = 'payout.voided'`,
        [p],
      );
      expect(n).toBe(1);
      expect(await violations(s)).toEqual([]);
    });

    it('a payout void against a new receipt: no deadlock, invariants hold', async () => {
      const p = (
        await as(operatorToken).post('/payouts', { supplier_id: s, amount: '600.00' }).expect(201)
      ).body.id;
      const [v, r] = await Promise.all([
        as(operatorToken).post(`/payouts/${p}/void`, { reason: 'x' }),
        receipt(s, '4.20'),
      ]);
      expect([v.status, r.status]).toEqual([201, 201]);
      expect(await violations(s)).toEqual([]);
    });

    it('two voids of one payout: one wins, one payout.voided, invariants hold', async () => {
      const p = (
        await as(operatorToken).post('/payouts', { supplier_id: s, amount: '100.00' }).expect(201)
      ).body.id;
      const res = await Promise.all([
        as(operatorToken).post(`/payouts/${p}/void`, { reason: 'x' }),
        as(operatorToken).post(`/payouts/${p}/void`, { reason: 'x' }),
      ]);
      expect(res.map((x) => x.status).sort()).toEqual([201, 409]);
      const [{ n }] = await ds.query(
        `SELECT count(*)::int AS n FROM audit_log WHERE target_id = $1 AND action = 'payout.voided'`,
        [p],
      );
      expect(n).toBe(1);
      expect(await violations(s)).toEqual([]);
    });
  });
});
