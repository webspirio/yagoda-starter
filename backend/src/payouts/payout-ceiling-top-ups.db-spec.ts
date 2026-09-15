import { randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
// MUST precede `../app.module` — it loads `.env`, and AppModule's decorator
// runs ConfigModule.forRoot() eagerly at import time.
import { relaxThrottleForTests, resolveTestDatabaseName } from '../testing/db-harness';
import { AppModule } from '../app.module';
import { PayoutsService } from './payouts.service';
import { IntakesService } from '../intakes/intakes.service';
import { IntakeTopUpsService } from '../intake-top-ups/intake-top-ups.service';
import { SupplierBalanceService } from '../supplier-balance/supplier-balance.service';
import { PointCashService } from '../point-cash/point-cash.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * THE SPEC'S §7.2 CLAIM, UNDER TEST: centralising the formula in `debtSql`
 * makes a top-up payable through the ordinary payout flow with no change in
 * `payouts`. If this file ever needs production code to pass, that claim is
 * false and the slice has a second formula somewhere.
 *
 * §7.3 IS HERE TOO, AS A NEGATIVE: a top-up moves no cash. `movementsSql` has
 * three terms and a top-up is none of them, which is easy to break later by
 * "helpfully" adding a fourth.
 */
describe('payout ceiling with top-ups (Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let payouts: PayoutsService;
  let intakes: IntakesService;
  let topUps: IntakeTopUpsService;
  let balance: SupplierBalanceService;
  let pointCash: PointCashService;
  let run: string;
  let pointId: string;
  let ownerId: string;
  let shiftId: string;

  const owner = (): AuthenticatedUser =>
    ({ sub: ownerId, role: UserRole.NetworkOwner, collection_point_id: null }) as AuthenticatedUser;

  // Copied verbatim (modulo `ds` being resolved from the booted app instead of
  // a bare `openTestDataSource()`) from
  // `../supplier-balance/intake-top-ups-balance.db-spec.ts` Step 1 — those
  // helpers insert against the real schema and are known to work.
  const supplier = async (last: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `${last}-${run}`],
    );
    return row.id;
  };

  const intake = async (supplierId: string, amount: string): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [`B-IN-${randomUUID().slice(0, 8)}`, shiftId, supplierId, amount, ownerId],
    );
    return row.id;
  };

  const payout = async (supplierId: string, amount: string): Promise<void> => {
    await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [`B-PO-${randomUUID().slice(0, 8)}`, shiftId, supplierId, amount, ownerId],
    );
  };

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    relaxThrottleForTests();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    ds = app.get(DataSource);
    payouts = app.get(PayoutsService);
    intakes = app.get(IntakesService);
    topUps = app.get(IntakeTopUpsService);
    balance = app.get(SupplierBalanceService);
    pointCash = app.get(PointCashService);
    run = randomUUID().slice(0, 8);

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Стеля ${run}`, `C${run.slice(0, 5).toUpperCase()}`],
    );
    pointId = point.id;

    const [user] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Стеля-${run}`],
    );
    ownerId = user.id;

    const [shift] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointId, ownerId],
    );
    shiftId = shift.id;

    // An opening cash count so the point has a non-zero cash anchor — without
    // one `pointCash.cashFor` reads '0.00' no matter what the documents say,
    // which would make the "moves no cash" assertion below vacuous.
    await ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount,
                                counted_by_user_id, counted_at)
       VALUES ($1, 'berry', 'opening', '5000.00', '5000.00', $2, $3)`,
      [shiftId, ownerId, new Date('2026-09-08T07:00:00Z')],
    );
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a fully-paid receipt plus a 2000 top-up can be paid exactly 2000', async () => {
    // 100.00 intake, 100.00 payout → debt 0.00. Then a 2 000 top-up.
    const supplierId = await supplier('Стеля');
    const intakeId = await intake(supplierId, '100.00');
    await payout(supplierId, '100.00');
    expect(await balance.debtFor(supplierId)).toBe('0.00');

    await topUps.create(owner(), {
      intake_id: intakeId,
      amount: '2000.00',
      reason: 'перерахували ціну після здачі',
    });

    expect(await balance.debtFor(supplierId)).toBe('2000.00');

    const paid = await payouts.create(owner(), {
      code: `CEIL-${run}`,
      collection_point_id: pointId,
      supplier_id: supplierId,
      amount: '2000.00',
    });

    expect(paid.amount).toBe('2000.00');
    expect(await balance.debtFor(supplierId)).toBe('0.00');
  });

  it('refuses one kopiyka more than the top-up made available', async () => {
    const supplierId = await supplier('Копійка');
    const intakeId = await intake(supplierId, '100.00');
    await payout(supplierId, '100.00');
    await topUps.create(owner(), {
      intake_id: intakeId,
      amount: '2000.00',
      reason: 'доплата',
    });
    // Pin the precondition: the debt this attempt is refused AGAINST is
    // exactly 2000.00. Without this, a top-up that silently failed to apply
    // would leave the debt at 0.00 and the attempt below would still throw
    // PAYOUT_EXCEEDS_DEBT — proving nothing about the boundary itself.
    expect(await balance.debtFor(supplierId)).toBe('2000.00');

    await expect(
      payouts.create(owner(), {
        code: `CEIL2-${run}`,
        collection_point_id: pointId,
        supplier_id: supplierId,
        amount: '2000.01',
      }),
    ).rejects.toMatchObject({ response: { code: 'PAYOUT_EXCEEDS_DEBT' } });
  });

  it('voiding the parent receipt takes the ceiling back down', async () => {
    const supplierId = await supplier('Сторно');
    const intakeId = await intake(supplierId, '100.00');
    await topUps.create(owner(), {
      intake_id: intakeId,
      amount: '2000.00',
      reason: 'доплата',
    });
    expect(await balance.debtFor(supplierId)).toBe('2100.00');

    await intakes.void(owner(), intakeId, { reason: 'не та людина' });

    // BOTH terms drop: the receipt and the money that hung off it.
    expect(await balance.debtFor(supplierId)).toBe('0.00');
  });

  it('a top-up moves NO cash — spec §7.3', async () => {
    const before = await pointCash.cashFor(pointId);
    // The fixture's opening cash count must actually anchor a non-zero
    // figure, or a byte-identical comparison below would pass vacuously even
    // if a top-up DID move cash.
    expect(before).not.toBe('0.00');

    const supplierId = await supplier('Каса');
    const intakeId = await intake(supplierId, '100.00');
    await topUps.create(owner(), {
      intake_id: intakeId,
      amount: '5000.00',
      reason: 'доплата',
    });

    const after = await pointCash.cashFor(pointId);

    // The receipt moved no cash either — only payouts and transfers do — so
    // the figure must be byte-identical, not merely close.
    expect(after).toBe(before);
  });
});
