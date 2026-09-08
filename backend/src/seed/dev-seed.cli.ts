import { AppDataSource } from '../data-source';
import { databaseEnv } from '../config/database.defaults';
import { seedDev } from './dev-seed';
import { DEV_OPERATOR_PASSWORD, SEED_OPERATORS } from './dev-seed.data';

/** Hosts a dev database answers on: the laptop itself, or the compose service. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres']);

/**
 * `npm run seed:dev -w backend` (or `npm run db:seed` from the root).
 *
 * Refuses under NODE_ENV=production for the same reason SeedDevAdmin does:
 * known credentials must never reach a production database. Also refuses a
 * NON-LOCAL `DB_HOST` unless `SEED_ALLOW_REMOTE_DB=1` is set — a laptop whose
 * `.env` points at a staging database, with NODE_ENV unset, is exactly the
 * case the NODE_ENV guard alone cannot see. Refuses on a database with pending
 * migrations rather than inserting into a half-built schema — run
 * `migration:run` (or just start the app) first.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV=production.');
    process.exitCode = 1;
    return;
  }
  const host = databaseEnv().host;
  if (!LOCAL_HOSTS.has(host) && process.env.SEED_ALLOW_REMOTE_DB !== '1') {
    console.error(
      `Refusing to seed a non-local database (DB_HOST=${host}). Set SEED_ALLOW_REMOTE_DB=1 if you really mean it.`,
    );
    process.exitCode = 1;
    return;
  }

  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) {
      console.error(
        'Refusing to seed: pending migrations. Run `npm run migration:run -w backend` first.',
      );
      process.exitCode = 1;
      return;
    }
    const summary = await seedDev(AppDataSource);
    const inserted = Object.entries(summary)
      .map(([table, n]) => `${table}=${n}`)
      .join(' ');
    console.log(`Dev seed applied (rows inserted this run): ${inserted}`);
    const operators = SEED_OPERATORS.filter((o) => o.is_active)
      .map((o) => o.login)
      .join(', ');
    console.log(
      `Sign in as admin/admin (owner) or as an operator — ${operators} — with password "${DEV_OPERATOR_PASSWORD}".`,
    );
  } finally {
    await AppDataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
