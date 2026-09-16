import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/**
 * `UserPasswordVault1788600000013` — the column that lets the network owner
 * read an issued password back (issue #11).
 *
 * The assertions here are about the SHAPE the migration leaves behind, which a
 * mocked spec cannot see: that the column is nullable (every credential that
 * predates the vault has to keep working with a hash alone) and that a
 * credential row is still perfectly valid without it.
 */
describe('user_credentials.password_enc (Postgres)', () => {
  let ds: DataSource;
  let userId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    const run = randomUUID().slice(0, 8);
    [{ id: userId }] = (await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`Vault ${run}`],
    )) as { id: string }[];
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('is a nullable varchar — a password issued before the vault has no copy', async () => {
    const [column] = (await ds.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'user_credentials'
          AND column_name = 'password_enc'`,
    )) as { data_type: string; is_nullable: string }[];

    expect(column).toBeDefined();
    expect(column.data_type).toBe('character varying');
    expect(column.is_nullable).toBe('YES');
  });

  it('accepts a credential with no readable copy at all', async () => {
    await ds.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [
      userId,
      'scrypt$16384$8$1$c2FsdA==$aGFzaA==',
    ]);

    const [row] = (await ds.query(
      `SELECT password_enc FROM user_credentials WHERE user_id = $1`,
      [userId],
    )) as { password_enc: string | null }[];
    expect(row.password_enc).toBeNull();
  });

  it('round-trips a sealed copy beside the hash', async () => {
    const sealed = 'a256gcm$aXYtMTItYnl0ZXMh$dGFnLTE2LWJ5dGVzLi4u$Y2lwaGVy';
    await ds.query(`UPDATE user_credentials SET password_enc = $1 WHERE user_id = $2`, [
      sealed,
      userId,
    ]);

    const [row] = (await ds.query(
      `SELECT password_hash, password_enc FROM user_credentials WHERE user_id = $1`,
      [userId],
    )) as { password_hash: string; password_enc: string }[];
    expect(row.password_enc).toBe(sealed);
    // The verifier is untouched by any of this — the login path never reads
    // the column added here.
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
  });
});
