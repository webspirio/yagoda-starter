# frontend/CLAUDE.md

React SPA for Web Starter.

## Stack

- **React 19** (strict TS) — UI
- **Vite 7** — dev server and bundler
- **Tailwind v4 + shadcn/ui** — component library; static light/dark CSS-variable palette in `src/index.css`, dark mode toggled by a `.dark` class on `<html>` (`useAppTheme`)
- **Zustand 5** — client state (the auth session: `token`)
- **TanStack Query v5** — server state (queries and mutations)
- **React Router v7** — client-side routing (`react-router` + `react-router/dom` imports)
- **i18next / react-i18next** — i18n; this starter ships English only

## Commands

```bash
npm run dev     # start Vite dev server (port 5173, --host for LAN access)
npm test        # run Vitest tests
npm run lint    # ESLint 9 flat config (typescript-eslint + react-hooks + react-refresh)
```

## Structure

Follows **Feature-Sliced Design (FSD)**:

```
src/
  main.tsx                    # entry point — wires auth interceptors, initI18n, global error reporting, renders App
  app/
    App.tsx                   # root component: ErrorBoundary > QueryClientProvider > RouterProvider
    router.tsx                # createBrowserRouter — /login, /register, / (dashboard), /profile, catch-all 404
    layouts/AppLayout.tsx      # persistent shell (top bar + collapsible sidebar); renders auth pages bare (no chrome)
    providers/
      ErrorBoundary.tsx        # React class error boundary → ErrorFallback
      ErrorFallback.tsx        # dev: full stack trace / prod: generic message + retry/reload
      RouteError.tsx           # router errorElement — reports the error, renders ErrorFallback
  entities/user/                # session store (Zustand), Me type, useMeQuery / useUpdateMeMutation — authenticated-account concerns only
  features/auth/                 # login/register API calls, LoginForm, RegisterForm, RequireAuth route guard
  features/edit-profile/         # useUploadAvatarMutation
  pages/login/, pages/register/, pages/dashboard/, pages/profile/, pages/not-found/
  shared/
    api/                       # httpClient (axios instance, env.apiUrl baseURL) + ApiError + attachAuthInterceptors + queryClient + queryKeys + persister
    lib/
      env/                     # Zod-validated import.meta.env → env.apiUrl
      i18n/                    # i18next init + locales/en.json + language-preference (localStorage)
      theme/                   # useThemePreference (system/light/dark, localStorage) + useAppTheme — the single owner of the `.dark` class on <html>
      upload/                  # validateImageFile, resolveUploadUrl, useImageUpload — client-side mirror of the backend's MEDIA_MAX_BYTES cap
      error-reporting/         # reportError(error, context) — swap body for Sentry later
      clipboard/, cn.ts, debounce.ts, useDebouncedValue.ts, useIsDesktop.ts — small framework-free utilities
      form-draft/               # useFormDraft — localStorage-backed draft persistence; infrastructure, not yet wired into any form
      url-state/                 # useUrlParam / useUrlFlag / useUrlList / useUrlNumber / useUrlPatch — query-string state helpers; infrastructure, not yet wired into any route
      motion.ts                 # shared motion/spring presets (used by animated-number.tsx, segmented.tsx)
    ui/                        # shadcn primitives (button, avatar, dialog, drawer, table, tabs, …) + a few hand-built ones (image-picker, stat-tile, filter-button, url-state-aware pickers)
```

FSD layer boundaries (`shared < entities < features < pages < app`, each layer may
only import from layers below it) are enforced by ESLint (`no-restricted-imports` in
`eslint.config.mjs`), not just convention — an upward import fails lint instead of
relying on review to catch it. There's no `widgets/` layer yet (it sits between
`features` and `pages` in FSD, for composed UI shared across multiple pages); add it
if/when something actually needs that — don't pre-create the empty folder.

`shared/lib/form-draft` and `shared/lib/url-state` ship as tested, ready-to-use
infrastructure carried over from the boilerplate this starter was extracted
from, but nothing in this starter currently consumes either — there is no form
worth drafting yet and no list/filter UI worth mirroring into the query
string. Reach for them the moment a real feature needs what they do; don't
delete them as dead code, and don't invent a consumer just to "use" them.

## Auth

`features/auth` holds the whole client-side auth surface: `authApi.ts` (`login`,
`register`, `logout` — plain axios calls, not routed through TanStack Query),
`LoginForm`/`RegisterForm` (local `useState`, not `react-hook-form` — see
"Forms" below), and `RequireAuth` (`ui/RequireAuth.tsx`), the route-guard
component: renders nothing but a redirect to `/login` when there is no token,
otherwise renders `children`. It guards on the token's *presence* only — the
backend is the sole authority on whether it's still valid, and a 401 (caught
by `attachAuthInterceptors` in `shared/api/client.ts`) clears the session,
which re-renders `RequireAuth` and redirects. There is no refresh token in
this starter, so a 401 has exactly one meaning: sign the user out.

