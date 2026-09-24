import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `crate_returns.intake_id` — a return written BY a receipt, in the same
 * «Прийняти» (spec 2026-09-23 §8.3): a person who brought berries in our
 * rented crates. What is under test is the DDL only: nullable, a real FK,
 * RESTRICT on the intake side, and the partial UNIQUE — one receipt writes
 * at most one return. Per-run uuids in every fixture: app_test persists
 * between runs and nothing here truncates.
 */
describe('crate_returns.intake_id schema (Postgres)', () => {
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
      [`Повернення-при-прийомці ${run}`, `R${run.slice(0, 5).toUpperCase()}`],
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
       VALUES ($1, $2, '2026-09-23') RETURNING id`,
      [pointId, userId],
    );
    [{ id: intakeId }] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '1000.00', $4) RETURNING id`,
      [`R-IN-${run}`, shiftId, supplierId, userId],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const insertReturn = (intake: string | null) =>
    ds.query(
      `INSERT INTO crate_returns
         (shift_id, supplier_id, units, deposit_refund, accepted_by_user_id, intake_id)
       VALUES ($1, $2, 5, '600.00', $3, $4) RETURNING id, intake_id`,
      [shiftId, supplierId, userId, intake],
    );

  it('accepts NULL — a standalone «Прийняти ящики»', async () => {
    const [row] = await insertReturn(null);
    expect(row.intake_id).toBeNull();
  });

  it('stores the intake the return was written with', async () => {
    const [row] = await insertReturn(intakeId);
    expect(row.intake_id).toBe(intakeId);
  });

  it('refuses a second return with the SAME intake_id (partial unique)', async () => {
    await expect(insertReturn(intakeId)).rejects.toThrow(/UQ_crate_returns_intake/);
  });

  it('refuses an intake that does not exist (FK)', async () => {
    await expect(insertReturn(randomUUID())).rejects.toThrow(/FK_crate_returns_intake/);
  });
});
