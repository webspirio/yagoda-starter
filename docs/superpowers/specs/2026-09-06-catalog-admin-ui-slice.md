# Yagoda Catalog Admin UI — Slice Spec

**Date:** 2026-09-06
**Source:** the `/superpowers:brainstorming` session of 2026-09-06, the backend contract in
`docs/superpowers/specs/2026-09-06-yagoda-catalog-slice.md` (hereafter **the API spec**), and
the conventions recorded in `frontend/CLAUDE.md`.

**Branch:** `feat/catalog-admin-ui`, cut from `feat/yagoda-catalog-slice` — the nine endpoints
this screen calls exist only there, and PR #8 is still open. This branch merges after it.

---

## 1. Goal

Give the network owner a screen for the three catalogs the backend now serves: products, their
grades, and tare types. This is the first CRUD UI in the application, so it is also the
template the users and collection-points screens will copy.

## 2. Scope

**In:**

- One route, `/catalog`, with three tabs over `GET/POST/PATCH` for `/products`,
  `/product-grades` and `/tare-types`.
- Create and edit through a dialog per resource, `is_active` included as a switch.
- `RequireRole`, a role-aware route guard, and a role-filtered nav entry.
- Server-error-to-field mapping, which is the only real logic in these forms.

**Out:**

- The users and collection-points admin screens. Same pattern, separate slices.
- A Ukrainian locale. English keys only — see §9.
- Any operator-facing view. `/catalog` is owner-only; the operator's need for this data is
  served by the intake screen, which does not exist yet.
- Delete. There is no `DELETE` endpoint and there never will be — deactivation is the only
  removal verb, and for a product not even that (API spec §5.1).
- Drawer-on-mobile. `Dialog` only; `drawer`/`vaul`/`useIsDesktop` exist and this is the
  obvious later polish, deliberately not taken now.
- `useFormDraft`. Draft persistence is right for a long form someone navigates away from and
  pure overhead for a two-field dialog. It stays what `frontend/CLAUDE.md` says it is.

---

## 3. Route, layout and navigation

**One route, three tabs.** `/catalog` renders a `Tabs` shell over Products · Grades · Tare
types. The three are one job: an owner setting up a season adds Малина, adds its grades, then
adds the crate types. Three nav destinations would split one task into three, and would make
the nav bar top-heavy before the users and points screens arrive.

The active tab lives in the query string (`?tab=grades`) via `shared/lib/url-state`'s
`useUrlParam`, so a tab is linkable and survives a reload. This is the first real consumer of
that helper, which `frontend/CLAUDE.md` describes as ready infrastructure awaiting one.

**The grades tab carries a product filter** — a `Select` above the table, defaulting to "All
products", driving the `?product_id=` query parameter the API provides. Its value lives in the
URL too, by the same `useUrlParam`, so "Малина's grades" is a link somebody can send. Filtering
to a product also pre-selects it when creating a grade from that view, which is the common
path: an owner adds three grades to the berry they are already looking at.

**Navigation.** `AppLayout`'s `NAV` array gains one entry, rendered only for a
`network_owner`. `NAV` is currently a flat `as const` array; each item gains an optional
`role`, and `AppLayout` filters on the role from `useMeQuery` — `app` may import from
`entities`, so this needs no new plumbing. While `me` is still loading, a role-restricted item
is **not** rendered: briefly missing is better than briefly appearing and then vanishing under
the cursor.

## 4. Placement

Everything lives in `pages/catalog/`. No new `entities/` slices and no `widgets/` layer.

```
pages/catalog/
  index.ts                      public API — CatalogPage only
  ui/CatalogPage.tsx            tabs shell, ?tab= state
  ui/ProductsTab.tsx            ui/ProductFormDialog.tsx
  ui/GradesTab.tsx              ui/GradeFormDialog.tsx
  ui/TareTypesTab.tsx           ui/TareTypeFormDialog.tsx
  api/products.ts               useProductsQuery + create/update mutations
  api/productGrades.ts          api/tareTypes.ts
  model/product.ts              model/productGrade.ts   model/tareType.ts
  lib/apiErrorToFields.ts       ApiError → RHF setError
```

