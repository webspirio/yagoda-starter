# frontend/CLAUDE.md

React SPA for Web Starter.

## Stack

- **React 19** (strict TS) — UI
- **Vite 8** — dev server and bundler
- **Tailwind v4 + shadcn/ui** — component library; static light/dark CSS-variable palette in `src/index.css`, dark mode toggled by a `.dark` class on `<html>` (`useAppTheme`)
- **Zustand 5** — client state (the auth session: `token`)
- **TanStack Query v5** — server state (queries and mutations), persisted to `localStorage` via `PersistQueryClientProvider` (`shared/api/persister.ts`)
- **React Router v8** — client-side routing (`react-router` imports only; no `react-router/dom`)
- **i18next / react-i18next** — i18n; `uk` is the default locale, `en` the second (both in `SUPPORTED_LANGUAGES`)

## Commands

```bash
npm run dev     # start Vite dev server (port 5173, --host for LAN access)
npm test        # run Vitest tests
npm run lint    # ESLint 10 flat config (typescript-eslint + react-hooks + react-refresh)
```

## Structure

Follows **Feature-Sliced Design (FSD)**:

```
src/
  main.tsx                    # entry point — wires auth interceptors, initI18n, global error reporting, renders App
  app/
    App.tsx                   # root component: ErrorBoundary > QueryClientProvider > RouterProvider
    router.tsx                # createBrowserRouter — /login, / (dashboard), /profile, /suppliers, /points, /users, /prices, /catalog, /day, /reception, /debts, /suppliers/:id, /journal, /point-cash, /transfers, /ui-kit, catch-all 404 — no /register
    layouts/AppLayout.tsx      # persistent shell: dark sidebar with role-aware grouped nav + PAPER top bar (mock composition) with scope, ThemeToggle, sign-out; renders auth pages bare
    providers/
      ErrorBoundary.tsx        # React class error boundary → ErrorFallback
      ErrorFallback.tsx        # dev: full stack trace / prod: generic message + retry/reload
      RouteError.tsx           # router errorElement — reports the error, renders ErrorFallback
  entities/user/                # session store (Zustand), Me type (model/user.ts), useMeQuery / useUpdateMeMutation / usePointScope (validated ?point= scoping for money screens) — authenticated-account concerns only
  entities/collection-point/    # usePointOptionsQuery — active points as select options, shared by users / suppliers / prices
  entities/supplier/            # useSuppliersQuery / useSupplierQuery / useSupplierBalanceQuery, Supplier type — the point's supplier directory and running balance, read by suppliers, reception and the receipt widget
  entities/product-grade/       # useGradeCatalogQuery / usePricedGradesQuery — grades joined to product names, for prices and reception
  entities/tare-type/           # useTareTypeOptionsQuery, TareTypeOption type — the tare registry, read by catalog and reception
  entities/shift/                # useShiftOnDateQuery / useCurrentShiftQuery / shiftOnDateQueryOptions, Shift type — one point's working day, read by pages/day and reception (the queryOptions factory also backs pages/dashboard's useNetworkToday fan-out)
  entities/intake/               # useIntakesQuery / intakesQueryOptions, Intake type — a point's receipts journal, read by pages/day, reception, supplier-card and journal (the queryOptions factory also backs pages/dashboard's useNetworkToday fan-out)
  entities/payout/               # usePayoutsQuery / payoutsQueryOptions, Payout type — a point's payouts journal, read by pages/day, supplier-card and journal (the queryOptions factory also backs pages/dashboard's useNetworkToday fan-out)
  entities/transfer/             # useTransfersQuery / useTransferQuery / transfersQueryOptions, Transfer type — one point-to-point movement of cash and crates (§7), read by pages/point-cash and pages/transfers
  entities/point-cash/           # usePointCashQuery / usePointCashForPointQuery, PointCashRow/PointCashOne types — a point's cash-on-hand, one server-computed figure never re-summed client-side, read by pages/dashboard, pages/day and pages/point-cash
  entities/cash-count/           # useCashCountsQuery, CashCount type — a point's drawer-count history (opening/midday/closing; §7.6 one drawer, two books), read by pages/point-cash
  features/auth/                 # login/logout API calls, LoginForm, RequireAuth + RequireRole route guards — no register API
  features/edit-profile/         # useUploadAvatarMutation (single consumer: pages/profile — kept as the upload exemplar)
  features/settle-payout/        # useCreatePayoutMutation, PayoutDialog — records a payout against a supplier's balance, opened from the receipt widget
  features/void-document/        # useVoidDocumentMutation, VoidDocumentDialog — voids an intake, payout or transfer (§9.3: a correction is a void plus a new document), opened from the receipt widget and pages/transfers
  features/count-shift/          # useOpenShiftMutation / useCloseShiftMutation, CountDrawerDialog — opens or closes a shift against the counted drawer (§10.3), used by pages/day
  features/send-transfer/        # useSendTransferMutation, SendTransferDialog — the owner sends money and crates to a point
  features/receive-transfer/     # useAcceptTransferMutation / useDisputeTransferMutation, DisputeTransferDialog — the point accepts an incoming transfer or disputes what actually arrived
  features/resolve-transfer/     # useResolveTransferMutation, ResolveTransferDialog — the owner settles a disputed transfer
  features/set-cash-explanation/ # useSetCashExplanationMutation, ExplainDiscrepancyDialog — the owner explains a drawer discrepancy after the fact
  features/set-point-target/     # useSetPointTargetMutation, SetTargetCashDialog — the owner sets or changes a point's cash target
  widgets/receipt/               # ReceiptDialog — the printable receipt for one intake, opened from reception, day and the supplier card alike
  pages/dashboard/               # «Зведення» — the owner's today-across-the-network overview (open shifts, receipts, cash, the biggest balances) at `/`; the same route shows the operator only their own point's row plus reception/day-cash/balances shortcuts. api/useNetworkToday.ts fans out shift+intake+payout `queryOptions` per point in one `useQueries`
  pages/login/, pages/profile/, pages/not-found/, pages/ui-kit/
  pages/points/, pages/users/, pages/suppliers/, pages/catalog/, pages/prices/   # each: api/ (TanStack hooks) · model/ (wire types + form values) · lib/apiErrorToFields · ui/ (page + dialogs + tests)
  pages/day/, pages/reception/   # the money screens — «Каса за день» and «Прийомка ягоди» (RHF form + live server preview)
  pages/debts/, pages/supplier-card/   # «Залишки за нами» (balances per point, «Видати без ягоди») and the supplier card (balance, tiles, timeline of receipts and payouts) — both roles
  pages/journal/                 # «Журнал прийомки» — the owner's register of every receipt and payout, filtered by point/month/supplier, server-paginated
  pages/point-cash/              # «Каса точки» — one point's cash-on-hand for a date: the ledger explaining the server's own figure, drawer-count history, incoming transfers — both roles, target-setting owner-only (§10.2)
  pages/transfers/               # «Перекази» — the owner's view of money and crates in flight and what each point is short (§7.9, §7.10) — OWNER-ONLY as a route-level gate, not a hidden button
  shared/
    api/                       # httpClient (axios instance, env.apiUrl baseURL) + ApiError + attachAuthInterceptors + queryClient + queryKeys + persister
    lib/
      env/                     # Zod-validated import.meta.env → env.apiUrl
      i18n/                    # i18next init + locales/en.json + language-preference (localStorage)
      theme/                   # useThemePreference (system/light/dark, localStorage) + useAppTheme — the single owner of the `.dark` class on <html>
      upload/                  # validateImageFile, resolveUploadUrl, useImageUpload — client-side mirror of the backend's MEDIA_MAX_BYTES cap
      money/                    # sum / add / sub / cmp / div / isNegative / isZero (decimal-string arithmetic, kopiykas under the hood) + formatUah / formatDecimal / formatKg — the client-side twin of `backend/src/common/money.ts`, used wherever a screen totals or formats a money value
      date/                     # todayIso / addDaysIso / isIsoDate / isRealIsoDate / formatLongDate / formatWeekday / formatShortDate — business-date (`YYYY-MM-DD`) helpers; pages/day owns the one `?date=` in the app
      error-reporting/         # reportError(error, context) — swap body for Sentry later
      api-error/                # apiErrorToBanner — one machine-`code`-keyed mapping of backend business-rule errors to banner copy, shared by every dialog that can fail on a rule (count-shift, void-document, send/receive/resolve-transfer, set-point-target, set-cash-explanation)
      clipboard/, cn.ts, debounce.ts, useDebouncedValue.ts, useIsDesktop.ts — small framework-free utilities
      form-draft/               # useFormDraft — localStorage-backed draft persistence; infrastructure, not yet wired into any form
      url-state/                 # useUrlParam / useUrlFlag / useUrlList / useUrlNumber / useUrlPatch — query-string state; pages/catalog uses useUrlParam for ?tab= and ?product=
      motion.ts                 # shared motion/spring presets (used by animated-number.tsx, segmented.tsx)
    ui/                        # the mock's kit in the starter's layout: primitives (button, badge, dialog, table, tabs, …), signature pieces (eyebrow, page-header, stat-tile, empty-state, sparkline, pending-slice), layout (Card, DataTable, SectionCard, ListPage template), ThemeToggle — plus starter leftovers no screen uses yet (chip, drawer, segmented, TagPicker, …; see the «Kit hygiene» note below)
```

