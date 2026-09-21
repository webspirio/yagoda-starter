import { randomUUID } from 'crypto';
import { Agent as HttpAgent } from 'http';
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

/**
 * §3.6 IN FULL, under REAL concurrency — the finding behind PR #137's review:
 * before the fix, `writePayout` read `PointCashService.cashFor` and checked
 * `PAYOUT_EXCEEDS_CASH` BEFORE `nextDocumentCode`'s advisory lock, guarded
 * only by `FOR UPDATE` on the SUPPLIER row. That lock is a per-supplier
 * mutex, so two payouts to two DIFFERENT suppliers at one point never
 * contend on it — both read the same drawer, both pass, both commit, and the
 * drawer goes negative. `intake-reception-race.db-spec.ts` proves the
 * reception path is already safe (it holds the `intakes` advisory lock
 * before ever calling `writePayout`); this file is the standalone-payout
 * twin that lock does NOT cover.
 *
 * Two requests issued from one supertest app against one running
 * `INestApplication` are genuinely concurrent the same way that file's are:
 * Nest handles them on the same event loop, but the database work each one
 * awaits interleaves. WHICH of the two wins the lock is not deterministic —
 * Postgres makes no ordering promise for two backends blocked on the same
 * `pg_advisory_xact_lock` — so every assertion below reads the pair as a SET.
 *
 * EACH RACING PAIR RUNS OVER A SHARED, PRE-WARMED KEEP-ALIVE AGENT
 * (`racingAgent`, below) — NOT the bare `request(app.getHttpServer())` every
 * other spec in this codebase uses for a one-off call. `supertest` opens a
 * FRESH TCP connection per request by default (`Connection: close`), and on
 * this machine that connection's setup cost is uneven enough between two
 * concurrent connections that the second request's first query can land
 * several milliseconds AFTER the first request has already committed — long
 * outside the window the bug needs, so the race silently fails to reproduce
 * even against the unfixed code (confirmed empirically while writing this
 * spec: the bare pattern passed 5/5 runs against the pre-fix `writePayout`).
 * Reusing two already-established sockets removes that connection-setup tax
 * from the timing entirely, which is what makes the reproduction reliable.
 */
