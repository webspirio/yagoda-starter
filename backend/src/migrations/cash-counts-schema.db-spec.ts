import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * The PARTIAL unique index is the whole point of this spec: two `midday` rows
 * on one shift must be legal (a recount is evidence and may happen any number
 * of times) while two `closing` rows must not (§6.3's demotion exists because
 * of it).
 */
describe('cash_counts schema (Postgres)', () => {
  let ds: DataSource;
  let shiftId: string;
  let userId: string;

  const insert = (over: Record<string, unknown> = {}) => {
    const row = {
      shift_id: shiftId,
      book: 'berry',
      kind: 'midday',
      counted_amount: '100.00',
      expected_amount: '100.00',
      counted_by_user_id: userId,
      counted_at: new Date(),
      ...over,
    };
    const keys = Object.keys(row);
    return ds.query(
      `INSERT INTO cash_counts (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => (row as Record<string, unknown>)[k]),
    );
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    const [{ id: pointId }] = (await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`Точка ${run}`, `C${run.slice(0, 6).toUpperCase()}`],
    )) as { id: string }[];
    [{ id: userId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    )) as { id: string }[];
    [{ id: shiftId }] = (await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, '2026-09-09', now(), $2, 'closed') RETURNING id`,
      [pointId, userId],
    )) as { id: string }[];
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('accepts an ordinary count', async () => {
    await expect(insert({ kind: 'opening' })).resolves.toHaveLength(1);
  });

  it('refuses a SECOND opening count on the same shift and book', async () => {
    await expect(insert({ kind: 'closing' })).resolves.toHaveLength(1);
    await expect(insert({ kind: 'closing' })).rejects.toThrow(/UQ_cash_counts_shift_book_kind/);
  });

  it('ACCEPTS any number of midday counts — they are outside the partial index', async () => {
    await expect(insert({ kind: 'midday' })).resolves.toHaveLength(1);
    await expect(insert({ kind: 'midday' })).resolves.toHaveLength(1);
    await expect(insert({ kind: 'midday' })).resolves.toHaveLength(1);
  });

  it('separates the two books', async () => {
    await expect(insert({ kind: 'opening', book: 'crates' })).resolves.toHaveLength(1);
  });

  it('refuses a negative COUNT — banknotes cannot be negative', async () => {
    await expect(insert({ counted_amount: '-1.00' })).rejects.toThrow(
      /CHK_cash_counts_counted_non_negative/,
    );
  });

  /**
   * THE ASYMMETRY IS DELIBERATE and this scenario is what pins it. An
   * expectation is the previous count plus this shift's SIGNED movements
   * (§3.3), so it goes negative whenever a shift paid out more than it took
   * in — an ordinary event, not a corrupt row. `1788600000009` shipped a
   * `CHK_cash_counts_expected_non_negative` alongside the counted-amount one;
   * it made every such shift permanently uncloseable, and `1788600000010`
   * drops it. Re-adding the constraint makes this red.
   */
  it('ACCEPTS a negative EXPECTATION — it is an arithmetic result, not a pile of banknotes', async () => {
    await expect(insert({ expected_amount: '-8000.00' })).resolves.toHaveLength(1);
  });

  it('no longer carries CHK_cash_counts_expected_non_negative at all', async () => {
    const rows = (await ds.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'cash_counts'::regclass AND conname LIKE 'CHK_cash_counts%'
        ORDER BY conname`,
    )) as { conname: string }[];
    expect(rows.map((r) => r.conname)).toEqual(['CHK_cash_counts_counted_non_negative']);
  });

  it('requires both amounts', async () => {
    await expect(insert({ expected_amount: null })).rejects.toThrow(/expected_amount/);
  });

  it('has the enums with exactly their documented values', async () => {
    const books = (await ds.query(
      `SELECT unnest(enum_range(NULL::cash_book))::text AS v ORDER BY v`,
    )) as { v: string }[];
    expect(books.map((b) => b.v)).toEqual(['berry', 'crates']);

    const kinds = (await ds.query(
      `SELECT unnest(enum_range(NULL::cash_count_kind))::text AS v ORDER BY v`,
    )) as { v: string }[];
    expect(kinds.map((k) => k.v)).toEqual(['closing', 'midday', 'opening']);
  });
});