FSD layer boundaries (`shared < entities < features < widgets < pages < app`, each layer may
only import from layers below it) are enforced by ESLint (`no-restricted-imports` in
`eslint.config.mjs`), not just convention — an upward import fails lint instead of
relying on review to catch it. The rule catches DIRECTION only: a same-layer
cross-import (e.g. `entities/payout` reaching into `entities/intake`) compiles and
lints clean, so keeping slices independent within a layer is a review discipline,
not something lint enforces. `widgets/receipt` is the first (and so far only)
`widgets/` slice — it sits between `features` and `pages` in FSD, for composed UI
shared across multiple pages: the printable receipt (`ReceiptDialog`) is opened from
the reception screen, the day screen and the supplier card alike, so it can't live
inside any single one of them.

`shared/lib/form-draft` ships as tested, ready-to-use infrastructure carried
over from the boilerplate this starter was extracted from, but nothing consumes
it yet — there is no form worth drafting. `shared/lib/url-state` found its first
consumer in `pages/catalog` (the active tab and the chosen product live in the
query string). Reach for form-draft the moment a real feature needs it; don't
delete it as dead code, and don't invent a consumer just to "use" it.

**Kit hygiene.** Spec §5.3 wants ONE kit. Today `shared/ui` still carries starter
primitives no screen or the `/ui-kit` gallery imports (`chip`, `drawer`,
`segmented`, `TagPicker`, `multi-select-chips`, `filter-button`, `filter-section`,
`screen`, `section-label`, `animated-number`, `CopyableField`, `progress`,
`radio-group`, `checkbox`, `select` (Radix — screens use the native `SelectField`),
`dropdown-menu`, `tooltip`, `confirm-dialog`/`alert-dialog`, `LanguageSwitcher`).
They are tested and harmless, but each is a second answer to a question the mock
kit already answers. When a screen needs one, prefer restyling it to the mock and
adding it to `/ui-kit`; otherwise they are candidates for deletion in a dedicated
cleanup, not for silent reuse.

