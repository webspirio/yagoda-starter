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
 * `POST /cash-counts` — R2's midday recount, over real HTTP through the whole
 * `AppModule`, modelled on `crates/crates.db-spec.ts`: every token is signed
 * directly with the app's own `JwtService` (never a real `/auth/login`), so
 * this file never touches the shared login throttle.
 *
 * WHY HTTP AND NOT THE SERVICE DIRECTLY (unlike `cash-counts.db-spec.ts`,
 * which drives `CashCountsService.list` straight): two of the brief's cases
 * are guard behaviour, not service logic — the owner's 403 comes from
 * `@Auth(UserRole.PointOperator)` on the controller, which a bare
 * `new CashCountsService(...)` call never exercises at all.
 *
 * THE FIXTURE'S NUMBERS ARE THE BRIEF'S OWN: a shift opened with a `1500.00`
 * counted drawer (the point's FIRST count, so `expected := counted` by
 * construction — `PointCashService`'s header), a supplier, one 1 000.00
 * intake (funds the supplier's debt; intakes never move cash — see
 * `movementsSql`'s doc comment, which sums only transfers/payouts/settled
 * returns) and one standalone 400.00 payout. `cashFor` is therefore
 * `1500.00 (opening anchor) − 400.00 (payout) = 1100.00` — the figure every
 * recount below is checked against. The intake and payout are inserted
 * directly by SQL rather than through `POST /intakes`/`POST /payouts`: what is
 * under test here is the recount route, and neither document's own write path
 * is exercised by this file.
 */
describe('POST /cash-counts — midday recount (HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;
  let operatorToken: string;
  // A DIFFERENT point's operator — the falsifier for "the point is the
  // actor's, never the request's": their own point has no open shift, so a
  // recount from them must refuse SHIFT_NOT_OPEN even though point A's shift
  // is wide open.
  let foreignOperatorToken: string;
  let pointId: string;
  let shiftId: string;

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
        providerUserId: `recount-owner-${randomUUID()}`,
        first_name: 'Recount',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    ownerToken = tokenFor(owner.id);

    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `recount-point-${randomUUID()}`, code: pointCode() })
      .expect(201);
    pointId = pointRes.body.id as string;

    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `recount-op-${randomUUID()}`,
        first_name: 'Оксана',
        last_name: 'Каса',
        role: UserRole.PointOperator,
        collection_point_id: pointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    operatorToken = tokenFor(operator.id);

    const foreignPointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `recount-foreign-${randomUUID()}`, code: pointCode() })
      .expect(201);
    const { user: foreignOperator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `recount-foreign-op-${randomUUID()}`,
        first_name: 'Леся',
        last_name: 'Чужа',
        role: UserRole.PointOperator,
        collection_point_id: foreignPointRes.body.id as string,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    foreignOperatorToken = tokenFor(foreignOperator.id);

    const supplierRes = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Постачальник-${randomUUID()}` })
      .expect(201);
    const supplierId = supplierRes.body.id as string;

    // The point's FIRST count, so `expected := counted` — see this file's
    // header — which is exactly the anchor `cashFor` walks forward below.
    const shiftRes = await request(app.getHttpServer())
      .post('/shifts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '1500.00' })
      .expect(201);
    shiftId = shiftRes.body.id as string;

    // One unpaid intake worth 1 000 — funds the supplier's debt ceiling and
    // does NOT move cash (movementsSql never reads `intakes`). Inserted
    // directly: the intake write path is not what this file tests.
    await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '1000.00', $4)`,
      [`RC-IN-${randomUUID()}`, shiftId, supplierId, operator.id],
    );

    // One standalone 400 payout — the only row that actually moves cash here.
    await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id)
       VALUES ($1, $2, $3, '400.00', $4)`,
      [`RC-PO-${randomUUID()}`, shiftId, supplierId, operator.id],
    );
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('(a) recounts 1100.00 — matches the drawer exactly: 0.00, not open', async () => {
    const res = await request(app.getHttpServer())
      .post('/cash-counts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ book: 'berry', counted_amount: '1100.00' })
      .expect(201);

    expect(res.body).toMatchObject({
      shift_id: shiftId,
      book: 'berry',
      kind: 'midday',
      counted_amount: '1100.00',
      expected_amount: '1100.00',
      discrepancy: '0.00',
      is_open: false,
      // D-8 — displayNameOf the operator who pressed the button (§10.6):
      // "Оксана Каса", the fixture's own first/last name.
      counted_by_name: 'Оксана Каса',
    });
  });

  it('(b) a SECOND recount on the same shift also lands — midday sits outside the unique index', async () => {
    const res = await request(app.getHttpServer())
      .post('/cash-counts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ book: 'berry', counted_amount: '1000.00' })
      .expect(201);

    expect(res.body).toMatchObject({
      shift_id: shiftId,
      kind: 'midday',
      counted_amount: '1000.00',
      // The drawer did not move between (a) and (b) — nothing here adds or
      // removes a transfer/payout — so the expectation is unchanged.
      expected_amount: '1100.00',
      discrepancy: '-100.00',
      is_open: false,
    });
  });

  it('(c) GET /point-cash is unchanged — a witness moves nothing', async () => {
    const res = await request(app.getHttpServer())
      .get('/point-cash')
      .query({ collection_point_id: pointId })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    expect(res.body.data[0]).toMatchObject({ collection_point_id: pointId, cash: '1100.00' });
  });

  it('(d) refuses once the shift is closed', async () => {
    await request(app.getHttpServer())
      .post(`/shifts/${shiftId}/close`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '1100.00', broken_crates: 0 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/cash-counts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ book: 'berry', counted_amount: '1100.00' })
      .expect(400);

    expect(res.body.code).toBe('SHIFT_NOT_OPEN');
  });

  it('(e) refuses the owner — @Auth(UserRole.PointOperator) only', async () => {
    await request(app.getHttpServer())
      .post('/cash-counts')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ book: 'berry', counted_amount: '1100.00' })
      .expect(403);
  });

  it('(f) a foreign operator cannot touch this point — their OWN point has no open shift', async () => {
    const before = (await ds.query('SELECT COUNT(*)::int AS n FROM cash_counts WHERE shift_id = $1', [
      shiftId,
    ])) as { n: number }[];

    const res = await request(app.getHttpServer())
      .post('/cash-counts')
      .set('Authorization', `Bearer ${foreignOperatorToken}`)
      .send({ book: 'berry', counted_amount: '1100.00' })
      .expect(400);

    expect(res.body.code).toBe('SHIFT_NOT_OPEN');

    const after = (await ds.query('SELECT COUNT(*)::int AS n FROM cash_counts WHERE shift_id = $1', [
      shiftId,
    ])) as { n: number }[];
    // No row landed at point A's shift — the DTO carries no point field to
    // forge, so the foreign operator's own (shiftless) point is all they ever
    // reach.
    expect(after[0].n).toBe(before[0].n);
  });
});
