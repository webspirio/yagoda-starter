import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { bootApp, makePoint, makeSupplier, onHand, stockPoint, sendCrates } from '../testing/crate-stock-fixture';

/**
 * «Пустих на точці» may go below zero (client call 23.10.2026, §6.9 «Правка 23.10.2026»): the six
 * writes that take empties all write past zero, and the minus is the point owing people crates —
 * who, the operator keeps in a notebook. Supersedes the 2026-09-30 invariant, whose refusal these
 * cases used to expect.
 */
describe('crates on hand may go below zero (real Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;

  beforeAll(async () => {
    ({ app, ds, ownerToken } = await bootApp());
  }, 30_000);
  afterAll(async () => app?.close());

  const issue = (token: string, supplierId: string, units: number) =>
    request(app.getHttpServer())
      .post('/crate-issuances')
      .set('Authorization', `Bearer ${token}`)
      .send({ supplier_id: supplierId, units, mode: 'receipt' });
  const openShiftId = async (pointId: string) =>
    ((await ds.query(`SELECT id FROM shifts WHERE collection_point_id = $1 AND closed_at IS NULL`, [pointId])) as {
      id: string;
    }[])[0].id;

  it('issuing with no empties at the point writes the issuance and goes negative', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-issue');
    const sup = await makeSupplier(app, operatorToken);
    expect((await issue(operatorToken, sup, 10)).status).toBe(201);
    expect(await onHand(ds, pointId)).toBe(-10);
  });

  it('a sent, unaccepted transfer still does not count — and does not block either', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-transit');
    const sup = await makeSupplier(app, operatorToken);
    await sendCrates(app, ownerToken, pointId, 20);
    expect((await issue(operatorToken, sup, 10)).status).toBe(201);
    expect(await onHand(ds, pointId)).toBe(-10);
  });

  it('the call\'s example: at −20, a transfer of 220 arrives and 200 are left', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-heal');
    const sup = await makeSupplier(app, operatorToken);
    expect((await issue(operatorToken, sup, 20)).status).toBe(201);
    expect(await onHand(ds, pointId)).toBe(-20);
    await stockPoint(app, ownerToken, operatorToken, pointId, 220);
    expect(await onHand(ds, pointId)).toBe(200);
  });

  it('voiding a return whose crates went out again passes and goes negative', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-void-return');
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
    await request(app.getHttpServer())
      .post(`/crate-returns/${ret.body.id}/void`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reason: 'помилка' })
      .expect(201);
    expect(await onHand(ds, pointId)).toBe(-10);
  });

  it('closing with more breakage than empties closes the shift and goes negative', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-close');
    await stockPoint(app, ownerToken, operatorToken, pointId, 10);
    const id = await openShiftId(pointId);
    await request(app.getHttpServer())
      .post(`/shifts/${id}/close`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ counted_amount: '0.00', broken_crates: 25 })
      .expect(201);
    const [{ closed_at }] = (await ds.query(`SELECT closed_at FROM shifts WHERE id = $1`, [id])) as {
      closed_at: Date | null;
    }[];
    expect(closed_at).not.toBeNull();
    expect(await onHand(ds, pointId)).toBe(-15);
  });

  it('voiding an accepted transfer whose crates went out passes and goes negative', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-void-transfer');
    const sup = await makeSupplier(app, operatorToken);
    const tr = await stockPoint(app, ownerToken, operatorToken, pointId, 20);
    expect((await issue(operatorToken, sup, 15)).status).toBe(201);
    await request(app.getHttpServer())
      .post(`/transfers/${tr}/void`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ reason: 'помилка' })
      .expect(201);
    expect(await onHand(ds, pointId)).toBe(-15);
  });

  it('resolving a dispute below what was already issued passes and goes negative', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-resolve');
    const sup = await makeSupplier(app, operatorToken);
    const tr = await sendCrates(app, ownerToken, pointId, 20);
    await request(app.getHttpServer())
      .post(`/transfers/${tr}/dispute`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reported_cash: '0.00', reported_crates: 20, dispute_note: 'перевірка' })
      .expect(201);
    expect((await issue(operatorToken, sup, 20)).status).toBe(201);
    await request(app.getHttpServer())
      .post(`/transfers/${tr}/resolve`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ resolved_cash: '0.00', resolved_crates: 5 })
      .expect(201);
    expect(await onHand(ds, pointId)).toBe(-15);
  });

  it('a receipt with crate tare and no empties at the point is written and goes negative', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-receipt');
    const supplierId = await makeSupplier(app, operatorToken);
    const product = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: `neg-product-${Date.now()}` })
      .expect(201);
    const grade = await request(app.getHttpServer())
      .post('/product-grades')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ product_id: product.body.id, name: `сорт-${Date.now()}` })
      .expect(201);
    await request(app.getHttpServer())
      .post('/grade-prices')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        collection_point_id: pointId,
        product_grade_id: grade.body.id,
        base_price: '50.00',
        max_markup: '0.00',
        max_discount: '0.00',
      })
      .expect(201);
    const [{ id: crateTypeId }] = (await ds.query(`SELECT id FROM tare_types WHERE is_crate`)) as { id: string }[];
    await request(app.getHttpServer())
      .post('/intakes')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({
        supplier_id: supplierId,
        items: [{ product_grade_id: grade.body.id, gross_kg: '40.00', tare: [{ tare_type_id: crateTypeId, units: 12 }] }],
      })
      .expect(201);
    expect(await onHand(ds, pointId)).toBe(-12);
  });

  it('writes that give crates back still work at a negative point', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'neg-give-back');
    const a = await makeSupplier(app, operatorToken);
    const b = await makeSupplier(app, operatorToken);
    expect((await issue(operatorToken, a, 8)).status).toBe(201); // 0 -> -8
    const toVoid = await issue(operatorToken, b, 4); // -8 -> -12
    expect(toVoid.status).toBe(201);
    await request(app.getHttpServer())
      .post('/crate-returns')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ supplier_id: a, units: 3 })
      .expect(201); // -12 -> -9
    await request(app.getHttpServer())
      .post(`/crate-issuances/${toVoid.body.id}/void`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ reason: 'помилка' })
      .expect(201); // -9 -> -5
    expect(await onHand(ds, pointId)).toBe(-5);
  });
});