**Surfaces.** `Card` (`rounded-xl border border-line2 bg-card`) is the one
outlined shell: `DataTable`'s frame and the catalog's master–detail panes use it.
`SectionCard`/`StatTile` still wear the mock's `ring-foreground/10`, which is
near-invisible on the dark paper — the next dark-mode pass should move them onto
`Card` too.

## Auth

`features/auth` holds the whole client-side auth surface: `authApi.ts` (`login`,
`logout` — plain axios calls, not routed through TanStack Query; there is no
`register` call, since the backend has no public registration route),
`LoginForm` (local `useState`, not `react-hook-form` — see "Forms" below), and
`RequireAuth` (`ui/RequireAuth.tsx`), the route-guard component: renders
nothing but a redirect to `/login` when there is no token, otherwise renders
`children`. It guards on the token's *presence* only — the backend is the sole
authority on whether it's still valid, and a 401 (caught by
`attachAuthInterceptors` in `shared/api/client.ts`) clears the session, which
re-renders `RequireAuth` and redirects. There is no refresh token in this
starter, so a 401 has exactly one meaning: sign the user out — which now also
covers the backend rejecting a still-unexpired token because the account was
deactivated, demoted, or reassigned since it was issued (`JwtStrategy.validate()`
reloads the user on every request).

