import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/** CHK_shifts_operator_note_not_blank gets a row that would be legal without it. */
describe('shifts.operator_note schema (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;
  let day = 0;

  const insertShift = async (over: Record<string, unknown> = {}) => {
    day += 1;
    const row: Record<string, unknown> = {
      collection_point_id: pointId,
      opened_by_user_id: userId,
      business_date: `2026-02-${String(day).padStart(2, '0')}`,
      status: 'closed',
      closed_at: new Date(),
      closed_by_user_id: userId,
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
      [`Точка ${run}`, `O${run.slice(0, 6).toUpperCase()}`],
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

  it('defaults to NULL', async () => {
    const [{ id }] = await insertShift();
    const [row] = await ds.query('SELECT operator_note FROM shifts WHERE id = $1', [id]);
    expect(row.operator_note).toBeNull();
  });

  it('stores a real note', async () => {
    const [{ id }] = await insertShift({ operator_note: 'віддав решту з іншої шухляди' });
    const [row] = await ds.query('SELECT operator_note FROM shifts WHERE id = $1', [id]);
    expect(row.operator_note).toBe('віддав решту з іншої шухляди');
  });

  it('refuses a blank note — only reopen puts it back to NULL', async () => {
    await expect(insertShift({ operator_note: '   ' })).rejects.toThrow(
      /CHK_shifts_operator_note_not_blank/,
    );
  });
});
