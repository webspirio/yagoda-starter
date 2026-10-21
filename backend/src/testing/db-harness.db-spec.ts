import { DataSource } from 'typeorm';

import { databaseEnv } from '../config/database.defaults';
import {
  buildTestTemplate,
  ensureTestDatabase,
  openTestDataSource,
  resolveTemplateDatabaseName,
  resolveTestDatabaseName,
} from './db-harness';

/** Runs `sql` against `database` on a connection of its own. */
const queryOn = async (database: string, sql: string): Promise<{ t: string | null }[]> => {
  const db = databaseEnv();
  const ds = new DataSource({
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database,
  });
  await ds.initialize();
  try {
    return await ds.query(sql);
  } finally {
    await ds.destroy();
  }
};

/**
 * The harness guarding itself. `.env` is loaded into this process, so a stray
 * `TEST_DB_NAME=app` would otherwise point a spec's TRUNCATE at a developer's
 * own database — the one failure mode of this suite that destroys data instead
 * of merely reporting red.
 *
 * Both cases assert the connection is REFUSED, so neither ever opens one.
 */
describe('openTestDataSource safety guard', () => {
  const original = process.env.TEST_DB_NAME;

  afterEach(() => {
    // `process.env.X = undefined` stringifies to "undefined"; delete instead.
    // These specs share one worker (maxWorkers: 1), so a leak here would aim
    // every later suite at a database named "undefined".
    if (original === undefined) delete process.env.TEST_DB_NAME;
    else process.env.TEST_DB_NAME = original;
  });

  it('refuses to open the database the app itself uses', async () => {
    process.env.TEST_DB_NAME = process.env.DB_NAME ?? 'app';
    await expect(openTestDataSource()).rejects.toThrow(/same database as DB_NAME/);
  });

  it('refuses any database whose name does not end in _test', async () => {
    process.env.TEST_DB_NAME = 'scratch';
    await expect(openTestDataSource()).rejects.toThrow(/must end in "_test"/);
  });

  it('refuses a template name that is the database the app itself uses', async () => {
    // DB_NAME is captured when db-harness loads, so the module is loaded afresh under it.
    const appDb = process.env.DB_NAME;
    process.env.TEST_DB_NAME = 'app_test';
    process.env.DB_NAME = 'app_template_test';
    try {
      await jest.isolateModulesAsync(async () => {
        const fresh = await import('./db-harness');
        expect(() => fresh.resolveTemplateDatabaseName()).toThrow(/same database as DB_NAME/);
      });
    } finally {
      if (appDb === undefined) delete process.env.DB_NAME;
      else process.env.DB_NAME = appDb;
    }
  });
});

/**
 * `openTestDataSource()` copies one migrated template (`CREATE DATABASE … TEMPLATE`)
 * instead of running every migration per suite — the copy is file-level and the
 * migrations are what each suite used to pay for.
 */
describe('the migrated template', () => {
  afterAll(async () => {
    // Later suites copy this template; leave it exactly as globalSetup built it.
    await buildTestTemplate();
  });

  it('is disposable by the same rule as the test database', () => {
    const template = resolveTemplateDatabaseName();
    expect(template).toMatch(/_test$/);
    expect(template).not.toBe(resolveTestDatabaseName());
  });

  it('is what openTestDataSource copies, not a fresh migration run', async () => {
    await buildTestTemplate();
    await queryOn(resolveTemplateDatabaseName(), 'CREATE TABLE template_marker (id int)');

    const ds = await openTestDataSource();
    try {
      const rows = await ds.query("SELECT to_regclass('public.template_marker') AS t");
      expect(rows[0].t).toBe('template_marker');
    } finally {
      await ds.destroy();
    }
  });

  it('is rebuilt when absent, and the copy has no migration left to run', async () => {
    await queryOn('postgres', `DROP DATABASE IF EXISTS "${resolveTemplateDatabaseName()}" WITH (FORCE)`);

    const ds = await openTestDataSource();
    try {
      await expect(ds.showMigrations()).resolves.toBe(false);
      const [{ n }] = await ds.query('SELECT count(*)::int AS n FROM migrations');
      expect(n).toBeGreaterThan(0);
    } finally {
      await ds.destroy();
    }
  });
});

