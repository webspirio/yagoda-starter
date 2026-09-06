# Catalog Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the network owner one `/catalog` screen with three tabs for creating and editing products, product grades and tare types.

**Architecture:** Everything lives in `pages/catalog/` — no new `entities/` slices. Each resource is a tab (a table plus an "Add" button) and a dialog serving both create and edit. Server state is TanStack Query copying `useMeQuery`'s shape; forms are `react-hook-form` with built-in rules; the one piece of real logic is mapping a failed mutation's `ApiError` onto individual form fields.

**Tech Stack:** React 19, TypeScript (strict), Vite, TanStack Query v5, React Router v8, react-hook-form, Tailwind v4 + shadcn/ui, react-i18next, Vitest + Testing Library + axios-mock-adapter.

**Spec:** `docs/superpowers/specs/2026-09-06-catalog-admin-ui-slice.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **`weight_kg` and `deposit_price` are STRINGS in every layer** — input value, form state, request body. **Never `<input type="number">`, never `valueAsNumber`, never arithmetic.** Use `inputMode="decimal"` on a text input. A number input returns a coerced value and breaks the project's money rule at the first keystroke.
- **FSD import direction is ESLint-enforced** (`no-restricted-imports` in `eslint.config.mjs`): `shared < entities < features < pages < app`. An upward import fails lint.
- **A slice is imported through its `index.ts`**, never by reaching into internal files.
- **Every user-visible string goes through `t()`** into `src/shared/lib/i18n/locales/en.json`. English only this slice.
- **`Field`'s `error` prop takes an i18n KEY**, not a message — `Field` resolves it with `t()` internally. So every react-hook-form validation `message` in this slice is an i18n key string like `'catalog.errors.nameRequired'`.
- **Reads use `STALE.reference`** imported from `@/shared/api/queryClient` — never a hand-written duration.
- **Mutations invalidate their list query; they never `setQueryData` onto it.** The response is one row inside a paginated collection, and splicing it in by hand is how a cache goes subtly wrong.
- **No pagination controls, and no `page`/`limit` in requests.** The API defaults to `limit=100` for these bounded catalogs.
- **No `DELETE` anywhere.** Deactivation via `is_active` is the only removal verb, and products do not have even that.
- **Tests mock HTTP with `axios-mock-adapter` against the shared `httpClient`**, and call `attachAuthInterceptors(httpClient, sessionAuthHooks)` **once at module scope, never in `beforeEach`** — it is not idempotent, and a second attachment collapses every error status to 0. Copy the comment from `pages/profile/ui/ProfilePage.test.tsx`.
- **Do NOT add catalog keys to `shared/api/persister.ts`.** Its `isPersistableKey` allowlists only the `me` query, deliberately: this data is owner-edited and a stale copy restored across sessions buys nothing.
- **Dialog behaviour is tested through its tab's spec, not a separate dialog spec.** The design doc's §10 lists "one dialog spec per resource"; testing the dialog through the tab that owns it covers the same behaviour AND proves the wiring between them, which a dialog-only spec cannot. Deliberate, not an omission.
- **Commit after every task**, conventional-commit prefixes.
- Run from `frontend/`: `npm test`, `npm run lint`, `npm run build`.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/pages/catalog/lib/apiErrorToFields.ts` | Map an `ApiError` onto react-hook-form field errors; return the leftover form-level key. |
| `src/pages/catalog/lib/apiErrorToFields.test.ts` | Its spec. |
| `src/features/auth/ui/RequireRole.tsx` | Route guard on role, tolerating the pending `me` query. |
| `src/features/auth/ui/RequireRole.test.tsx` | Its spec. |
| `src/pages/catalog/model/product.ts` | `Product`, `ProductFormValues`. |
| `src/pages/catalog/model/productGrade.ts` | `ProductGrade`, `ProductGradeFormValues`. |
| `src/pages/catalog/model/tareType.ts` | `TareType`, `TareTypeFormValues`. |
| `src/pages/catalog/api/products.ts` | `useProductsQuery`, `useCreateProductMutation`, `useUpdateProductMutation`. |
| `src/pages/catalog/api/productGrades.ts` | Same three for grades. |
| `src/pages/catalog/api/tareTypes.ts` | Same three for tare types. |
| `src/pages/catalog/ui/ProductsTab.tsx` + `ProductFormDialog.tsx` | Products table and its form. |
| `src/pages/catalog/ui/GradesTab.tsx` + `GradeFormDialog.tsx` | Grades table, product filter, and its form. |
| `src/pages/catalog/ui/TareTypesTab.tsx` + `TareTypeFormDialog.tsx` | Tare types table and its form. |
| `src/pages/catalog/ui/*.test.tsx` | One spec per tab. |
| `src/pages/catalog/ui/CatalogPage.tsx` + `CatalogPage.test.tsx` | Tabs shell, `?tab=` state. |
| `src/pages/catalog/index.ts` | Public API — `CatalogPage` only. |

**Modified:**

| File | Change |
|---|---|
| `src/shared/api/queryKeys.ts` | Catalog keys. |
| `src/shared/lib/i18n/locales/en.json` | A `catalog` block. |
| `src/features/auth/index.ts` | Export `RequireRole`. |
| `src/app/router.tsx` | The `/catalog` route. |
| `src/app/layouts/AppLayout.tsx` | Role-filtered nav entry. |

---

## Task 1: `apiErrorToFields`

The only real logic in the slice. Pure, dependency-free, and every dialog leans on it — so it is built and proven first.