The FSD skill's golden rule is "when in doubt, keep it in `pages/`", and its
`insignificant-slice` rule says an entity used by one page belongs in that page. One page uses
these. `entities/product` is tempting because a product *feels* like a domain model, but the
test is "currently used in multiple places, not hypothetically" — and `entities` is the
most-imported layer, so a boundary drawn wrong now propagates furthest. It would also force an
`@x` cross-import or a merge, since a grade references its product.

**When the intake screen lands and genuinely needs all three catalogs, extract then.** That
move is mechanical; drawing the boundary early is not.

File names are domain-based (`product.ts`, not `types.ts`), per FSD rule 4-4.

**Rejected:** CRUD hooks in `shared/api/`, which the FSD skill recommends outright. This repo
already put `useMeQuery` in `entities/user/api/`, so following the skill literally would create
a *second* convention for where server-state hooks live. Consistency with the repo wins.

**Outside the page, three small edits:**

- `features/auth/ui/RequireRole.tsx` — sibling of `RequireAuth`, exported from the same slice.
- `shared/api/queryKeys.ts` — catalog keys added to the existing registry.
- `app/router.tsx` and `app/layouts/AppLayout.tsx` — the route and the nav entry.

## 5. Server state

Queries copy `useMeQuery`'s shape exactly — `queryKey`, `queryFn` through `httpClient`,
`enabled` — as `frontend/CLAUDE.md` instructs.

**Freshness:** `staleTime: STALE.reference` (30 min) from `shared/api/queryClient`, imported
rather than hand-written. These are the reference/lookup reads that constant is for: a berry
catalog changes a few times a season.

**Query keys**, added to the existing registry:

```ts
export const queryKeys = {
  me: ['me'] as const,
  products: ['products'] as const,
  productGrades: (productId?: string) => ['product-grades', productId ?? 'all'] as const,
  tareTypes: ['tare-types'] as const,
};
```

The grades key is parameterised because the tab filters by product (`?product_id=`), and two
filters must not share a cache entry.

**Pagination:** none in the UI. The API defaults to `limit=100` for these bounded catalogs
(API spec §6.4) and the client sends no `page`/`limit`. Each query asserts `data.length ===
total` and surfaces a warning if they differ — the API spec requires exactly this, because a
silently truncated grade list means an operator cannot find the berry in front of them. If it
ever fires, the assumption behind the 100 default has broken and someone needs to know.

**Mutations invalidate the list; they do not seed it.** `useUpdateMeMutation` seeds via
`setQueryData` because *its* response is the entire resource. Ours is one row inside a
collection, so seeding means splicing by hand — inserting at the right sort position,
respecting the `include_inactive` filter, keeping `total` honest. That is how a cache goes
subtly wrong. These lists are ≤100 rows behind a 30-minute stale window; one refetch after a
write is cheap and correct.

**Persistence:** none. `shared/api/persister.ts` allowlists only the `me` query
(`isPersistableKey`) and catalog keys are deliberately not added — this data is owner-edited
and a stale persisted copy across sessions buys nothing.

## 6. Forms

**`react-hook-form`, built-in validation rules, no new dependency.**

`frontend/CLAUDE.md` states the policy: `LoginForm` uses plain `useState` because two fields
buy nothing from a library, and one should "reach for `react-hook-form` once a form has more
than a couple of fields or needs real per-field validation". A five-field tare type with a
decimal pattern is both. `Field`'s own doc comment already calls its `name` prop "the RHF field
name", so the component was built for this.

**No zod, and no `@hookform/resolvers`.** That package is *deliberately absent* — removed as
unused, per `frontend/CLAUDE.md`, which sanctions adding it back "if schema validation is worth
it". It is not worth it here: the entire rule set is `required`, `maxLength: 128` and a decimal
`pattern`, which RHF's built-in rules express directly, one object per field. Zod earns its
place when rules compose or branch. These do not.

