import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Underscore-prefixed = intentionally unused (interface conformance,
      // extension-point stubs like AllExceptionsFilter.reportError).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // MONEY ARITHMETIC IS CONFINED TO src/common/money.ts, AND THIS IS WHAT
    // KEEPS IT THERE. Foundation §5.1: `numeric` values are strings end to end
    // and «no arithmetic operator is ever applied to a monetary or weight
    // value». A `price * kg` in a service compiles, passes review at a glance,
    // and produces a wrong `amount` that §2.7 then freezes forever on a
    // supplier's printed receipt.
    //
    // Scoped to the four modules that handle money rather than applied
    // globally: `*` and `/` are perfectly ordinary in pagination offsets,
    // image resizing and time arithmetic, and a repo-wide ban would train
    // people to write disable comments.
    files: [
      'src/intakes/**/*.ts',
      'src/payouts/**/*.ts',
      'src/shifts/**/*.ts',
      'src/supplier-balance/**/*.ts',
    ],
    ignores: ['**/*.spec.ts', '**/*.db-spec.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use src/common/money.ts — parseFloat cannot round-trip numeric(12,2).' },
        { name: 'parseInt', message: 'Use src/common/money.ts for decimals; parseInt silently truncates.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator=/^[*/]$/]",
          message: 'Money and weight arithmetic belongs in src/common/money.ts (foundation §5.1).',
        },
        {
          selector: "CallExpression[callee.name='Number']",
          message: 'Never convert a numeric string to a JS number — see src/common/money.ts.',
        },
        {
          selector: "MemberExpression[property.name='toFixed']",
          message: 'toFixed rounds half-to-even on a double. Use src/common/money.ts.',
        },
      ],
    },
  },
  {
    // supertest is an `export =` (CommonJS export-assignment) module, and
    // this repo's tsconfig has no `esModuleInterop` — `import request =
    // require('supertest')` is the correct, interop-independent form (a
    // default import type-checks but resolves to `undefined` at runtime; see
    // the comment in pipeline.db-spec.ts). `allowAsImport` permits exactly
    // that TS-specific syntax, not a plain `require()` call.
    files: ['src/testing/pipeline.db-spec.ts', 'src/testing/catalog-pipeline.db-spec.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
    },
  },
  prettier,
);
