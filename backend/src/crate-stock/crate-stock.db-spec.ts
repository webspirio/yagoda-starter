import { ConflictException, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootApp, makePoint, makeSupplier, onHand, stockPoint, sendCrates } from '../testing/crate-stock-fixture';
import { CrateStockGuard } from './crate-stock.guard';

describe('CrateStockGuard (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;
  let guard: CrateStockGuard;

  beforeAll(async () => {
    ({ app, ds, ownerToken } = await bootApp());
    guard = app.get(CrateStockGuard);
  }, 30_000);
  afterAll(async () => app?.close());

  const refused = (res: request.Response, available: number, required: number, inTransit = 0) => {
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CRATES_ON_HAND_INSUFFICIENT', available, required, in_transit: inTransit });
  };
  const issue = (token: string, supplierId: string, units: number) =>
    request(app.getHttpServer())
      .post('/crate-issuances')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplier_id: supplierId, units, mode: 'receipt' });

  it('passes when the point stays at or above zero', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'guard-ok');
    await stockPoint(app, ownerToken, operatorToken, pointId, 10);
    await expect(ds.transaction((m) => guard.assertOnHand(m, pointId, 10))).resolves.toBeUndefined();
  });

  it('refuses a negative point, naming what was there, what is asked and what is in transit', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'guard-neg');
    const supplierId = await makeSupplier(app, operatorToken);
    await sendCrates(app, ownerToken, pointId, 20); // sent, not accepted
    // A crate_issuances row written straight by SQL stands in for "the write that just happened".
    await ds.query(
      `INSERT INTO crate_issuances (code, shift_id, supplier_id, units, mode, deposit_per_unit, deposit_taken, issued_by_user_id)
       SELECT 'GUARD-' || substr(md5(random()::text), 1, 8), s.id, $2, 5, 'receipt', 0, 0, s.opened_by_user_id
         FROM shifts s
        WHERE s.collection_point_id = $1 AND s.closed_at IS NULL`,
      [pointId, supplierId],
    );
    const err = await ds.transaction((m) => guard.assertOnHand(m, pointId, 5)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'CRATES_ON_HAND_INSUFFICIENT',
      available: 0,
      required: 5,
      in_transit: 20,
    });
  });

  describe('write paths', () => {
    it('case 1 — issuing with no transfer at all is refused and writes nothing', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case1');
      const sup = await makeSupplier(app, operatorToken);
      refused(await issue(operatorToken, sup, 10), 0, 10);
      const [{ n }] = (await ds.query(
        `SELECT COUNT(*)::int AS n FROM crate_issuances ci JOIN shifts s ON s.id = ci.shift_id WHERE s.collection_point_id = $1`,
        [pointId],
      )) as { n: number }[];
      expect(n).toBe(0);
    });

    it('case 2 — a sent, unaccepted transfer does not count; the refusal names it', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case2');
      const sup = await makeSupplier(app, operatorToken);
      await sendCrates(app, ownerToken, pointId, 20);
      refused(await issue(operatorToken, sup, 10), 0, 10, 20);
    });

    it('boundary — issuing exactly what is on hand passes and leaves 0', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'boundary');
      const sup = await makeSupplier(app, operatorToken);
      await stockPoint(app, ownerToken, operatorToken, pointId, 10);
      expect((await issue(operatorToken, sup, 10)).status).toBe(201);
      expect(await onHand(ds, pointId)).toBe(0);
    });

    it('case 6 — voiding a return whose crates went out again is refused', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case6');
      const a = await makeSupplier(app, operatorToken);
      const b = await makeSupplier(app, operatorToken);
      await stockPoint(app, ownerToken, operatorToken, pointId, 10);
      expect((await issue(operatorToken, a, 10)).status).toBe(201);
      const ret = await request(app.getHttpServer())
        .post('/crate-returns')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: a, units: 10 })
        .expect(201);
      expect((await issue(operatorToken, b, 10)).status).toBe(201);
      const res = await request(app.getHttpServer())
        .post(`/crate-returns/${ret.body.id}/void`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ reason: 'помилка' });
      refused(res, 0, 10);
      expect(await onHand(ds, pointId)).toBe(0);
    });
  });
});
