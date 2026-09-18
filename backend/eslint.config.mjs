import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  // `coverage` is the `coverage` row's own output. jest's rootDir here is `src`, so
  // `npm run coverage` writes backend/src/coverage/lcov-report/*.js INSIDE the linted
  // tree. It lints clean today, which is exactly why this is worth pinning now: it is the
  // same shape as the frontend dist-e2e bug found on 2026-09-15, where a full-tier row
  // left generated output on disk and the next fast-tier `lint` run reported 2116 errors
  // inside it. frontend/eslint.config.mjs has ignored `coverage` all along.
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
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
    // Scoped to the modules that handle money rather than applied
    // globally: `*` and `/` are perfectly ordinary in pagination offsets,
    // image resizing and time arithmetic, and a repo-wide ban would train
    // people to write disable comments.
    //
    // `transfers` and `point-cash` join the list with the cash slice. Neither
    // does arithmetic in JavaScript today — the cash formula and the shortfall
    // are both computed in Postgres, where `numeric` is exact — and this guard
    // is what keeps it that way. `shortfall = target_cash - cash` written in
    // TypeScript is the exact shape §5.1 forbids, and it would look perfectly
    // reasonable in review.
    //
    // `cash-counts` joins with the cash counts slice, and it is the one entry
    // here that does arithmetic in JavaScript ALREADY: `cash-count.mapper.ts`
    // computes the discrepancy as `counted − expected` through
    // `common/money.ts`'s `sub`. `Number(a) - Number(b)` would produce the
    // same answer on every fixture in the suite and a wrong one on a real
    // kopiyka, so this guard is not prospective here — it is guarding a live
    // call site.
    //
    // `intake-top-ups` joins with the top-ups slice (#61). Like `transfers`
    // and `point-cash` before it, it does no JavaScript arithmetic today —
    // the third term of the debt formula is computed in Postgres, and this
    // module only compares its amount against zero through `money.ts`'s `gt`.
    // The guard is what keeps a later `debt + top_up` from being written in
    // TypeScript, where it would look perfectly reasonable in review.
    files: [
      'src/intakes/**/*.ts',
      'src/payouts/**/*.ts',
      'src/shifts/**/*.ts',
      'src/supplier-balance/**/*.ts',
      'src/transfers/**/*.ts',
      'src/point-cash/**/*.ts',
      'src/cash-counts/**/*.ts',
      // crates/: the money files only. `crate-code.ts` converts a row COUNT
      // with Number() and is deliberately outside this guard — it touches no
      // currency.
      //
      // `crate-balance.service.ts` stays IN the guard despite converting
      // `remaining_units`, an integer row count, not money: it spells that
      // conversion `Number.parseInt(String(v), 10)`, not `Number(v)`, because
      // this rule's `CallExpression[callee.name='Number']` selector matches
      // the bare global only — `Number.parseInt` is a MemberExpression call
      // and is the sanctioned spelling here on purpose. Whoever tightens this
      // selector to also catch `Number.parseInt`/`Number.parseFloat` should
      // know that closes a gap deliberately left open, not a leftover one.
      'src/crates/crate-allocation.ts',
      'src/crates/crates.service.ts',
      'src/crates/crate-balance.service.ts',
      'src/intake-top-ups/**/*.ts',
      // ADDED 2026-09-18, and this is the list's most important property, not an
      // afterthought: EVERY module that owns a money or weight `numeric` column
      // must be in it. These three own six of them between them, and none was
      // guarded — `grade_prices.base_price` is the price that multiplies into
      // every intake `amount`, plus `max_markup` and `max_discount`;
      // `tare_types.weight_kg` and `deposit_price`; `collection_points.target_cash`.
      // They were reachable only by the separate money ratchet, which scanned all
      // of backend/src and is deleted a commit later. Widening first is what makes
      // that deletion a handover rather than a hole.
      'src/grade-prices/**/*.ts',
      'src/tare-types/**/*.ts',
      'src/collection-points/**/*.ts',
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
          // `total *= rate` is the same operator with a different token kind, and
          // BOTH nets missed it: eslint's selector above is anchored, and the AST
          // ratchet compared against ts.SyntaxKind.AsteriskToken, which is not
          // AsteriskEqualsToken. Free to add — a full AST scan of backend/src and
          // frontend/src found zero occurrences, so this is a prospective guard
          // with no migration behind it.
          selector: "AssignmentExpression[operator=/^[*/]=$/]",
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
    files: [
      'src/testing/pipeline.db-spec.ts',
      'src/testing/catalog-pipeline.db-spec.ts',
      'src/testing/documents-pipeline.db-spec.ts',
      'src/crates/crates.db-spec.ts',
      'src/crates/crates-race.db-spec.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
    },
  },
  prettier,
);
