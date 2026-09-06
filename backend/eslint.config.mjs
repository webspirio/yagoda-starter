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
