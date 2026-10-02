# Query Cache by Allowlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing in the frontend's TanStack Query cache survives unless its query key is on one allowlist; every other read refetches on mount and on window focus and is dropped once unobserved.

**Architecture:** A new `shared/api/cachePolicy.ts` builds the app's `QueryClient` with no-cache defaults and grants a cache window, through `setQueryDefaults`, only to the four allowlisted keys. Every per-hook freshness option is deleted, and an ESLint rule forbids them anywhere but `cachePolicy.ts`, so the allowlist cannot be bypassed from a hook.

**Tech Stack:** React 19, TanStack Query v5, Vitest + Testing Library (jsdom), ESLint 10 flat config.

**Spec:** `docs/superpowers/specs/2026-09-24-query-cache-allowlist-design.md`

## Global Constraints

- Allowlist is exactly: `queryKeys.me`, `queryKeys.tareTypes`, `queryKeys.products`, `queryKeys.productGrades()`. Nothing else — `collectionPoints` and `users` are deliberately excluded.
- Off-allowlist queries: `staleTime: 0`, `gcTime: 0`, `refetchOnMount: true`, `refetchOnWindowFocus: true`, `retry: 1`.
- Allowlisted keys: `staleTime` 30 min, `gcTime` 24h.
- Mutations: `gcTime: 0`.
- Forbidden property names outside `src/shared/api/cachePolicy.ts` and test files: `staleTime`, `gcTime`, `refetchOnMount`, `refetchOnWindowFocus`.
- No `eslint-disable` for the new rule anywhere; no raised test timeouts; no baseline edits.
- No polling (follow-up). Do not touch `crateBalances` invalidation (follow-up).
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Work on branch `fix/query-cache-allowlist` in the main checkout (no worktree).
- All commands below run from the repo root unless they `cd`.

## Review Focus

1. **A key two screens read at once** (reception's form and `PointStatePanel` both read `['point-cash','one',pointId,null]`): one unmounting must not drop the other's data — `gcTime` counts from the LAST observer. Pinned in Task 1.
2. **A key that merely looks like an allowlisted one** (`['grade-prices']` vs `['product-grades']`, `['collection-points']`): must NOT be cached. Pinned in Task 1.
3. **Allowlisted key under a leaf** (`['product-grades','active']`, `['tare-types','options']`): must BE cached via prefix match. Pinned in Task 1.
4. **The revealed password** (`useRevealPasswordMutation`): losing the hook's own `gcTime: 0` must not make a plaintext password linger. Pinned in Task 1 (mutation test).
5. **The existing raw-`<input>` lint rule** after the options merge: must still fire on page `.tsx` files, test files included. Pinned in Task 2.

---

### Task 1: The cache policy and the app client built from it

**Files:**
- Create: `frontend/src/shared/api/cachePolicy.ts`
- Create: `frontend/src/shared/api/cachePolicy.test.tsx`
- Modify: `frontend/src/shared/api/queryClient.ts` (whole file)

**Interfaces:**
- Consumes: `queryKeys` from `frontend/src/shared/api/queryKeys.ts`.
- Produces: `createQueryClient(): QueryClient` exported from `frontend/src/shared/api/cachePolicy.ts`; `queryClient` in `queryClient.ts` is now `createQueryClient()`. `STALE` is still exported from `queryClient.ts` at the end of this task (Task 2 removes it).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/shared/api/cachePolicy.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  QueryClientProvider,
  focusManager,
  useMutation,
  useQuery,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createQueryClient } from './cachePolicy';
import { queryClient } from './queryClient';
import { queryKeys } from './queryKeys';

const HOUR = 60 * 60_000;

