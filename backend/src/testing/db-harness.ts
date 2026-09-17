import { config } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { databaseEnv } from '../config/database.defaults';

config({ path: join(__dirname, '../../../.env') });

/**
 * The DB_NAME this process started with, captured ONCE at module load,
 * before any test code has a chance to redirect it. `resolveTestDatabaseName`
 * below must always validate against this fixed baseline rather than
 * re-reading `process.env.DB_NAME` on every call: a pipeline-style spec
 * redirects the whole app by doing `process.env.DB_NAME =
 * resolveTestDatabaseName()` in its own `beforeAll`, and a file with a SECOND
 * such `describe` block (e.g. `pipeline.db-spec.ts`'s `suppliers + grade
 * prices` block, added to reuse the first block's app-boot machinery rather
 * than duplicate it) then calls this function again in the SAME process.
 * Comparing against a live `databaseEnv().name` at that point would compare
 * the candidate against the app's OWN prior redirection, not the true
 * original — silently blind to a real collision (e.g. a second block
 * resolving `staging_test` while `DB_NAME` was actually `staging_test` all
 * along, once the first block's redirect has overwritten the visible value
 * to something else). Capturing it once, before any redirection, keeps every
 * call — no matter how many, no matter what `TEST_DB_NAME` says at the time —
 * validated against the one value this guard actually exists to protect.
 */
const originalDbName = databaseEnv().name;

/**
 * Resolves and validates the database `*.db-spec.ts` suites are allowed to
 * touch (`TEST_DB_NAME`, default `app_test`) — SEPARATE from `DB_NAME`
 * because these specs TRUNCATE, and that separation is ENFORCED here rather
 * than documented: `.env` is loaded into this process, so a stray
 * `TEST_DB_NAME=app` line would otherwise silently aim the truncation at a
 * developer's own database.
 *
 * Exported (not just used by `openTestDataSource` below) so any other
 * harness that needs the same guaranteed-safe database name — e.g. an
 * HTTP-level pipeline spec that bootstraps the full Nest app rather than a
 * bare `DataSource` — gets it from ONE place instead of re-deriving it.
 *
 * Safe to call more than once per process (see `originalDbName` above):
 * every call validates against the ORIGINAL `DB_NAME`, not whatever
 * `process.env.DB_NAME` has since been redirected to by a caller's own
 * `beforeAll`.
 */
