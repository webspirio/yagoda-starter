import { ensureTestDatabase } from './db-harness';

/**
 * jest `globalSetup` for jest.db.config.js — runs ONCE, before any db-spec, and guarantees
 * the test database exists.
 *
 * WHY THIS IS A GLOBAL SETUP RATHER THAN A CALL IN EACH SUITE, which is how it was first
 * fixed on 2026-09-15 and why that was the wrong shape. Suites that open a bare DataSource
 * go through `openTestDataSource()`, which DROPs and CREATEs the database itself. The ones
 * that boot the whole AppModule do not: they point `DB_NAME` at it and let Nest connect, so
 * they need it to already exist. The first fix added `ensureTestDatabase()` to the three
 * such suites that existed — and main then merged a FOURTH, crates.db-spec.ts, which of
 * course did not have the call. Nine tests died on `database "app_test" does not exist`,
 * their `afterAll` never ran, and jest held the open handles and never exited: the identical
 * failure, reintroduced by ordinary feature work in under a day.
 *
 * A precondition every suite depends on belongs to the RUNNER, not to each suite's memory of
 * it. Here it costs one connection at startup and cannot be forgotten by a suite written
 * next month. The per-suite calls stay as well — they are no-ops now, and they keep each of
 * those files runnable on its own through `-t` or an IDE runner, which bypasses nothing else
 * but does bypass this.
 */
export default async function globalSetup(): Promise<void> {
  await ensureTestDatabase();
}