function wrapperFor(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function mount(client: QueryClient, queryKey: QueryKey, queryFn: () => Promise<string>) {
  return renderHook(() => useQuery({ queryKey, queryFn }), { wrapper: wrapperFor(client) });
}

afterEach(() => focusManager.setFocused(undefined));

describe('createQueryClient — nothing is cached unless its key is allowlisted', () => {
  it.each([
    ['intakes', [...queryKeys.intakes, { shiftId: 's1' }]],
    ['point-cash', [...queryKeys.pointCash, 'one', 'p1', null]],
    // Near misses: look like catalog keys, are not on the list.
    ['grade-prices', [...queryKeys.gradePrices, 'p1']],
    ['collection-points', [...queryKeys.collectionPoints, 'options']],
  ])('%s: refetches on every mount and is dropped once unmounted', async (_label, key) => {
    const client = createQueryClient();
    const fn = vi.fn(async () => 'rows');

    const first = mount(client, key, fn);
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();
    await waitFor(() => expect(client.getQueryCache().find({ queryKey: key })).toBeUndefined());

    const second = mount(client, key, fn);
    // No previous visit's figure on screen while the fresh one loads.
    expect(second.result.current.data).toBeUndefined();
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['me', queryKeys.me],
    ['tare-types (leaf)', [...queryKeys.tareTypes, 'options']],
    ['products', queryKeys.products],
    ['product-grades (leaf)', [...queryKeys.productGrades(), 'active']],
    ['product-grades (per product)', queryKeys.productGrades('prod-1')],
  ])('%s: is served from cache on remount inside its window', async (_label, key) => {
    const client = createQueryClient();
    const fn = vi.fn(async () => 'value');

    const first = mount(client, key, fn);
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    first.unmount();

    const second = mount(client, key, fn);
    expect(second.result.current.data).toBe('value');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('refetches a key off the allowlist when the window regains focus', async () => {
    const client = createQueryClient();
    const key = [...queryKeys.pointCash, 'one', 'p1', null];
    const fn = vi.fn(async () => '100.00');

    const view = mount(client, key, fn);
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });

  it('does not refetch an allowlisted key on focus inside its window', async () => {
    const client = createQueryClient();
    const key = [...queryKeys.tareTypes, 'options'];
    const fn = vi.fn(async () => 'tares');

    const view = mount(client, key, fn);
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps a key alive while another screen still reads it', async () => {
    const client = createQueryClient();
    const key = [...queryKeys.pointCash, 'one', 'p1', null];
    const fn = vi.fn(async () => '100.00');

    const form = mount(client, key, fn);
    const panel = mount(client, key, fn);
    await waitFor(() => expect(panel.result.current.isSuccess).toBe(true));
    form.unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(client.getQueryCache().find({ queryKey: key })).toBeDefined();
    expect(panel.result.current.data).toBe('100.00');
  });

  it("forgets a settled mutation's data once nothing observes it", async () => {
    const client = createQueryClient();
    const view = renderHook(() => useMutation({ mutationFn: async () => 'plaintext' }), {
      wrapper: wrapperFor(client),
    });
    await act(() => view.result.current.mutateAsync());
    view.unmount();
    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
  });
});

describe('queryClient', () => {
  it('is the app client, built by the policy', () => {
    expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(0);
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(0);
    // The persister needs gcTime >= its 24h maxAge for the one key it keeps.
    expect(queryClient.getQueryDefaults(queryKeys.me).gcTime).toBe(24 * HOUR);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/shared/api/cachePolicy.test.tsx`
Expected: FAIL — `Failed to resolve import "./cachePolicy"`.

- [ ] **Step 3: Write the policy**

Create `frontend/src/shared/api/cachePolicy.ts`:

```ts
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';

/**
 * WHAT MAY BE CACHED — the one list, default-deny, the same shape as the
 * persister's `isPersistableKey`. A key is matched by PREFIX
 * (`setQueryDefaults`), so `['product-grades', 'active']` rides on
 * `queryKeys.productGrades()`.
 *
 * Only data that changes rarely and by the owner's hand belongs here. Money
 * and documents never do: `/reception` showed a drawer, receipts and prices
 * five minutes old because each hook used to pick its own window. Points are
 * left off on purpose — their row carries `target_crates`, a live figure.
 * Adding a key is the decision; nothing else in `src` may set a freshness
 * option (eslint `no-restricted-syntax`).
 */
const CACHEABLE_KEYS: readonly (readonly unknown[])[] = [
  queryKeys.me,
  queryKeys.tareTypes,
  queryKeys.products,
  queryKeys.productGrades(),
];

const CACHED_STALE_MS = 30 * 60_000;
/** Not shorter than the persister's `maxAge` — it keeps `me` across reloads. */
const CACHED_GC_MS = 24 * 60 * 60_000;

/**
 * The app's `QueryClient`. Everything off `CACHEABLE_KEYS` is stale on
 * arrival, refetched on every mount and on window focus, and dropped the
 * moment nothing reads it — so returning to a screen shows the loading state,
 * never a previous visit's figures. Mutations are dropped once unobserved
 * too: one mutation's `data` is a plaintext password
 * (`useRevealPasswordMutation`).
 */
export function createQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 0,
        gcTime: 0,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
      },
      mutations: {
        gcTime: 0,
      },
    },
  });
  for (const queryKey of CACHEABLE_KEYS) {
    client.setQueryDefaults(queryKey, { staleTime: CACHED_STALE_MS, gcTime: CACHED_GC_MS });
  }
  return client;
}
```

- [ ] **Step 4: Build the app client from it**

Replace the `queryClient` definition in `frontend/src/shared/api/queryClient.ts`. Keep the `STALE` block exactly as it is for now (Task 2 deletes it); delete the `queryClient` doc comment and the `new QueryClient({...})` call and its `QueryClient` import, and add:

```ts
import { createQueryClient } from './cachePolicy';

/** The app's one client. Freshness is decided in `cachePolicy.ts`, nowhere else. */
export const queryClient = createQueryClient();
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/shared/api/cachePolicy.test.tsx`
Expected: PASS, 14 tests.

- [ ] **Step 6: Run the frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all test files pass (hooks still set their own `staleTime`; nothing else changes yet).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/shared/api/cachePolicy.ts frontend/src/shared/api/cachePolicy.test.tsx frontend/src/shared/api/queryClient.ts
git commit -m "feat(api): build the query client from an allowlist — nothing else is cached

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Forbid per-hook freshness, then strip it from every hook

**Files:**
- Modify: `frontend/eslint.config.mjs` (constants near the top; the raw-`<input>` block at lines 134-159)
- Create: `frontend/src/shared/api/cachePolicy.lint.test.ts`
- Modify: `frontend/src/shared/api/queryClient.ts`, `frontend/src/shared/api/index.ts`
- Modify (delete `staleTime`/`gcTime` and the then-unused `STALE` import): the 29 files listed in Step 6
- Modify comments: `features/count-shift/api/crateDispatch.ts`, `features/return-crates/api/useReturnCrates.ts`, `features/settle-payout/api/useCreatePayout.ts`, `pages/catalog/api/products.ts`, `pages/users/api/users.ts`, `entities/intake/api/useIntake.ts`, `entities/shift/api/useShifts.ts`, `entities/intake/api/useIntakes.ts`, `entities/payout/api/usePayouts.ts` (all under `frontend/src/`)

**Interfaces:**
- Consumes: `createQueryClient` from Task 1 (the lint rule exempts `src/shared/api/cachePolicy.ts` by path).
- Produces: `STALE` no longer exists; `shared/api/index.ts` exports `queryClient` only.

- [ ] **Step 1: Write the failing lint test**

Create `frontend/src/shared/api/cachePolicy.lint.test.ts`:

```ts
// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('../../../', import.meta.url)) });

async function restricted(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message);
}

const HOOK = "export const options = { queryKey: ['x'], staleTime: 1000 };\n";
const PAGE = 'export function Page() { return <div>{String({ gcTime: 0 })}</div>; }\n';
const APP = 'export const client = { refetchOnWindowFocus: false };\n';
const INPUT = 'export function Page() { return <input />; }\n';

describe('eslint — freshness is decided in cachePolicy.ts only', () => {
  it.each([
    ['an entity hook (.ts)', HOOK, 'src/entities/foo/api/useFoo.ts'],
    ['a page component (.tsx)', PAGE, 'src/pages/foo/ui/FooPage.tsx'],
    ['an app module (.tsx)', PAGE, 'src/app/Foo.tsx'],
    ['a shared module (.ts)', APP, 'src/shared/api/other.ts'],
  ])('forbids a freshness option in %s', async (_label, code, filePath) => {
    const messages = await restricted(code, filePath);
    expect(messages.some((m) => m.includes('cachePolicy.ts'))).toBe(true);
  });

  it.each([
    ['cachePolicy.ts itself', HOOK, 'src/shared/api/cachePolicy.ts'],
    ['a test file (.ts)', HOOK, 'src/entities/foo/api/useFoo.test.ts'],
    ['a test file (.tsx)', PAGE, 'src/pages/foo/ui/FooPage.test.tsx'],
  ])('allows it in %s', async (_label, code, filePath) => {
    expect(await restricted(code, filePath)).toEqual([]);
  });

  it.each([
    ['a page component', 'src/pages/foo/ui/FooPage.tsx'],
    ['a page test', 'src/pages/foo/ui/FooPage.test.tsx'],
  ])('still forbids a raw <input> in %s', async (_label, filePath) => {
    const messages = await restricted(INPUT, filePath);
    expect(messages.some((m) => m.includes('<TextInput>'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/shared/api/cachePolicy.lint.test.ts`
Expected: FAIL — the four "forbids a freshness option" cases (no rule yet). The "allows" and raw-`<input>` cases already pass.

- [ ] **Step 3: Add the rule**

In `frontend/eslint.config.mjs`, directly under the `STORAGE_MESSAGE` constant, add:

```js
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
```

In the existing raw-`<input>` block, replace its inline selector object with the constant, so its `rules` reads:

```js
    rules: {
      'no-restricted-syntax': ['error', RAW_INPUT_RESTRICTION],
    },
```

Immediately AFTER that block (before the first `forbidLayers` block), add two blocks:

```js
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
```

- [ ] **Step 4: Run the lint test to verify it passes**

Run: `cd frontend && npx vitest run src/shared/api/cachePolicy.lint.test.ts`
Expected: PASS, 9 tests. If ESLint's first construction is slow, do NOT raise a timeout — report the measured time instead.

- [ ] **Step 5: See the rule find every hook**

Run: `npm run lint -w frontend 2>&1 | grep -c "cachePolicy.ts only"`
Expected: 39 — one per freshness property in a non-test file outside `shared/api` (counted
2026-09-24 with `grep -rnE "\b(staleTime|gcTime|refetchOnMount|refetchOnWindowFocus)\s*:" src`
minus tests, comments and `queryClient.ts`). A different number means a hook was added or
changed since; the next steps must take it to 0 either way.

- [ ] **Step 6: Delete every per-hook freshness option**

In each file below (paths under `frontend/src/`), delete every `staleTime: …,` line, and delete `import { STALE } from '@/shared/api/queryClient';` where `STALE` is then unused:

```
entities/cash-count/api/useCashCounts.ts
entities/collection-point/api/usePointOptions.ts
entities/cost-of-day/api/useCostOfDay.ts
entities/crate/api/useCrates.ts                 (5 lines)
entities/day-expense/api/useDayExpenses.ts
entities/intake-top-up/api/useIntakeTopUps.ts
entities/intake/api/useIntake.ts
entities/intake/api/useIntakes.ts
entities/payout/api/usePayouts.ts
entities/point-cash/api/usePointCash.ts         (2 lines)
entities/product-grade/api/useGradeCatalog.ts   (2 lines)
entities/product-grade/api/usePricedGrades.ts
entities/reweigh/api/useReweigh.ts
entities/shift/api/useShifts.ts                 (2 lines)
entities/supplier/api/useSupplierBalances.ts    (2 lines)
entities/supplier/api/useSuppliers.ts           (2 lines)
entities/tare-type/api/useTareTypeOptions.ts
entities/transfer/api/useTransfers.ts
entities/user/api/useStaff.ts
features/count-shift/api/crateDispatch.ts
features/return-crates/api/useReturnCrates.ts   (also delete `gcTime: 0,`; keep `retry: false`)
pages/catalog/api/productGrades.ts
pages/catalog/api/products.ts
pages/catalog/api/tareTypes.ts
pages/points/api/collectionPoints.ts
pages/prices/api/gradePrices.ts
pages/prices/api/priceChanges.ts
pages/prices/api/priceSheet.ts
pages/users/api/users.ts                        (`staleTime` line AND the mutation's `gcTime: 0,`)
```

- [ ] **Step 7: Rewrite the comments that described a window**

All under `frontend/src/`. Replace exactly:

`features/count-shift/api/crateDispatch.ts` — the eight-line comment above the deleted `staleTime: 0,` (from `// НЕ успадковувати 30-секундний` through `// діалогу — свіжий запит.`) becomes:

```ts
    // Свіжість тут не налаштовується: `queryKeys.crates` поза allowlist
    // `shared/api/cachePolicy.ts`, тож кожне відкриття діалогу — свіжий запит,
    // хоча жодна мутація квитанції цей ключ не інвалідовує (§6.8).
```

`features/return-crates/api/useReturnCrates.ts` — in the doc comment, `keyed by them, and \`gcTime: 0\` because a stale` / `preview is a wrong number about money.` becomes:

```ts
 * once both inputs are real, keyed by them, and never cached (`queryKeys.crates`
 * is off `shared/api/cachePolicy.ts`'s allowlist) because a stale preview is a
 * wrong number about money.
```

(keep the preceding `A POST that writes nothing, so it is modelled as a query: \`enabled\` only` line as is.)

`features/settle-payout/api/useCreatePayout.ts` — `for \`STALE.list\` after the operator walks back from «Борги».` becomes `for as long as they stay mounted.`

`pages/catalog/api/products.ts` — `nothing to include. \`STALE.reference\`: a berry catalog changes a few times a` / `season.` becomes:

```ts
 * nothing to include. Cached: `queryKeys.products` is on `shared/api/cachePolicy.ts`'s
 * allowlist — a berry catalog changes a few times a season.
```

`pages/users/api/users.ts` — the four-line comment above the deleted mutation `gcTime: 0,` becomes:

```ts
    // No retention window: `shared/api/cachePolicy.ts` gives every mutation
    // `gcTime: 0`, so a settled mutation's `data` — here, a plaintext password —
    // is forgotten once unobserved. The caller still calls `reset()` when the
    // row closes.
```

`entities/intake/api/useIntake.ts` — the paragraph starting `` * `STALE.detail` — a receipt is immutable`` (three lines) becomes:

```ts
 * Not cached (`shared/api/cachePolicy.ts`): a receipt is immutable once written
 * (§2.7: `amount` never changes after posting), but a fresh void could land
 * seconds later.
```

`entities/shift/api/useShifts.ts` — delete the line `// A shift changes by the operator's own action, which invalidates; 30s covers a second tab.`; in the doc comment, `this exact queryKey/queryFn/staleTime without duplicating the fetcher.` becomes `this exact queryKey/queryFn without duplicating the fetcher.`

`entities/intake/api/useIntakes.ts` and `entities/payout/api/usePayouts.ts` — `can share this exact queryKey/queryFn/staleTime` becomes `can share this exact queryKey/queryFn`.

- [ ] **Step 8: Remove `STALE`**

In `frontend/src/shared/api/queryClient.ts`, delete the `STALE` constant and its doc comment, leaving only the Task 1 import and `export const queryClient = createQueryClient();`.
In `frontend/src/shared/api/index.ts`, change `export { queryClient, STALE } from './queryClient';` to `export { queryClient } from './queryClient';`.

- [ ] **Step 9: Verify nothing still decides freshness outside the policy**

Run: `cd frontend && grep -rnE "\bSTALE\b|staleTime|gcTime|refetchOnMount|refetchOnWindowFocus" src | grep -v "\.test\." | grep -v "src/shared/api/cachePolicy.ts"`
Expected: exactly two lines, both prose — the rewritten `users.ts` comment containing
`` `gcTime: 0` `` and `pages/reception/lib/useIntakePreview.ts`'s «a STALE response» doc
line. Any other hit is an option or a stale comment still to remove.

- [ ] **Step 10: Lint, typecheck, tests**

Run: `npm run lint -w frontend && npm run typecheck -w frontend && (cd frontend && npx vitest run)`
Expected: lint 0 problems; typecheck (`tsc -b`) clean — Vitest does not typecheck, so a
green suite alone proves nothing about the deleted `STALE` imports; every test file passes.

- [ ] **Step 11: Commit**

```bash
git add frontend/eslint.config.mjs frontend/src
git commit -m "refactor(api): no hook decides its own freshness — lint keeps it in cachePolicy

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Docs, follow-ups, test wording, verification

**Files:**
- Modify: `frontend/CLAUDE.md` («Server state» first paragraph)
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (append)
- Modify: `frontend/src/features/settle-payout/api/useCreatePayout.test.tsx:36-37`, `frontend/src/pages/cost-of-day/ui/CostOfDayPage.test.tsx:92-94`

**Interfaces:**
- Consumes: the finished Tasks 1–2.
- Produces: nothing code-facing.

- [ ] **Step 1: Rewrite «Server state» in `frontend/CLAUDE.md`**

Replace the paragraph that begins `` `shared/api/queryClient.ts` exports the shared `QueryClient` `` and ends `rather than hand-writing a duration.` with:

```markdown
**Nothing is cached unless its query key is on one allowlist.** `shared/api/cachePolicy.ts`'s `createQueryClient()` builds the app's client (`shared/api/queryClient.ts`, wired via `PersistQueryClientProvider` in `App.tsx`): every query is stale on arrival (`staleTime: 0`), refetched on every mount and on window focus, and dropped the moment nothing reads it (`gcTime: 0`); mutations are dropped once unobserved too. `CACHEABLE_KEYS` there grants 30 min / 24h to exactly `me`, `tareTypes`, `products` and `productGrades()` (prefix match). Freshness is a property of the KEY, not the route — one key is one cache entry whichever screen reads it. A hook never sets `staleTime`, `gcTime`, `refetchOnMount` or `refetchOnWindowFocus`: eslint forbids them outside `cachePolicy.ts` (tests exempt); to cache something, add its key to the list. `retry: 1` is unchanged. Spec: `docs/superpowers/specs/2026-09-24-query-cache-allowlist-design.md`.
```

- [ ] **Step 2: Append the follow-ups**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`:

```markdown

## Deferred from the query cache allowlist (2026-09-24)

- **Polling an always-focused screen.** The allowlist refetches on mount and on window focus, so an operator who never leaves `/reception` still does not see the owner's void, transfer or dispute resolution from another device until they switch tabs or navigate. Candidate: `refetchInterval` (~30 s, visible tab only) on reception's live reads — the drawer, the shift's intakes/payouts, the current shift. It needs a home in `cachePolicy.ts`, since hooks may not set freshness options.
- **An intake create or void does not invalidate `crateBalances`.** `/crates`' «з ягодою» reads live intakes (`GET /crate-standing`), but neither `useCreateIntakeMutation` nor `useVoidDocumentMutation`'s intake entry invalidates `queryKeys.crateBalances`. Since the allowlist it only survives while `/crates` stays mounted, but it is still wrong there.
```

- [ ] **Step 3: Fix the two test comments**

`frontend/src/features/settle-payout/api/useCreatePayout.test.tsx` — replace

```ts
    // A payout is a term of the drawer formula: «Каса точки» must not keep
    // the pre-payout `cash` for `STALE.list` after the operator walks back.
```

with

```ts
    // A payout is a term of the drawer formula: whatever screen still shows
    // «Каса точки» must refetch its `cash`, not keep the pre-payout figure.
```

`frontend/src/pages/cost-of-day/ui/CostOfDayPage.test.tsx` — replace `date whose queries are already cached (gcTime is 24h, so \`isPending\`` with `date whose queries are still in this test's cache (its own client keeps them; the app's cachePolicy drops them, but the key below must not depend on that — so \`isPending\``, then re-flow the comment to the file's width with prettier (Step 4).

- [ ] **Step 4: Format and run the fast tier**

Run: `npx prettier --write frontend/src/pages/cost-of-day/ui/CostOfDayPage.test.tsx frontend/src/features/settle-payout/api/useCreatePayout.test.tsx && npm run verify`
Expected: the verdict line ends `ok=true`. Paste it. Name any `SKIPPED` row aloud.

- [ ] **Step 5: Commit**

```bash
git add frontend/CLAUDE.md docs/superpowers/2026-09-05-foundation-slice-follow-ups.md frontend/src/features/settle-payout/api/useCreatePayout.test.tsx frontend/src/pages/cost-of-day/ui/CostOfDayPage.test.tsx
git commit -m "docs(api): the cache allowlist in frontend/CLAUDE.md; polling and crateBalances as follow-ups

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
