// Unit config (*.spec.ts — no I/O, everything mocked). Moved out of package.json's
// "jest" key into this file for exactly one reason: coverageThreshold below has to be
// computed from process.env, and a static JSON block in package.json cannot do that.
//
// The threshold values are read from the SAME COVERAGE_BACKEND_* variables
// .github/workflows/ci.yml's `verify` job sets in its `env:` block — see that file's
// header comment for why they live there and nowhere else. Every one of them defaults
// to 0 here, so a plain `npm run coverage` on a laptop reports the percentage without
// ever failing on it; only CI sets these above zero.
module.exports = {
  watchman: false,
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  coverageThreshold: {
    global: {
      statements: Number(process.env.COVERAGE_BACKEND_STATEMENTS ?? 0),
      branches: Number(process.env.COVERAGE_BACKEND_BRANCHES ?? 0),
      functions: Number(process.env.COVERAGE_BACKEND_FUNCTIONS ?? 0),
      lines: Number(process.env.COVERAGE_BACKEND_LINES ?? 0),
    },
  },
};
