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
import { resolveTestDatabaseName } from './db-harness';

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
  let pointId: string;
  let otherPointId: string;

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();

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

  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('shifts', () => {
    let shiftId: string;

    it('lets the operator open a shift, deriving point and business_date', async () => {
      const res = await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${operatorToken}`)
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
      await request(app.getHttpServer())
        .post(`/shifts/${shiftId}/close`)
        .set('Authorization', `Bearer ${operatorToken}`)
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
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/shifts')
        .set('Authorization', `Bearer ${operatorToken}`)
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

      expect(res.body.data.every((s: { collection_point_id: string }) => s.collection_point_id === pointId)).toBe(true);
    });
  });
});
