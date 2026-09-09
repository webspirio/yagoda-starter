import { randomUUID } from 'crypto';
// `export = supertest`: this repo's tsconfig has no `esModuleInterop`, so a
// default import type-checks and then resolves to `undefined` at runtime.
import request = require('supertest');
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// MUST be imported before `../app.module` — it loads `.env` as a side effect,
// and AppModule's decorator runs ConfigModule.forRoot() eagerly at import time.
import { relaxThrottleForTests, resolveTestDatabaseName } from './db-harness';

import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';

const pointCode = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * The document walk, end to end, over real HTTP against a real database: open a
 * shift → record an intake → pay part of it → void → close. This is the only
 * place the whole chain is proven, and the only place the role split is
 * exercised through the actual guard.
 *
 * Tokens are signed with the app's own JwtService rather than minted through
 * `/auth/login`, because that route is rate-limited at 10/min per IP and
 * `npm run test:db` is not idempotent within a minute. The tokens are still
 * real — `JwtStrategy.validate()` reloads the user row on every request.
 */
describe('documents pipeline (HTTP)', () => {
  let app: INestApplication;
  let ownerToken: string;
  let operatorToken: string;
  let mariaToken: string;
  let elsewhereToken: string;
  let pointId: string;
  let otherPointId: string;

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

    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);
    const tokenFor = (userId: string): string => jwt.sign({ sub: userId });

    const { user: owner } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `doc-owner-${randomUUID()}`,
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
      .send({ name: `doc-point-${randomUUID()}`, code: pointCode() })
      .expect(201);
    pointId = pointRes.body.id as string;

    const otherPointRes = await request(app.getHttpServer())
      .post('/collection-points')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `doc-point-b-${randomUUID()}`, code: pointCode() })
      .expect(201);
    otherPointId = otherPointRes.body.id as string;

    const { user: operator } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `doc-op-${randomUUID()}`,
        first_name: 'Оксана',
        last_name: 'Приймальник',
        role: UserRole.PointOperator,
        collection_point_id: pointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    operatorToken = tokenFor(operator.id);

    // A SECOND operator at the SAME point. §10.6's mid-day cashier swap —
    // Оксана leaves her account at 14:00, Марія enters hers at 14:01 — is what
    // makes §9.4's «чужа квитанція» case ordinary rather than hypothetical.
    const { user: maria } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `doc-op2-${randomUUID()}`,
        first_name: 'Марія',
        last_name: 'Змінниця',
        role: UserRole.PointOperator,
        collection_point_id: pointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    mariaToken = tokenFor(maria.id);

    // An operator at the OTHER point. `intakes` and `payouts` carry no
    // `collection_point_id` at all — the scope is a JOIN through `shifts` — so
    // this token is what proves the join is actually load-bearing rather than
    // merely present.
    const { user: elsewhere } = await users.createWithIdentity(
      {
        provider: LOCAL_PROVIDER,
        providerUserId: `doc-op3-${randomUUID()}`,
        first_name: 'Богдан',
        last_name: 'Сусід',
        role: UserRole.PointOperator,
        collection_point_id: otherPointId,
      },
      async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
    );
    elsewhereToken = tokenFor(elsewhere.id);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('shifts', () => {
    let shiftId: string;

    it('lets the operator open a shift, deriving point and business_date', async () => {
      // §6.1 — opening now counts the drawer in the same request. This is the
      // point's FIRST count, so its expected figure is the counted one, with
      // no discrepancy — nothing this suite asserts on here, only exercised.
      const res = await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ counted_amount: '5000.00' })
        .expect(201);

      expect(res.body.collection_point_id).toBe(pointId);
      expect(res.body.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(res.body.status).toBe('open');
      expect(res.body.closed_at).toBeNull();
      shiftId = res.body.id as string;
    });

    it('refuses the OWNER the open verb entirely', async () => {
      // §10.3 — «Тільки приймальник — і це не помилка». The owner has no point
      // of their own, so there is no shift for them to open, and that is the
      // intended outcome rather than a gap. This test fails first if someone
      // "helpfully" restores a body collection_point_id.
      await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ collection_point_id: pointId })
        .expect(403);
    });

    it('refuses a second open shift at the same point', async () => {
      // §7.8 — «дві відкриті зміни це дві книги на одну шухляду».
      const res = await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ counted_amount: '5000.00' })
        .expect(409);
      expect(res.body.code ?? res.body.message).toBeDefined();
    });

    it('returns the open shift from GET /shifts/current', async () => {
      // Also proves the route is not shadowed by GET /shifts/:id — with the
      // parameterized route registered first, this would be a 400 from
      // ParseUUIDPipe rather than a 200.
      const res = await request(app.getHttpServer())
        .get('/shifts/current')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(res.body.id).toBe(shiftId);
    });

    it('refuses the operator a reopen, and refuses the owner one with no reason', async () => {
      // §6.1 — closing now counts the drawer too. A NEUTRAL figure (matching
      // the opening count above) keeps the discrepancy at zero on purpose, so
      // a fixture value can never mask a real arithmetic bug later.
      await request(app.getHttpServer())
        .post(`/shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ counted_amount: '5000.00' })
        .expect(201);

      // §10.2 puts corrections with the owner; the operator who closed it
      // cannot undo their own close.
      await request(app.getHttpServer())
        .post(`/shifts/${shiftId}/reopen`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'закрив помилково' })
        .expect(403);

      // §9.3's posture on corrections: a reason is mandatory.
      await request(app.getHttpServer())
        .post(`/shifts/${shiftId}/reopen`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(400);
    });

    it('refuses the OWNER the close verb too', async () => {
      await request(app.getHttpServer())
        .post(`/shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ counted_amount: '5000.00' })
        .expect(403);
    });

    it('lets the owner reopen with a reason, and the point trades again', async () => {
      // Spec §8.1: this route exists BECAUSE of UQ_shifts_point_business_date.
      // Without it, the close above would have ended this point's day.
      const res = await request(app.getHttpServer())
        .post(`/shifts/${shiftId}/reopen`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ reason: 'закрив помилково, машини ще їдуть' })
        .expect(201);

      expect(res.body.status).toBe('open');
      expect(res.body.closed_at).toBeNull();
      expect(res.body.closed_by_user_id).toBeNull();
    });

    it('refuses a second shift on the same business_date after a real close', async () => {
      // The cost of spec §8.1, asserted so it is not discovered in production:
      // one shift per point per day, and reopen is the only way back.
      await request(app.getHttpServer())
        .post(`/shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ counted_amount: '5000.00' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ counted_amount: '5000.00' })
        .expect(409);
      expect(res.body.code).toBe('SHIFT_DAY_ALREADY_USED');

      // Leave the shift open for the document blocks that follow.
      await request(app.getHttpServer())
        .post(`/shifts/${shiftId}/reopen`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ reason: 'далі по тестах' })
        .expect(201);
    });

    it('404s GET /shifts/current for a point with nothing open', async () => {
      await request(app.getHttpServer())
        .get('/shifts/current')
        .query({ collection_point_id: otherPointId })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('scopes the operator’s list to their own point', async () => {
      const res = await request(app.getHttpServer())
        .get('/shifts')
        .query({ collection_point_id: otherPointId })
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(
        res.body.data.every(
          (s: { collection_point_id: string }) => s.collection_point_id === pointId,
        ),
      ).toBe(true);
    });
  });

  describe('intakes', () => {
    let gradeId: string;
    let crateId: string;
    let supplierId: string;
    let intakeId: string;

    beforeAll(async () => {
      // The catalog this document needs. Names carry a per-run uuid: app_test
      // persists between runs and is never truncated.
      const productRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `Малина-${randomUUID()}` })
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
          name: `Чешка-${randomUUID()}`,
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
          base_price: '57.00',
          max_markup: '30.00',
          max_discount: '20.00',
        })
        .expect(201);

      const supplierRes = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ first_name: 'Іван', last_name: `Коваль-${randomUUID()}` })
        .expect(201);
      supplierId = supplierRes.body.id as string;

      // The shifts block above left one open; make that explicit rather than
      // depending on describe ordering.
      const current = await request(app.getHttpServer())
        .get('/shifts/current')
        .set('Authorization', `Bearer ${operatorToken}`);
      if (current.status === 404) {
        await request(app.getHttpServer())
          .post('/shifts')
          .set('Authorization', `Bearer ${operatorToken}`)
          .send({ counted_amount: '5000.00' })
          .expect(201);
      }
    }, 30_000);

    it('previews the receipt without writing it, and the real POST stores the very same numbers', async () => {
      // §2.4/§2.8/§2.9 — the server is the ONLY place these numbers are
      // computed, so the screen asks for them live instead of computing its
      // own. The body is `POST /intakes` minus `code`: nothing about a receipt
      // number changes a weight or an amount.
      const items = [
        {
          product_grade_id: gradeId,
          gross_kg: '42.00',
          pallet_kg: '1.50',
          tare: [{ tare_type_id: crateId, units: 3 }],
        },
        {
          product_grade_id: gradeId,
          gross_kg: '20.00',
          bonus: '-2.00',
          tare: [{ tare_type_id: crateId, units: 1 }],
        },
      ];
      const journalBefore = await request(app.getHttpServer())
        .get('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      // 200, not 201: a computed answer, and nothing was created.
      const preview = await request(app.getHttpServer())
        .post('/intakes/preview')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, items })
        .expect(200);

      expect(preview.body.amount).toBe('3137.30');
      expect(preview.body.items.map((i: { net_kg: string }) => i.net_kg)).toEqual([
        '36.90',
        '18.80',
      ]);
      expect(preview.body.collection_point_id).toBe(pointId);
      expect(preview.body.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(preview.body).not.toHaveProperty('id');
      expect(preview.body).not.toHaveProperty('code');
      expect(preview.body.items[0]).not.toHaveProperty('id');

      const journalAfter = await request(app.getHttpServer())
        .get('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(journalAfter.body.total).toBe(journalBefore.body.total);

      const stored = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ code: '04411', supplier_id: supplierId, items })
        .expect(201);

      const numbers = (i: { net_kg: string; amount: string }) => ({
        net_kg: i.net_kg,
        amount: i.amount,
      });
      expect(stored.body.amount).toBe(preview.body.amount);
      expect(stored.body.items.map(numbers)).toEqual(preview.body.items.map(numbers));
    });

    it('records a two-line intake and returns the computed total', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          code: '04412',
          supplier_id: supplierId,
          items: [
            {
              product_grade_id: gradeId,
              gross_kg: '42.00',
              pallet_kg: '1.50',
              tare: [{ tare_type_id: crateId, units: 3 }],
            },
            {
              product_grade_id: gradeId,
              gross_kg: '20.00',
              bonus: '-2.00',
              tare: [{ tare_type_id: crateId, units: 1 }],
            },
          ],
        })
        .expect(201);

      expect(res.body.code).toMatch(/^[A-Z0-9]{2,8}-IN-\d{8}-04412$/);
      // (42.00 − 1.50 − 3.60) × 57.00 = 2103.30
      // (20.00 − 0.00 − 1.20) × 55.00 = 1034.00
      expect(res.body.amount).toBe('3137.30');
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].net_kg).toBe('36.90');
      expect(res.body.items[1].amount).toBe('1034.00');
      // numeric is a STRING on the wire, always (foundation §5.1)
      expect(typeof res.body.items[0].net_kg).toBe('string');
      // Joined in from the shift — neither is a column on `intakes`.
      expect(res.body.collection_point_id).toBe(pointId);
      expect(res.body.business_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      intakeId = res.body.id as string;
    });

    it('refuses the same typed code twice on the same day at the same point', async () => {
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          code: '04412',
          supplier_id: supplierId,
          items: [
            {
              product_grade_id: gradeId,
              gross_kg: '10.00',
              tare: [{ tare_type_id: crateId, units: 1 }],
            },
          ],
        })
        .expect(409);

      expect(res.body.code).toBe('INTAKE_CODE_TAKEN');
    });

    it('refuses a line with no tare', async () => {
      // §9.1 — «Вкажіть кількість тари — без неї брутто пішло б у чисту вагу
      // цілком». Refused by the DTO, proving the guard is reachable over HTTP
      // and not only from the pure module.
      await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          code: '04413',
          supplier_id: supplierId,
          items: [{ product_grade_id: gradeId, gross_kg: '10.00', tare: [] }],
        })
        .expect(400);
    });

    it('refuses an over-limit bonus with the maximum IN the message', async () => {
      // The assertion is on the BODY, not just the status: §2.10 is a UI/UX
      // recommendation about the resting screen, not a rule that the number is
      // secret (owner, 2026-09-08). A 400 the operator cannot act on is the
      // failure mode being avoided.
      const res = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          code: '04414',
          supplier_id: supplierId,
          items: [
            {
              product_grade_id: gradeId,
              gross_kg: '10.00',
              bonus: '99.00',
              tare: [{ tare_type_id: crateId, units: 1 }],
            },
          ],
        })
        .expect(400);

      expect(JSON.stringify(res.body)).toMatch(/30\.00/);
    });

    it('returns the nested detail on GET /intakes/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/intakes/${intakeId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].item_order).toBe(1);
      expect(res.body.items[0].tare[0].units).toBe(3);
    });

    it('refuses one operator the void of another operator’s intake', async () => {
      // §9.4 — «чужа квитанція → приймальник НІКОЛИ, навіть на своїй точці і в
      // ту саму зміну». Марія is at the SAME point, in the SAME open shift.
      const res = await request(app.getHttpServer())
        .post(`/intakes/${intakeId}/void`)
        .set('Authorization', `Bearer ${mariaToken}`)
        .send({ reason: 'не моя квитанція' })
        .expect(403);

      expect(res.body.code).toBe('NOT_YOUR_DOCUMENT');
    });

    it('refuses a void with no reason', async () => {
      // §9.3 — «спроба сторнувати без причини → кнопка неактивна».
      await request(app.getHttpServer())
        .post(`/intakes/${intakeId}/void`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({})
        .expect(400);
    });

    it('has no PATCH route', async () => {
      await request(app.getHttpServer())
        .patch(`/intakes/${intakeId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ amount: '1.00' })
        .expect(404);
    });

    it('has no DELETE route', async () => {
      await request(app.getHttpServer())
        .delete(`/intakes/${intakeId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(404);
    });

    it('keeps a voided intake in the journal and flags it', async () => {
      // §9.3 — «лишається в журналі НАЗАВЖДИ з печаткою СТОРНОВАНО».
      await request(app.getHttpServer())
        .post(`/intakes/${intakeId}/void`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'помилка ваги: 62,40 замість 26,40' })
        .expect(201);

      const listed = await request(app.getHttpServer())
        .get('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      const found = listed.body.data.find((i: { id: string }) => i.id === intakeId);
      expect(found.voided_at).not.toBeNull();
      expect(found.void_reason).toBe('помилка ваги: 62,40 замість 26,40');

      const hidden = await request(app.getHttpServer())
        .get('/intakes')
        .query({ include_voided: 'false' })
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(hidden.body.data.some((i: { id: string }) => i.id === intakeId)).toBe(false);
    });

    it('409s voiding the same document twice', async () => {
      await request(app.getHttpServer())
        .post(`/intakes/${intakeId}/void`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'ще раз' })
        .expect(409);
    });
  });

  describe('payouts and the supplier balance', () => {
    let gradeId: string;
    let crateId: string;
    let supplierId: string;
    let intakeId: string;
    let payoutId: string;

    const balanceOf = async (token: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .get(`/suppliers/${supplierId}/balance`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body.debt as string;
    };

    beforeAll(async () => {
      const productRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `Смородина-${randomUUID()}` })
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
        .send({ name: `Ящик-${randomUUID()}`, weight_kg: '1.20', deposit_price: '120.00' })
        .expect(201);
      crateId = tareRes.body.id as string;

      await request(app.getHttpServer())
        .post('/grade-prices')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          collection_point_id: pointId,
          product_grade_id: gradeId,
          base_price: '57.00',
          max_markup: '30.00',
          max_discount: '20.00',
        })
        .expect(201);

      const supplierRes = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ first_name: 'Петро', last_name: `Мельник-${randomUUID()}` })
        .expect(201);
      supplierId = supplierRes.body.id as string;

      const intakeRes = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          code: '05000',
          supplier_id: supplierId,
          items: [
            {
              product_grade_id: gradeId,
              gross_kg: '12.00',
              tare: [{ tare_type_id: crateId, units: 1 }],
            },
          ],
        })
        .expect(201);
      // (12.00 − 0.00 − 1.20) × 57.00 = 615.60
      expect(intakeRes.body.amount).toBe('615.60');
      intakeId = intakeRes.body.id as string;
    }, 30_000);

    it('shows the debt after the intake — §3.1’s «Разом»', async () => {
      expect(await balanceOf(operatorToken)).toBe('615.60');
    });

    it('refuses a payout above the debt and NAMES the balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/payouts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ code: '00031', supplier_id: supplierId, amount: '615.61' })
        .expect(400);

      expect(res.body.code).toBe('PAYOUT_EXCEEDS_DEBT');
      expect(JSON.stringify(res.body)).toContain('615.60');
    });

    it('pays part of it and lowers the balance', async () => {
      const res = await request(app.getHttpServer())
        .post('/payouts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ code: '00031', supplier_id: supplierId, amount: '600.00' })
        .expect(201);

      expect(res.body.code).toMatch(/^[A-Z0-9]{2,8}-PO-\d{8}-00031$/);
      payoutId = res.body.id as string;
      expect(await balanceOf(operatorToken)).toBe('15.60');
    });

    it('the SECOND payout sees the first one’s effect on the balance', async () => {
      // The service-level proof that the ceiling reads live data rather than a
      // value cached anywhere — sequentially. The concurrent case is «two
      // payouts in flight at once» at the bottom of this file;
      // `payout-race.db-spec.ts` covers the locking primitive under it.
      await request(app.getHttpServer())
        .post('/payouts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ code: '00032', supplier_id: supplierId, amount: '15.61' })
        .expect(400);

      await request(app.getHttpServer())
        .post('/payouts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ code: '00032', supplier_id: supplierId, amount: '15.60' })
        .expect(201);

      expect(await balanceOf(operatorToken)).toBe('0.00');
    });

    it('refuses a zero payout', async () => {
      // Spec §8.6 — stricter than §3.7. A receipt for handing over nothing.
      await request(app.getHttpServer())
        .post('/payouts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ code: '00033', supplier_id: supplierId, amount: '0.00' })
        .expect(400);
    });

    it('refuses settle-return on a payout that is not voided', async () => {
      await request(app.getHttpServer())
        .post(`/payouts/${payoutId}/settle-return`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(409);
    });

    it('voids the payout WITHOUT returning the cash', async () => {
      // §9.3 — «сторновано виплату 8 000,00 ₴ → каса НЕ виросла на 8 000».
      const res = await request(app.getHttpServer())
        .post(`/payouts/${payoutId}/void`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'видав не тій людині' })
        .expect(201);

      expect(res.body.voided_at).not.toBeNull();
      expect(res.body.return_settled_at).toBeNull();
      // The voided payout leaves the DEBT formula, so the balance rises again.
      expect(await balanceOf(operatorToken)).toBe('600.00');
    });

    it('refuses settle-return to the operator who voided it', async () => {
      // §9.3's loop, kept open: the person holding the drawer is not the person
      // who attests it was refilled — «інакше сторно стає способом красти».
      await request(app.getHttpServer())
        .post(`/payouts/${payoutId}/settle-return`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({})
        .expect(403);
    });

    it('lets the owner record the cash coming back, once', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payouts/${payoutId}/settle-return`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ note: 'вніс готівку назад 09.09' })
        .expect(201);

      expect(res.body.return_settled_at).not.toBeNull();
      expect(res.body.return_note).toBe('вніс готівку назад 09.09');

      await request(app.getHttpServer())
        .post(`/payouts/${payoutId}/settle-return`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(409);
    });

    it('voiding the intake drives the balance NEGATIVE, and is allowed', async () => {
      // «сторно КВИТАНЦІЇ ЄДИНИЙ шлях у мінус, і воно ДОЗВОЛЕНЕ, з
      // попередженням». There is no floor anywhere, by design.
      await request(app.getHttpServer())
        .post(`/intakes/${intakeId}/void`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'квитанція на іншу людину' })
        .expect(201);

      // intakes: 0 (voided). payouts: 15.60 live, 600.00 voided → debt −15.60.
      expect(await balanceOf(operatorToken)).toBe('-15.60');
    });

    it('404s another point’s supplier balance for an operator', async () => {
      const otherSupplier = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          collection_point_id: otherPointId,
          first_name: 'Чужий',
          last_name: `Постачальник-${randomUUID()}`,
        })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/suppliers/${otherSupplier.body.id}/balance`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(404);
    });
  });

  /**
   * THE POINT SCOPE IS A JOIN, AND NOTHING ELSE GUARDS IT.
   *
   * Neither `intakes` nor `payouts` has a `collection_point_id`: the filter is
   * a `WHERE` on a column that deliberately does not exist, reached only
   * through `shifts`, combined with `skip`/`take` — which makes TypeORM rewrite
   * the whole thing into a distinct-ids subquery. Swap an `innerJoin` for a
   * `leftJoin`, or move the point clause after the `.skip()`, and both lists
   * start serving the whole network with every other test still green.
   *
   * These run last, after both document blocks have populated point A.
   */
  describe('cross-point isolation of the document journals', () => {
    it('shows the operator at point B none of point A’s intakes', async () => {
      const mine = await request(app.getHttpServer())
        .get('/intakes')
        .set('Authorization', `Bearer ${elsewhereToken}`)
        .expect(200);
      expect(mine.body.data).toEqual([]);
      expect(mine.body.total).toBe(0);

      // Point A demonstrably HAS intakes — otherwise the assertion above would
      // pass just as well against a broken join.
      const theirs = await request(app.getHttpServer())
        .get('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(theirs.body.total).toBeGreaterThan(0);
    });

    it('does not let an operator widen the intake journal by naming another point', async () => {
      // `resolvePointFilter` IGNORES the parameter for an operator rather than
      // rejecting it — the test is that it cannot REDIRECT the scope either.
      const res = await request(app.getHttpServer())
        .get('/intakes')
        .query({ collection_point_id: pointId })
        .set('Authorization', `Bearer ${elsewhereToken}`)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });

    it('shows the operator at point B none of point A’s payouts', async () => {
      const mine = await request(app.getHttpServer())
        .get('/payouts')
        .set('Authorization', `Bearer ${elsewhereToken}`)
        .expect(200);
      expect(mine.body.data).toEqual([]);

      const theirs = await request(app.getHttpServer())
        .get('/payouts')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(theirs.body.total).toBeGreaterThan(0);
    });

    it('does not let an operator widen the payout journal by naming another point', async () => {
      const res = await request(app.getHttpServer())
        .get('/payouts')
        .query({ collection_point_id: pointId })
        .set('Authorization', `Bearer ${elsewhereToken}`)
        .expect(200);

      expect(res.body.data).toEqual([]);
    });

    it('shows the owner both points at once, and either one on request', async () => {
      const all = await request(app.getHttpServer())
        .get('/intakes')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const scoped = await request(app.getHttpServer())
        .get('/intakes')
        .query({ collection_point_id: otherPointId })
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      expect(all.body.total).toBeGreaterThan(0);
      expect(scoped.body.total).toBe(0);
    });
  });

  /**
   * §3.6's ceiling UNDER CONCURRENCY, through the route.
   *
   * `payout-race.db-spec.ts` shows that a Postgres row lock blocks — a fact
   * about Postgres. This shows the thing that actually matters: two payouts in
   * flight together against a debt that admits only one, and the second is
   * REFUSED. Spec §11 asked for «blocks and then fails»; the second half is
   * this test. Delete the `FOR UPDATE` from `PayoutsService.create` and both
   * requests read the same debt, both clear the ceiling, and 800,00 ₴ leaves
   * the drawer against a 615,60 ₴ debt with nothing downstream to notice.
   */
  describe('two payouts in flight at once', () => {
    let supplierId: string;

    beforeAll(async () => {
      const productRes = await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `Аґрус-${randomUUID()}` })
        .expect(201);

      const gradeRes = await request(app.getHttpServer())
        .post('/product-grades')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ product_id: productRes.body.id, name: `1 сорт-${randomUUID()}` })
        .expect(201);

      const tareRes = await request(app.getHttpServer())
        .post('/tare-types')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `Ящик-${randomUUID()}`, weight_kg: '1.20', deposit_price: '120.00' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/grade-prices')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          collection_point_id: pointId,
          product_grade_id: gradeRes.body.id,
          base_price: '57.00',
          max_markup: '30.00',
          max_discount: '20.00',
        })
        .expect(201);

      const supplierRes = await request(app.getHttpServer())
        .post('/suppliers')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ first_name: 'Гонка', last_name: `Двох-${randomUUID()}` })
        .expect(201);
      supplierId = supplierRes.body.id as string;

      const current = await request(app.getHttpServer())
        .get('/shifts/current')
        .set('Authorization', `Bearer ${operatorToken}`);
      if (current.status === 404) {
        await request(app.getHttpServer())
          .post('/shifts')
          .set('Authorization', `Bearer ${operatorToken}`)
          .send({ counted_amount: '5000.00' })
          .expect(201);
      }

      const intakeRes = await request(app.getHttpServer())
        .post('/intakes')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          code: '09100',
          supplier_id: supplierId,
          items: [
            {
              product_grade_id: gradeRes.body.id,
              gross_kg: '12.00',
              tare: [{ tare_type_id: tareRes.body.id, units: 1 }],
            },
          ],
        })
        .expect(201);
      // (12.00 − 0.00 − 1.20) × 57.00 = 615.60
      expect(intakeRes.body.amount).toBe('615.60');
    }, 30_000);

    it('lets exactly ONE of two simultaneous payouts through', async () => {
      // 400 + 400 = 800 > 615.60, but EITHER one alone clears the ceiling — so
      // a serial pair of checks passes both and only the lock stops it. The
      // typed codes differ, so the unique index on `(shift, code)` is not what
      // is doing the refusing.
      const attempt = (code: string) =>
        request(app.getHttpServer())
          .post('/payouts')
          .set('Authorization', `Bearer ${operatorToken}`)
          .send({ code, supplier_id: supplierId, amount: '400.00' });

      const results = await Promise.all([attempt('09101'), attempt('09102')]);
      const statuses = results.map((r) => r.status).sort();

      expect(statuses).toEqual([201, 400]);

      const refused = results.find((r) => r.status === 400);
      expect(refused?.body.code).toBe('PAYOUT_EXCEEDS_DEBT');

      // And the survivor is the only one that moved the balance.
      const balance = await request(app.getHttpServer())
        .get(`/suppliers/${supplierId}/balance`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(balance.body.debt).toBe('215.60');
    });
  });
});
