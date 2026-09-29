import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `payouts.intake_id` — the «paid at reception» signature (spec
 * 2026-09-21 §2.2). What is under test is the DDL only: nullable, a real FK,
 * RESTRICT on the intake side. Per-run uuids in every fixture: app_test
 * persists between runs and nothing here truncates.
 */
describe('payouts.intake_id schema (Postgres)', () => {
  let ds: DataSource;
  let run: string;
  let shiftId: string;
  let supplierId: string;
  let userId: string;
  let intakeId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);

    const [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Виплата-при-прийомці ${run}`, `P${run.slice(0, 5).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, collection_point_id)
       VALUES ('Оксана', $1, 'point_operator', $2) RETURNING id`,
      [`Тест-${run}`, pointId],
    );
    [{ id: supplierId }] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `Тест-${run}`],
    );
    [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-21') RETURNING id`,
      [pointId, userId],
    );
    [{ id: intakeId }] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '1000.00', $4) RETURNING id`,
      [`P-IN-${run}`, shiftId, supplierId, userId],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const insertPayout = (code: string, intake: string | null) =>
    ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id)
       VALUES ($1, $2, $3, '500.00', $4, $5) RETURNING id, intake_id`,
      [code, shiftId, supplierId, userId, intake],
    );

  it('accepts NULL — a standalone «Видати без ягоди»', async () => {
    const [row] = await insertPayout(`P-PO-${run}-1`, null);
    expect(row.intake_id).toBeNull();
  });

  it('stores the intake the cash was handed over with', async () => {
    const [row] = await insertPayout(`P-PO-${run}-2`, intakeId);
    expect(row.intake_id).toBe(intakeId);
  });

  it('refuses an intake that does not exist (FK)', async () => {
    await expect(insertPayout(`P-PO-${run}-3`, randomUUID())).rejects.toMatchObject({
      code: '23503',
    });
  });

  it('RESTRICTs deleting an intake a payout points at', async () => {
    await expect(ds.query(`DELETE FROM intakes WHERE id = $1`, [intakeId])).rejects.toMatchObject(
      { code: '23503' },
    );
  });

  it('the intake_id index is partial — a standalone payout has nothing to be looked up by', async () => {
    const rows = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_payouts_intake'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].indexdef).toContain('WHERE (intake_id IS NOT NULL)');
  });
});
