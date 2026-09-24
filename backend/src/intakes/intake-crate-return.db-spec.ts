import { randomUUID } from 'crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
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
import { add, sub } from '../common/money';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

let app: INestApplication;
let ds: DataSource;
let ownerToken: string;
let operatorToken: string;
let operatorId: string;
let pointId: string;
let shiftId: string;
let gradeId: string;
let crateId: string;
let bucketId: string;

/**
 * Spec §8.3 end to end, over real HTTP against a real database: `POST
 * /intakes` with `returned_crates` writing the receipt AND a linked crate
 * return (FIFO allocation, deposit refund, crates-book check) in ONE
 * transaction, and `POST /intakes/:id/void` voiding the return with it.
 *
 * ORDER-DEPENDENT, DELIBERATELY: every case shares one point and one shift,
 * and the crates-drawer case drains that point's crates book — so it runs
 * LAST, and nothing after it may need a refund.
 */
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
      providerUserId: `icr-owner-${randomUUID()}`,
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
    .send({ name: `icr-point-${randomUUID()}`, code: pointCode() })
    .expect(201);
  pointId = pointRes.body.id as string;

  const { user: operator } = await users.createWithIdentity(
    {
      provider: LOCAL_PROVIDER,
      providerUserId: `icr-op-${randomUUID()}`,
      first_name: 'Оксана',
      last_name: 'Ящикова',
      role: UserRole.PointOperator,
      collection_point_id: pointId,
    },
    async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
  );
  operatorToken = tokenFor(operator.id);
  operatorId = operator.id;

  const productRes = await request(app.getHttpServer())
    .post('/products')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `icr-product-${randomUUID()}` })
    .expect(201);
  const gradeRes = await request(app.getHttpServer())
    .post('/product-grades')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ product_id: productRes.body.id, name: `1 сорт-${randomUUID()}` })
    .expect(201);
  gradeId = gradeRes.body.id as string;

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

  // THE crate — `is_crate` is exclusive network-wide, and creating a flagged
  // row demotes every other one in the same transaction, so this is the crate
  // for the rest of this file whatever an earlier run left in `app_test`.
  const crateRes = await request(app.getHttpServer())
    .post('/tare-types')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: `icr-crate-${randomUUID()}`,
      weight_kg: '1.20',
      deposit_price: '120.00',
      is_crate: true,
    })
    .expect(201);
  crateId = crateRes.body.id as string;

  // A tare that is NOT the crate — its units must never count as returnable.
  const bucketRes = await request(app.getHttpServer())
    .post('/tare-types')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `icr-bucket-${randomUUID()}`, weight_kg: '0.50', deposit_price: '0.00' })
    .expect(201);
  bucketId = bucketRes.body.id as string;

  const sh = await request(app.getHttpServer())
    .post('/shifts')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ counted_amount: '100000.00' })
    .expect(201);
  shiftId = sh.body.id as string;
}, 30_000);

afterAll(async () => {
  await app?.close();
});

const newSupplier = async (): Promise<string> => {
  const s = await request(app.getHttpServer())
    .post('/suppliers')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ first_name: 'Ящик', last_name: `Повернення-${randomUUID()}` })
    .expect(201);
  return s.body.id as string;
};

/** Sequential on purpose — FIFO orders by `created_at`, so the deposit
 *  tranche is the older one and is drawn first. */
const issue = async (supplierId: string, units: number, mode: 'deposit' | 'receipt') => {
  await request(app.getHttpServer())
    .post('/crate-issuances')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send({ supplier_id: supplierId, units, mode })
    .expect(201);
};

/** One line: `crates` crate-tare units, `buckets` non-crate units, and a
 *  gross weight that leaves exactly 10.00 kg net (1000.00 ₴ at 100.00/kg). */
const line = (crates: number, buckets = 0) => {
  const tare: { tare_type_id: string; units: number }[] = [];
  if (crates > 0) tare.push({ tare_type_id: crateId, units: crates });
  if (buckets > 0) tare.push({ tare_type_id: bucketId, units: buckets });
  // 1.20 × crates + 0.50 × buckets + 10.00, spelled out per case below.
  const gross: Record<string, string> = {
    '40:0': '58.00',
    '40:5': '60.50',
    '20:0': '34.00',
    '10:0': '22.00',
    '0:5': '12.50',
    '1:0': '11.20',
  };
  return { product_grade_id: gradeId, gross_kg: gross[`${crates}:${buckets}`], tare };
};

