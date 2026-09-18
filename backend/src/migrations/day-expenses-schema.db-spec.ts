import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `day_expenses` constraints, against a real Postgres. What is under test is
 * the DDL and nothing else — every assertion here fails if the migration is
 * wrong and passes regardless of what the service does.
 *
 * Real parent rows are seeded (a point, a user, a shift) so each assertion
 * demonstrably trips the CHECK it names, not a foreign-key violation on a
 * missing `shift_id`/`created_by_user_id` — a test that trips the wrong
 * constraint proves nothing about the one it claims to guard.
 *
 * Per-run uuids in every fixture: the throwaway database persists between
 * runs and nothing in this file truncates.
 */
describe('day_expenses schema (Postgres)', () => {
  let ds: DataSource;
  let shiftId: string;
  let userId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);

    const [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`Витрати ${run}`, `T${run.slice(0, 5).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role)
       VALUES ('Власник', $1, 'network_owner') RETURNING id`,
      [`Тест-${run}`],
    );
    [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date)
       VALUES ($1, $2, CURRENT_DATE) RETURNING id`,
      [pointId, userId],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const insert = (amount: string, label = 'пальне') =>
    ds.query(
      `INSERT INTO day_expenses (shift_id, label, amount, created_by_user_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [shiftId, label, amount, userId],
    );

  it('accepts a positive amount', async () => {
    const [row] = await insert('1000.00');
    expect(row.id).toEqual(expect.any(String));
  });

  it('refuses a zero amount — a row with no reader (§8.3)', async () => {
    await expect(insert('0')).rejects.toThrow(/CHK_day_expenses_amount/);
  });

  it('refuses a negative amount — §8.3 has no concept of income here', async () => {
    await expect(insert('-1')).rejects.toThrow(/CHK_day_expenses_amount/);
  });

  it('refuses a whitespace-only label', async () => {
    await expect(insert('10.00', '   ')).rejects.toThrow(/CHK_day_expenses_label/);
  });

  it('has NO voided_at column — this table is mutable, not voidable (spec §3.8)', async () => {
    const rows = await ds.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'day_expenses' AND column_name = 'voided_at'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('RESTRICTs the shift FK', async () => {
    const rows = await ds.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname = 'FK_day_expenses_shift'`,
    );
    expect(rows[0].confdeltype).toBe('r');
  });
});
