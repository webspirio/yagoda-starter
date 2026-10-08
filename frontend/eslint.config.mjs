import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import comments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import globals from 'globals';

const STORAGE_MESSAGE =
  'Web storage belongs in one of the reviewed shared/lib storage modules. Reading ' +
  '`localStorage` AT ALL throws in a private window, and this module graph is imported at ' +
  'bootstrap, so an unguarded access is a blank page rather than a degraded feature. Those ' +
  'modules wrap every call in try/catch and narrow what comes back — import from them ' +
  'instead of touching storage directly.';

// FRESHNESS IS DECIDED IN ONE PLACE. `src/shared/api/cachePolicy.ts` builds the app's
// QueryClient with nothing cached and grants a window only to the keys on its allowlist;
// a hook that sets one of these options itself silently re-opens the per-hook model that
// left /reception showing a five-minute-old drawer (spec 2026-09-24). Test files may set
// them — they build their own clients to test hooks, not policy.
const FRESHNESS_RESTRICTIONS = [
  {
    selector: 'Property[key.name=/^(staleTime|gcTime|refetchOnMount|refetchOnWindowFocus)$/]',
    message:
      'Query freshness is decided in src/shared/api/cachePolicy.ts only. Nothing is cached ' +
      'unless its key is on CACHEABLE_KEYS there — add the key to that list instead of ' +
      'setting this option here.',
  },
];

const RAW_INPUT_RESTRICTION = {
  selector: 'JSXOpeningElement[name.name="input"]',
  message:
    'Use <TextInput> (variant="ghost" for borderless rows) instead of a raw <input> — hand-rolled inputs miss the 16px iOS no-zoom floor. For an sr-only type="file" picker, disable this line with a reason.',
};

// Feature-Sliced Design layer boundaries: shared < entities < features < widgets < pages < app.
// A layer may import from any layer below it, never from one above. Cross-imports
// between slices of the *same* layer (e.g. features/auth -> features/other) are
// intentionally not restricted here — only the layer direction is enforced.
// Each pattern is listed both as the `@/`-aliased form and a bare `**/<layer>/**`
// form so relative imports (`../../entities/user`) are caught too.
function forbidLayers(layers) {
  return {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: layers.map((layer) => ({
            group: [`@/${layer}/**`, `**/${layer}/**`],
            message: `FSD layer violation: this file's layer may not import from ${layer}/ (shared < entities < features < widgets < pages < app).`,
          })),
        },
      ],
    },
  };
}