/**
 * The precondition the three pipeline suites depend on and none of them used to create.
 *
 * `openTestDataSource()` DROPs and CREATEs the database itself, so every suite that opens
 * a bare DataSource has always been self-sufficient. The pipeline suites do NOT open one:
 * they point `DB_NAME` at the test database and boot the whole AppModule, whose own
 * TypeORM connection then expects it to already exist. On a laptop it always does — it is
 * created by hand once (the message `resolveTestDatabaseName` prints says how) and
 * `pg_data` keeps it — and on the CI this repo used to run it existed because the Actions
 * `services:` block set `POSTGRES_DB: app_test`. Neither is true of a Compose-provided
 * Postgres, which sets `POSTGRES_DB: app`, and the failure there is not a clean error: the
 * app retries the missing database every 3s, all 70 tests in the two boot-the-app suites
 * die at jest's 30s timeout, their `afterAll` never runs, and jest then never exits at all
 * (CI run 34998136933, killed at its 480s budget having finished testing after ~100s).
 *
 * This suite reproduces that by dropping the database first, which is the only way to see
 * it on a machine where it already exists.
 */
describe('ensureTestDatabase', () => {
  const dropTestDatabase = async (): Promise<void> => {
    const db = databaseEnv();
    const maintenance = new DataSource({
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: 'postgres',
    });
    await maintenance.initialize();
    try {
      await maintenance.query(`DROP DATABASE IF EXISTS "${resolveTestDatabaseName()}" WITH (FORCE)`);
    } finally {
      await maintenance.destroy();
    }
  };

  const testDatabaseExists = async (): Promise<boolean> => {
    const db = databaseEnv();
    const maintenance = new DataSource({
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: 'postgres',
    });
    await maintenance.initialize();
    try {
      const rows = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        resolveTestDatabaseName(),
      ]);
      return rows.length > 0;
    } finally {
      await maintenance.destroy();
    }
  };

  it('creates the test database when it is absent', async () => {
    await dropTestDatabase();
    await expect(testDatabaseExists()).resolves.toBe(false);

    await ensureTestDatabase();

    await expect(testDatabaseExists()).resolves.toBe(true);
  });

  it('is a no-op when it already exists — it must never drop what is there', async () => {
    await ensureTestDatabase();

    // A marker table survives the second call only if nothing dropped the database. This is
    // the half that makes this function different from `resetTestDatabase`: the pipeline
    // suites state outright that app_test persists between runs and is never truncated, and
    // an "ensure" that quietly recreated it would break that without failing any test here.
    const db = databaseEnv();
    const ds = new DataSource({
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: resolveTestDatabaseName(),
    });
    await ds.initialize();
    try {
      await ds.query('CREATE TABLE IF NOT EXISTS ensure_marker (id int)');
    } finally {
      await ds.destroy();
    }

    await ensureTestDatabase();

    const after = new DataSource({
      type: 'postgres',
      host: db.host,
      port: db.port,
      username: db.username,
      password: db.password,
      database: resolveTestDatabaseName(),
    });
    await after.initialize();
    try {
      const rows = await after.query("SELECT to_regclass('public.ensure_marker') AS t");
      expect(rows[0].t).toBe('ensure_marker');
      await after.query('DROP TABLE ensure_marker');
    } finally {
      await after.destroy();
    }
  });

  // Every guard `openTestDataSource` enforces applies here too — this function creates a
  // database, so pointing it at the app's own would be the same destructive mistake one
  // step earlier.
  it('refuses the database the app itself uses, exactly as openTestDataSource does', async () => {
    const original = process.env.TEST_DB_NAME;
    process.env.TEST_DB_NAME = process.env.DB_NAME ?? 'app';
    try {
      await expect(ensureTestDatabase()).rejects.toThrow(/same database as DB_NAME/);
    } finally {
      if (original === undefined) delete process.env.TEST_DB_NAME;
      else process.env.TEST_DB_NAME = original;
    }
  });
});
