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
import { CrateDispatchService } from './crate-dispatch.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * UNVERIFIED AT WRITE TIME. This spec has never been run — no Postgres was
 * reachable in this environment (port 5432 on this machine belongs to an
 * unrelated project whose credentials happen to match this repo's; connecting
 * would run migrations against the wrong schema). Every route, field and
 * refusal `code` asserted below was checked against the real source rather
 * than a live server:
 *   - `crates/crate-issuances.controller.ts`, `crate-returns.controller.ts`,
 *     `crate-balance.controller.ts` for the paths and verbs
 *   - `crates/crates.service.ts` for the refusal codes and their HTTP status
 *   - `crates/crate-issuance.mapper.ts`, `crate-return.mapper.ts` for the
 *     response field names, including the enriched allocation rows
 *     (`mode`, `code` joined onto each row)
 *   - `crates/crate-balance.service.ts` for the balance response shape
 * It MUST be run — `npm run test:db -w backend -- crates.db-spec` — and pass
 * before this slice merges. Any failure is a real defect in Tasks 5–9; fix the
 * source, never the assertion.
 *
 * Modelled on `testing/documents-pipeline.db-spec.ts`: the full `AppModule`
 * over real HTTP, ONE real `/auth/login` mint is not even needed here — every
 * token is signed with the app's own `JwtService`, exactly as that file's
 * doc comment recommends, so this file never touches the shared login
 * throttle at all.
 */
