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
let operatorToken: string;

/**
 * §2.1 ⑥ + §3.6, under REAL concurrency: two `POST /intakes` requests fired
 * together at one supplier, over real HTTP against a real database — the
 * proof behind the doc comment `PayoutsService.writePayout` now carries.
 *
 * Two requests issued from one supertest app against one running `INestApplication`
 * are genuinely concurrent: Nest handles them on the same event loop, but the
 * database work each one awaits interleaves, which is exactly the window the
 * `intakes` advisory lock (`nextDocumentCode`) and the supplier row lock
 * (`writePayout`) exist to close. WHICH of the two requests wins that lock is
 * not deterministic — Postgres makes no ordering promise for two backends
 * blocked on the same `pg_advisory_xact_lock` — so every assertion below reads
 * the pair as a SET, never by array position, even where the lock happens to
 * make the outcome look ordered on a given run.
 */
describe('reception race: two concurrent POST /intakes for one supplier (HTTP, Postgres)', () => {
  let gradeId: string;
  let crateId: string;
  let supplierId: string;
  let shiftId: string;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    // See `intake-paid-at-reception.db-spec.ts` (and `documents-pipeline.db-spec.ts`)
    // for why this line has to be here: the app expects `app_test` to already
    // exist rather than creating it, and this suite's fixtures are
    // uuid-scoped because that database persists between runs.
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
        providerUserId: `race-owner-${randomUUID()}`,
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
      .send({ name: `race-point-${randomUUID()}`, code: pointCode() })
      .expect(201);
    const pointId = pointRes.body.id as string;

    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `race-op-${randomUUID()}`,
        first_name: 'Гонка',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    operatorToken = tokenFor(operator.id);

    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `race-product-${randomUUID()}` })
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
        name: `race-crate-${randomUUID()}`,
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

    const supplierRes = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Гонка', last_name: `Постачальник-${randomUUID()}` })
      .expect(201);
    supplierId = supplierRes.body.id as string;

    // §6.1 — opening counts the drawer in the same request, and it is the
    // point's first count, so 1500.00 IS the drawer with nothing else moved.
    const shiftRes = await request(app.getHttpServer())
      .post('/shifts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '1500.00' })
      .expect(201);
    shiftId = shiftRes.body.id as string;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  // A crate of 1.20 kg and gross 11.20 kg make a 10.00 kg line at 100.00 ₴/kg
  // = 1000.00 ₴ — the one figure every payout amount below is built on.
  const line = () => ({
    product_grade_id: gradeId,
    gross_kg: '11.20',
    tare: [{ tare_type_id: crateId, units: 1 }],
  });

  it('two paid receptions for one supplier in flight together: exactly one is paid, nothing 500s, both receipts are numbered consecutively', async () => {
    const post = (paid_amount: string) =>
      request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, items: [line()], paid_amount });

    const [a, b] = await Promise.all([post('1000.00'), post('1000.00')]);

    // Assert the OUTCOMES as a set — 1500 in the drawer admits exactly one
    // 1000.00 payout, but WHICH of the two requests gets it depends on which
    // one wins the advisory lock, and Postgres promises no order there.
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 400]);

    const [winner, loser] = a.status === 201 ? [a, b] : [b, a];
    expect(loser.body.code).toBe('PAYOUT_EXCEEDS_CASH');
    expect(winner.body.paid_amount).toBe('1000.00');

    const journal = await request(app.getHttpServer())
      .get('/intakes')
      .query({ shift_id: shiftId })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    // The loser's WHOLE transaction rolled back — its intake never landed
    // either, exactly like a receipt without its «видано» would not match
    // the paper in the supplier's hand.
    expect(journal.body.total).toBe(1);
    expect(journal.body.data[0]).toMatchObject({ id: winner.body.id, paid_amount: '1000.00' });

    // Drawer is now 1500 − 1000 = 500. A 500.00 reception fits it exactly —
    // proof the winner's payout, and only the winner's, actually landed.
    const third = await request(app.getHttpServer())
      .post('/intakes')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierId, items: [line()], paid_amount: '500.00' })
      .expect(201);
    expect(third.body.paid_amount).toBe('500.00');
  });

  it('two UNPAID receptions in flight together both land, consecutively numbered', async () => {
    const post = () =>
      request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, items: [line()] });

    const [a, b] = await Promise.all([post(), post()]);

    // No payout on either side of this race, so nothing here can refuse —
    // both must land, with distinct codes the advisory lock serialised.
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.code).not.toBe(b.body.code);

    const sequenceOf = (code: unknown): number => {
      const match = /-(\d{3})$/.exec(code as string);
      if (!match) throw new Error(`unexpected code shape: ${String(code)}`);
      return Number(match[1]);
    };
    const sequences = [sequenceOf(a.body.code), sequenceOf(b.body.code)].sort((x, y) => x - y);
    expect(sequences[1] - sequences[0]).toBe(1);
  });
});
