import { AppDataSource } from '../data-source';
import { seedDev } from './dev-seed';
import { DEV_OPERATOR_PASSWORD, SEED_OPERATORS } from './dev-seed.data';

/**
 * `npm run seed:dev -w backend` (or `npm run db:seed` from the root).
 *
 * Refuses under NODE_ENV=production for the same reason SeedDevAdmin does:
 * known credentials must never reach a production database. Refuses on a
 * database with pending migrations rather than inserting into a half-built
 * schema — run `migration:run` (or just start the app) first.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV=production.');
    process.exit(1);
  }

  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) {
      console.error(
        'Refusing to seed: pending migrations. Run `npm run migration:run -w backend` first.',
      );
      process.exit(1);
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