describe('crates lifecycle (HTTP)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;
  let operatorToken: string;
  let pointId: string;
  let supplierId: string;
  // §6.8's dispatch line (#110) — this file already owns a point, an open
  // shift and the network's one crate tare type, which is everything that
  // query needs besides a receipt to count.
  let dispatch: CrateDispatchService;
  let ownerActor: AuthenticatedUser;
  let shiftId: string;
  let crateTareId: string;
  let boxTareId: string;
  let gradeId: string;

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
        providerUserId: `crates-owner-${randomUUID()}`,
        first_name: 'Crates',
        last_name: 'Owner',
        role: UserRole.NetworkOwner,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    ownerToken = tokenFor(owner.id);
    ownerActor = {
      sub: owner.id,
      username: 'crates-owner',
      role: UserRole.NetworkOwner,
      collection_point_id: null,
    };
    dispatch = app.get(CrateDispatchService);

    const pointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `crates-point-${randomUUID()}`, code: pointCode() })
      .expect(201);
    pointId = pointRes.body.id as string;

    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `crates-op-${randomUUID()}`,
        first_name: 'Оксана',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    operatorToken = tokenFor(operator.id);

    // Exactly one crate type — `UQ_tare_types_single_crate` (bare, not
    // deferrable) tolerates only one flagged row at a time. This is safe even
    // though `app_test` is never truncated and may already carry a flagged
    // row (e.g. from `dev-seed.db-spec.ts`): `TareTypesService.create`
    // unconditionally demotes every other flagged row BEFORE inserting this
    // one, in the same transaction — see that service's own doc comment.
    await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        name: `Ящик-${randomUUID()}`,
        weight_kg: '1.20',
        deposit_price: '120.00',
        is_crate: true,
      })
      .expect(201)
      .then((res) => {
        crateTareId = res.body.id as string;
      });

    // A SECOND tare type, deliberately NOT a crate — «Чешка» on the same
    // receipt is what makes `tt.is_crate` in the dispatch query falsifiable.
    const boxRes = await request(app.getHttpServer())
      .post('/tare-types')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Чешка-${randomUUID()}`, weight_kg: '0.40', deposit_price: '0.00' })
      .expect(201);
    boxTareId = boxRes.body.id as string;

    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `Малина-${randomUUID()}` })
      .expect(201);
    const gradeRes = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: productRes.body.id as string, name: `Перший-${randomUUID()}` })
      .expect(201);
    gradeId = gradeRes.body.id as string;

    const supplierRes = await request(app.getHttpServer())
      .post('/suppliers')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ first_name: 'Іван', last_name: `Постачальник-${randomUUID()}` })
      .expect(201);
    supplierId = supplierRes.body.id as string;

    const shiftRes = await request(app.getHttpServer())
      .post('/shifts')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '0.00' })
      .expect(201);
    shiftId = shiftRes.body.id as string;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  let depositIssuanceId: string;
  let receiptIssuanceId: string;
  let returnId: string;

  it('1. issues 20 against a deposit at 120,00', async () => {
    const res = await request(app.getHttpServer())
      .post('/crate-issuances')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierId, units: 20, mode: 'deposit' })
      .expect(201);

    expect(res.body.deposit_per_unit).toBe('120.00');
    expect(res.body.deposit_taken).toBe('2400.00');
    expect(res.body.code).toMatch(/^[A-Z0-9]+-CD-\d{8}-\d{3}$/);
    expect(res.body.code).toMatch(/-CD-\d{8}-001$/);
    depositIssuanceId = res.body.id as string;
  });

  it('2. issues 200 against a receipt, with its own independent sequence', async () => {
    const res = await request(app.getHttpServer())
      .post('/crate-issuances')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierId, units: 200, mode: 'receipt' })
      .expect(201);

    expect(res.body.deposit_per_unit).toBe('0.00');
    expect(res.body.deposit_taken).toBe('0.00');
    // Same shift, DIFFERENT mode → its own counter, sequence 001 again —
    // proving the CD and CR counters are independent (crate-code.ts).
    expect(res.body.code).toMatch(/^[A-Z0-9]+-CR-\d{8}-001$/);
    receiptIssuanceId = res.body.id as string;
  });

  it('3. reports the combined balance across both tranches', async () => {
    const res = await request(app.getHttpServer())
      .get(`/suppliers/${supplierId}/crate-balance`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    expect(res.body.outstanding_units).toBe(220);
    expect(res.body.deposit_held).toBe('2400.00');
    expect(res.body.tranches).toHaveLength(2);
  });

  it('4. previews a 210 return with a two-way split, and writes NOTHING', async () => {
    const before = await request(app.getHttpServer())
      .get(`/suppliers/${supplierId}/crate-balance`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/crate-returns/preview')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierId, units: 210 })
      .expect(200);

    expect(res.body.allocations).toEqual([
      expect.objectContaining({
        issuance_id: depositIssuanceId,
        units: 20,
        per_unit: '120.00',
        amount: '2400.00',
        mode: 'deposit',
      }),
      expect.objectContaining({
        issuance_id: receiptIssuanceId,
        units: 190,
        per_unit: '0.00',
        amount: '0.00',
        mode: 'receipt',
      }),
    ]);
    expect(res.body.deposit_refund).toBe('2400.00');
    expect(res.body.shortfall).toBe(0);

    const after = await request(app.getHttpServer())
      .get(`/suppliers/${supplierId}/crate-balance`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(after.body).toEqual(before.body);
  });

  it('5. returns 210 for real, refunding 2400.00 and leaving 10 units at 0.00 held', async () => {
    const res = await request(app.getHttpServer())
      .post('/crate-returns')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierId, units: 210 })
      .expect(201);

    expect(res.body.deposit_refund).toBe('2400.00');
    expect(res.body.allocations).toHaveLength(2);
    returnId = res.body.id as string;

    const balance = await request(app.getHttpServer())
      .get(`/suppliers/${supplierId}/crate-balance`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(balance.body.outstanding_units).toBe(10);
    expect(balance.body.deposit_held).toBe('0.00');
  });

  it('6. refuses returning 11 more, naming the 10 actually outstanding', async () => {
    const res = await request(app.getHttpServer())
      .post('/crate-returns')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: supplierId, units: 11 })
      .expect(400);

    expect(res.body.code).toBe('RETURN_EXCEEDS_OUTSTANDING');
    expect(JSON.stringify(res.body)).toContain('10');
  });

  it('7. refuses voiding the first issuance while a live return is allocated against it', async () => {
    const res = await request(app.getHttpServer())
      .post(`/crate-issuances/${depositIssuanceId}/void`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reason: 'ще не можна' })
      .expect(409);

    expect(res.body.code).toBe('ISSUANCE_HAS_RETURNS');
  });

  it('8. voids the return — restores tranche capacity WITHOUT deleting the allocation rows', async () => {
    const res = await request(app.getHttpServer())
      .post(`/crate-returns/${returnId}/void`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reason: 'помилка прийому' })
      .expect(201);

    expect(res.body.voided_at).not.toBeNull();

    const balance = await request(app.getHttpServer())
      .get(`/suppliers/${supplierId}/crate-balance`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    expect(balance.body.outstanding_units).toBe(220);
    expect(balance.body.deposit_held).toBe('2400.00');

    // THE ROWS THEMSELVES SURVIVE THE VOID — `CratesService.voidReturn`'s own
    // doc comment: capacity comes back through `cr.voided_at IS NULL` in
    // `tranchesFor`, never by deleting `crate_return_allocations`.
    const [{ n }] = (await ds.query(
      `SELECT count(*)::int AS n FROM crate_return_allocations WHERE return_id = $1`,
      [returnId],
    )) as { n: number }[];
    expect(n).toBe(2);
  });

  it('9. voids the first issuance now that its return is void, and the point-cash figure drops to 0.00', async () => {
    const res = await request(app.getHttpServer())
      .post(`/crate-issuances/${depositIssuanceId}/void`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reason: 'дублікат' })
      .expect(201);
    expect(res.body.voided_at).not.toBeNull();

    const cash = await request(app.getHttpServer())
      .get(`/point-cash/${pointId}`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    // (0.00 taken by the still-live receipt issuance) − (0.00 refunded, its
    // one return is voided) = 0.00. The deposit issuance's 2400.00 no longer
    // counts because IT is now voided too.
    expect(cash.body.crate_deposits).toBe('0.00');

    // SAME FIGURE, THE OTHER SQL PATH. `GET /point-cash/:pointId` binds the
    // point id as `$1` (`crateBookSql('$1')`); `GET /point-cash` computes the
    // same column per row of its `scoped` CTE via `crateBookSql('cp.id')` —
    // a correlated column, not a bind. Nothing above this test exercises
    // that second path at all, so a regression that broke ONLY the
    // correlated form (e.g. a future edit to `crateBookSql` that only the
    // `$1` caller was updated for) would pass every assertion before this
    // one and still ship.
    const list = await request(app.getHttpServer())
      .get('/point-cash')
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(200);
    const row = (list.body.data as Array<{ collection_point_id: string; crate_deposits: string }>).find(
      (r) => r.collection_point_id === pointId,
    );
    expect(row?.crate_deposits).toBe('0.00');
  });

  it('counts only crate tare on live intakes', async () => {
    // A receipt with 12 crates and 8 Чешка: only the crates count. Written
    // straight to SQL rather than over `POST /intakes` — a real receipt would
    // need a grade price and a supplier debt, none of which this query reads.
    const [{ id: intakeId }] = (await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '4280.00', $4) RETURNING id`,
      [`DISP-${randomUUID().slice(0, 8)}`, shiftId, supplierId, ownerActor.sub],
    )) as Array<{ id: string }>;
    const [{ id: itemId }] = (await ds.query(
      `INSERT INTO intake_items
         (intake_id, item_order, product_grade_id, gross_kg, tare_weight_kg, net_kg, price, amount)
       VALUES ($1, 1, $2, '100.00', '14.40', '85.60', '50.00', '4280.00') RETURNING id`,
      [intakeId, gradeId],
    )) as Array<{ id: string }>;
    await ds.query(
      `INSERT INTO intake_item_tare_types (item_id, tare_type_id, units)
       VALUES ($1, $2, 12), ($1, $3, 8)`,
      [itemId, crateTareId, boxTareId],
    );

    await expect(dispatch.forShift(ownerActor, shiftId)).resolves.toMatchObject({ with_berry: 12 });

    // The whole trio, or CHK_intakes_void_trio refuses the row — §9.3 does not
    // let a document be voided without saying who did it and why.
    await ds.query(
      `UPDATE intakes
          SET voided_at = now(), voided_by_user_id = $2, void_reason = 'перерахунок'
        WHERE id = $1`,
      [intakeId, ownerActor.sub],
    );
    // A voided receipt's crates never left the point.
    await expect(dispatch.forShift(ownerActor, shiftId)).resolves.toMatchObject({ with_berry: 0 });
  });
});