The session itself (`entities/user/model/store.ts`, `useSession`) is a
Zustand store holding just the JWT, mirrored into `localStorage` under
`web-starter.token` so a reload stays signed in. `entities/user` is the
lowest FSD layer allowed to know about both the http client and the session
store, so it owns wiring them together (`authHooks.ts`'s `sessionAuthHooks`,
passed to `attachAuthInterceptors` once in `main.tsx`) — `shared` must never
import from `entities`, so the interceptor takes session access as callbacks
instead of importing the store directly.

## i18n

Strings live in `src/shared/lib/i18n/locales/uk.json` (default) and `en.json`; components use `useTranslation()`/`t()`.
To add a locale: create `locales/<code>.json` mirroring `en.json`, add it to the
`resources` map in `src/shared/lib/i18n/index.ts`, and add its code to
`SUPPORTED_LANGUAGES` (`language-preference.ts`) — it becomes selectable once
something writes that code via `storeLanguage`. `<html lang>` is kept in sync
with the resolved language automatically.

## Routing

`createBrowserRouter` (BrowserRouter) works because nginx SPA-fallbacks unknown paths to `index.html` (`try_files $uri $uri/ /index.html`); use HashRouter only for static hosting without rewrites.

`/login` is the only public route (`router.tsx`) — there is no `/register`; `/`, `/profile`, and the catch-all 404 are each individually wrapped in `RequireAuth` rather than guarding the whole layout, so `AppLayout` can render the auth screen bare (see its `CHROMELESS` list).

## Server state

