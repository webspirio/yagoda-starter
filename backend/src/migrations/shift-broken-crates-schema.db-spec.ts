import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * Both CHECKs on `shifts.broken_crates` get a row that would be legal without
 * them. A constraint nobody has watched reject anything is a constraint nobody
 * knows is there.
 */
describe('shifts.broken_crates schema (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  // A SECOND point exists only so the two OPEN-shift tests below don't collide
  // on `UQ_shifts_open_per_point` (partial-unique on collection_point_id WHERE
  // closed_at IS NULL — one open shift per point at a time). Both tests insert
  // an open shift; sharing a point would make the second insert fail with a
  // 23505 unique violation instead of proving the CHECK it's actually testing.
  // Do not consolidate these back onto one point.
  let pointId2: string;
  let userId: string;
  let day = 0;

  /** A fresh business_date per call — UQ_shifts_point_business_date allows one
   *  shift per point per day, and these tests need several. */
  const insertShift = async (over: Record<string, unknown> = {}, point: string = pointId) => {
    day += 1;
    const row: Record<string, unknown> = {
      collection_point_id: point,
      opened_by_user_id: userId,
      business_date: `2026-01-${String(day).padStart(2, '0')}`,
      status: 'open',
      ...over,
    };
    const keys = Object.keys(row);
    return ds.query(
      `INSERT INTO shifts (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => row[k]),
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `T${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: pointId2 }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка 2 ${run}`, `U${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('defaults to NULL on a newly opened shift', async () => {
    const [{ id }] = await insertShift();
    const [row] = await ds.query('SELECT broken_crates FROM shifts WHERE id = $1', [id]);
    // NULL is «не записано». It is NOT zero, and nothing may default it to zero.
    expect(row.broken_crates).toBeNull();
  });

  it('refuses a negative count', async () => {
    await expect(
      insertShift({
        status: 'closed',
        closed_at: new Date(),
        closed_by_user_id: userId,
        broken_crates: -1,
      }),
    ).rejects.toThrow(/CHK_shifts_broken_crates_non_negative/);
  });

  it('accepts zero on a closed shift — «нуль це нормальне значення»', async () => {
    const [{ id }] = await insertShift({
      status: 'closed',
      closed_at: new Date(),
      closed_by_user_id: userId,
      broken_crates: 0,
    });
    const [row] = await ds.query('SELECT broken_crates FROM shifts WHERE id = $1', [id]);
    expect(row.broken_crates).toBe(0);
  });

  it('refuses a count on an OPEN shift', async () => {
    // Uses pointId2 — see the comment on that variable's declaration above.
    await expect(insertShift({ broken_crates: 3 }, pointId2)).rejects.toThrow(
      /CHK_shifts_broken_crates_closed/,
    );
  });

  it('allows a closed shift to carry NULL — history predates the column', async () => {
    const [{ id }] = await insertShift({
      status: 'closed',
      closed_at: new Date(),
      closed_by_user_id: userId,
    });
    const [row] = await ds.query('SELECT broken_crates FROM shifts WHERE id = $1', [id]);
    expect(row.broken_crates).toBeNull();
  });
});