### 6.1 The error mapping is the real logic

Client validation is a fast-feedback courtesy. **The server is the authority, and two rules
exist only there:** "that name is taken" is a `lower(name)` index lookup, and for a grade it is
scoped per-product. No client can know either without asking.

`lib/apiErrorToFields.ts` maps a failed mutation onto fields via RHF's `setError`:

| Source | Handling |
|---|---|
| `ApiError.code` ending `_NAME_TAKEN` | field error on `name` |
| `ApiError.code` ending `_NAME_EMPTY` | field error on `name` |
| `ApiError.details` (400, class-validator's per-field `message[]`) | matched to fields by the property name each message starts with |
| anything else | a form-level `role="alert"`, as `LoginForm` already does |

`ApiError.details` exists for precisely this. `frontend/CLAUDE.md`: it is "the backend's raw
per-field `message` array from `class-validator` … so a form can map server-side validation
failures onto individual fields once there's a form to map them onto." This is that form.

**Kept page-local, not in `shared/lib`.** Three dialogs use it, but all three are one page, and
the FSD threshold is multiple *places*. It moves to `shared/lib/` the moment the users or
points screen needs it — which they will.

### 6.2 One dialog per resource, two modes

Each resource has a single `*FormDialog` serving create and edit, distinguished by whether it
received a row. Create and edit share every rule, and the backend deliberately made the update
DTO a *different shape* from create — no `product_id` when editing a grade — so that difference
belongs in one visible mode flag rather than two components that drift.

`is_active` is a `Switch` **inside the dialog**, never a toggle on the table row. A row toggle
is one mis-tap from retiring a grade, and deactivating a product's last grade *is* how a product
is retired (API spec §5.1). It deserves a deliberate act. One write path also keeps the
mutation, the toast and the invalidation in one place.

### 6.3 The three forms

| Resource | Fields | Client rules |
|---|---|---|
| Product | `name` | required, trimmed non-empty, ≤128 |
| Grade | `product_id` (create only, `Select`), `name`, `is_active` (edit only) | product required; name required, trimmed, ≤128 |
| Tare type | `name`, `weight_kg`, `deposit_price`, `is_crate`, `is_active` (edit only) | name as above; `weight_kg` matches `/^\d{1,8}(\.\d{1,2})?$/`; `deposit_price` matches `/^\d{1,10}(\.\d{1,2})?$/` |

`weight_kg` and `deposit_price` are **strings in every layer** — input value, form state, request
body. No `type="number"`, no `valueAsNumber`, no arithmetic. The API spec's §5.1 rule is that a
binary float never touches money or weight, and an `<input type="number">` hands back a coerced
value that breaks it at the very first keystroke. They render as `inputMode="decimal"` text
inputs.

`is_active` appears only when editing: a newly created row is active, and the API has no such
field on either create DTO.

`product_id` appears only when creating a grade, and is immutable thereafter (API spec §5.3) —
so the edit dialog shows the product name as static text, not a disabled select. A disabled
control invites someone to wonder how to enable it.

**The grades tab needs both queries, and this is not incidental.** `ProductGradeResponse` is
`{ id, product_id, name, is_active, created_at }` — it carries the product's **id and not its
name**, deliberately, because the API addresses grades flatly (API spec §4). So `GradesTab`
loads `useProductsQuery` alongside `useProductGradesQuery` and joins by id on the client, for
three purposes: the product column in the table, the `Select` options when creating, and the
static product name in the edit dialog. A grade whose `product_id` matches no loaded product
renders the raw id rather than blank — that state should be impossible (the FK guarantees it),
and silently showing an empty cell would hide a real bug.

## 7. Authorization

`/catalog` is **owner-only**: absent from the nav for an operator, and guarded on the route.

The governing rule is §10.2, quoted in the backend's collection-points controller: for an
operator the control «НЕ ІСНУЄ — не "є, але сіра"», because «заблокована кнопка вчить шукати
обхід, відсутня не вчить нічого». A disabled button teaches people to look for a way around it;
an absent one teaches nothing. Extended from a control to this screen: the read access the API
grants an operator exists for the intake screen, where they hold the crate — not for an admin
table.

**`RequireRole` cannot mirror `RequireAuth`, and the reason is load-bearing.** Role does not
live in the JWT: the payload is `{ sub }` and nothing else, deliberately, so nothing in it can
go stale. Role therefore arrives from the `me` query. `RequireAuth` redirects synchronously on
token presence; a role guard cannot, because on a cold load `me` is still in flight. It must
render a loading state while the query is pending and only redirect once a role is known —
otherwise an owner refreshing `/catalog` is bounced to the dashboard for a frame.

The server remains the authority. Hiding the screen is UX, not enforcement: every write is
`@Auth(UserRole.NetworkOwner)` and returns 403 regardless of what the client renders.

## 8. Feedback and error handling

- **Success:** a `sonner` toast, and the dialog closes. The list refetches from the
  invalidation.
- **Field-level failure:** stays in the dialog, error under the offending input (§6.1).
- **Other failure:** stays in the dialog, form-level `role="alert"`, matching `LoginForm`.
- **Loading:** `skeleton` rows in each tab's table, not a spinner — the row count is known
  roughly, so a skeleton avoids the layout jump.
- **Empty:** each tab states what is missing and offers the create action. A product with no
  grades is a legitimate dead end (Кизил, API spec §5.1), not an error.
- **401:** already handled globally — `attachAuthInterceptors` clears the session and
  `RequireAuth` redirects.

## 9. i18n

Every string goes through `t()` into `locales/en.json` under a new `catalog` key. English only.

Adding `uk` properly means a `uk.json` mirroring *every* existing key, `uk` in
`SUPPORTED_LANGUAGES`, widening the backend's `@IsIn(['en'])` on `language_code`, and wiring the
`LanguageSwitcher` that already exists. A Ukrainian catalog screen inside an English app is
worse than either end state.

**The concern, stated rather than buried:** the person who will actually use this screen is a
Ukrainian-speaking network owner, so an English-only admin UI is not shippable to a real user.
That is a real gap, not a nicety — but the fix is a locale slice covering the whole app, cheap
to do once the string set stops moving, and burying a translation pass inside a forms PR helps
nobody. Labels use the schema's vocabulary (Products, Grades, Tare types; `weight_kg` renders
as "Weight (kg)"). Domain data stays as typed — Малина, 1 сорт.