`shared/api/queryClient.ts` exports the shared `QueryClient`, wired into the tree via `QueryClientProvider` in `App.tsx`. Defaults: `retry: 1` (most failures are auth/validation errors that won't succeed on a second try), `staleTime: 30_000`, `gcTime: 24h`, `refetchOnWindowFocus: false`. `STALE` (`list`/`detail`/`reference` freshness windows) is exported for reads that want a longer window than the default — none of this starter's own reads need one yet, but new list/detail reads should import from it rather than hand-writing a duration.

`entities/user/api/useMeQuery.ts` is the exemplar hook: `queryKey: queryKeys.me`, `queryFn` calling `GET /me` through `httpClient`, gated with `enabled: token !== null` so it never fires before a session exists. Copy this shape — queryKey + queryFn + `enabled` — for every new server-state read. `useUpdateMeMutation` is the exemplar mutation: it seeds the cache from the response (`setQueryData`) instead of invalidating and paying for a second round trip, which is the right default whenever the mutation response IS the new resource. It has had no caller since the profile identity fields became read-only (the owner renames staff over `PATCH /users/:id`, not `/me`) — kept as the pattern reference, not dead code to delete.

`shared/api/persister.ts` provides a localStorage-backed TanStack Query persister (`isPersistableKey` allowlists only the `me` query) and `buildPersistOptions()` for wiring it up via `PersistQueryClientProvider`. `App.tsx` wires this up: it wraps the tree in `PersistQueryClientProvider` and scopes the buster to the session token (`buildPersistOptions(token ?? 'anon')`) rather than a user id — there is no synchronously-known user id at bootstrap, since the `me` query that would supply one is itself the thing being restored from the persisted cache.

## Forms

`react-hook-form` is a dependency, but `LoginForm` uses plain `useState` — it's two fields, and a form library buys nothing there yet. `shared/lib/form-draft/useFormDraft` is the one place `react-hook-form` is actually wired up today, as a `localStorage`-backed draft-persistence hook (unused by any page — see "Structure" above). `@hookform/resolvers` is NOT a dependency (removed as unused; there is no schema-driven form in this starter yet) — reach for `react-hook-form` once a form has more than a couple of fields or needs real per-field validation, and add `@hookform/resolvers` + `zodResolver` at that point if schema validation is worth it; `ApiError.details` (`shared/api/client.ts`) — the backend's raw per-field `message` array from `class-validator` — exists so a form can map server-side validation failures onto individual fields once there's a form to map them onto.

## Uploads

`shared/lib/upload/image.ts` mirrors the backend's `MEDIA_MAX_BYTES` cap as `IMAGE_MAX_BYTES` (10 MB) and `validateImageFile()` for pre-upload UX checks — the server re-validates independently (size + magic bytes), so this is UX only, never the security boundary. `resolveUploadUrl()` turns a `/uploads/<name>` path (what the API returns) into a browser-loadable URL rooted at the API's own origin, since in dev the frontend and backend are served from different ports. `pages/profile/ui/ProfilePage.tsx` is the one caller today (avatar upload via `features/edit-profile/useUploadAvatarMutation`) and is the reference for wiring up a new image upload: validate client-side, ignore a new pick while one is already in flight (two concurrent uploads racing `setQueryData` means whichever response lands last wins), and surface upload failure via a toast rather than letting a failed upload look identical to a successful one.

## shadcn CLI / MCP gotchas

`frontend/tsconfig.json` carries a `compilerOptions.paths` block that duplicates
`tsconfig.app.json`'s `@/* -> src/*` mapping — see the comment there. The shadcn CLI (`npx
shadcn@latest add/info/diff`, and any shadcn MCP server configured for this project) reads
`paths` from the root `tsconfig.json` directly and does not follow TS project `references`;
without that duplicated block it can't resolve the `@` alias, silently reports zero installed
components, and `add` writes new files into a bogus `./@/` folder instead of `src/`. Don't
remove it as "dead" config during a tsconfig cleanup.

Separately, the shadcn CLI's MCP tools have their own bugs unrelated to this project's
config: `search_items_in_registries`/`list_items_in_registries` don't fall back to the project's
configured registries when `registries` is omitted (pass `registries: ["@shadcn"]` explicitly),
and the inline `Add command` text in search results renders as `[object Promise]` (use
`get_add_command_for_items` instead, which works correctly).

## Key entry points

| File | Role |
|------|------|
| `src/app/App.tsx` | Component tree root |
| `src/app/router.tsx` | All routes |
| `src/entities/user/index.ts` | Public API for session/user state |
| `src/shared/api/client.ts` | `attachAuthInterceptors(httpClient, hooks)` — bearer token + 401→sign-out, wired once in `main.tsx` |
| `src/entities/user/api/useMeQuery.ts` | TanStack Query exemplar — `GET /me` |
| `src/features/auth/ui/RequireAuth.tsx` | Route guard (token presence only) |
| `src/shared/api/queryClient.ts` | Shared TanStack `QueryClient` |
| `src/shared/lib/error-reporting/index.ts` | Error reporting hook point for Sentry |