describe('payout cash race: two suppliers, one drawer (HTTP, Postgres)', () => {
  let gradeId: string;
  let crateId: string;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    // See `intake-paid-at-reception.db-spec.ts` for why this line has to be
    // here: the app expects `app_test` to already exist rather than creating
    // it, and this suite's fixtures are uuid-scoped because that database
    // persists between runs.
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
        providerUserId: `pcr-owner-${randomUUID()}`,
        first_name: 'Cash',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    ownerToken = tokenFor(owner.id);

    // The catalog both scenarios below share — point-agnostic, unlike the
    // grade-price each scenario's own point needs.
    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `pcr-product-${randomUUID()}` })
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
        name: `pcr-crate-${randomUUID()}`,
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      })
      .expect(201);
    crateId = tareRes.body.id as string;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  // A crate of 1.20 kg and gross 11.20 kg make a 10.00 kg line at 100.00 ₴/kg
  // = 1000.00 ₴ — the one figure every test below is built on. An unpaid
  // intake of one such line gives a supplier exactly 1000.00 of debt, which
  // is what makes `debtFor` pass a 1000.00 payout without being the thing
  // under test — only the CASH ceiling is.
  const line = () => ({
    product_grade_id: gradeId,
    gross_kg: '11.20',
    tare: [{ tare_type_id: crateId, units: 1 }],
  });

  /**
   * One point, one operator, two active suppliers, each already owing
   * 1000.00 (an unpaid intake apiece) — the shared setup both scenarios
   * below use, built fresh per scenario so neither test's spent drawer
   * leaks into the other's.
   */
  async function setUpPointWithTwoDebtors(): Promise<{
    operatorToken: string;
    pointId: string;
    shiftId: string;
    supplierAId: string;
    supplierBId: string;
  }> {
    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `pcr-point-${randomUUID()}`, code: pointCode() })
      .expect(201);
    const pointId = pointRes.body.id as string;

    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);
    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `pcr-op-${randomUUID()}`,
        first_name: 'Каса',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    const operatorToken = jwt.sign({ sub: operator.id });

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

    const supplierARes = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Ганна', last_name: `Дебіторка-А-${randomUUID()}` })
      .expect(201);
    const supplierAId = supplierARes.body.id as string;

    const supplierBRes = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Борис', last_name: `Дебітор-Б-${randomUUID()}` })
      .expect(201);
    const supplierBId = supplierBRes.body.id as string;

    // §6.1 — opening counts the drawer in the same request, and it is the
    // point's first count, so 1500.00 IS the drawer with nothing else moved.
    const shiftRes = await request(app.getHttpServer())
      .post('/shifts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '1500.00' })
      .expect(201);
    const shiftId = shiftRes.body.id as string;

    // Give EACH supplier 1000.00 of debt — an unpaid intake apiece — so
    // `debtFor` passes a 1000.00 payout to either one and only the CASH half
    // of §3.6 is what refuses the loser below.
    for (const supplierId of [supplierAId, supplierBId]) {
      await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, items: [line()] })
        .expect(201);
    }

    return { operatorToken, pointId, shiftId, supplierAId, supplierBId };
  }

  /**
   * A keep-alive `http.Agent`, pre-warmed with TWO harmless authenticated
   * reads over it before the caller fires its real racing pair — see the
   * describe-level comment for why this is what makes the race land instead
   * of racing past itself.
   */
  async function racingAgent(operatorToken: string, pointId: string): Promise<HttpAgent> {
    const agent = new HttpAgent({ keepAlive: true, maxSockets: 10 });
    const warmUp = () =>
      request(app.getHttpServer())
        .get(`/point-cash/${pointId}`)
        .agent(agent as never)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
    await Promise.all([warmUp(), warmUp()]);
    return agent;
  }

  it('two standalone payouts for two suppliers against one drawer: exactly one is paid, the drawer lands at 500.00', async () => {
    const { operatorToken, pointId, supplierAId, supplierBId } = await setUpPointWithTwoDebtors();
    const agent = await racingAgent(operatorToken, pointId);

    const payout = (supplierId: string) =>
      request(app.getHttpServer())
        .post('/payouts')
        .agent(agent as never)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, amount: '1000.00' });

    const [a, b] = await Promise.all([payout(supplierAId), payout(supplierBId)]);

    // Assert the OUTCOMES as a set — 1500 in the drawer admits exactly one
    // 1000.00 payout, but WHICH of the two requests gets it depends on which
    // one wins the advisory lock, and Postgres promises no order there.
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 400]);

    const loser = a.status === 201 ? b : a;
    expect(loser.body.code).toBe('PAYOUT_EXCEEDS_CASH');

    const cash = await request(app.getHttpServer())
      .get(`/point-cash/${pointId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(cash.body.cash).toBe('500.00');
  });

  it('a paid reception for one supplier and a standalone payout for another, in flight together: exactly one wins, the drawer lands at 500.00', async () => {
    const { operatorToken, pointId, shiftId, supplierAId, supplierBId } =
      await setUpPointWithTwoDebtors();
    const agent = await racingAgent(operatorToken, pointId);

    // `Promise.resolve(...)` on a supertest `Test` (a thenable, not a started
    // request) is what actually fires it — `.then()` is what triggers
    // `.end()` under the hood, and nothing sends before that. Wrapping it
    // schedules that `.then()` as a MICROTASK, which drains before the
    // `setTimeout` below ever starts waiting, so this genuinely dispatches
    // now rather than only once `Promise.all` gets around to it.
    const receptionForA = Promise.resolve(
      request(app.getHttpServer())
        .post('/intakes')
        .agent(agent as never)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierAId, items: [line()], paid_amount: '1000.00' }),
    );
    // A reception does far more work than a standalone payout BEFORE either
    // reaches `writePayout`'s cash read — price/tare lookups, `buildIntake`,
    // its OWN `IN` advisory lock — so dispatched at the exact same instant
    // the payout always wins the race to `cashFor` and commits well before
    // the reception gets there (measured empirically while writing this
    // spec: 0/5 runs against the pre-fix code overlapped with a bare
    // `Promise.all`). This head start is what puts the two requests' cash
    // reads back in the SAME window a real two-operator scramble would.
    await new Promise((resolve) => setTimeout(resolve, 25));
    const standalonePayoutForB = request(app.getHttpServer())
      .post('/payouts')
      .agent(agent as never)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierBId, amount: '1000.00' });

    const [reception, payout] = await Promise.all([receptionForA, standalonePayoutForB]);

    const statuses = [reception.status, payout.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 400]);

    const receptionWon = reception.status === 201;
    const loserBody = receptionWon ? payout.body : reception.body;
    expect(loserBody.code).toBe('PAYOUT_EXCEEDS_CASH');

    const cash = await request(app.getHttpServer())
      .get(`/point-cash/${pointId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(cash.body.cash).toBe('500.00');

    // If the reception was the one refused, its WHOLE transaction rolled
    // back — the intake it would have written does not exist either, exactly
    // like a receipt without its «видано» would not match the paper in the
    // supplier's hand. Two intakes already exist in this shift (one per
    // supplier, from `setUpPointWithTwoDebtors`'s debt setup); a third lands
    // only if the reception won.
    const journal = await request(app.getHttpServer())
      .get('/intakes')
      .query({ shift_id: shiftId })
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(journal.body.total).toBe(receptionWon ? 3 : 2);
  });
});