export const resolveTestDatabaseName = (): string => {
  const database = process.env.TEST_DB_NAME ?? 'app_test';

  if (database === originalDbName) {
    throw new Error(
      `Refusing to run db-specs against "${database}": it is the same database as DB_NAME. ` +
        `These specs TRUNCATE tables. Point TEST_DB_NAME at a dedicated database ` +
        `(create it with: docker compose exec postgres createdb -U app app_test).`,
    );
  }
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run db-specs against "${database}": TEST_DB_NAME must end in "_test". ` +
        `These specs TRUNCATE tables, and the suffix is the only thing marking a database as disposable.`,
    );
  }
  return database;
};

/**
 * Raises the global per-IP rate limit for the HTTP suites.
 *
 * The production default is 100 requests per minute per IP, and every request
 * in a `*.db-spec.ts` comes from 127.0.0.1 — so ONE test run looks like a
 * single abusive client. The current suite still fits under that budget, but
 * only just: its peak `x-ratelimit-remaining` dips to 79 of 100, and the
 * failure mode when a spec is added is a scatter of `429 Too Many Requests` in
 * whichever spec happens to run past request 100, which reads like a bug in
 * that spec rather than in the shared budget.
 *
 * THE ASSIGNMENT IS UNCONDITIONAL, and that is the whole point. `dotenv` runs
 * at the top of this module, so a `THROTTLE_LIMIT` copied from `.env.example`
 * — which the root `CLAUDE.md` tells everyone to do — is already in
 * `process.env` by the time any spec calls this. A `??` here would defer to it
 * and restore the exact 429 scatter this exists to remove.
 *
 * Call this BEFORE importing `AppModule` — its decorator runs
 * `ConfigModule.forRoot()` eagerly at import time — alongside the
 * `process.env.DB_NAME` redirect the pipeline specs already do.
 *
 * This does NOT weaken the production setting: it only ever writes to this
 * process's own environment, and `THROTTLE_LIMIT` is unset outside tests.
 */
export const relaxThrottleForTests = (): void => {
  process.env.THROTTLE_LIMIT = '100000';
};

/**
 * DROP + CREATE `database` on a MAINTENANCE connection, so every `openTestDataSource()`
 * call starts from a database with no rows in it — including its migrations table —
 * before a single migration runs.
 *
 * This exists because idempotency is only provable from a known starting state:
 * `dev-seed.db-spec.ts`'s "is idempotent — a second run inserts nothing" assertion
 * means what it says only when the FIRST `seedDev()` call in that file ran against an
 * empty database. Without this, a database still carrying rows from a PREVIOUS
 * `test:db` invocation (nothing here ever truncates `app_test` on its own — see
 * backend/CLAUDE.md's "Dev seed" section) can make that assertion pass locally for the
 * wrong reason and fail the first time it runs against a genuinely clean database, e.g.
 * in CI.
 *
 * The maintenance connection targets the `postgres` administrative database — never
 * `database` itself, which is exactly the one being dropped — and Postgres always
 * provisions `postgres` alongside whatever `POSTGRES_DB` names (confirmed against this
 * repo's own `docker-compose.yml`, which sets `POSTGRES_DB: app`, yet `\l` still lists
 * `postgres` as a fifth database owned by the same `app` user). `WITH (FORCE)` (Postgres
 * 13+; this repo runs postgres:16-alpine) drops any lingering session on `database`
 * first, so a prior suite's `DataSource` that failed to `destroy()` in its own
 * `afterAll` fails this with a clear next `DROP DATABASE` retry rather than the opaque
 * "database is being accessed by other users" error a plain `DROP DATABASE` would raise.
 *
 * Called from `openTestDataSource()` ONLY after `resolveTestDatabaseName()` has already
 * validated `database` — every one of that function's guards (must end in `_test`, must
 * not equal `DB_NAME`) still runs, and still throws, before this function is ever
 * reached, so `db-harness.db-spec.ts`'s two safety-guard tests are untouched by this.
 *
 * @param {string} database — already validated by `resolveTestDatabaseName()`
 * @param {ReturnType<typeof databaseEnv>} db
 * @returns {Promise<void>}
 */
const resetTestDatabase = async (
  database: string,
  db: ReturnType<typeof databaseEnv>,
): Promise<void> => {
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
    await maintenance.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await maintenance.query(`CREATE DATABASE "${database}"`);
  } finally {
    await maintenance.destroy();
  }
};

/**
 * Creates the test database if it is not there, and does NOTHING if it is. The one
 * precondition the three pipeline suites need and none of them used to establish.
 *
 * Every suite that opens a bare `DataSource` goes through `openTestDataSource()` below,
 * which DROPs and CREATEs the database itself — those have always been self-sufficient.
 * The pipeline suites (testing/{pipeline,catalog-pipeline,documents-pipeline}.db-spec.ts)
 * do not: they point `DB_NAME` at the test database and boot the whole AppModule, whose
 * own TypeORM connection then expects it to already exist.
 *
 * IT ALWAYS DID, FOR TWO REASONS THAT BOTH STOPPED HOLDING AT ONCE. On a laptop the
 * database is created by hand once — the message `resolveTestDatabaseName` prints says
 * exactly how — and the `pg_data` volume keeps it for good. On the CI this repo ran until
 * 2026-09-15 it existed because the Actions `services:` block set `POSTGRES_DB: app_test`
 * on the container. A Compose-provided Postgres sets `POSTGRES_DB: app` instead
 * (docker-compose.yml), so on the `verify` job's stack the database was simply absent —
 * and so it is on any laptop the moment someone runs `docker compose down -v`.
 *
 * THE FAILURE IS NOT A CLEAN ERROR, which is why this function exists rather than a line
 * of documentation: the app retries the missing database every 3 seconds, all 70 tests in
 * the two boot-the-app suites die at jest's 30s `testTimeout`, their `afterAll` therefore
 * never runs, and jest — holding the open handles that teardown would have closed — never
 * exits at all. CI run 34998136933 was killed at its 480s budget having actually finished
 * testing after about 100 seconds.
 *
 * CREATE, NEVER RESET. `resetTestDatabase` above drops first, on purpose, because the
 * suites it serves must not see a previous run's rows. These three say the opposite in
 * their own comments — app_test persists between runs and is never truncated, which is why
 * they name their fixtures with a per-run uuid — so recreating it here would break them in
 * a way no assertion would catch.
 *
 * Guarded exactly as `openTestDataSource` is: `resolveTestDatabaseName()` runs first, so
 * every refusal (the app's own DB_NAME, a name not ending in `_test`) applies to a
 * function that CREATES a database just as it does to one that drops it.
 *
 * @returns {Promise<void>}
 */
export const ensureTestDatabase = async (): Promise<void> => {
  const database = resolveTestDatabaseName();
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
    const existing: unknown[] = await maintenance.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );
    if (existing.length > 0) return;
    try {
      await maintenance.query(`CREATE DATABASE "${database}"`);
    } catch (err) {
      // 42P04 is duplicate_database. Postgres has no CREATE DATABASE IF NOT EXISTS, so the
      // check above is a read followed by a write and another process can land between the
      // two. Losing that race means the database exists, which is the whole goal.
      if ((err as { code?: string }).code !== '42P04') throw err;
    }
  } finally {
    await maintenance.destroy();
  }
};

/**
 * The data source for `*.db-spec.ts` suites — the ONLY tests here that touch a real
 * Postgres. No prerequisite database to create by hand: `resetTestDatabase` above drops
 * and recreates `database` on every call, before migrations run, so there is nothing to
 * carry over between one call and the next, in this file or the next `test:db` invocation.
 *
 * Migrations are RUN, not synchronized — the point is to test the schema the
 * migration actually produces, including constraints TypeORM cannot express.
 */
export const openTestDataSource = async (): Promise<DataSource> => {
  const db = databaseEnv();
  const database = resolveTestDatabaseName();

  await resetTestDatabase(database, db);

  const ds = new DataSource({
    type: 'postgres',
    host: db.host,
    port: db.port,
    username: db.username,
    password: db.password,
    database,
    // Entity metadata IS required: the services under test build statements with
    // the QueryBuilder, which resolves table and column names from metadata
    // (`.update(User)` throws EntityMetadataNotFound without it). It never
    // creates schema — `synchronize: false` stands, so `runMigrations()` below
    // remains the only DDL path.
    entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
    // Numeric-prefixed only — the third site of this restriction, alongside
    // app.module.ts's runtime TypeORM config and data-source.ts's CLI data
    // source. A bare `*{.ts,.js}` here also matches this very directory's
    // sibling specs (e.g. `migrations/schema.db-spec.ts`), which TypeORM
    // would then try to `require()` and run as a migration.
    migrations: [join(__dirname, '../migrations/[0-9]*{.ts,.js}')],
    migrationsTableName: 'migrations',
    synchronize: false,
  });
  await ds.initialize();
  await ds.runMigrations();
  return ds;
};