## 10. Testing

Vitest + Testing Library, matching the existing component specs, with `test-axe` for
accessibility where the repo already applies it.

- **`apiErrorToFields`** — a unit spec. It is pure, it is the only real logic in the slice, and
  every dialog depends on it: a `_NAME_TAKEN` code lands on `name`, a `details` array maps by
  property prefix, an unrecognised error falls through to form level.
- **`RequireRole`** — renders children for an owner, redirects an operator, and **renders
  neither while `me` is pending**. That third case is the one the implementation exists for
  (§7); without it the guard looks correct and flickers in production.
- **One dialog spec per resource** — submits create, submits edit, and shows a server
  `*_NAME_TAKEN` under the `name` field rather than as a banner.
- **`CatalogPage`** — renders the three tabs and reflects `?tab=` from the URL.
- **Tare type strings** — a spec asserting the request body carries `weight_kg` as the string
  typed, unmodified. This is the §5.1 rule at its most fragile point, and a regression to
  `type="number"` would be invisible in every other test.

## 11. Open, and deliberately not resolved here

- **The Ukrainian locale** (§9) — the largest known gap in this slice.
- **Drawer on mobile** — the pieces exist; the dialog ships first.
- **Extraction to `entities/`** — the moment the intake screen needs these catalogs (§4).
- **`apiErrorToFields` moving to `shared/lib`** — the moment a second page needs it (§6.1).
