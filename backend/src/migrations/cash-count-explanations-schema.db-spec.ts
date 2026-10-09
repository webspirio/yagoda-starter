import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';
import { CashCountExplanations1788600000022 } from './1788600000022-CashCountExplanations';

/** Spec 2026-10-08 §3 — the columns, their CHECKs, and the copy off `shifts.explanation`. */
describe('cash_counts explanations (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;
  let day = 0;

  const shift = async () => {
    day += 1;
    const [{ id }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status, closed_at, closed_by_user_id)
       VALUES ($1, $2, $3, 'closed', now(), $2) RETURNING id`,
      [pointId, userId, `2026-03-${String(day).padStart(2, '0')}`],
    );
    return id as string;
  };
  const count = async (shiftId: string, kind: string, counted: string, expected: string) => {
    const [{ id }] = await ds.query(
      `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount, counted_by_user_id, counted_at)
       VALUES ($1, 'berry', $2, $3, $4, $5, now()) RETURNING id`,
      [shiftId, kind, counted, expected, userId],
    );
    return id as string;
  };
  const texts = async (id: string) =>
    (await ds.query(`SELECT explanation, operator_note FROM cash_counts WHERE id = $1`, [id]))[0];

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `E${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      // CHK_users_role_point: an operator must be pinned to a point.
      `INSERT INTO users (first_name, last_name, role, is_active, collection_point_id)
       VALUES ('Тест', $1, 'point_operator', true, $2) RETURNING id`,
      [`Op ${run}`, pointId],
    );
  });
  afterAll(async () => {
    await ds?.destroy();
  });

  it('drops shifts.explanation', async () => {
    const cols = await ds.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'shifts' AND column_name IN ('explanation', 'operator_note')`,
    );
    expect(cols).toEqual([]);
  });

  it('refuses a blank explanation and a blank operator note', async () => {
    const id = await count(await shift(), 'closing', '90.00', '100.00');
    await expect(
      ds.query(`UPDATE cash_counts SET explanation = '  ' WHERE id = $1`, [id]),
    ).rejects.toThrow(/CHK_cash_counts_explanation_not_blank/);
    await expect(
      ds.query(`UPDATE cash_counts SET operator_note = '' WHERE id = $1`, [id]),
    ).rejects.toThrow(/CHK_cash_counts_operator_note_not_blank/);
  });

  describe('the copy (decision 4) — replayed by running down() then up() on fixture rows', () => {
    const migration = new CashCountExplanations1788600000022();
    let both: { s: string; opening: string; closing: string };
    let matchedOnly: { s: string; opening: string; closing: string };
    let blank: { s: string; closing: string };

    beforeAll(async () => {
      // Relies on serial suites (maxWorkers: 1 in jest.db.config.js): down() is real DDL on the shared DB.
      const qr = ds.createQueryRunner();
      try {
        await migration.down(qr); // shifts.explanation is back, the count columns are gone
        try {
          const a = await shift();
          both = { s: a, opening: await count(a, 'opening', '120.00', '100.00'), closing: await count(a, 'closing', '80.00', '100.00') };
          const b = await shift();
          matchedOnly = { s: b, opening: await count(b, 'opening', '100.00', '100.00'), closing: await count(b, 'closing', '100.00', '100.00') };
          const c = await shift();
          blank = { s: c, closing: await count(c, 'closing', '90.00', '100.00') };
          await ds.query(`UPDATE shifts SET explanation = 'одне пояснення на зміну' WHERE id = $1`, [a]);
          await ds.query(`UPDATE shifts SET explanation = 'зійшлося, але написав' WHERE id = $1`, [b]);
          await ds.query(`UPDATE shifts SET explanation = '' WHERE id = $1`, [c]);
        } finally {
          await migration.up(qr); // the schema is always restored
        }
      } finally {
        await qr.release(); // even when down() or up() throws
      }
    });

    it('puts one shift text on BOTH disagreeing counts', async () => {
      expect((await texts(both.opening)).explanation).toBe('одне пояснення на зміну');
      expect((await texts(both.closing)).explanation).toBe('одне пояснення на зміну');
    });

    it('keeps a text from a shift with no disagreeing count, on its closing count', async () => {
      expect((await texts(matchedOnly.closing)).explanation).toBe('зійшлося, але написав');
      expect((await texts(matchedOnly.opening)).explanation).toBeNull();
    });

    it("copies nothing for '' (yesterday's «undecided»)", async () => {
      expect((await texts(blank.closing)).explanation).toBeNull();
    });
  });

  it('refuses to drop a shift text that has no count to land on', async () => {
    const qr = ds.createQueryRunner();
    await qr.startTransaction(); // Postgres DDL is transactional: the rollback restores the schema
    try {
      await new CashCountExplanations1788600000022().down(qr);
      await qr.query(
        `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status, explanation)
         VALUES ($1, $2, '2026-04-01', 'open', 'без підрахунку')`,
        [pointId, userId],
      );
      await expect(new CashCountExplanations1788600000022().up(qr)).rejects.toThrow(/no opening or closing count/);
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});
