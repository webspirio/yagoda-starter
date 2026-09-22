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

/**
 * `GET /suppliers/:id/balance` over real HTTP against a real Postgres — the
 * breakdown's SQL (#103) proven at the one boundary a unit spec cannot reach:
 * whether the projected columns actually add up, and whether Postgres's own
 * `date` and `numeric` wire types come back the shape the mapper promises.
 *
 * Modelled on `crates/crates.db-spec.ts`: the full `AppModule` over real HTTP,
 * one token signed with the app's own `JwtService` rather than a real
 * `/auth/login` (§ that file's own doc comment), so this file never touches
 * the shared login throttle.
 *
 * ONE SUPPLIER carries every case the formula has to get right:
 *   - two LIVE receipts, on different business dates, so `intakes_count`,
 *     `kg_total` and `last_intake_date` all have something to select among
 *   - one VOIDED receipt that ALSO carries a (live) top-up — proving the
 *     parent's void neutralises the top-up WITHOUT the top-up's own
 *     `voided_at` doing any of the work
 *   - one LIVE top-up on a LIVE receipt — the one top-up that must count
 *   - one LIVE payout and one VOIDED payout — the voided one must not close
 *     any debt
 *
 * A SECOND, untouched supplier proves the `0.00`-not-`0` fallback and the
 * `null` shape of `last_intake_date` for a person with no documents at all.
 */
describe('supplier balance breakdown (HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;
  let pointId: string;
  let userId: string;
  let supplierId: string;
  let emptySupplierId: string;

  const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

  const get = (path: string) =>
    request(app.getHttpServer()).get(path).set('Authorization', `Bearer ${ownerToken}`).expect(200);

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

    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `breakdown-owner-${randomUUID()}`,
        first_name: 'Breakdown',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    ownerToken = jwt.sign({ sub: owner.id });
    userId = owner.id;

    const run = randomUUID().slice(0, 8);

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Розбивка ${run}`, pointCode()],
    );
    pointId = point.id;

    // One grade — `kg_total` sums `intake_items.net_kg`, and the FK just needs
    // to resolve; which product it names is irrelevant to this suite.
    const [product] = await ds.query(`INSERT INTO products (name) VALUES ($1) RETURNING id`, [
      `Малина ${run}`,
    ]);
    const [grade] = await ds.query(
      `INSERT INTO product_grades (product_id, name) VALUES ($1, 'Стандарт') RETURNING id`,
      [product.id],
    );

    // Two shifts on two dates — `UQ_shifts_point_business_date` forbids two
    // shifts on the SAME date at the SAME point, and the newer date is what
    // `last_intake_date` must select. `UQ_shifts_open_per_point` (partial,
    // `WHERE closed_at IS NULL`) forbids two OPEN shifts at once, so the
    // earlier one is inserted already closed.
    const [shiftEarly] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           status, closed_at, closed_by_user_id)
       VALUES ($1, $2, '2026-09-15', 'closed', now(), $2) RETURNING id`,
      [pointId, userId],
    );
    const [shiftLate] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-20') RETURNING id`,
      [pointId, userId],
    );

    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `Постачальник-${run}`],
    );
    supplierId = supplier.id;

    const [empty] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Порожній', $2, true) RETURNING id`,
      [pointId, `Пусто-${run}`],
    );
    emptySupplierId = empty.id;

    // Live receipt #1 — 100.00 кг, 2026-09-15.
    const [intakeEarly] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '3000.00', $4) RETURNING id`,
      [`BD-IN-${run}-1`, shiftEarly.id, supplierId, userId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '100.00', '0.00', '0.00', '100.00', '30.00', '0.00', '3000.00')`,
      [intakeEarly.id, grade.id],
    );

    // Live receipt #2 — 150.50 кг, 2026-09-20 — the newer of the two, and the
    // one carrying the live top-up below.
    const [intakeLate] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '7000.00', $4) RETURNING id`,
      [`BD-IN-${run}-2`, shiftLate.id, supplierId, userId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '150.50', '0.00', '0.00', '150.50', '46.51', '0.00', '7000.00')`,
      [intakeLate.id, grade.id],
    );

    // The ONE top-up that must count — live, on a live receipt.
    await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, '150.00', 'доплата за спеціальною ціною', $2)`,
      [intakeLate.id, userId],
    );

    // A VOIDED receipt carrying its OWN live top-up — both the receipt's
    // amount and its top-up must vanish from every total, and NEITHER counts
    // toward `intakes_count`, `kg_total` or `last_intake_date`.
    const [intakeVoided] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, '2000.00', $4, now(), $4, 'тестове сторно') RETURNING id`,
      [`BD-IN-${run}-3`, shiftEarly.id, supplierId, userId],
    );
    await ds.query(
      `INSERT INTO intake_items (intake_id, item_order, product_grade_id,
           gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount)
       VALUES ($1, 1, $2, '50.00', '0.00', '0.00', '50.00', '40.00', '0.00', '2000.00')`,
      [intakeVoided.id, grade.id],
    );
    await ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, '999.00', 'доплата на сторновану квитанцію', $2)`,
      [intakeVoided.id, userId],
    );

    // Live payout — the one that must close part of the debt.
    await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id)
       VALUES ($1, $2, $3, '5000.00', $4)`,
      [`BD-PO-${run}-1`, shiftLate.id, supplierId, userId],
    );

    // Voided payout — must NOT close any debt (§9.3 — a void does not return
    // cash on its own; that is a separate `settle-return`, irrelevant here).
    await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id,
                            voided_at, voided_by_user_id, void_reason)
       VALUES ($1, $2, $3, '1500.00', $4, now(), $4, 'тестове сторно')`,
      [`BD-PO-${run}-2`, shiftLate.id, supplierId, userId],
    );
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('adds up to its own debt over the same data', async () => {
    const { body } = await get(`/suppliers/${supplierId}/balance`);
    expect(sub(add(body.intakes_total, body.top_ups_total), body.payouts_total)).toBe(body.debt);
  });

  it('lets a voided receipt neutralise its own top-up', async () => {
    const { body } = await get(`/suppliers/${supplierId}/balance`);
    expect(body.top_ups_total).toBe('150.00'); // only the live receipt's top-up
  });

  it('does not let a voided payout close any debt', async () => {
    const { body } = await get(`/suppliers/${supplierId}/balance`);
    expect(body.payouts_total).toBe('5000.00'); // the voided one is absent
  });

  it('counts and weighs only live receipts, and dates the newest of them', async () => {
    const { body } = await get(`/suppliers/${supplierId}/balance`);
    expect(body.intakes_count).toBe(2);
    expect(body.kg_total).toBe('250.50');
    expect(body.last_intake_date).toBe('2026-09-20');
  });

  it('reads 0.00, not 0, for a supplier with no documents at all', async () => {
    const { body } = await get(`/suppliers/${emptySupplierId}/balance`);
    expect(body).toMatchObject({
      debt: '0.00',
      intakes_total: '0.00',
      top_ups_total: '0.00',
      payouts_total: '0.00',
      intakes_count: 0,
      kg_total: '0.00',
      last_intake_date: null,
    });
  });
});
