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
  maxWorkers: 1,
  testTimeout: 30000,
};
