import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

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
  { ignores: ['dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
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
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXOpeningElement[name.name="input"]',
          message:
            'Use <TextInput> (variant="ghost" for borderless rows) instead of a raw <input> — hand-rolled inputs miss the 16px iOS no-zoom floor. For an sr-only type="file" picker, disable this line with a reason.',
        },
      ],
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
  // Last: disable stylistic rules that would fight Prettier.
  prettier,
);
