import { config } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { databaseEnv } from '../config/database.defaults';

config({ path: join(__dirname, '../../../.env') });

/**
 * The data source for `*.db-spec.ts` suites — the ONLY tests here that touch a real
 * Postgres. Create the database once with
 * `docker compose exec postgres createdb -U app app_test`.
 *
 * It targets a SEPARATE database (`TEST_DB_NAME`, default `app_test`) because the
 * specs TRUNCATE, and that separation is ENFORCED below rather than documented:
 * `.env` is loaded into this process, so a stray `TEST_DB_NAME=app` line would
 * otherwise silently aim the truncation at a developer's own database. Migrations
 * are RUN, not synchronized — the point is to test the schema the migration
 * actually produces, including constraints TypeORM cannot express.
 */
export const openTestDataSource = async (): Promise<DataSource> => {
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
    migrations: [join(__dirname, '../migrations/*{.ts,.js}')],
    migrationsTableName: 'migrations',
    synchronize: false,
  });
  await ds.initialize();
  await ds.runMigrations();
  return ds;
};

/** `users` has a default for every NOT NULL column, so an id is the whole row. */
export const insertTestUser = async (ds: DataSource, id: string): Promise<void> => {
  await ds.query(`INSERT INTO "users" ("id") VALUES ($1) ON CONFLICT ("id") DO NOTHING`, [id]);
};

/**
 * Re-apply one-shot data migrations, in the order given, against an open source.
 *
 * Sibling suites in this serial run may TRUNCATE the very tables a migration
 * populates, so whether a seeded row survives to a given suite is a question
 * of jest's file ordering, not of the migration itself.
 *
 * A spec that asserts on seeded data should call this in `beforeAll` rather
 * than depend on that ordering. It is safe because every migration named here
 * is idempotent — the property each of those specs also asserts directly.
 */
export const applyMigrations = async (ds: DataSource, names: string[]): Promise<void> => {
  for (const name of names) {
    const migration = ds.migrations.find((m) => m.name === name);
    if (!migration) throw new Error(`applyMigrations: no migration named ${name}`);
    const runner = ds.createQueryRunner();
    try {
      await migration.up(runner);
    } finally {
      await runner.release();
    }
  }
};