**Files:**
- Create: `frontend/src/pages/catalog/lib/apiErrorToFields.ts`
- Test: `frontend/src/pages/catalog/lib/apiErrorToFields.test.ts`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`

**Interfaces:**
- Produces: `apiErrorToFields(error: unknown, fields: readonly string[]): { fieldErrors: Array<{ field: string; messageKey: string }>; formErrorKey: string | null }`. Tasks 3–5 call it in every mutation `onError`.

- [ ] **Step 1: Add the error i18n keys**

In `frontend/src/shared/lib/i18n/locales/en.json`, add a `catalog` block (the tabs and forms extend it in later tasks — add exactly this now):

```json
"catalog": {
  "errors": {
    "nameRequired": "Name is required",
    "nameTooLong": "Name must be 128 characters or fewer",
    "nameTaken": "That name is already taken",
    "nameEmpty": "Name cannot be blank",
    "productRequired": "Choose a product",
    "weightFormat": "Use a number with up to 2 decimals, e.g. 1.20",
    "depositFormat": "Use a number with up to 2 decimals, e.g. 120.00",
    "saveFailed": "Could not save. Please try again."
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `frontend/src/pages/catalog/lib/apiErrorToFields.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '@/shared/api';
import { apiErrorToFields } from './apiErrorToFields';

const FIELDS = ['name', 'weight_kg', 'deposit_price'] as const;

/** ApiError's constructor is exercised through a helper so each test reads as
 *  the server response it stands for, not as constructor plumbing. */
const apiError = (init: { status: number; code?: string; details?: string[] }) =>
  // Verified signature: ApiError(status, message, details?, code?, payload?, reason?)
  new ApiError(init.status, 'Request failed', init.details, init.code);

describe('apiErrorToFields', () => {
  it('puts a 409 name conflict on the name field, not in the banner', () => {
    const result = apiErrorToFields(apiError({ status: 409, code: 'PRODUCT_NAME_TAKEN' }), FIELDS);
    expect(result.fieldErrors).toEqual([{ field: 'name', messageKey: 'catalog.errors.nameTaken' }]);
    expect(result.formErrorKey).toBeNull();
  });

  // The three services use three different prefixes for the same condition.
  it.each(['PRODUCT_NAME_TAKEN', 'GRADE_NAME_TAKEN', 'TARE_TYPE_NAME_TAKEN'])(
    'recognises %s',
    (code) => {
      const result = apiErrorToFields(apiError({ status: 409, code }), FIELDS);
      expect(result.fieldErrors[0]).toEqual({
        field: 'name',
        messageKey: 'catalog.errors.nameTaken',
      });
    },
  );

  it.each(['PRODUCT_NAME_EMPTY', 'GRADE_NAME_EMPTY', 'TARE_TYPE_NAME_EMPTY'])(
    'recognises %s',
    (code) => {
      const result = apiErrorToFields(apiError({ status: 400, code }), FIELDS);
      expect(result.fieldErrors[0]).toEqual({
        field: 'name',
        messageKey: 'catalog.errors.nameEmpty',
      });
    },
  );

  // class-validator emits "<property> <complaint>" strings; the property is the
  // first token. This is what ApiError.details exists to carry.
  it('maps class-validator details onto fields by their leading property name', () => {
    const result = apiErrorToFields(
      apiError({
        status: 400,
        details: [
          'weight_kg must be a decimal string with at most 2 decimal places',
          'name must be shorter than or equal to 128 characters',
        ],
      }),
      FIELDS,
    );
    expect(result.fieldErrors).toEqual([
      { field: 'weight_kg', messageKey: 'catalog.errors.weightFormat' },
      { field: 'name', messageKey: 'catalog.errors.nameTooLong' },
    ]);
    expect(result.formErrorKey).toBeNull();
  });

  it('sends a detail naming an unknown property to the form level', () => {
    const result = apiErrorToFields(
      apiError({ status: 400, details: ['collection_point_id must be a UUID'] }),
      FIELDS,
    );
    expect(result.fieldErrors).toEqual([]);
    expect(result.formErrorKey).toBe('catalog.errors.saveFailed');
  });

  it('sends an unrecognised failure to the form level', () => {
    const result = apiErrorToFields(apiError({ status: 500 }), FIELDS);
    expect(result.fieldErrors).toEqual([]);
    expect(result.formErrorKey).toBe('catalog.errors.saveFailed');
  });

  it('handles something that is not an ApiError at all', () => {
    const result = apiErrorToFields(new Error('network down'), FIELDS);
    expect(result.fieldErrors).toEqual([]);
    expect(result.formErrorKey).toBe('catalog.errors.saveFailed');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/catalog/lib/apiErrorToFields.test.ts`
Expected: FAIL — cannot resolve `./apiErrorToFields`.

- [ ] **Step 4: Write the implementation**

Create `frontend/src/pages/catalog/lib/apiErrorToFields.ts`:

```ts
import { ApiError } from '@/shared/api';

/**
 * Turns a failed catalog mutation into per-field form errors.
 *
 * This exists because TWO of the backend's rules cannot be checked on the
 * client at all: "that name is taken" is a `lower(name)` index lookup, and for
 * a grade it is scoped per product. The client cannot know either without
 * asking, so the server's answer has to land under the offending input rather
 * than in a banner the user must map onto a field themselves.
 *
 * Returned rather than applied: the caller owns the form, and a pure function
 * is testable without rendering one.
 *
 * Every `messageKey` is an i18n KEY, not a message — `Field` resolves it with
 * `t()` internally, so handing it a human string would render that string as a
 * missing key.
 *
 * Kept page-local rather than in `shared/lib`: three dialogs use it, but all
 * three are one page, and FSD's threshold is multiple *places*. It moves to
 * `shared/lib/` the moment the users or points screen needs it.
 */
export interface ApiFieldErrors {
  fieldErrors: Array<{ field: string; messageKey: string }>;
  /** Non-null when something could not be attributed to a field. */
  formErrorKey: string | null;
}

const FORM_LEVEL = 'catalog.errors.saveFailed';

/**
 * The three catalog services each prefix their codes with their own resource
 * name (`PRODUCT_`, `GRADE_`, `TARE_TYPE_`), so match the SUFFIX. Matching
 * whole codes would need nine entries and would silently miss the fourth
 * resource the next slice adds.
 */
const CODE_SUFFIX_TO_MESSAGE: ReadonlyArray<[string, string]> = [
  ['_NAME_TAKEN', 'catalog.errors.nameTaken'],
  ['_NAME_EMPTY', 'catalog.errors.nameEmpty'],
];

/**
 * class-validator emits `"<property> <complaint>"`. The complaint text is not
 * stable enough to match on, so this maps the PROPERTY to the one message that
 * property can fail with in these forms — each field has exactly one rule the
 * server enforces beyond presence.
 */
const PROPERTY_TO_MESSAGE: Readonly<Record<string, string>> = {
  name: 'catalog.errors.nameTooLong',
  weight_kg: 'catalog.errors.weightFormat',
  deposit_price: 'catalog.errors.depositFormat',
};

export function apiErrorToFields(error: unknown, fields: readonly string[]): ApiFieldErrors {
  if (!(error instanceof ApiError)) return { fieldErrors: [], formErrorKey: FORM_LEVEL };

  // Branch on the machine-readable code first, never on the human message —
  // the same convention LoginForm follows.
  if (error.code) {
    const matched = CODE_SUFFIX_TO_MESSAGE.find(([suffix]) => error.code!.endsWith(suffix));
    if (matched && fields.includes('name')) {
      return { fieldErrors: [{ field: 'name', messageKey: matched[1] }], formErrorKey: null };
    }
  }

  const fieldErrors: Array<{ field: string; messageKey: string }> = [];
  let unattributed = false;

  for (const detail of error.details ?? []) {
    // The property is the first token; class-validator always leads with it.
    const property = detail.split(' ')[0];
    const messageKey = PROPERTY_TO_MESSAGE[property];
    if (messageKey && fields.includes(property)) {
      fieldErrors.push({ field: property, messageKey });
    } else {
      // A detail we cannot place must NOT vanish. Silently dropping it would
      // leave the dialog looking like the save succeeded quietly.
      unattributed = true;
    }
  }

  if (fieldErrors.length > 0) {
    return { fieldErrors, formErrorKey: unattributed ? FORM_LEVEL : null };
  }
  return { fieldErrors: [], formErrorKey: FORM_LEVEL };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/pages/catalog/lib/apiErrorToFields.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/catalog/lib frontend/src/shared/lib/i18n/locales/en.json
git commit -m "feat: map catalog API errors onto form fields"
```

---

## Task 2: `RequireRole`

**Files:**
- Create: `frontend/src/features/auth/ui/RequireRole.tsx`
- Test: `frontend/src/features/auth/ui/RequireRole.test.tsx`
- Modify: `frontend/src/features/auth/index.ts`

**Interfaces:**
- Produces: `<RequireRole role="network_owner">{children}</RequireRole>`, exported from `@/features/auth`. Task 6 wraps the `/catalog` route in it.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/features/auth/ui/RequireRole.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks, useSession } from '@/entities/user';

// Attached ONCE at module scope, never in beforeEach: `httpClient` is a shared
// axios singleton and `attachAuthInterceptors` is NOT idempotent — a second
// attachment stacks a handler that receives the first's ApiError (no
// `.response`), collapsing every status to 0.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { RequireRole } from './RequireRole';

const me = (role: 'network_owner' | 'point_operator') => ({
  id: 'u1',
  username: 'alice',
  display_name: 'Alice',
  avatar_url: null,
  language_code: null,
  role,
  collection_point_id: role === 'point_operator' ? 'p1' : null,
});

let mock: MockAdapter;

const renderGuarded = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/catalog',
        element: (
          <RequireRole role="network_owner">
            <p>secret catalog</p>
          </RequireRole>
        ),
      },
      { path: '/', element: <p>dashboard</p> },
    ],
    { initialEntries: ['/catalog'] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('RequireRole', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
    useSession.setState({ token: 'tok' });
  });

  afterEach(() => {
    mock.restore();
    useSession.setState({ token: null });
  });

  it('renders children for the required role', async () => {
    mock.onGet('/me').reply(200, me('network_owner'));
    renderGuarded();
    expect(await screen.findByText('secret catalog')).toBeInTheDocument();
  });

  it('redirects a user with the wrong role', async () => {
    mock.onGet('/me').reply(200, me('point_operator'));
    renderGuarded();
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
    expect(screen.queryByText('secret catalog')).not.toBeInTheDocument();
  });

  // THE REASON THIS COMPONENT EXISTS. Role is not in the JWT — the payload is
  // `{ sub }` — so it arrives from the `me` query. A guard that redirects
  // synchronously would bounce an owner to the dashboard on every cold load of
  // /catalog, for one frame, and the bug would be near-impossible to reproduce
  // by hand.
  it('redirects nobody while the me query is still in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mock.onGet('/me').reply(async () => {
      await gate;
      return [200, me('network_owner')];
    });

    renderGuarded();

    expect(screen.queryByText('secret catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();

    release();
    expect(await screen.findByText('secret catalog')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/features/auth/ui/RequireRole.test.tsx`
Expected: FAIL — cannot resolve `./RequireRole`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/features/auth/ui/RequireRole.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMeQuery, type UserRole } from '@/entities/user';
import { Spinner } from '@/shared/ui/spinner';

/**
 * Route guard on ROLE, to be composed inside `RequireAuth` — which handles the
 * "no token at all" case and redirects to /login.
 *
 * IT CANNOT MIRROR `RequireAuth`, AND THE REASON IS LOAD-BEARING. `RequireAuth`
 * decides synchronously, because the token is in a Zustand store read from
 * localStorage. Role is NOT in the token: the JWT payload is `{ sub }` and
 * nothing else, deliberately, so that nothing inside it can go stale while a
 * user is demoted or reassigned. Role therefore arrives from the `me` query,
 * which on a cold load is still in flight when this first renders.
 *
 * So a pending query renders a spinner and redirects NOBODY. Redirecting on
 * "role is not yet network_owner" would bounce an owner to the dashboard for
 * one frame on every hard refresh of a guarded route.
 *
 * This is UX, not enforcement. Every write the guarded screens make is
 * `@Auth(UserRole.NetworkOwner)` server-side and 403s regardless of what the
 * client chose to render.
 */
export function RequireRole({ role, children }: { role: UserRole; children: ReactNode }) {
  const { data: me, isPending } = useMeQuery();

  if (isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (me?.role !== role) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 4: Export it from the slice's public API**

In `frontend/src/features/auth/index.ts`, add `RequireRole` alongside the existing `RequireAuth` export, following that file's existing style.

- [ ] **Step 5: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/features/auth/ui/RequireRole.test.tsx`
Expected: PASS, all three cases.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/auth
git commit -m "feat: role-aware route guard that tolerates the pending me query"
```

---

## Task 3: Products tab and dialog

The first vertical slice: model, query keys, API hooks, table, dialog. Tasks 4 and 5 mirror its shape, so get it right here.

**Files:**
- Create: `frontend/src/pages/catalog/model/product.ts`
- Create: `frontend/src/pages/catalog/api/products.ts`
- Create: `frontend/src/pages/catalog/ui/ProductsTab.tsx`
- Create: `frontend/src/pages/catalog/ui/ProductFormDialog.tsx`
- Test: `frontend/src/pages/catalog/ui/ProductsTab.test.tsx`
- Modify: `frontend/src/shared/api/queryKeys.ts`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`

**Interfaces:**
- Consumes: `apiErrorToFields` (Task 1).
- Produces: `Product { id: string; name: string; created_at: string }`; `Paginated<T> { data: T[]; total: number; page: number; limit: number }`; `useProductsQuery()`; `<ProductsTab />`. Task 4 imports `Product` and `useProductsQuery` to render the product column and the create-time `Select`.

- [ ] **Step 1: Add the query keys**

Replace `frontend/src/shared/api/queryKeys.ts` with:

```ts
export const queryKeys = {
  me: ['me'] as const,
  products: ['products'] as const,
  /** Parameterised: the grades tab filters by product, and two filters must
   *  never share one cache entry. */
  productGrades: (productId?: string) => ['product-grades', productId ?? 'all'] as const,
  tareTypes: ['tare-types'] as const,
};
```

- [ ] **Step 2: Add the products i18n keys**

In `en.json`, extend the `catalog` block created in Task 1 with these siblings of `errors`:

```json
"title": "Catalog",
"tabs": { "products": "Products", "grades": "Grades", "tareTypes": "Tare types" },
"truncated": "Showing {{shown}} of {{total}}. Some rows are not listed.",
"products": {
  "add": "Add product",
  "empty": "No products yet.",
  "name": "Name",
  "createTitle": "New product",
  "editTitle": "Edit product"
},
"actions": { "edit": "Edit", "save": "Save", "cancel": "Cancel" },
"saved": "Saved"
```

- [ ] **Step 3: Write the model**

Create `frontend/src/pages/catalog/model/product.ts`:

```ts
/**
 * Mirrors the backend's `ProductResponse`. There is deliberately NO
 * `is_active`: a product's visibility is DERIVED from whether it has any
 * active grade (§4.1 of the domain rules), so the column does not exist and no
 * form may invent one.
 */
export interface Product {
  id: string;
  name: string;
  created_at: string;
}

/** The API's list envelope, shared by all three catalogs. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ProductFormValues {
  name: string;
}
```

- [ ] **Step 4: Write the API hooks**

Create `frontend/src/pages/catalog/api/products.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated, Product, ProductFormValues } from '../model/product';

/**
 * Copies `useMeQuery`'s shape — queryKey, queryFn through `httpClient`.
 *
 * `STALE.reference` (30 min), not a hand-written duration: a berry catalog
 * changes a few times a season, which is exactly what that constant is for.
 *
 * No `page`/`limit` is sent. The API defaults these bounded catalogs to
 * `limit=100`; the caller checks `total` against `data.length` and warns
 * rather than paginating.
 */
export function useProductsQuery() {
  return useQuery({
    queryKey: queryKeys.products,
    queryFn: async (): Promise<Paginated<Product>> => {
      const { data } = await httpClient.get<Paginated<Product>>('/products');
      return data;
    },
    staleTime: STALE.reference,
  });
}

/**
 * INVALIDATES the list rather than seeding it with `setQueryData`.
 *
 * `useUpdateMeMutation` seeds because its response IS the whole resource.
 * Here the response is one row inside a collection, so seeding would mean
 * splicing by hand — inserting at the right sort position, honouring the
 * active filter, keeping `total` truthful. That is how a cache goes quietly
 * wrong. These lists are at most 100 rows behind a 30-minute stale window.
 */
export function useCreateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductFormValues): Promise<Product> => {
      const { data } = await httpClient.post<Product>('/products', input);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.products }),
  });
}

export function useUpdateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: ProductFormValues & { id: string }): Promise<Product> => {
      const { data } = await httpClient.patch<Product>(`/products/${id}`, input);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.products }),
  });
}
```

- [ ] **Step 5: Write the failing test**

Create `frontend/src/pages/catalog/ui/ProductsTab.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx for why beforeEach
// would collapse every error status to 0.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { ProductsTab } from './ProductsTab';

let mock: MockAdapter;

const list = (data: unknown[], total = data.length) => ({ data, total, page: 1, limit: 100 });
const MALYNA = { id: 'p1', name: 'Малина', created_at: '2026-07-15T06:00:00.000Z' };

const renderTab = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProductsTab />
    </QueryClientProvider>,
  );
};

describe('ProductsTab', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
  });
  afterEach(() => mock.restore());

  it('lists products', async () => {
    mock.onGet('/products').reply(200, list([MALYNA]));
    renderTab();
    expect(await screen.findByText('Малина')).toBeInTheDocument();
  });

  it('shows an empty state rather than a bare table', async () => {
    mock.onGet('/products').reply(200, list([]));
    renderTab();
    expect(await screen.findByText('No products yet.')).toBeInTheDocument();
  });

  // The API caps these lists at 100. If the business ever exceeds that, a
  // silently short list means an owner cannot find a berry that exists.
  it('warns when the server returned fewer rows than it counted', async () => {
    mock.onGet('/products').reply(200, list([MALYNA], 140));
    renderTab();
    expect(await screen.findByRole('status')).toHaveTextContent('Showing 1 of 140');
  });

  it('creates a product and refetches the list', async () => {
    mock.onGet('/products').replyOnce(200, list([]));
    mock.onPost('/products').reply(201, MALYNA);
    mock.onGet('/products').reply(200, list([MALYNA]));

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Малина' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ name: 'Малина' });
    expect(await screen.findByText('Малина')).toBeInTheDocument();
  });

  // The conflict cannot be detected client-side: it is a lower(name) index
  // lookup. It must land under the input, not in a banner.
  it('puts a duplicate-name conflict under the name field', async () => {
    mock.onGet('/products').reply(200, list([]));
    mock.onPost('/products').reply(409, { message: 'That name is taken', code: 'PRODUCT_NAME_TAKEN' });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'малина' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That name is already taken')).toBeInTheDocument();
    // Still open, so the value can be corrected in place.
    expect(screen.getByLabelText('Name')).toHaveValue('малина');
  });

  it('edits an existing product through the same dialog', async () => {
    mock.onGet('/products').reply(200, list([MALYNA]));
    mock.onPatch('/products/p1').reply(200, { ...MALYNA, name: 'Полуниця' });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Малина' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Полуниця' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({ name: 'Полуниця' });
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/catalog/ui/ProductsTab.test.tsx`
Expected: FAIL — cannot resolve `./ProductsTab`.

- [ ] **Step 7: Write the dialog**

Create `frontend/src/pages/catalog/ui/ProductFormDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { toastSuccess } from '@/shared/ui/toast';
import { useCreateProductMutation, useUpdateProductMutation } from '../api/products';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { Product, ProductFormValues } from '../model/product';

const FIELDS = ['name'] as const;

/**
 * One dialog for create AND edit, told apart by whether `product` is null.
 *
 * They share every validation rule, and the backend deliberately gives create
 * and update DIFFERENT DTO shapes — so the difference belongs in one visible
 * mode flag rather than two components that drift apart.
 */
export function ProductFormDialog({
  open,
  product,
  onClose,
}: {
  open: boolean;
  product: Product | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateProductMutation();
  const update = useUpdateProductMutation();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({ defaultValues: { name: '' } });

  // Re-seed whenever the dialog opens: the component stays mounted between
  // openings, so without this an edit would show the previous row's values.
  useEffect(() => {
    if (open) {
      reset({ name: product?.name ?? '' });
      setFormError(null);
    }
  }, [open, product, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (product) await update.mutateAsync({ id: product.id, ...values });
      else await create.mutateAsync(values);
      toastSuccess(t('catalog.saved'));
      onClose();
    } catch (error) {
      const { fieldErrors, formErrorKey } = apiErrorToFields(error, FIELDS);
      for (const { field, messageKey } of fieldErrors) {
        setError(field as keyof ProductFormValues, { message: messageKey });
      }
      setFormError(formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(product ? 'catalog.products.editTitle' : 'catalog.products.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {/* `Field`'s `error` takes an i18n KEY and resolves it internally,
              which is why every RHF `message` in this slice is a key. */}
          <Field
            name="name"
            label={t('catalog.products.name')}
            required
            error={errors.name?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('name', {
                  required: 'catalog.errors.nameRequired',
                  maxLength: { value: 128, message: 'catalog.errors.nameTooLong' },
                })}
              />
            )}
          </Field>

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('catalog.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('catalog.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: Write the tab**

Create `frontend/src/pages/catalog/ui/ProductsTab.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Skeleton } from '@/shared/ui/skeleton';
import { useProductsQuery } from '../api/products';
import { ProductFormDialog } from './ProductFormDialog';
import type { Product } from '../model/product';

/**
 * There is no delete action and there never will be: a product is retired by
 * deactivating its grades, which is why this table has no `is_active` column
 * either — a product has no such field.
 */
export function ProductsTab() {
  const { t } = useTranslation();
  const { data, isPending } = useProductsQuery();
  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (product: Product) => {
    setEditing(product);
    setDialogOpen(true);
  };

  // Skeleton rows rather than a spinner: the row count is roughly known, so
  // this avoids the layout jump a spinner causes when data lands.
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const products = data?.data ?? [];
  const truncated = (data?.total ?? 0) > products.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>{t('catalog.products.add')}</Button>
      </div>

      {truncated && (
        <p role="status" className="text-sm text-destructive">
          {t('catalog.truncated', { shown: products.length, total: data?.total })}
        </p>
      )}

      {products.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t('catalog.products.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.products.name')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell>{product.name}</TableCell>
                <TableCell>
                  {/* Named per row so a test — and a screen reader — can tell
                      one Edit button from another. */}
                  <Button
                    variant="ghost"
                    aria-label={`${t('catalog.actions.edit')} ${product.name}`}
                    onClick={() => openEdit(product)}
                  >
                    {t('catalog.actions.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ProductFormDialog
        open={dialogOpen}
        product={editing}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/pages/catalog/ui/ProductsTab.test.tsx`
Expected: PASS, all six cases.

If the dialog's fields are not found by `getByLabelText`, check that Radix's `DialogContent` renders into a portal that Testing Library's default container can see — `screen` queries the whole document, so this should work; if it does not, the cause is the dialog not actually being open, not the query.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/catalog frontend/src/shared/api/queryKeys.ts frontend/src/shared/lib/i18n/locales/en.json
git commit -m "feat: products tab with create and edit"
```

---

## Task 4: Grades tab and dialog

**Files:**
- Create: `frontend/src/pages/catalog/model/productGrade.ts`
- Create: `frontend/src/pages/catalog/api/productGrades.ts`
- Create: `frontend/src/pages/catalog/ui/GradesTab.tsx`
- Create: `frontend/src/pages/catalog/ui/GradeFormDialog.tsx`
- Test: `frontend/src/pages/catalog/ui/GradesTab.test.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`

**Interfaces:**
- Consumes: `apiErrorToFields` (Task 1); `Product`, `Paginated<T>`, `useProductsQuery` (Task 3).
- Produces: `ProductGrade { id, product_id, name, is_active, created_at }`, `<GradesTab />`.

- [ ] **Step 1: Add the grades i18n keys**

Extend the `catalog` block in `en.json` with:

```json
"grades": {
  "add": "Add grade",
  "empty": "No grades yet.",
  "name": "Name",
  "product": "Product",
  "allProducts": "All products",
  "active": "Active",
  "inactive": "Inactive",
  "createTitle": "New grade",
  "editTitle": "Edit grade",
  "activeLabel": "Active"
}
```

- [ ] **Step 2: Write the model**

Create `frontend/src/pages/catalog/model/productGrade.ts`:

```ts
/**
 * Mirrors the backend's `ProductGradeResponse`.
 *
 * It carries the product's ID AND NOT ITS NAME — deliberately, because the API
 * addresses grades flatly (`/product-grades/:id`) and every later table
 * (`grade_prices`, `intake_items`) points at a grade without mentioning its
 * product. The tab therefore loads products too and joins by id on the client.
 */
export interface ProductGrade {
  id: string;
  product_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

/** `product_id` is set at CREATE only. A grade never changes parent: moving it
 *  would retroactively move every receipt line ever written against it into a
 *  different product's totals. The edit dialog shows the product as text. */
export interface ProductGradeFormValues {
  product_id: string;
  name: string;
  is_active: boolean;
}
```

- [ ] **Step 3: Write the API hooks**

Create `frontend/src/pages/catalog/api/productGrades.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated } from '../model/product';
import type { ProductGrade, ProductGradeFormValues } from '../model/productGrade';

/** `productId` undefined means "all products" — the key is parameterised so
 *  the filtered and unfiltered lists never share one cache entry. */
export function useProductGradesQuery(productId?: string) {
  return useQuery({
    queryKey: queryKeys.productGrades(productId),
    queryFn: async (): Promise<Paginated<ProductGrade>> => {
      const { data } = await httpClient.get<Paginated<ProductGrade>>('/product-grades', {
        params: {
          ...(productId ? { product_id: productId } : {}),
          // Deactivated grades still matter to the owner: this screen is where
          // they are reactivated, so it must be able to see them.
          include_inactive: true,
        },
      });
      return data;
    },
    staleTime: STALE.reference,
  });
}

/** Invalidates by PREFIX (`['product-grades']`), so every filtered variant is
 *  refreshed — a grade created while filtered to Малина must also appear in
 *  the unfiltered list. */
export function useCreateProductGradeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Pick<ProductGradeFormValues, 'product_id' | 'name'>,
    ): Promise<ProductGrade> => {
      const { data } = await httpClient.post<ProductGrade>('/product-grades', input);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product-grades'] }),
  });
}

/** No `product_id` in the payload: it is immutable after create. */
export function useUpdateProductGradeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
      is_active: boolean;
    }): Promise<ProductGrade> => {
      const { id, ...body } = input;
      const { data } = await httpClient.patch<ProductGrade>(`/product-grades/${id}`, body);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product-grades'] }),
  });
}
```

- [ ] **Step 4: Write the failing test**

Create `frontend/src/pages/catalog/ui/GradesTab.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { GradesTab } from './GradesTab';

let mock: MockAdapter;

const list = (data: unknown[], total = data.length) => ({ data, total, page: 1, limit: 100 });
const MALYNA = { id: 'p1', name: 'Малина', created_at: '2026-07-15T06:00:00.000Z' };
const GRADE = {
  id: 'g1',
  product_id: 'p1',
  name: '1 сорт',
  is_active: true,
  created_at: '2026-07-15T06:00:00.000Z',
};

// GradesTab keeps its product filter in the query string, so it needs a router.
const renderTab = (initialEntry = '/catalog') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/catalog', element: <GradesTab /> }], {
    initialEntries: [initialEntry],
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('GradesTab', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
    mock.onGet('/products').reply(200, list([MALYNA]));
  });
  afterEach(() => mock.restore());

  // The grade response carries product_id and NOT the product name, so the
  // tab has to join the two lists itself.
  it('resolves each grade to its product name', async () => {
    mock.onGet('/product-grades').reply(200, list([GRADE]));
    renderTab();
    expect(await screen.findByText('1 сорт')).toBeInTheDocument();
    expect(screen.getByText('Малина')).toBeInTheDocument();
  });

  it('filters by product through the query string', async () => {
    mock.onGet('/product-grades').reply(200, list([GRADE]));
    renderTab('/catalog?product_id=p1');
    await screen.findByText('1 сорт');
    const gradeRequests = mock.history.get.filter((r) => r.url === '/product-grades');
    expect(gradeRequests[0].params).toMatchObject({ product_id: 'p1' });
  });

  it('creates a grade against the selected product', async () => {
    mock.onGet('/product-grades').reply(200, list([]));
    mock.onPost('/product-grades').reply(201, GRADE);

    renderTab('/catalog?product_id=p1');
    fireEvent.click(await screen.findByRole('button', { name: 'Add grade' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '1 сорт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toEqual({ product_id: 'p1', name: '1 сорт' });
  });

  // Uniqueness is per product — "1 сорт" is legitimate for every berry — so
  // this conflict can only come from the server.
  it('puts a duplicate grade name under the name field', async () => {
    mock.onGet('/product-grades').reply(200, list([]));
    mock.onPost('/product-grades').reply(409, {
      message: 'That grade name is already used for this product',
      code: 'GRADE_NAME_TAKEN',
    });

    renderTab('/catalog?product_id=p1');
    fireEvent.click(await screen.findByRole('button', { name: 'Add grade' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '1 сорт' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That name is already taken')).toBeInTheDocument();
  });

  // Deactivating the last active grade is how a PRODUCT is retired, so it must
  // never be blocked or warned about.
  it('deactivates a grade without sending product_id', async () => {
    mock.onGet('/product-grades').reply(200, list([GRADE]));
    mock.onPatch('/product-grades/g1').reply(200, { ...GRADE, is_active: false });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit 1 сорт' }));
    fireEvent.click(screen.getByLabelText('Active'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.patch).toHaveLength(1));
    const body = JSON.parse(mock.history.patch[0].data);
    expect(body).toEqual({ name: '1 сорт', is_active: false });
    expect(body).not.toHaveProperty('product_id');
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/catalog/ui/GradesTab.test.tsx`
Expected: FAIL — cannot resolve `./GradesTab`.

- [ ] **Step 6: Write the dialog**

Create `frontend/src/pages/catalog/ui/GradeFormDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { SelectField } from '@/shared/ui/select-field';
import { Switch } from '@/shared/ui/switch';
import { toastSuccess } from '@/shared/ui/toast';
import {
  useCreateProductGradeMutation,
  useUpdateProductGradeMutation,
} from '../api/productGrades';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { Product } from '../model/product';
import type { ProductGrade, ProductGradeFormValues } from '../model/productGrade';

const FIELDS = ['name', 'product_id'] as const;

/**
 * `product_id` is a Select when CREATING and static text when EDITING — not a
 * disabled Select. A grade never changes parent (moving it would retroactively
 * move every receipt line written against it into another product's totals),
 * and a disabled control invites someone to wonder how to enable it, whereas
 * text simply states a fact.
 *
 * `is_active` appears only when editing: the API has no such field on create,
 * and a new grade is active.
 */
export function GradeFormDialog({
  open,
  grade,
  products,
  defaultProductId,
  onClose,
}: {
  open: boolean;
  grade: ProductGrade | null;
  products: Product[];
  defaultProductId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateProductGradeMutation();
  const update = useUpdateProductGradeMutation();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductGradeFormValues>({
    defaultValues: { product_id: '', name: '', is_active: true },
  });

  useEffect(() => {
    if (open) {
      reset({
        product_id: grade?.product_id ?? defaultProductId ?? '',
        name: grade?.name ?? '',
        is_active: grade?.is_active ?? true,
      });
      setFormError(null);
    }
  }, [open, grade, defaultProductId, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (grade) {
        await update.mutateAsync({
          id: grade.id,
          name: values.name,
          is_active: values.is_active,
        });
      } else {
        await create.mutateAsync({ product_id: values.product_id, name: values.name });
      }
      toastSuccess(t('catalog.saved'));
      onClose();
    } catch (error) {
      const { fieldErrors, formErrorKey } = apiErrorToFields(error, FIELDS);
      for (const { field, messageKey } of fieldErrors) {
        setError(field as keyof ProductGradeFormValues, { message: messageKey });
      }
      setFormError(formErrorKey);
    }
  });

  const parentName = grade ? products.find((p) => p.id === grade.product_id)?.name : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(grade ? 'catalog.grades.editTitle' : 'catalog.grades.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {grade ? (
            <Field name="product_static" label={t('catalog.grades.product')}>
              {() => (
                <p className="text-base">
                  {/* Falls back to the raw id: the FK guarantees the product
                      exists, so a blank cell here would hide a real bug. */}
                  {parentName ?? grade.product_id}
                </p>
              )}
            </Field>
          ) : (
            <Field
              name="product_id"
              label={t('catalog.grades.product')}
              required
              error={errors.product_id?.message}
            >
              {(a11y) => (
                <SelectField
                  {...a11y}
                  {...register('product_id', { required: 'catalog.errors.productRequired' })}
                >
                  <option value="">—</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </SelectField>
              )}
            </Field>
          )}

          <Field
            name="name"
            label={t('catalog.grades.name')}
            required
            error={errors.name?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('name', {
                  required: 'catalog.errors.nameRequired',
                  maxLength: { value: 128, message: 'catalog.errors.nameTooLong' },
                })}
              />
            )}
          </Field>

          {grade && (
            <Field name="is_active" label={t('catalog.grades.activeLabel')}>
              {(a11y) => <Switch {...a11y} {...register('is_active')} />}
            </Field>
          )}

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('catalog.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('catalog.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**`Switch` is Radix-based** (`SwitchPrimitive.Root`, verified) and takes `checked` / `onCheckedChange` — it does **not** accept a `register()` spread, which returns `onChange`/`ref` for a native input. Spreading `register` onto it silently produces a switch that never updates the form. Drive it through react-hook-form's `Controller`, importing it alongside `useForm`:

```tsx
<Field name="is_active" label={t('catalog.grades.activeLabel')}>
  {(a11y) => (
    <Controller
      name="is_active"
      control={control}
      render={({ field }) => (
        <Switch
          {...a11y}
          checked={field.value}
          onCheckedChange={field.onChange}
        />
      )}
    />
  )}
</Field>
```

Take `control` from `useForm`'s return alongside `register`. The test clicks `screen.getByLabelText('Active')`, and `{...a11y}` is what makes that label association work — do not drop it.


- [ ] **Step 7: Write the tab**

Create `frontend/src/pages/catalog/ui/GradesTab.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUrlParam } from '@/shared/lib/url-state';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { SelectField } from '@/shared/ui/select-field';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Skeleton } from '@/shared/ui/skeleton';
import { useProductsQuery } from '../api/products';
import { useProductGradesQuery } from '../api/productGrades';
import { GradeFormDialog } from './GradeFormDialog';
import type { ProductGrade } from '../model/productGrade';

/**
 * Loads BOTH lists: a grade carries `product_id` and not the product's name,
 * so the product column, the create Select and the edit dialog's static parent
 * label are all client-side joins.
 *
 * The filter lives in the query string so "Малина's grades" is a link, and it
 * pre-selects that product when creating — the common path is adding several
 * grades to the berry already on screen.
 */
export function GradesTab() {
  const { t } = useTranslation();
  const [productId, setProductId] = useUrlParam('product_id');
  const products = useProductsQuery();
  const grades = useProductGradesQuery(productId ?? undefined);
  const [editing, setEditing] = useState<ProductGrade | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (grades.isPending || products.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const productList = products.data?.data ?? [];
  const rows = grades.data?.data ?? [];
  const truncated = (grades.data?.total ?? 0) > rows.length;
  const nameOf = (id: string) => productList.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <SelectField
          aria-label={t('catalog.grades.product')}
          className="max-w-xs"
          value={productId ?? ''}
          onChange={(event) => setProductId(event.target.value || null)}
        >
          <option value="">{t('catalog.grades.allProducts')}</option>
          {productList.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </SelectField>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          {t('catalog.grades.add')}
        </Button>
      </div>

      {truncated && (
        <p role="status" className="text-sm text-destructive">
          {t('catalog.truncated', { shown: rows.length, total: grades.data?.total })}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t('catalog.grades.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.grades.product')}</TableHead>
              <TableHead>{t('catalog.grades.name')}</TableHead>
              <TableHead>{t('catalog.grades.active')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((grade) => (
              <TableRow key={grade.id}>
                <TableCell>{nameOf(grade.product_id)}</TableCell>
                <TableCell>{grade.name}</TableCell>
                <TableCell>
                  <Badge variant={grade.is_active ? 'default' : 'secondary'}>
                    {t(grade.is_active ? 'catalog.grades.active' : 'catalog.grades.inactive')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    aria-label={`${t('catalog.actions.edit')} ${grade.name}`}
                    onClick={() => {
                      setEditing(grade);
                      setDialogOpen(true);
                    }}
                  >
                    {t('catalog.actions.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <GradeFormDialog
        open={dialogOpen}
        grade={editing}
        products={productList}
        defaultProductId={productId}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/pages/catalog/ui/GradesTab.test.tsx`
Expected: PASS, all five cases.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/catalog frontend/src/shared/lib/i18n/locales/en.json
git commit -m "feat: grades tab with per-product filter"
```

---

## Task 5: Tare types tab and dialog

Five fields, two of them money and weight. **This is the task where the string rule is most fragile.**

**Files:**
- Create: `frontend/src/pages/catalog/model/tareType.ts`
- Create: `frontend/src/pages/catalog/api/tareTypes.ts`
- Create: `frontend/src/pages/catalog/ui/TareTypesTab.tsx`
- Create: `frontend/src/pages/catalog/ui/TareTypeFormDialog.tsx`
- Test: `frontend/src/pages/catalog/ui/TareTypesTab.test.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`

**Interfaces:**
- Consumes: `apiErrorToFields` (Task 1); `Paginated<T>` (Task 3).
- Produces: `TareType { id, name, weight_kg, deposit_price, is_crate, is_active, created_at }` with **both numbers typed `string`**; `<TareTypesTab />`.

- [ ] **Step 1: Add the tare-type i18n keys**

Extend the `catalog` block in `en.json` with:

```json
"tareTypes": {
  "add": "Add tare type",
  "empty": "No tare types yet.",
  "name": "Name",
  "weight": "Weight (kg)",
  "deposit": "Deposit price",
  "isCrate": "Counts as a crate",
  "active": "Active",
  "inactive": "Inactive",
  "createTitle": "New tare type",
  "editTitle": "Edit tare type",
  "activeLabel": "Active"
}
```

- [ ] **Step 2: Write the model**

Create `frontend/src/pages/catalog/model/tareType.ts`:

```ts
/**
 * Mirrors the backend's `TareTypeResponse`.
 *
 * `weight_kg` AND `deposit_price` ARE STRINGS, AND THAT IS NOT NEGOTIABLE.
 * They are `numeric` columns carried as strings from database to JSON so no
 * value ever passes through a binary float. This is a cash business whose own
 * rules say a one-kopiyka discrepancy is the same problem as a 350 ₴ one, and
 * these two numbers are snapshotted into receipts that are never recalculated.
 *
 * Typing either as `number` here would compile, look harmless, and reintroduce
 * float error at the exact point the schema spent its design effort avoiding.
 */
export interface TareType {
  id: string;
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
  is_active: boolean;
  created_at: string;
}

export interface TareTypeFormValues {
  name: string;
  weight_kg: string;
  deposit_price: string;
  is_crate: boolean;
  is_active: boolean;
}
```

- [ ] **Step 3: Write the API hooks**

Create `frontend/src/pages/catalog/api/tareTypes.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated } from '../model/product';
import type { TareType, TareTypeFormValues } from '../model/tareType';

export function useTareTypesQuery() {
  return useQuery({
    queryKey: queryKeys.tareTypes,
    queryFn: async (): Promise<Paginated<TareType>> => {
      const { data } = await httpClient.get<Paginated<TareType>>('/tare-types', {
        // The owner reactivates retired tare types from this screen, so it
        // must be able to see them.
        params: { include_inactive: true },
      });
      return data;
    },
    staleTime: STALE.reference,
  });
}

/** `is_active` is absent from the create payload: the API has no such field on
 *  the create DTO, and a new tare type is active. */
export function useCreateTareTypeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<TareTypeFormValues, 'is_active'>,
    ): Promise<TareType> => {
      const { data } = await httpClient.post<TareType>('/tare-types', input);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tareTypes }),
  });
}

export function useUpdateTareTypeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TareTypeFormValues & { id: string }): Promise<TareType> => {
      const { id, ...body } = input;
      const { data } = await httpClient.patch<TareType>(`/tare-types/${id}`, body);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tareTypes }),
  });
}
```

- [ ] **Step 4: Write the failing test**

Create `frontend/src/pages/catalog/ui/TareTypesTab.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { TareTypesTab } from './TareTypesTab';

let mock: MockAdapter;

const list = (data: unknown[], total = data.length) => ({ data, total, page: 1, limit: 100 });
const CRATE = {
  id: 't1',
  name: 'Ящик',
  weight_kg: '1.20',
  deposit_price: '120.00',
  is_crate: true,
  is_active: true,
  created_at: '2026-07-15T06:00:00.000Z',
};

const renderTab = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TareTypesTab />
    </QueryClientProvider>,
  );
};

describe('TareTypesTab', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
  });
  afterEach(() => mock.restore());

  it('renders both numbers exactly as the server sent them', async () => {
    mock.onGet('/tare-types').reply(200, list([CRATE]));
    renderTab();
    // '1.20', not '1.2': the trailing zero survives only if nothing coerced it.
    expect(await screen.findByText('1.20')).toBeInTheDocument();
    expect(screen.getByText('120.00')).toBeInTheDocument();
  });

  /**
   * THE MOST IMPORTANT TEST IN THIS SLICE.
   *
   * `weight_kg` and `deposit_price` must reach the wire as the exact strings
   * typed. A regression to <input type="number"> — or any coercion — turns
   * '1.20' into 1.2 and '120.00' into 120, and every other test in this file
   * would still pass. This one would not.
   */
  it('sends the numbers as strings, unmodified', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    mock.onPost('/tare-types').reply(201, CRATE);

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ящик' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '1.20' } });
    fireEvent.change(screen.getByLabelText('Deposit price'), { target: { value: '120.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    const body = JSON.parse(mock.history.post[0].data);
    expect(body.weight_kg).toBe('1.20');
    expect(body.deposit_price).toBe('120.00');
    expect(typeof body.weight_kg).toBe('string');
    expect(typeof body.deposit_price).toBe('string');
    // is_active is not part of the create DTO.
    expect(body).not.toHaveProperty('is_active');
  });

  it('never renders a number input for either money field', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    expect(screen.getByLabelText('Weight (kg)')).not.toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('Deposit price')).not.toHaveAttribute('type', 'number');
  });

  it('rejects a malformed decimal before sending anything', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ящик' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '1.234' } });
    fireEvent.change(screen.getByLabelText('Deposit price'), { target: { value: '120.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Use a number with up to 2 decimals, e.g. 1.20'),
    ).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  // A non-crate carrying a deposit price is legal — the backend deliberately
  // has no rule tying the two — so the form must not invent one.
  it('allows a non-crate to carry a deposit price', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    mock.onPost('/tare-types').reply(201, { ...CRATE, is_crate: false });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Відро' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '0.30' } });
    fireEvent.change(screen.getByLabelText('Deposit price'), { target: { value: '50.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data)).toMatchObject({
      is_crate: false,
      deposit_price: '50.00',
    });
  });

  it('puts a duplicate name under the name field', async () => {
    mock.onGet('/tare-types').reply(200, list([]));
    mock.onPost('/tare-types').reply(409, {
      message: 'That name is taken',
      code: 'TARE_TYPE_NAME_TAKEN',
    });

    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tare type' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ящик' } });
    fireEvent.change(screen.getByLabelText('Weight (kg)'), { target: { value: '1.20' } });
    fireEvent.change(screen.getByLabelText('Deposit price'), { target: { value: '120.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('That name is already taken')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/catalog/ui/TareTypesTab.test.tsx`
Expected: FAIL — cannot resolve `./TareTypesTab`.

- [ ] **Step 6: Write the dialog**

Create `frontend/src/pages/catalog/ui/TareTypeFormDialog.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { Switch } from '@/shared/ui/switch';
import { toastSuccess } from '@/shared/ui/toast';
import { useCreateTareTypeMutation, useUpdateTareTypeMutation } from '../api/tareTypes';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { TareType, TareTypeFormValues } from '../model/tareType';

const FIELDS = ['name', 'weight_kg', 'deposit_price'] as const;

/**
 * The two numeric inputs are TEXT inputs with `inputMode="decimal"`, never
 * `type="number"`. A number input hands back a coerced value, which turns
 * '1.20' into 1.2 before the form state has even settled — reintroducing
 * binary float into money the moment someone types. `inputMode` still gets a
 * numeric keypad on a phone without changing the value's type.
 *
 * The patterns mirror the server's columns exactly: `numeric(10,2)` is 8
 * integer digits, `numeric(12,2)` is 10. Zero is legal for both; negative is
 * not, and the leading `\d` refuses a minus sign before the request is made.
 *
 * There is deliberately NO rule tying `deposit_price` to `is_crate`. The
 * backend refused to add that CHECK because no domain rule asks for it, and a
 * form that invents it would block a case the domain permits.
 */
const WEIGHT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
const DEPOSIT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export function TareTypeFormDialog({
  open,
  tareType,
  onClose,
}: {
  open: boolean;
  tareType: TareType | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateTareTypeMutation();
  const update = useUpdateTareTypeMutation();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TareTypeFormValues>({
    defaultValues: {
      name: '',
      weight_kg: '',
      deposit_price: '',
      is_crate: false,
      is_active: true,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        name: tareType?.name ?? '',
        weight_kg: tareType?.weight_kg ?? '',
        deposit_price: tareType?.deposit_price ?? '',
        is_crate: tareType?.is_crate ?? false,
        is_active: tareType?.is_active ?? true,
      });
      setFormError(null);
    }
  }, [open, tareType, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (tareType) {
        await update.mutateAsync({ id: tareType.id, ...values });
      } else {
        // is_active omitted: it is not on the create DTO.
        const { is_active: _ignored, ...createValues } = values;
        await create.mutateAsync(createValues);
      }
      toastSuccess(t('catalog.saved'));
      onClose();
    } catch (error) {
      const { fieldErrors, formErrorKey } = apiErrorToFields(error, FIELDS);
      for (const { field, messageKey } of fieldErrors) {
        setError(field as keyof TareTypeFormValues, { message: messageKey });
      }
      setFormError(formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(tareType ? 'catalog.tareTypes.editTitle' : 'catalog.tareTypes.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            name="name"
            label={t('catalog.tareTypes.name')}
            required
            error={errors.name?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('name', {
                  required: 'catalog.errors.nameRequired',
                  maxLength: { value: 128, message: 'catalog.errors.nameTooLong' },
                })}
              />
            )}
          </Field>

          <Field
            name="weight_kg"
            label={t('catalog.tareTypes.weight')}
            required
            error={errors.weight_kg?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                {...register('weight_kg', {
                  required: 'catalog.errors.weightFormat',
                  pattern: { value: WEIGHT_PATTERN, message: 'catalog.errors.weightFormat' },
                })}
              />
            )}
          </Field>

          <Field
            name="deposit_price"
            label={t('catalog.tareTypes.deposit')}
            required
            error={errors.deposit_price?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                {...register('deposit_price', {
                  required: 'catalog.errors.depositFormat',
                  pattern: { value: DEPOSIT_PATTERN, message: 'catalog.errors.depositFormat' },
                })}
              />
            )}
          </Field>

          <Field name="is_crate" label={t('catalog.tareTypes.isCrate')}>
            {(a11y) => <Switch {...a11y} {...register('is_crate')} />}
          </Field>

          {tareType && (
            <Field name="is_active" label={t('catalog.tareTypes.activeLabel')}>
              {(a11y) => <Switch {...a11y} {...register('is_active')} />}
            </Field>
          )}

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('catalog.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('catalog.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Both `Switch`es need `Controller`, exactly as in Task 4.** `Switch` is Radix-based (verified) and takes `checked` / `onCheckedChange`; a `register()` spread produces a switch that never updates the form. Import `Controller` alongside `useForm`, take `control` from its return, and wrap each switch:

```tsx
<Field name="is_crate" label={t('catalog.tareTypes.isCrate')}>
  {(a11y) => (
    <Controller
      name="is_crate"
      control={control}
      render={({ field }) => (
        <Switch {...a11y} checked={field.value} onCheckedChange={field.onChange} />
      )}
    />
  )}
</Field>
```

Do the same for `is_active`. Keep `{...a11y}` on both — it is what makes `getByLabelText` find them.

- [ ] **Step 7: Write the tab**

Create `frontend/src/pages/catalog/ui/TareTypesTab.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Skeleton } from '@/shared/ui/skeleton';
import { useTareTypesQuery } from '../api/tareTypes';
import { TareTypeFormDialog } from './TareTypeFormDialog';
import type { TareType } from '../model/tareType';

/** Both numbers render as the strings the server sent — no formatting, no
 *  `toFixed`, no locale number formatter. The server already stores them at
 *  the scale it means, and reformatting is how a displayed value stops
 *  matching the one on the receipt. */
export function TareTypesTab() {
  const { t } = useTranslation();
  const { data, isPending } = useTareTypesQuery();
  const [editing, setEditing] = useState<TareType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const rows = data?.data ?? [];
  const truncated = (data?.total ?? 0) > rows.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          {t('catalog.tareTypes.add')}
        </Button>
      </div>

      {truncated && (
        <p role="status" className="text-sm text-destructive">
          {t('catalog.truncated', { shown: rows.length, total: data?.total })}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t('catalog.tareTypes.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.tareTypes.name')}</TableHead>
              <TableHead>{t('catalog.tareTypes.weight')}</TableHead>
              <TableHead>{t('catalog.tareTypes.deposit')}</TableHead>
              <TableHead>{t('catalog.tareTypes.isCrate')}</TableHead>
              <TableHead>{t('catalog.tareTypes.active')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((tare) => (
              <TableRow key={tare.id}>
                <TableCell>{tare.name}</TableCell>
                <TableCell>{tare.weight_kg}</TableCell>
                <TableCell>{tare.deposit_price}</TableCell>
                <TableCell>{tare.is_crate ? '✓' : '—'}</TableCell>
                <TableCell>
                  <Badge variant={tare.is_active ? 'default' : 'secondary'}>
                    {t(tare.is_active ? 'catalog.tareTypes.active' : 'catalog.tareTypes.inactive')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    aria-label={`${t('catalog.actions.edit')} ${tare.name}`}
                    onClick={() => {
                      setEditing(tare);
                      setDialogOpen(true);
                    }}
                  >
                    {t('catalog.actions.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <TareTypeFormDialog
        open={dialogOpen}
        tareType={editing}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `cd frontend && npx vitest run src/pages/catalog/ui/TareTypesTab.test.tsx`
Expected: PASS, all six cases.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/catalog frontend/src/shared/lib/i18n/locales/en.json
git commit -m "feat: tare types tab, numbers carried as strings end to end"
```

---

## Task 6: The page shell, the route and the nav entry

Composes the three tabs and makes the screen reachable.

**Files:**
- Create: `frontend/src/pages/catalog/ui/CatalogPage.tsx`
- Create: `frontend/src/pages/catalog/index.ts`
- Test: `frontend/src/pages/catalog/ui/CatalogPage.test.tsx`
- Modify: `frontend/src/app/router.tsx`
- Modify: `frontend/src/app/layouts/AppLayout.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/en.json`

**Interfaces:**
- Consumes: `<ProductsTab />`, `<GradesTab />`, `<TareTypesTab />` (Tasks 3–5); `RequireRole` (Task 2).
- Produces: `CatalogPage`, exported from `@/pages/catalog`.

- [ ] **Step 1: Add the nav i18n key**

In `en.json`, add `"catalog": "Catalog"` to the existing top-level `nav` block (NOT inside the `catalog` block — this one is the sidebar label).

- [ ] **Step 2: Write the failing test**

Create `frontend/src/pages/catalog/ui/CatalogPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope — see ProfilePage.test.tsx.
attachAuthInterceptors(httpClient, sessionAuthHooks);

import { CatalogPage } from './CatalogPage';

let mock: MockAdapter;
const empty = { data: [], total: 0, page: 1, limit: 100 };

const renderPage = (initialEntry = '/catalog') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/catalog', element: <CatalogPage /> }], {
    initialEntries: [initialEntry],
  });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('CatalogPage', () => {
  beforeEach(() => {
    mock = new MockAdapter(httpClient);
    mock.onGet('/products').reply(200, empty);
    mock.onGet('/product-grades').reply(200, empty);
    mock.onGet('/tare-types').reply(200, empty);
  });
  afterEach(() => mock.restore());

  it('shows all three tabs', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Grades' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tare types' })).toBeInTheDocument();
  });

  it('opens on products by default', async () => {
    renderPage();
    expect(await screen.findByRole('tab', { name: 'Products', selected: true })).toBeInTheDocument();
  });

  // The tab is in the URL so it survives a reload and can be linked.
  it('opens the tab named in the query string', async () => {
    renderPage('/catalog?tab=tareTypes');
    expect(
      await screen.findByRole('tab', { name: 'Tare types', selected: true }),
    ).toBeInTheDocument();
  });

  // A hand-edited or stale URL must not render an empty shell.
  it('falls back to products when the query string names an unknown tab', async () => {
    renderPage('/catalog?tab=nonsense');
    expect(await screen.findByRole('tab', { name: 'Products', selected: true })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/pages/catalog/ui/CatalogPage.test.tsx`
Expected: FAIL — cannot resolve `./CatalogPage`.

- [ ] **Step 4: Write the page**

Create `frontend/src/pages/catalog/ui/CatalogPage.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { useUrlParam } from '@/shared/lib/url-state';
import { Screen } from '@/shared/ui/screen';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { ProductsTab } from './ProductsTab';
import { GradesTab } from './GradesTab';
import { TareTypesTab } from './TareTypesTab';

/**
 * One screen for all three catalogs, because they are one job: an owner
 * setting up a season adds a berry, adds its grades, then adds the crate types
 * it arrives in. Three nav destinations would split one task into three.
 *
 * The active tab lives in the query string so it survives a reload and can be
 * linked. `useUrlParam` REPLACES rather than pushes, so switching tabs does not
 * fill the back stack with dead entries.
 */
const TABS = ['products', 'grades', 'tareTypes'] as const;
type TabId = (typeof TABS)[number];

const isTabId = (value: string | null): value is TabId =>
  value !== null && (TABS as readonly string[]).includes(value);

export function CatalogPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useUrlParam('tab');

  // A hand-edited or stale URL falls back rather than rendering an empty
  // shell with no tab selected.
  const active: TabId = isTabId(tab) ? tab : 'products';

  return (
    <Screen>
      <h1 className="mb-6 text-2xl font-semibold">{t('catalog.title')}</h1>
      <Tabs value={active} onValueChange={(next) => setTab(next)}>
        <TabsList>
          <TabsTrigger value="products">{t('catalog.tabs.products')}</TabsTrigger>
          <TabsTrigger value="grades">{t('catalog.tabs.grades')}</TabsTrigger>
          <TabsTrigger value="tareTypes">{t('catalog.tabs.tareTypes')}</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="grades">
          <GradesTab />
        </TabsContent>
        <TabsContent value="tareTypes">
          <TareTypesTab />
        </TabsContent>
      </Tabs>
    </Screen>
  );
}
```

`Screen` takes only `children` and `className` (verified — it has no `title` prop), which is why the heading is rendered as a child.

- [ ] **Step 5: Write the public API**

Create `frontend/src/pages/catalog/index.ts`:

```ts
export { CatalogPage } from './ui/CatalogPage';
```

- [ ] **Step 6: Run the page test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/catalog/ui/CatalogPage.test.tsx`
Expected: PASS, all four cases.

- [ ] **Step 7: Add the route**

In `frontend/src/app/router.tsx`, add the import `import { CatalogPage } from '@/pages/catalog';` alongside the other page imports, and add this route object to `routes[0].children`, placed after `/profile` and **before** the `'*'` catch-all:

```tsx
{
  path: '/catalog',
  element: (
    <RequireAuth>
      <RequireRole role="network_owner">
        <CatalogPage />
      </RequireRole>
    </RequireAuth>
  ),
},
```

Add `RequireRole` to the existing `@/features/auth` import. `RequireAuth` remains the outer guard: it handles "no token at all" and redirects to `/login`, while `RequireRole` only decides between rendering and bouncing an authenticated non-owner.

- [ ] **Step 8: Make the nav role-aware**

In `frontend/src/app/layouts/AppLayout.tsx`, give `NAV` an optional role and filter it. Replace the `NAV` declaration with:

```tsx
const NAV = [
  { to: '/', labelKey: 'nav.dashboard' },
  { to: '/profile', labelKey: 'nav.profile' },
  { to: '/catalog', labelKey: 'nav.catalog', role: 'network_owner' },
] as const;
```

and inside the component, before the `<nav>` renders, derive the visible items:

```tsx
const { data: me } = useMeQuery();
// A role-restricted item stays hidden while `me` is loading: briefly missing
// is better than briefly appearing and then vanishing under the cursor.
const navItems = NAV.filter((item) => !('role' in item) || item.role === me?.role);
```

Then map over `navItems` instead of `NAV`, and add `import { useMeQuery } from '@/entities/user';`. `app` may import from `entities`, so this needs no new plumbing.

- [ ] **Step 9: Run everything**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: all PASS. `src/app/router.test.tsx` and `src/app/layouts/AppLayout.test.tsx` already exist — if either breaks because it renders the layout without a `QueryClientProvider` now that `AppLayout` calls `useMeQuery`, wrap the render in one rather than removing the hook.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/catalog frontend/src/app frontend/src/shared/lib/i18n/locales/en.json
git commit -m "feat: catalog page shell, owner-only route and nav entry"
```

---

## Definition of done

- [ ] `/catalog` renders three tabs; `?tab=` selects one and survives a reload.
- [ ] An owner can create and edit a product, a grade and a tare type; an operator sees no nav entry and is redirected from the route.
- [ ] A duplicate name lands under the `name` input, never in a banner.
- [ ] `weight_kg` and `deposit_price` are strings from input to request body; neither input is `type="number"`.
- [ ] No `DELETE` action exists anywhere in the UI.
- [ ] `npm test`, `npm run lint` and `npm run build` all pass.
