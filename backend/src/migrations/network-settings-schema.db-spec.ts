import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `NetworkSettings1788600000021` — the network's one settings row. What a
 * mocked spec cannot see: that the migration leaves exactly one row, and that
 * the key makes a second one impossible rather than merely unusual.
 */
describe('network_settings (Postgres)', () => {
  let ds: DataSource;

  beforeAll(async () => {
    ds = await openTestDataSource();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('holds exactly one row, created by the migration', async () => {
    const rows = (await ds.query(`SELECT id FROM network_settings`)) as { id: boolean }[];
    expect(rows).toEqual([{ id: true }]);
  });

  it('refuses a second row on the key', async () => {
    await expect(ds.query(`INSERT INTO network_settings DEFAULT VALUES`)).rejects.toThrow(
      /PK_network_settings/,
    );
  });

  it('refuses a row keyed false', async () => {
    await expect(ds.query(`INSERT INTO network_settings (id) VALUES (false)`)).rejects.toThrow(
      /CHK_network_settings_single_row/,
    );
  });

  it('keeps receipt_note nullable text', async () => {
    const [column] = (await ds.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'network_settings'
          AND column_name = 'receipt_note'`,
    )) as { data_type: string; is_nullable: string }[];
    expect(column).toEqual({ data_type: 'text', is_nullable: 'YES' });
  });
});
