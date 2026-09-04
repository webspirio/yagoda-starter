import { openTestDataSource } from './db-harness';

/**
 * The harness guarding itself. `.env` is loaded into this process, so a stray
 * `TEST_DB_NAME=app` would otherwise point a spec's TRUNCATE at a developer's
 * own database — the one failure mode of this suite that destroys data instead
 * of merely reporting red.
 *
 * Both cases assert the connection is REFUSED, so neither ever opens one.
 */
describe('openTestDataSource safety guard', () => {
  const original = process.env.TEST_DB_NAME;

  afterEach(() => {
    // `process.env.X = undefined` stringifies to "undefined"; delete instead.
    // These specs share one worker (maxWorkers: 1), so a leak here would aim
    // every later suite at a database named "undefined".
    if (original === undefined) delete process.env.TEST_DB_NAME;
    else process.env.TEST_DB_NAME = original;
  });

  it('refuses to open the database the app itself uses', async () => {
    process.env.TEST_DB_NAME = process.env.DB_NAME ?? 'app';
    await expect(openTestDataSource()).rejects.toThrow(/same database as DB_NAME/);
  });

  it('refuses any database whose name does not end in _test', async () => {
    process.env.TEST_DB_NAME = 'scratch';
    await expect(openTestDataSource()).rejects.toThrow(/must end in "_test"/);
  });
});
