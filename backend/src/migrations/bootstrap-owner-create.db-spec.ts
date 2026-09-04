import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { databaseEnv } from '../config/database.defaults';
import { openTestDataSource, resolveTestDatabaseName } from '../testing/db-harness';

/**
 * BootstrapOwner1788600000003's CREATING branch — the one that actually
 * inserts a user, an identity and a credential row — has zero coverage
 * anywhere else. `schema.db-spec.ts`'s `BootstrapOwner` describe block only
 * proves the migration DECLINED to run against `app_test`: that database can
 * never be empty by the time this repo's specs reach it (SeedDevAdmin already
 * populated it, and none of these suites truncate — see `db-harness.ts`).
 * Proving the creating branch needs a `users` table that is empty BEFORE
 * migrations even start, which only a brand-new database can guarantee.
 *
 * So this spec creates and drops its own throwaway database per run. The name
 * is invented here, but it is still routed through `resolveTestDatabaseName`'s
 * exact guard (by pointing `TEST_DB_NAME` at it before calling
 * `openTestDataSource`) rather than duplicating an "ends in _test" check that
 * could drift from the real one. This spec never opens, truncates, or
 * otherwise touches `app_test`.
 *
 * One more wrinkle: a plain fresh database is not enough. `SeedDevAdmin`
 * (…0001, runs before BootstrapOwner) is guarded only on
 * `NODE_ENV === 'production'` — under Jest, NODE_ENV is 'test', so on an
 * ordinary fresh database SeedDevAdmin would populate its own 'admin' user
 * first, the `users` table would be non-empty by the time BootstrapOwner
 * runs, and BootstrapOwner would no-op — failing this test for the wrong
 * reason. The fix is to set NODE_ENV=production for the DURATION of the
 * migration run only: that is also the exactly correct simulation, since
 * production boots under NODE_ENV=production precisely so SeedDevAdmin skips
 * itself there. NODE_ENV is restored immediately after migrations run, before
 * any assertion, so it cannot leak into sibling suites sharing this worker.
 */
describe('BootstrapOwner (creating branch)', () => {
  const dbName = `bootstrap_owner_${randomUUID().replace(/-/g, '')}_test`;
  const login = `Bootstrap-Owner-${randomUUID()}`; // mixed case: proves the migration lowercases it

  const originalTestDbName = process.env.TEST_DB_NAME;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBootstrapEnv = {
    BOOTSTRAP_OWNER_LOGIN: process.env.BOOTSTRAP_OWNER_LOGIN,
    BOOTSTRAP_OWNER_PASSWORD: process.env.BOOTSTRAP_OWNER_PASSWORD,
    BOOTSTRAP_OWNER_FIRST_NAME: process.env.BOOTSTRAP_OWNER_FIRST_NAME,
    BOOTSTRAP_OWNER_LAST_NAME: process.env.BOOTSTRAP_OWNER_LAST_NAME,
  };

  let adminDs: DataSource | undefined;
  let ds: DataSource | undefined;

  const restoreEnv = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  beforeAll(async () => {
    // Route through the SAME guard every other db-spec relies on (refuses a
    // name that isn't ours and refuses one that doesn't end in "_test").
    process.env.TEST_DB_NAME = dbName;
    resolveTestDatabaseName();

    const db = databaseEnv();
    // Maintenance connection: CREATE DATABASE / DROP DATABASE cannot target
    // the database the connection itself is on, and "postgres" always exists
    // regardless of DB_NAME/TEST_DB_NAME. Unlike `ds` below, this connection
    // never runs a migration or touches a row.
    adminDs = new DataSource({
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: 'postgres',
    });
    await adminDs.initialize();
    await adminDs.query(`CREATE DATABASE "${dbName}"`);

    process.env.BOOTSTRAP_OWNER_LOGIN = login;
    process.env.BOOTSTRAP_OWNER_PASSWORD = 'hunter2!!';
    process.env.BOOTSTRAP_OWNER_FIRST_NAME = 'Перший';
    process.env.BOOTSTRAP_OWNER_LAST_NAME = 'Власник';

    process.env.NODE_ENV = 'production';
    try {
      ds = await openTestDataSource();
    } finally {
      restoreEnv('NODE_ENV', originalNodeEnv);
    }
  }, 30_000);

  afterAll(async () => {
    await ds?.destroy();
    if (adminDs?.isInitialized) {
      await adminDs.query(`DROP DATABASE IF EXISTS "${dbName}"`);
      await adminDs.destroy();
    }

    restoreEnv('TEST_DB_NAME', originalTestDbName);
    for (const [key, value] of Object.entries(originalBootstrapEnv)) restoreEnv(key, value);
  });

  it('creates a network_owner from BOOTSTRAP_OWNER_* on a fresh database', async () => {
    if (!ds) throw new Error('setup failed to produce a DataSource');

    const [row] = await ds.query(
      `SELECT u.role, u.collection_point_id, i.provider_user_id, c.password_hash
         FROM user_identities i
         JOIN users u ON u.id = i.user_id
         JOIN user_credentials c ON c.user_id = u.id
        WHERE i.provider = 'local'`,
    );

    expect(row).toBeDefined();
    expect(row.role).toBe('network_owner');
    expect(row.collection_point_id).toBeNull();
    // Lowercased, exactly like every other login — proves BootstrapOwner
    // shares that normalization instead of storing the env var verbatim.
    expect(row.provider_user_id).toBe(login.toLowerCase());
    expect(String(row.password_hash).startsWith('scrypt$')).toBe(true);
  });

  it('left no other user behind (SeedDevAdmin correctly skipped itself)', async () => {
    if (!ds) throw new Error('setup failed to produce a DataSource');
    const [{ count }] = await ds.query(`SELECT count(*)::int AS count FROM "users"`);
    expect(count).toBe(1);
  });
});
