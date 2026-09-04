import { config } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { databaseEnv } from '../config/database.defaults';

config({ path: join(__dirname, '../../../.env') });

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
 */
export const resolveTestDatabaseName = (): string => {
  const db = databaseEnv();
  const database = process.env.TEST_DB_NAME ?? 'app_test';

  if (database === db.name) {
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
