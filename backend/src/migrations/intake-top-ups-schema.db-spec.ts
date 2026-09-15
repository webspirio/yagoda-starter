import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `intake_top_ups` constraints, against a real Postgres. What is under test is
 * the DDL and nothing else — every assertion here fails if the migration is
 * wrong and passes regardless of what the service does.
 *
 * Per-run uuids in every fixture: the throwaway database persists between runs
 * and nothing in this file truncates.
 */
describe('intake_top_ups schema (Postgres)', () => {
  let ds: DataSource;
  let run: string;
  let intakeId: string;
  let userId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    run = randomUUID().slice(0, 8);

    const [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Доплати ${run}`, `T${run.slice(0, 5).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Тест-${run}`],
    );
    const [{ id: supplierId }] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Іван', $2, true) RETURNING id`,
      [pointId, `Тест-${run}`],
    );
    const [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, '2026-09-08') RETURNING id`,
      [pointId, userId],
    );
    [{ id: intakeId }] = await ds.query(
      `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
       VALUES ($1, $2, $3, '100.00', $4) RETURNING id`,
      [`T-IN-${run}`, shiftId, supplierId, userId],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const insert = (amount: string, reason = 'доплата') =>
    ds.query(
      `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [intakeId, amount, reason, userId],
    );

  it('accepts a positive amount', async () => {
    const [row] = await insert('2000.00');
    expect(row.id).toEqual(expect.any(String));
  });

  it('refuses zero — a top-up that changes no debt is not a document', async () => {
    await expect(insert('0.00')).rejects.toThrow(/CHK_intake_top_ups_amount/);
  });

  it('refuses a negative amount — spec §3.3, void-and-reissue is the downward path', async () => {
    await expect(insert('-1.00')).rejects.toThrow(/CHK_intake_top_ups_amount/);
  });

  it('accepts two top-ups on one intake — §9.3 makes a correction a void plus a new row', async () => {
    await insert('10.00', 'перша');
    await expect(insert('20.00', 'друга')).resolves.toBeDefined();
  });

  it('refuses a partial void trio', async () => {
    const [row] = await insert('5.00');
    await expect(
      ds.query(`UPDATE intake_top_ups SET voided_at = now() WHERE id = $1`, [row.id]),
    ).rejects.toThrow(/CHK_intake_top_ups_void_trio/);
  });

  it('accepts a complete void trio', async () => {
    const [row] = await insert('5.00');
    await expect(
      ds.query(
        `UPDATE intake_top_ups
            SET voided_at = now(), voided_by_user_id = $2, void_reason = 'помилка'
          WHERE id = $1`,
        [row.id, userId],
      ),
    ).resolves.toBeDefined();
  });

  it('requires a reason', async () => {
    await expect(
      ds.query(
        `INSERT INTO intake_top_ups (intake_id, amount, created_by_user_id)
         VALUES ($1, '1.00', $2)`,
        [intakeId, userId],
      ),
    ).rejects.toThrow(/reason/);
  });

  it('refuses an orphan — intake_id is NOT NULL', async () => {
    await expect(
      ds.query(
        `INSERT INTO intake_top_ups (intake_id, amount, reason, created_by_user_id)
         VALUES (NULL, '1.00', 'x', $1)`,
        [userId],
      ),
    ).rejects.toThrow(/intake_id/);
  });
});