const post = (body: Record<string, unknown>) =>
  request(app.getHttpServer())
    .post('/intakes')
    .set('Authorization', `Bearer ${operatorToken}`)
    .send(body);

const outstanding = async (supplierId: string): Promise<number> => {
  const res = await request(app.getHttpServer())
    .get(`/suppliers/${supplierId}/crate-balance`)
    .set('Authorization', `Bearer ${operatorToken}`)
    .expect(200);
  return res.body.outstanding_units as number;
};

const crateBook = async (): Promise<string> => {
  const res = await request(app.getHttpServer())
    .get(`/point-cash/${pointId}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .expect(200);
  return res.body.crate_deposits as string;
};

const count = async (table: string, supplierId: string): Promise<number> => {
  const [{ n }] = (await ds.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE supplier_id = $1`,
    [supplierId],
  )) as { n: number }[];
  return n;
};

describe('POST /intakes with returned_crates (HTTP, Postgres)', () => {
  let returnedSupplierId: string;
  let returnedIntakeId: string;

  it('writes the receipt AND a linked FIFO return: 20 on deposit refunded, 20 on розписка', async () => {
    const supplierId = await newSupplier();
    await issue(supplierId, 20, 'deposit');
    await issue(supplierId, 30, 'receipt');
    const bookBefore = await crateBook();

    const res = await post({
      supplier_id: supplierId,
      items: [line(40)],
      returned_crates: 40,
      paid_amount: '100.00',
    }).expect(201);

    expect(res.body.crate_return).toMatchObject({
      units: 40,
      deposit_refund: '2400.00',
      deposit_units: 20,
      receipt_units: 20,
      voided_at: null,
    });
    expect(typeof res.body.crate_return.id).toBe('string');
    expect(res.body.payouts).toHaveLength(1);

    expect(await outstanding(supplierId)).toBe(10);
    expect(await crateBook()).toBe(sub(bookBefore, '2400.00'));

    const [row] = (await ds.query(`SELECT intake_id FROM crate_returns WHERE id = $1`, [
      res.body.crate_return.id,
    ])) as { intake_id: string }[];
    expect(row.intake_id).toBe(res.body.id);

    // The detail read — what the receipt widget opens — carries it too.
    const detail = await request(app.getHttpServer())
      .get(`/intakes/${res.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(detail.body.crate_return).toEqual(res.body.crate_return);

    returnedSupplierId = supplierId;
    returnedIntakeId = res.body.id as string;
  });

  it('400s RETURNED_EXCEEDS_TARE when more come back than the receipt carries in crate tare — non-crate tare does not count', async () => {
    const supplierId = await newSupplier();
    await issue(supplierId, 50, 'receipt');
    const before = await count('intakes', supplierId);

    const res = await post({
      supplier_id: supplierId,
      items: [line(40, 5)],
      returned_crates: 41,
    }).expect(400);
    expect(res.body.code).toBe('RETURNED_EXCEEDS_TARE');

    // Only non-crate tare on the receipt — nothing is returnable at all.
    const none = await post({
      supplier_id: supplierId,
      items: [line(0, 5)],
      returned_crates: 1,
    }).expect(400);
    expect(none.body.code).toBe('RETURNED_EXCEEDS_TARE');

    expect(await count('intakes', supplierId)).toBe(before);
    expect(await count('crate_returns', supplierId)).toBe(0);
    expect(await outstanding(supplierId)).toBe(50);
  });

  it('400s RETURN_EXCEEDS_OUTSTANDING when the supplier holds fewer, and writes no intake', async () => {
    const supplierId = await newSupplier();
    await issue(supplierId, 5, 'receipt');

    const res = await post({
      supplier_id: supplierId,
      items: [line(10)],
      returned_crates: 10,
    }).expect(400);
    expect(res.body.code).toBe('RETURN_EXCEEDS_OUTSTANDING');

    expect(await count('intakes', supplierId)).toBe(0);
    expect(await count('crate_returns', supplierId)).toBe(0);
  });

  it('writes no return when returned_crates is omitted or 0', async () => {
    const supplierId = await newSupplier();

    const omitted = await post({ supplier_id: supplierId, items: [line(1)] }).expect(201);
    expect(omitted.body.crate_return).toBeNull();

    const zero = await post({
      supplier_id: supplierId,
      items: [line(1)],
      returned_crates: 0,
    }).expect(201);
    expect(zero.body.crate_return).toBeNull();

    const detail = await request(app.getHttpServer())
      .get(`/intakes/${zero.body.id}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(detail.body.crate_return).toBeNull();

    expect(await count('crate_returns', supplierId)).toBe(0);
  });

  it('voiding the receipt voids its return with the same reason — the payout stays live', async () => {
    const bookBefore = await crateBook();

    await request(app.getHttpServer())
      .post(`/intakes/${returnedIntakeId}/void`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reason: 'не той постачальник' })
      .expect(201);

    const [ret] = (await ds.query(
      `SELECT voided_at, void_reason, voided_by_user_id FROM crate_returns WHERE intake_id = $1`,
      [returnedIntakeId],
    )) as { voided_at: Date | null; void_reason: string; voided_by_user_id: string }[];
    expect(ret.voided_at).not.toBeNull();
    expect(ret.void_reason).toBe('не той постачальник');
    expect(ret.voided_by_user_id).toBe(operatorId);

    expect(await outstanding(returnedSupplierId)).toBe(50);
    expect(await crateBook()).toBe(add(bookBefore, '2400.00'));

    const payouts = (await ds.query(`SELECT voided_at FROM payouts WHERE intake_id = $1`, [
      returnedIntakeId,
    ])) as { voided_at: Date | null }[];
    expect(payouts).toHaveLength(1);
    expect(payouts[0].voided_at).toBeNull();

    const detail = await request(app.getHttpServer())
      .get(`/intakes/${returnedIntakeId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(detail.body.crate_return.voided_at).not.toBeNull();
  });

  it('a standalone return and a reception return for one supplier serialise on the supplier lock', async () => {
    const supplierId = await newSupplier();
    await issue(supplierId, 20, 'deposit');

    const standalone = () =>
      request(app.getHttpServer())
        .post('/crate-returns')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, units: 20 });
    const reception = () =>
      post({ supplier_id: supplierId, items: [line(20)], returned_crates: 20 });

    const [a, b] = await Promise.allSettled([standalone(), reception()]);
    const results = [a, b].map((r) =>
      r.status === 'fulfilled' ? { status: r.value.status, code: r.value.body.code } : null,
    );

    expect(results.filter((r) => r?.status === 201)).toHaveLength(1);
    const refused = results.find((r) => r?.status !== 201);
    expect(refused).toEqual({ status: 400, code: 'RETURN_EXCEEDS_OUTSTANDING' });

    expect(await outstanding(supplierId)).toBe(0);
    const [{ n }] = (await ds.query(
      `SELECT COALESCE(SUM(a.units), 0)::int AS n
         FROM crate_return_allocations a
         JOIN crate_returns cr ON cr.id = a.return_id
        WHERE cr.supplier_id = $1 AND cr.voided_at IS NULL`,
      [supplierId],
    )) as { n: number }[];
    expect(n).toBe(20);
    // The receipt either won and exists, or lost and was rolled back whole.
    expect(await count('intakes', supplierId)).toBe(results[1]?.status === 201 ? 1 : 0);
  });

  // MUST RUN LAST — it drains this point's crates book for good.
  it('409s CRATE_CASH_INSUFFICIENT when the crates drawer is short, and writes nothing at all', async () => {
    const supplierId = await newSupplier();
    await issue(supplierId, 20, 'deposit');
    await issue(supplierId, 30, 'receipt');

    // Valid documents cannot produce this state — FIFO never refunds more
    // than was deposited — which is exactly why the check exists. A live
    // return for ANOTHER supplier, refunding the whole book, with no
    // allocation rows behind it.
    const other = await newSupplier();
    const book = await crateBook();
    await ds.query(
      `INSERT INTO crate_returns (shift_id, supplier_id, units, deposit_refund, accepted_by_user_id)
       VALUES ($1, $2, 1, $3, $4)`,
      [shiftId, other, book, operatorId],
    );
    expect(await crateBook()).toBe('0.00');

    const res = await post({
      supplier_id: supplierId,
      items: [line(40)],
      returned_crates: 40,
      paid_amount: '100.00',
    }).expect(409);
    expect(res.body.code).toBe('CRATE_CASH_INSUFFICIENT');

    expect(await count('intakes', supplierId)).toBe(0);
    expect(await count('payouts', supplierId)).toBe(0);
    expect(await count('crate_returns', supplierId)).toBe(0);
    expect(await outstanding(supplierId)).toBe(50);
  });
});
