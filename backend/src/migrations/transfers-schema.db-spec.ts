import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * Every CHECK on `transfers` gets a row that would be legal without it. A
 * constraint nobody has watched reject anything is a constraint nobody knows
 * is there.
 */
describe('transfers schema (Postgres)', () => {
  let ds: DataSource;
  let pointId: string;
  let userId: string;

  const insert = (over: Record<string, unknown> = {}) => {
    const row = {
      collection_point_id: pointId,
      cash: '100.00',
      crates: 10,
      carrier: 'Іван, Ducato',
      sent_by_user_id: userId,
      sent_at: new Date(),
      status: 'sent',
      ...over,
    };
    const keys = Object.keys(row);
    return ds.query(
      `INSERT INTO transfers (${keys.map((k) => `"${k}"`).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      keys.map((k) => (row as Record<string, unknown>)[k]),
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
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Owner ${run}`],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('accepts an ordinary transfer', async () => {
    await expect(insert()).resolves.toHaveLength(1);
  });

  it('refuses negative cash', async () => {
    await expect(insert({ cash: '-1.00' })).rejects.toThrow(/CHK_transfers_cash_non_negative/);
  });

  it('refuses negative crates', async () => {
    await expect(insert({ crates: -1 })).rejects.toThrow(/CHK_transfers_crates_non_negative/);
  });

  it('refuses a transfer that moves nothing', async () => {
    await expect(insert({ cash: '0.00', crates: 0 })).rejects.toThrow(/CHK_transfers_not_empty/);
  });

  it('accepts a crates-only run and a cash-only run', async () => {
    await expect(insert({ cash: '0.00', crates: 200 })).resolves.toHaveLength(1);
    await expect(insert({ cash: '150000.00', crates: 0 })).resolves.toHaveLength(1);
  });

  it('refuses negative reported and resolved figures', async () => {
    await expect(insert({ status: 'disputed', reported_cash: '-5.00' })).rejects.toThrow(
      /CHK_transfers_reported_non_negative/,
    );
    await expect(insert({ status: 'disputed', resolved_cash: '-5.00' })).rejects.toThrow(
      /CHK_transfers_resolved_non_negative/,
    );
  });

  it('refuses a partial void trio', async () => {
    await expect(insert({ voided_at: new Date() })).rejects.toThrow(/CHK_transfers_void_trio/);
  });

  it('accepts a complete void trio', async () => {
    await expect(
      insert({ voided_at: new Date(), voided_by_user_id: userId, void_reason: 'дубль' }),
    ).resolves.toHaveLength(1);
  });

  it('has exactly three transfer_status values', async () => {
    const rows = (await ds.query(
      `SELECT unnest(enum_range(NULL::transfer_status))::text AS v ORDER BY v`,
    )) as { v: string }[];
    expect(rows.map((r) => r.v)).toEqual(['accepted', 'disputed', 'sent']);
  });

  it('has both indexes from the DBML', async () => {
    const rows = (await ds.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'transfers'`,
    )) as { indexname: string }[];
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('IDX_transfers_point_accepted_date');
    expect(names).toContain('IDX_transfers_status');
  });
});