export default tseslint.config(
  // `dist-e2e` is the `smoke` row's OWN build output (playwright.config.ts's webServer,
  // --outDir — see e2e/constants.ts's E2E_OUT_DIR). It is gitignored, but eslint's flat
  // config does not read .gitignore, so without this line the first `npm run verify:full`
  // leaves a minified bundle on disk and the NEXT `npm run verify` reports 2116 lint
  // errors inside it — a false red with nothing wrong in the source tree. Measured
  // 2026-09-15 on exactly that sequence.
  { ignores: ['dist', 'dist-e2e', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
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
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  // Fast Refresh exceptions — files that legitimately export non-components and
  // are NOT Fast Refresh boundaries, so we whitelist the specific offending
  // exports rather than split the file. Scoped per-path (flat-config later block
  // wins; rule OPTIONS are replaced, not merged, so `allowConstantExport` is
  // repeated). Genuine helper *functions* are NOT whitelisted here — they're
  // extracted to their own modules (shared/lib/cn.ts, shared/lib/debounce.ts)
  // so the rule keeps guarding real component/helper mixing.
  {
    // shadcn primitives keep their cva variants / base-class const beside the
    // component for customization ergonomics (allowConstantExport can't cover
    // cva() — it returns a function, not a literal).
    files: ['src/shared/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: [
            'buttonVariants',
            'badgeVariants',
            'tabsListVariants',
            'fieldBaseClass',
            'fieldGhostClass',
          ],
        },
      ],
    },
  },
  {
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Node context: config files run outside the browser.
    files: ['*.config.ts', '*.config.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // A raw `<input>` silently drops the 16px floor that keeps mobile browsers
    // (iOS Safari and other WebViews) from auto-zooming the viewport on focus
    // — five of them shipped at `text-sm` (14px) before this rule existed.
    // `shared/ui` is exempt: that's where the primitives (and their tests)
    // legitimately render the element. File pickers are the one honest
    // exception outside it — they are `sr-only` and never focused for typing,
    // so they disable this line with a reason rather than route through
    // `TextInput`.
    files: [
      'src/entities/**/*.tsx',
      'src/features/**/*.tsx',
      'src/widgets/**/*.tsx',
      'src/pages/**/*.tsx',
    ],
    rules: {
      'no-restricted-syntax': ['error', RAW_INPUT_RESTRICTION],
    },
  },
  {
    // The same four layers' NON-TEST .tsx files carry both restrictions. Flat config
    // REPLACES a rule's options when a later block overlaps an earlier one (see the
    // storage block below), so this block repeats RAW_INPUT_RESTRICTION rather than
    // relying on the block above; test .tsx files fall outside it and keep only that one.
    files: [
      'src/entities/**/*.tsx',
      'src/features/**/*.tsx',
      'src/widgets/**/*.tsx',
      'src/pages/**/*.tsx',
    ],
    ignores: ['src/**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error', RAW_INPUT_RESTRICTION, ...FRESHNESS_RESTRICTIONS],
    },
  },
  {
    // Everywhere else the raw-<input> rule never reached: every .ts file, and app/ and
    // shared/ components. cachePolicy.ts is the one file allowed to set freshness.
    files: ['src/**/*.ts', 'src/app/**/*.tsx', 'src/shared/**/*.tsx'],
    ignores: ['src/shared/api/cachePolicy.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...FRESHNESS_RESTRICTIONS],
    },
  },
  {
    files: ['src/shared/**/*.ts', 'src/shared/**/*.tsx'],
    ...forbidLayers(['entities', 'features', 'widgets', 'pages', 'app']),
  },
  {
    files: ['src/entities/**/*.ts', 'src/entities/**/*.tsx'],
    ...forbidLayers(['features', 'widgets', 'pages', 'app']),
  },
  {
    files: ['src/features/**/*.ts', 'src/features/**/*.tsx'],
    ...forbidLayers(['widgets', 'pages', 'app']),
  },
  {
    files: ['src/widgets/**/*.ts', 'src/widgets/**/*.tsx'],
    ...forbidLayers(['pages', 'app']),
  },
  {
    files: ['src/pages/**/*.ts', 'src/pages/**/*.tsx'],
    ...forbidLayers(['app']),
  },
  {
    // WEB STORAGE IS CONFINED TO SIX REVIEWED MODULES, AND THIS IS WHAT KEEPS IT THERE.
    //
    // Replaces `ratchet:persist`, a 913-line AST scanner. Note what changed and what did
    // not: the ratchet required every access to sit inside a try/catch ANYWHERE in
    // frontend/src, which is weaker outside these six files than forbidding the access
    // outright, and stronger inside them. `ignores` is the reviewed list; adding to it is
    // the decision, and it is one line in a diff rather than an entry in a baseline.
    //
    // NOT `no-restricted-syntax`: esquery has no ancestor axis, so it cannot express "not
    // inside a try block" at all — and a second `no-restricted-syntax` block overlapping
    // the raw-<input> paths above would silently REPLACE that rule's options rather than
    // merge with them (flat config, see the note above). `no-restricted-globals` and
    // `no-restricted-properties` are unused in this config, so they collide with nothing.
    //
    // Paths are workspace-relative because eslint runs with cwd = frontend/.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: [
      'src/entities/user/model/store.ts',
      'src/shared/api/persister.ts',
      'src/shared/lib/form-draft/draftStorage.ts',
      'src/shared/lib/i18n/language-preference.ts',
      'src/shared/lib/point-preference/index.ts',
      'src/shared/lib/theme/theme-preference.ts',
      'src/test-setup.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'localStorage', message: STORAGE_MESSAGE },
        { name: 'sessionStorage', message: STORAGE_MESSAGE },
        { name: 'indexedDB', message: STORAGE_MESSAGE },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'window', property: 'localStorage', message: STORAGE_MESSAGE },
        { object: 'window', property: 'sessionStorage', message: STORAGE_MESSAGE },
        { object: 'window', property: 'indexedDB', message: STORAGE_MESSAGE },
      ],
    },
  },
  // Last: disable stylistic rules that would fight Prettier.
  prettier,
);
