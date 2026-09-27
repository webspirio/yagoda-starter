import { randomUUID } from 'crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// MUST precede `../app.module` — it loads `.env` as a side effect.
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
import { PayoutWriter } from '../payouts/services/payout-writer';
import { SupplierDebtQuery } from '../supplier-balance/queries/supplier-debt.query';
import { SupplierSettlementQuery } from '../supplier-balance/queries/supplier-settlement.query';
import { AllocationsService } from '../supplier-balance/services/allocations';
import { PointCashService } from '../point-cash/point-cash.service';
import { timezoneConfig } from '../config/timezone.config';
import { sub } from '../common/money';

/**
 * #125 end to end: old debt 1000, receipt R 500 today, payout P 1500 issued with R
 * (it covered R and the old receipt). Each test builds its own supplier; the
 * database persists between runs, so every name carries the run's uuid.
 */
describe('intake void with a payout decision (HTTP, Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;
  let operatorToken: string;
  let operatorId: string;
  let pointId: string;
  let oldShiftId: string;
  let todayShiftId: string;
  const run = randomUUID();

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
    const make = (role: UserRole, point: string | null, tag: string) =>
      users.createWithIdentity(
        {
          provider: LOCAL_PROVIDER,
          providerUserId: `ivpd-${tag}-${randomUUID()}`,
          first_name: tag,
          last_name: 'Test',
          role,
          ...(point ? { collection_point_id: point } : {}),
        },
        async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
      );

    const { user: owner } = await make(UserRole.NetworkOwner, null, 'owner');
    ownerToken = jwt.sign({ sub: owner.id });

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`ivpd-${run}`, run.replace(/-/g, '').slice(0, 8).toUpperCase()],
    );
    pointId = point.id;

    const { user: operator } = await make(UserRole.PointOperator, pointId, 'oksana');
    operatorId = operator.id;
    operatorToken = jwt.sign({ sub: operator.id });

    const tz = app.get<{ appTimezone: string }>(timezoneConfig.KEY).appTimezone;
    const [old] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, '2026-07-01', now(), $2, 'closed') RETURNING id`,
      [pointId, operatorId],
    );
    oldShiftId = old.id;
    // Today's local date: a settled return is credited to the shift of its local date.
    const [today] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status)
       VALUES ($1, $2, (now() AT TIME ZONE $3::text)::date, 'open') RETURNING id`,
      [pointId, operatorId, tz],
    );
    todayShiftId = today.id;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  let seq = 0;
  /** A fresh supplier with the #125 fixture. Returns the ids the tests need. */
  const scenario = async () => {
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ніна', $2, true) RETURNING id`,
      [pointId, `ivpd-${run}-${++seq}`],
    );
    const intake = async (shiftId: string, amount: string) => {
      const [row] = await ds.query(
        `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [`IN-${run}-${++seq}`, shiftId, supplier.id, amount, operatorId],
      );
      return row.id as string;
    };
    const oldId = await intake(oldShiftId, '1000.00');
    const rId = await intake(todayShiftId, '500.00');
    const [p] = await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id)
       VALUES ($1, $2, $3, '1500.00', $4, $5) RETURNING id`,
      [`PO-${run}-${++seq}`, todayShiftId, supplier.id, operatorId, rId],
    );

    // Raw fixture, so nothing has allocated this yet. Without this, the "keep"
    // case below would pass even if `release` did nothing — `allocate` recomputes
    // fully from live documents, so a fixture with no prior rows can't tell a
    // working void from a no-op one. Allocating here first gives `release` real
    // frozen rows to void.
    const supplierId = supplier.id as string;
    await ds.transaction(async (m) => {
      const a = new AllocationsService();
      await a.lockSupplier(m, supplierId);
      await a.allocate(m, supplierId);
    });

    return { supplierId, oldId, rId, pId: p.id as string };
  };

  const voidIntake = (token: string, id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/intakes/${id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const row = async (table: 'intakes' | 'payouts', id: string) =>
    (await ds.query(`SELECT * FROM ${table} WHERE id = $1`, [id]))[0];
  const debt = (supplierId: string) => app.get(SupplierDebtQuery).debtFor(supplierId);
  const cash = () => app.get(PointCashService).movementsForShift(todayShiftId);

  it('400s without a decision and leaves both documents live', async () => {
    const s = await scenario();
    const res = await voidIntake(operatorToken, s.rId, { reason: 'помилка' }).expect(400);
    expect(res.body.code).toBe('PAYOUT_DECISION_REQUIRED');
    expect((await row('intakes', s.rId)).voided_at).toBeNull();
    expect((await row('payouts', s.pId)).voided_at).toBeNull();
  });

  it('403s an operator choosing void_returned and writes nothing', async () => {
    const s = await scenario();
    const res = await voidIntake(operatorToken, s.rId, {
      reason: 'повернув',
      payout: 'void_returned',
    }).expect(403);
    expect(res.body.code).toBe('OWNER_ONLY');
    expect((await row('intakes', s.rId)).voided_at).toBeNull();
  });

  it('keep: the payout re-routes to the old receipt and leaves 500 as an advance', async () => {
    const s = await scenario();
    await voidIntake(operatorToken, s.rId, { reason: 'помилка', payout: 'keep' }).expect(201);

    expect((await row('payouts', s.pId)).voided_at).toBeNull();
    await expect(debt(s.supplierId)).resolves.toBe('-500.00');
    const settlement = await app.get(SupplierSettlementQuery).settlementFor(s.supplierId);
    expect(settlement.lines.map((l) => [l.id, l.open])).toEqual([[s.oldId, '0.00']]);
    expect(settlement.payouts[0].unallocated).toBe('500.00');
  });

  it('void: both voided, the old receipt reopens, the drawer does not change', async () => {
    const s = await scenario();
    const before = await cash();
    await voidIntake(operatorToken, s.rId, { reason: 'помилка', payout: 'void' }).expect(201);

    const p = await row('payouts', s.pId);
    expect(p.voided_at).not.toBeNull();
    expect(p.void_reason).toBe('помилка');
    expect(p.return_settled_at).toBeNull();
    await expect(debt(s.supplierId)).resolves.toBe('1000.00');
    expect(sub(await cash(), before)).toBe('0.00');
  });

  it('void_returned (owner): both voided and 1500 back in the drawer', async () => {
    const s = await scenario();
    const before = await cash();
    await voidIntake(ownerToken, s.rId, { reason: 'повернув', payout: 'void_returned' }).expect(
      201,
    );

    const p = await row('payouts', s.pId);
    expect(p.return_settled_at).not.toBeNull();
    expect(p.return_note).toBe('повернув');
    await expect(debt(s.supplierId)).resolves.toBe('1000.00');
    expect(sub(await cash(), before)).toBe('1500.00');
    const actions = await ds.query(
      `SELECT action FROM audit_log WHERE target_id IN ($1, $2) ORDER BY at, action`,
      [s.rId, s.pId],
    );
    expect(actions.map((a: { action: string }) => a.action).sort()).toEqual([
      'intake.voided',
      'payout.return-settled',
      'payout.voided',
    ]);
  });

  it('is atomic: a failure voiding the payout leaves the receipt live', async () => {
    const s = await scenario();
    const spy = jest.spyOn(app.get(PayoutWriter), 'void').mockRejectedValueOnce(new Error('boom'));
    try {
      await voidIntake(operatorToken, s.rId, { reason: 'помилка', payout: 'void' }).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await row('intakes', s.rId)).voided_at).toBeNull();
    expect((await row('payouts', s.pId)).voided_at).toBeNull();
  });

  it('two concurrent voids: one wins, the other is ALREADY_VOIDED, one payout.voided entry', async () => {
    const s = await scenario();
    const results = await Promise.all([
      voidIntake(operatorToken, s.rId, { reason: 'a', payout: 'void' }),
      voidIntake(operatorToken, s.rId, { reason: 'b', payout: 'void' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('ALREADY_VOIDED');
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE target_id = $1 AND action = 'payout.voided'`,
      [s.pId],
    );
    expect(n).toBe(1);
  });
});
