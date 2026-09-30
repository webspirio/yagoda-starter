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

    it('case 5 — closing with more breakage than empties is refused; the shift stays open', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case5');
      await stockPoint(app, ownerToken, operatorToken, pointId, 10);
      const [{ id }] = (await ds.query(
        `SELECT id FROM shifts WHERE collection_point_id = $1 AND closed_at IS NULL`,
        [pointId],
      )) as { id: string }[];
      const res = await request(app.getHttpServer())
        .post(`/shifts/${id}/close`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({ counted_amount: '0.00', broken_crates: 25 });
      refused(res, 10, 25);
      const [{ closed_at }] = (await ds.query(`SELECT closed_at FROM shifts WHERE id = $1`, [id])) as { closed_at: Date | null }[];
      expect(closed_at).toBeNull();
    });

    it('case 3 — voiding an accepted transfer whose crates went out is refused', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case3');
      const sup = await makeSupplier(app, operatorToken);
      const tr = await stockPoint(app, ownerToken, operatorToken, pointId, 20);
      expect((await issue(operatorToken, sup, 15)).status).toBe(201);
      const res = await request(app.getHttpServer()).post(`/transfers/${tr}/void`)
        .set('Authorization', `Bearer ${ownerToken}`).send({ reason: 'помилка' });
      refused(res, 5, 20);
      const [{ voided_at }] = (await ds.query(`SELECT voided_at FROM transfers WHERE id = $1`, [tr])) as { voided_at: Date | null }[];
      expect(voided_at).toBeNull();
    });

    it('case 4 — resolving a dispute below what was already issued is refused', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'case4');
      const sup = await makeSupplier(app, operatorToken);
      const tr = await sendCrates(app, ownerToken, pointId, 20);
      await request(app.getHttpServer()).post(`/transfers/${tr}/dispute`).set('Authorization', `Bearer ${operatorToken}`)
        .send({ reported_cash: '0.00', reported_crates: 20, dispute_note: 'перевірка' }).expect(201);
      expect((await issue(operatorToken, sup, 20)).status).toBe(201);
      const res = await request(app.getHttpServer()).post(`/transfers/${tr}/resolve`)
        .set('Authorization', `Bearer ${ownerToken}`).send({ resolved_cash: '0.00', resolved_crates: 5 });
      refused(res, 0, 15);
    });

    it('voiding a sent transfer takes nothing, so it passes even at a negative point', async () => {
      const { pointId } = await makePoint(app, ownerToken, 'void-sent');
      const [{ id: opener }] = (await ds.query(`SELECT opened_by_user_id AS id FROM shifts WHERE collection_point_id = $1`, [pointId])) as { id: string }[];
      await ds.query(
        `UPDATE shifts SET broken_crates = 7, closed_at = now(), closed_by_user_id = $2, status = 'closed' WHERE collection_point_id = $1`,
        [pointId, opener],
      );
      expect(await onHand(ds, pointId)).toBe(-7);
      const tr = await sendCrates(app, ownerToken, pointId, 10);
      expect((await request(app.getHttpServer()).post(`/transfers/${tr}/void`)
        .set('Authorization', `Bearer ${ownerToken}`).send({ reason: 'не поїхала' })).status).toBe(201);
    });
  });

  describe('a point already below zero, and races', () => {
    /** A point at `-n`: an earlier CLOSED shift with breakage n, written past the guard, and a
     *  fresh open shift for today's work. */
    const negativePoint = async (label: string, n: number) => {
      const p = await makePoint(app, ownerToken, label);
      // Yesterday's shift — moved back a day because UQ_shifts_point_business_date allows one per day.
      await ds.query(
        `UPDATE shifts SET broken_crates = $2, closed_at = now(), closed_by_user_id = opened_by_user_id,
                           status = 'closed', business_date = business_date - 1
          WHERE collection_point_id = $1 AND closed_at IS NULL`,
        [p.pointId, n],
      );
      await request(app.getHttpServer()).post('/shifts').set('Authorization', `Bearer ${p.operatorToken}`)
        .send({ counted_amount: '0.00' }).expect(201);
      expect(await onHand(ds, p.pointId)).toBe(-n);
      return p;
    };
    const openShiftId = async (pointId: string) =>
      ((await ds.query(`SELECT id FROM shifts WHERE collection_point_id = $1 AND closed_at IS NULL`, [pointId])) as { id: string }[])[0].id;

    it('accepting a transfer heals a negative point', async () => {
      const { pointId, operatorToken } = await negativePoint('heal-accept', 30);
      await stockPoint(app, ownerToken, operatorToken, pointId, 10);
      expect(await onHand(ds, pointId)).toBe(-20);
    });

    it('a crate return and an issuance void both pass while the point is negative', async () => {
      const { pointId, operatorToken } = await negativePoint('heal-return', 5);
      const a = await makeSupplier(app, operatorToken);
      const b = await makeSupplier(app, operatorToken);
      await stockPoint(app, ownerToken, operatorToken, pointId, 10); // -5 -> 5
      expect((await issue(operatorToken, a, 3)).status).toBe(201); // 5 -> 2
      const toVoid = await issue(operatorToken, b, 2); // 2 -> 0
      expect(toVoid.status).toBe(201);
      // Push the point negative again past the guard: more breakage on yesterday's shift.
      await ds.query(
        `UPDATE shifts SET broken_crates = broken_crates + 4 WHERE collection_point_id = $1 AND closed_at IS NOT NULL`,
        [pointId],
      );
      expect(await onHand(ds, pointId)).toBe(-4);
      await request(app.getHttpServer()).post('/crate-returns').set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: a, units: 3 }).expect(201); // -4 -> -1
      await request(app.getHttpServer()).post(`/crate-issuances/${toVoid.body.id}/void`)
        .set('Authorization', `Bearer ${operatorToken}`).send({ reason: 'помилка' }).expect(201); // -1 -> 1
      expect(await onHand(ds, pointId)).toBe(1);
    });

    it('reopening a shift gives its breakage back', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'heal-reopen');
      await stockPoint(app, ownerToken, operatorToken, pointId, 10);
      const id = await openShiftId(pointId);
      await request(app.getHttpServer()).post(`/shifts/${id}/close`).set('Authorization', `Bearer ${operatorToken}`)
        .send({ counted_amount: '0.00', broken_crates: 10 }).expect(201);
      expect(await onHand(ds, pointId)).toBe(0);
      await request(app.getHttpServer()).post(`/shifts/${id}/reopen`).set('Authorization', `Bearer ${ownerToken}`)
        .send({ reason: 'помилка' }).expect(201);
      expect(await onHand(ds, pointId)).toBe(10);
    });

    /** Exactly one of two concurrent writes wins; the loser is the guard's refusal, not some other 409. */
    const oneWins = (a: request.Response, b: request.Response) => {
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect((a.status === 409 ? a : b).body.code).toBe('CRATES_ON_HAND_INSUFFICIENT');
    };

    /**
     * Both writes' last statement before the guard is their audit insert, so holding `audit_log`
     * EXCLUSIVE parks each one there with its document already written; releasing it sends both
     * into the guard together. Without this barrier the two requests mostly serialise by timing
     * alone, and a guard with its point lock removed passed ~8 runs in 10.
     */
    const raceAtGuard = async (a: request.Test, b: request.Test) => {
      const qr = ds.createQueryRunner();
      await qr.connect();
      await qr.startTransaction();
      try {
        await qr.query('LOCK TABLE audit_log IN EXCLUSIVE MODE');
        const both = Promise.all([a, b]);
        for (let i = 0; i < 500; i++) {
          const [{ n }] = (await qr.query(
            `SELECT COUNT(*)::int AS n FROM pg_locks WHERE relation = 'audit_log'::regclass AND NOT granted`,
          )) as { n: number }[];
          if (n >= 2) break;
          await new Promise((r) => setTimeout(r, 10));
        }
        await qr.commitTransaction();
        return await both;
      } finally {
        if (qr.isTransactionActive) await qr.rollbackTransaction();
        await qr.release();
      }
    };

    // The races below share NO lock before the guard's point lock: a receipt- and a deposit-mode
    // issuance take different document-code advisory keys (CR vs CD), and a transfer void locks
    // only the transfer row. Without the point lock both writes would pass (spec 2026-09-30).
    it('a receipt- and a deposit-mode issuance that fit alone but not together — exactly one wins', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'race');
      const a = await makeSupplier(app, operatorToken);
      const b = await makeSupplier(app, operatorToken);
      await stockPoint(app, ownerToken, operatorToken, pointId, 10);
      const [ra, rb] = await raceAtGuard(
        issue(operatorToken, a, 10),
        request(app.getHttpServer()).post('/crate-issuances').set('Authorization', `Bearer ${operatorToken}`)
          .send({ supplier_id: b, units: 10, mode: 'deposit' }),
      );
      oneWins(ra, rb);
      expect(await onHand(ds, pointId)).toBe(0);
    });

    it('a concurrent issuance and the owner voiding the transfer that stocked the point — exactly one wins', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'race-void');
      const sup = await makeSupplier(app, operatorToken);
      const tr = await stockPoint(app, ownerToken, operatorToken, pointId, 10);
      const [ri, rv] = await raceAtGuard(
        issue(operatorToken, sup, 10),
        request(app.getHttpServer()).post(`/transfers/${tr}/void`).set('Authorization', `Bearer ${ownerToken}`)
          .send({ reason: 'помилка' }),
      );
      oneWins(ri, rv);
      expect(await onHand(ds, pointId)).toBe(0);
    });

    it('a concurrent issuance and a close with breakage — never both', async () => {
      const { pointId, operatorToken } = await makePoint(app, ownerToken, 'race-close');
      const sup = await makeSupplier(app, operatorToken);
      await stockPoint(app, ownerToken, operatorToken, pointId, 10);
      const id = await openShiftId(pointId);
      const [ri, rc] = await Promise.all([
        issue(operatorToken, sup, 6),
        request(app.getHttpServer()).post(`/shifts/${id}/close`).set('Authorization', `Bearer ${operatorToken}`)
          .send({ counted_amount: '0.00', broken_crates: 6 }),
      ]);
      expect([ri.status, rc.status]).toContain(409);
      // The shift row serialises these two; the issuance may lose on either count.
      for (const r of [ri, rc].filter((x) => x.status === 409)) {
        expect(['CRATES_ON_HAND_INSUFFICIENT', 'NO_OPEN_SHIFT']).toContain(r.body.code);
      }
      expect(await onHand(ds, pointId)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('receipts', () => {
    let pointId: string;
    let operatorToken: string;
    let supplierId: string;
    let gradeId: string;
    let crateTypeId: string;

    beforeAll(async () => {
      ({ pointId, operatorToken } = await makePoint(app, ownerToken, 'case7'));
      supplierId = await makeSupplier(app, operatorToken);
      const product = await request(app.getHttpServer()).post('/products')
        .set('Authorization', `Bearer ${ownerToken}`).send({ name: `stock-product-${Date.now()}` }).expect(201);
      const grade = await request(app.getHttpServer()).post('/product-grades')
        .set('Authorization', `Bearer ${ownerToken}`).send({ product_id: product.body.id, name: `сорт-${Date.now()}` }).expect(201);
      gradeId = grade.body.id as string;
      await request(app.getHttpServer()).post('/grade-prices').set('Authorization', `Bearer ${ownerToken}`)
        .send({ collection_point_id: pointId, product_grade_id: gradeId, base_price: '50.00', max_markup: '0.00', max_discount: '0.00' })
        .expect(201);
      [{ id: crateTypeId }] = (await ds.query(`SELECT id FROM tare_types WHERE is_crate`)) as { id: string }[];
    });

    const receipt = (crates: number, returned?: number) =>
      request(app.getHttpServer()).post('/intakes').set('Authorization', `Bearer ${operatorToken}`).send({
        supplier_id: supplierId,
        items: [{ product_grade_id: gradeId, gross_kg: '40.00', tare: [{ tare_type_id: crateTypeId, units: crates }] }],
        ...(returned === undefined ? {} : { returned_crates: returned }),
      });

    it('case 7 — crate tare with no empties at the point is refused, and no receipt is written', async () => {
      refused(await receipt(12), 0, 12);
      const [{ n }] = (await ds.query(
        `SELECT COUNT(*)::int AS n FROM intakes i JOIN shifts s ON s.id = i.shift_id WHERE s.collection_point_id = $1`,
        [pointId],
      )) as { n: number }[];
      expect(n).toBe(0);
    });

    it('a receipt returning every crate it carries takes no empties, so it passes at 0', async () => {
      // The return needs outstanding crates: stock 5, issue 5 (on_hand back to 0).
      await stockPoint(app, ownerToken, operatorToken, pointId, 5);
      await request(app.getHttpServer()).post('/crate-issuances').set('Authorization', `Bearer ${operatorToken}`)
        .send({ supplier_id: supplierId, units: 5, mode: 'receipt' }).expect(201);
      expect(await onHand(ds, pointId)).toBe(0);
      expect((await receipt(5, 5)).status).toBe(201);
      expect(await onHand(ds, pointId)).toBe(0);
    });

    it('voiding a receipt that gives its crates back passes at a negative point', async () => {
      await stockPoint(app, ownerToken, operatorToken, pointId, 12);
      const before = await onHand(ds, pointId);
      const made = await receipt(12);
      expect(made.status).toBe(201);
      expect(await onHand(ds, pointId)).toBe(before - 12);
      // Push the point below zero past the guard, the way legacy data did: the shift the
      // receipt sits in becomes yesterday's and closes with breakage; today gets a fresh shift.
      await ds.query(
        `UPDATE shifts SET broken_crates = $2, closed_at = now(), closed_by_user_id = opened_by_user_id,
                           status = 'closed', business_date = business_date - 1
          WHERE collection_point_id = $1 AND closed_at IS NULL`,
        [pointId, before + 4],
      );
      await request(app.getHttpServer()).post('/shifts').set('Authorization', `Bearer ${operatorToken}`)
        .send({ counted_amount: '0.00' }).expect(201);
      expect(await onHand(ds, pointId)).toBe(-16);
      const res = await request(app.getHttpServer()).post(`/intakes/${made.body.id}/void`)
        .set('Authorization', `Bearer ${ownerToken}`).send({ reason: 'x' });
      expect(res.status).not.toBe(409);
      expect(await onHand(ds, pointId)).toBe(-4);
    });
  });
});