The session itself (`entities/user/model/store.ts`, `useSession`) is a
Zustand store holding just the JWT, mirrored into `localStorage` under
`web-starter.token` so a reload stays signed in. `entities/user` is the
lowest FSD layer allowed to know about both the http client and the session
store, so it owns wiring them together (`authHooks.ts`'s `sessionAuthHooks`,
passed to `attachAuthInterceptors` once in `main.tsx`) — `shared` must never
import from `entities`, so the interceptor takes session access as callbacks
instead of importing the store directly.

## i18n

Strings live in `src/shared/lib/i18n/locales/en.json`; components use `useTranslation()`/`t()`.
To add a locale: create `locales/<code>.json` mirroring `en.json`, add it to the
`resources` map in `src/shared/lib/i18n/index.ts`, and add its code to
`SUPPORTED_LANGUAGES` (`language-preference.ts`) — it becomes selectable once
something writes that code via `storeLanguage`. `<html lang>` is kept in sync
with the resolved language automatically.

## Routing

`createBrowserRouter` (BrowserRouter) works because nginx SPA-fallbacks unknown paths to `index.html` (`try_files $uri $uri/ /index.html`); use HashRouter only for static hosting without rewrites.

`/login` and `/register` are the only public routes (`router.tsx`); `/`, `/profile`, and the catch-all 404 are each individually wrapped in `RequireAuth` rather than guarding the whole layout, so `AppLayout` can render the auth screens bare (see its `CHROMELESS` list).

## Server state

`shared/api/queryClient.ts` exports the shared `QueryClient`, wired into the tree via `QueryClientProvider` in `App.tsx`. Defaults: `retry: 1` (most failures are auth/validation errors that won't succeed on a second try), `staleTime: 30_000`, `gcTime: 24h`, `refetchOnWindowFocus: false`. `STALE` (`list`/`detail`/`reference` freshness windows) is exported for reads that want a longer window than the default — none of this starter's own reads need one yet, but new list/detail reads should import from it rather than hand-writing a duration.

`entities/user/api/useMeQuery.ts` is the exemplar hook: `queryKey: queryKeys.me`, `queryFn` calling `GET /me` through `httpClient`, gated with `enabled: token !== null` so it never fires before a session exists. Copy this shape — queryKey + queryFn + `enabled` — for every new server-state read. `useUpdateMeMutation` is the exemplar mutation: it seeds the cache from the response (`setQueryData`) instead of invalidating and paying for a second round trip, which is the right default whenever the mutation response IS the new resource.

`shared/api/persister.ts` provides a localStorage-backed TanStack Query persister (`isPersistableKey` allowlists only the `me` query) and `buildPersistOptions()` for wiring it up via `PersistQueryClientProvider`. It exists as ready-to-use infrastructure — `App.tsx` currently uses the plain `QueryClientProvider`, so nothing is persisted across reloads yet. Swap in `PersistQueryClientProvider` with `buildPersistOptions(userId)` when a real read is expensive or slow enough to be worth surviving a reload.

## Forms

`react-hook-form` and `@hookform/resolvers` (with `zod`) are dependencies, but `LoginForm`/`RegisterForm` use plain `useState` — they're two fields each, and a form library buys nothing there yet. `shared/lib/form-draft/useFormDraft` is the one place `react-hook-form` is actually wired up today, as a `localStorage`-backed draft-persistence hook (unused by any page — see "Structure" above). Reach for `react-hook-form` + `zodResolver` once a form has more than a couple of fields or needs real per-field validation; `ApiError.details` (`shared/api/client.ts`) — the backend's raw per-field `message` array from `class-validator` — exists so a form can map server-side validation failures onto individual fields once there's a form to map them onto.

## Uploads

`shared/lib/upload/image.ts` mirrors the backend's `MEDIA_MAX_BYTES` cap as `IMAGE_MAX_BYTES` (10 MB) and `validateImageFile()` for pre-upload UX checks — the server re-validates independently (size + magic bytes), so this is UX only, never the security boundary. `resolveUploadUrl()` turns a `/uploads/<name>` path (what the API returns) into a browser-loadable URL rooted at the API's own origin, since in dev the frontend and backend are served from different ports. `pages/profile/ui/ProfilePage.tsx` is the one caller today (avatar upload via `features/edit-profile/useUploadAvatarMutation`) and is the reference for wiring up a new image upload: validate client-side, ignore a new pick while one is already in flight (two concurrent uploads racing `setQueryData` means whichever response lands last wins), and surface upload failure via a toast rather than letting a failed upload look identical to a successful one.

## shadcn CLI / MCP gotchas

`frontend/tsconfig.json` carries a `compilerOptions.paths` block that duplicates
`tsconfig.app.json`'s `@/* -> src/*` mapping — see the comment there. The shadcn CLI (`npx
shadcn@latest add/info/diff`, and the `shadcn` MCP server in `.mcp.json`) reads `paths` from the
root `tsconfig.json` directly and does not follow TS project `references`; without that
duplicated block it can't resolve the `@` alias, silently reports zero installed components, and
`add` writes new files into a bogus `./@/` folder instead of `src/`. Don't remove it as "dead"
config during a tsconfig cleanup.

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
