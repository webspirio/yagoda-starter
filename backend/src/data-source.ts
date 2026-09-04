import { config } from 'dotenv';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { databaseEnv } from './config/database.defaults';

config({ path: join(__dirname, '../../.env') });

const db = databaseEnv();

// CLI-only data source (migration:generate/run/revert). Entities and
// migrations are discovered by __dirname-relative glob so this works both
// from src/ via ts-node and from the compiled dist/ (migration:run:prod).
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: db.host,
  port: db.port,
  username: db.username,
  password: db.password,
  database: db.name,
  ssl: db.ssl ? { rejectUnauthorized: false } : undefined,
  // node-postgres defaults Pool.max to 10, shared across every code path in
  // this process that queries through it (e.g. /health/ready). Stated here as
  // well as in app.module.ts on purpose: these are two INDEPENDENT TypeORM
  // configurations (runtime vs CLI/migrations) and setting it in only one is
  // how they drift.
  extra: { max: 20 },
  entities: [join(__dirname, '**/*.entity{.ts,.js}')],
  // Numeric-prefixed only (the `<epoch-ms>-Name.ts` convention every migration
  // in this repo follows) — a bare `*{.ts,.js}` here also matches
  // `migrations/schema.db-spec.ts`, which ts-node then `require()`s as a
  // migration module and crashes on `describe(...)` (a Jest global that
  // doesn't exist outside Jest). The compiled runtime (`nest build` /
  // `nest start`) never hits this: `tsconfig.build.json` excludes
  // `**/*.db-spec.ts`, so it's simply absent from `dist/migrations`. This CLI
  // data source has no such build step, so the glob itself has to exclude it.
  migrations: [join(__dirname, 'migrations/[0-9]*{.ts,.js}')],
  migrationsTableName: 'migrations',
});
