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
/**
 * Raises the global per-IP rate limit for the HTTP suites.
 *
 * The production default is 100 requests per minute per IP, and every request
 * in a `*.db-spec.ts` comes from 127.0.0.1 — so ONE test run looks like a
 * single abusive client. Before the documents pipeline existed the whole db
 * suite fitted under that budget; it no longer does, and the failure surfaces
 * as a scatter of `429 Too Many Requests` in whichever spec happens to run
 * past request 100, which reads like a bug in that spec rather than in the
 * shared budget.
 *
 * Call this BEFORE importing `AppModule` — its decorator runs
 * `ConfigModule.forRoot()` eagerly at import time — alongside the
 * `process.env.DB_NAME` redirect the pipeline specs already do.
 *
 * This does NOT weaken the production setting: `THROTTLE_LIMIT` is unset
 * outside tests and the factory falls back to 100.
 */
export const relaxThrottleForTests = (): void => {
  process.env.THROTTLE_LIMIT = process.env.THROTTLE_LIMIT ?? '100000';
};

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
 * The data source for `*.db-spec.ts` suites — the ONLY tests here that touch a real
 * Postgres. Create the database once with
 * `docker compose exec postgres createdb -U app app_test`.
 *
 * Migrations are RUN, not synchronized — the point is to test the schema the
 * migration actually produces, including constraints TypeORM cannot express.
 */
export const openTestDataSource = async (): Promise<DataSource> => {
  const db = databaseEnv();
  const database = resolveTestDatabaseName();

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
