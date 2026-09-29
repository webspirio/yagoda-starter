import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/** `returned_on_void` defaults to false and cannot claim a return nobody stamped. */
describe('PayoutReturnedOnVoid migration', () => {
  let ds: DataSource;
  let shiftId: string;
  let supplierId: string;
  let userId: string;
  const run = randomUUID().slice(0, 8);

  beforeAll(async () => {
    ds = await openTestDataSource();
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`rov-${run}`],
    );
    const [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`rov-${run}`, `R${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status)
       VALUES ($1, $2, '2026-09-02', 'open') RETURNING id`,
      [pointId, userId],
    );
    [{ id: supplierId }] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ніна', $2, true) RETURNING id`,
      [pointId, `rov-${run}`],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const insert = (extra: string, values: unknown[]) =>
    ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id${extra ? ', ' + extra : ''})
       VALUES ($1, $2, $3, '100.00', $4${values.map((_, i) => `, $${i + 5}`).join('')}) RETURNING returned_on_void`,
      [`PO-${randomUUID().slice(0, 12)}`, shiftId, supplierId, userId, ...values],
    );

  it('defaults to false', async () => {
    const [row] = await insert('', []);
    expect(row.returned_on_void).toBe(false);
  });

  it('rejects returned_on_void without return_settled_at', async () => {
    await expect(
      insert('voided_at, voided_by_user_id, void_reason, returned_on_void', [
        new Date(), userId, 'r', true,
      ]),
    ).rejects.toThrow(/CHK_payouts_returned_on_void/);
  });

  it('accepts returned_on_void with a stamped return', async () => {
    const at = new Date();
    const [row] = await insert(
      'voided_at, voided_by_user_id, void_reason, return_settled_at, return_settled_by_user_id, returned_on_void',
      [at, userId, 'r', at, userId, true],
    );
    expect(row.returned_on_void).toBe(true);
  });
});
