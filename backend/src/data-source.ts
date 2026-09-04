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
  migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  migrationsTableName: 'migrations',
});
