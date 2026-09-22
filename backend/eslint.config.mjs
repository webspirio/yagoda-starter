import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';

export default tseslint.config(
  // `coverage` is the `coverage` row's own output. jest's rootDir here is `src`, so
  // `npm run coverage` writes backend/src/coverage/lcov-report/*.js INSIDE the linted
  // tree. It lints clean today, which is exactly why this is worth pinning now: it is the
  // same shape as the frontend dist-e2e bug found on 2026-09-15, where a full-tier row
  // left generated output on disk and the next fast-tier `lint` run reported 2116 errors
  // inside it. frontend/eslint.config.mjs has ignored `coverage` all along.
  // `**/coverage/`, not `coverage/`: jest's coverageDirectory defaults to
  // `<rootDir>/coverage` and rootDir is `src`, so the output actually lands in
  // `src/coverage/` — while a flat-config ignore is anchored to this file's directory and
  // only ever matched `backend/coverage/`. The two never agreed. It went unnoticed because
  // no rule fired on generated lcov HTML until eslint-comments arrived, at which point three
  // vendored report scripts each produced three errors. `.gitignore`'s bare `coverage/`
  // matches at any depth, which is why git has always hidden this and eslint never did.
  { ignores: ['dist/', 'node_modules/', '**/coverage/'] },
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
  comments.recommended,
  {
    // EVERY SUPPRESSION MUST SAY WHY, IN THE CODE, NEXT TO THE THING IT EXCUSES.
    //
    // Replaces `ratchet:lint-exempt` — 371 impl + 213 test + 71 baseline lines that kept
    // the same reasons in a JSON file keyed BY LINE NUMBER, which moved four times in eight
    // days without ever finding a defect. `require-description` puts each reason where the
    // next reader is already looking.
    //
    // `no-use` with this `allow` list is the part the ratchet could not do at all. It was
    // blind to FOUR comment shapes, not one: `/* eslint rule: "off" */` (the inline-config
    // form — its regex demanded the `eslint-` hyphen), `/* eslint-env */`, `/* global */`
    // and `/* exported */`. Allowing only the four disable/enable directives bans all four.
    // eslint's own `linterOptions.noInlineConfig` would also close it, and would ban the
    // ten legitimate disable comments with it; this is the precise instrument.
    //
    // NOT claimed as new coverage: `reportUnusedDisableDirectives`. ESLint 10 defaults it to
    // `warn` and both lint scripts run `--max-warnings=0`, so a suppression that has stopped
    // suppressing anything is ALREADY fatal here. It is set explicitly only to make the
    // guarantee legible rather than inherited.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@eslint-community/eslint-comments/no-use': [
        'error',
        {
          allow: [
            'eslint-disable',
            'eslint-disable-line',
            'eslint-disable-next-line',
            'eslint-enable',
          ],
        },
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
    //
    // `reweighs` joins because §8.1's net weight is computed in TypeScript —
    // `(gross − pallet) − tare` — and it is the first module in the guard
    // whose arithmetic is on WEIGHTS rather than on money, which is the same
    // rule (foundation §5.1) and the easier one to forget.
    //
    // `day-costs` joins with §8.3's day expenses. It does no arithmetic in
    // TypeScript today — `create`/`update`/`remove` only store and compare the
    // amount string — but this is exactly the module a later собівартість
    // screen (§8.6, «скільки коштував кілограм ягоди цього дня») would reach
    // into for `Σ day_expenses.amount`, and `total / net_kg` written in
    // TypeScript is precisely the shape §5.1 forbids. The guard is what keeps
    // that sum in `common/money.ts` when that screen is built, not a
    // retrofit after the first wrong кілограма.
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
      // THE LIST'S MOST IMPORTANT PROPERTY, not an afterthought: EVERY module that
      // owns a money or weight `numeric` column is in it. registry.test.mjs derives
      // that set from 28-db-schema.dbml and fails if one is missing, so this is a
      // machine-checked claim rather than a promise.
      //
      // grade-prices, tare-types and collection-points own six of them between them
      // — `grade_prices.base_price` multiplies into every intake `amount`, plus
      // `max_markup` and `max_discount`; `tare_types.weight_kg` and `deposit_price`;
      // `collection_points.target_cash` — and none was guarded until 2026-09-18.
      // They were reachable only by the separate money ratchet, which scanned all of
      // backend/src and is now deleted; widening first is what made that deletion a
      // handover rather than a hole.
      'src/grade-prices/**/*.ts',
      'src/tare-types/**/*.ts',
      'src/collection-points/**/*.ts',
      'src/reweighs/**/*.ts',
      'src/day-costs/**/*.ts',
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
    // THE SEED IS A STANDALONE CLI, NEVER A RUNTIME DEPENDENCY OF THE APP IT SEEDS.
    //
    // Replaces rule 2 of the `seam` check, which resolved every import specifier through
    // the TypeScript compiler API to see whether it landed inside src/seed/. eslint sees
    // the same files, from a config `npm run lint` already loads, for none of the 501
    // lines.
    //
    // `no-restricted-imports` is unused everywhere else in this config, so this block
    // collides with nothing. That is the reason rule 1 could NOT come along: banning a
    // string literal needs `no-restricted-syntax`, and a second block setting it over
    // files that overlap the money ban would REPLACE that rule's options rather than
    // merge with them — silently disabling the money guard. Flat config replaces options;
    // it does not merge them.
    //
    // Patterns match the specifier STRING, not a resolved path. That is sound HERE and
    // only here: this workspace has no tsconfig `paths` aliases, so every import of the
    // seed is relative and the spellings below are all of them. Adding an alias means
    // adding its spelling to this group.
    files: ['src/**/*.ts'],
    ignores: ['src/seed/**', '**/*.spec.ts', '**/*.db-spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/seed', '**/seed/**'],
              message:
                'backend/src/seed/ is a standalone CLI (dev-seed.cli.ts, run via `npm run seed:dev`), never a runtime dependency of the application it seeds. Move what you need out of seed/ rather than importing into it.',
            },
          ],
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
      'src/supplier-balance/supplier-balance-breakdown.db-spec.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
    },
  },
  prettier,
);
