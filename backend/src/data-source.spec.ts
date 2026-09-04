import 'reflect-metadata';
import type { DataSource } from 'typeorm';

/**
 * `data-source.ts` is the TypeORM **CLI's** entry point (`migration:generate` /
 * `run` / `revert`), not a Nest provider, so it calls `dotenv.config()` at MODULE
 * scope: importing it MUTATES `process.env` as a side effect, loading the
 * developer's real repo-root `.env`.
 *
 * That does NOT leak into other specs today — `backend/package.json` sets
 * `testEnvironment: "node"`, and jest-environment-node hands each test FILE its
 * own `process.env` copy (`jest-util`'s `createProcessObject`) — so the blast
 * radius is this file. The snapshot/restore below is kept anyway, for two
 * reasons that survive that: the containment is a property of the configured
 * environment rather than of the import, so it stops holding silently under a
 * different runner or a `testEnvironment` change; and within this file it keeps
 * the assertions independent of whatever the machine's `.env` happens to hold,
 * undoing both the keys dotenv adds and any it overwrites.
 *
 * The dynamic `import()` is what makes the pair possible at all: a top-level
 * import is hoisted above every statement, so the snapshot could not be taken
 * before dotenv ran.
 */
const loadAppDataSource = async (): Promise<DataSource> => {
  const before = { ...process.env };
  try {
    return (await import('./data-source')).AppDataSource;
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) delete process.env[key];
    }
    Object.assign(process.env, before);
  }
};

describe('AppDataSource — the CLI / migrations connection', () => {
  it('pins the connection-pool ceiling that app.module.ts sets INDEPENDENTLY', async () => {
    // node-postgres defaults `Pool.max` to 10, shared across every code path
    // in this process that queries through it — a handful of concurrent-heavy
    // endpoints easily exhaust it. The runtime (`app.module.ts`) and the CLI
    // (here) are two SEPARATE TypeORM configurations, so the ceiling is
    // written twice and nothing else notices when one of them drifts — which
    // is the whole reason this assertion exists rather than being «obviously»
    // covered.
    const dataSource = await loadAppDataSource();
    expect(dataSource.options.extra).toEqual({ max: 20 });
  });
});
