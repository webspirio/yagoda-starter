// Single source of truth for DB connection env reads and defaults — shared by
// the Nest runtime config (database.config.ts) and the TypeORM CLI (data-source.ts).
export const databaseEnv = () => ({
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USER ?? 'app',
  password: process.env.DB_PASSWORD ?? 'app',
  name: process.env.DB_NAME ?? 'app',
  // Managed Postgres (Neon/RDS/Supabase/…) requires TLS — set DB_SSL=true.
  ssl: process.env.DB_SSL === 'true',
});
