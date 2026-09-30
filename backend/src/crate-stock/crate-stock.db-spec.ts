import { ConflictException, INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { bootApp, makePoint, stockPoint, sendCrates } from '../testing/crate-stock-fixture';
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

  it('passes when the point stays at or above zero', async () => {
    const { pointId, operatorToken } = await makePoint(app, ownerToken, 'guard-ok');
    await stockPoint(app, ownerToken, operatorToken, pointId, 10);
    await expect(ds.transaction((m) => guard.assertOnHand(m, pointId, 10))).resolves.toBeUndefined();
  });

  it('refuses a negative point, naming what was there, what is asked and what is in transit', async () => {
    const { pointId } = await makePoint(app, ownerToken, 'guard-neg');
    await sendCrates(app, ownerToken, pointId, 20); // sent, not accepted
    // A crate_issuances row written straight by SQL stands in for "the write that just happened".
    await ds.query(
      `INSERT INTO crate_issuances (code, shift_id, supplier_id, units, mode, deposit_per_unit, deposit_taken, issued_by_user_id)
       SELECT 'GUARD-' || substr(md5(random()::text), 1, 8), s.id, sup.id, 5, 'receipt', 0, 0, s.opened_by_user_id
         FROM shifts s, LATERAL (SELECT id FROM suppliers LIMIT 1) sup
        WHERE s.collection_point_id = $1 AND s.closed_at IS NULL`,
      [pointId],
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
});
