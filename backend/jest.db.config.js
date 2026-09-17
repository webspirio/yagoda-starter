// DB-backed specs (*.db-spec.ts) — the only tests that touch a real Postgres.
// Serial (maxWorkers: 1) because every spec truncates the same tables.
// The unit config in package.json uses testRegex `.*\.spec\.ts$`, which does not
// match `-spec.ts`, so `npm test` never picks these up.
module.exports = {
  rootDir: 'src',
  testRegex: '.*\\.db-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  // watchman: false — NOT a preference. When the machine's watchman binary is
  // broken (a mismatched homebrew boost/folly is the common cause), jest's
  // haste-map crawler returns an EMPTY file list and jest exits 0 having run
  // nothing. A green exit code for zero tests is worse than a red one, so the
  // node crawler is used unconditionally; it costs a little startup time and
  // cannot fail this way.
  watchman: false,
  maxWorkers: 1,
  testTimeout: 30000,
  // Creates TEST_DB_NAME once, before any suite, so the suites that boot the whole
  // AppModule (rather than opening a DataSource through openTestDataSource, which creates
  // it themselves) cannot depend on some other suite having run first. See the file's own
  // header for why this is a runner concern and not a per-suite one — it was the latter
  // until main merged a fourth AppModule suite without the call and nine tests died on
  // `database "app_test" does not exist`, taking jest's exit with them.
  globalSetup: '<rootDir>/testing/db-global-setup.ts',
};
