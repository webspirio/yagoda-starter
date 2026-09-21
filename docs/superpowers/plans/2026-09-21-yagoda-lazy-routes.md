# Lazy owner routes and a dev-only kit gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Shrink what an operator downloads on first paint and what the production bundle ships: the owner-only screens and the catalog load on demand, and the `/ui-kit` gallery exists in dev builds only.

**Architecture:** React Router 8 route-level `lazy` (data router: navigation waits for the module, no Suspense flash) under ONE eager owner-only layout route that keeps `RequireAuth`/`RequireRole` in the entry chunk; `/ui-kit` is spread into `routes` only when `import.meta.env.DEV`, so Rollup drops its chunk from the production build entirely. The bundle budget check (`scripts/verify/checks/bundle-size.mjs`) measures the SUM of `frontend/dist/assets/*.{js,css}` and separately prints the largest `.js` chunk — this plan expects the sum to fall (gallery gone) and the largest chunk to fall further (owner screens split out). The ceiling is NOT edited: raising is an exception, and `--write` after a reduction would raise it (min headroom 25 KiB > today's 5 KiB).

**Tech Stack:** react-router 8.3.1 (`lazy: () => import(...).then(m => ({ Component: m.Page }))`), Vite 8, Vitest.

**Spec:** none — this closes the bundle-headroom warning the reception slice's final review named (PR #137); `frontend/CLAUDE.md` «Routing» is the record.

## Global Constraints
- No new npm dependency. FSD import direction only (`app` may import every `pages/*`).
- Guards stay EAGER and OUTSIDE the lazy boundary: an owner-only page's module must not be requested for an operator (the guard redirects first).
- `frontend/src/app/router.test.tsx` drives `createMemoryRouter(routes)`; lazy routes resolve asynchronously, so assertions on lazy pages use `await screen.findBy…`.
- Commit per task with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; no push (the controller pushes).

---

### Task 1: The owner-only layout route with lazy children; `/catalog` lazy; the gallery dev-only

**Files:** Modify `frontend/src/app/router.tsx`, `frontend/src/app/router.test.tsx`; Modify `frontend/CLAUDE.md` («Routing» and the `router.tsx` line in the Structure tree; the `pages/ui-kit` mention).

**Design (write exactly this shape):**
- Read `router.tsx` fully first. Every route currently wrapped in `<RequireRole role="network_owner">` (four today — find them, do not assume the list) moves under ONE new pathless layout route:
  ```tsx
  {
    element: (
      <RequireAuth>
        <RequireRole role="network_owner">
          <Outlet />
        </RequireRole>
      </RequireAuth>
    ),
    children: [
      { path: '/users', lazy: () => import('@/pages/users').then((m) => ({ Component: m.UsersPage })) },
      // …the other owner-only paths, same shape
    ],
  }
  ```
  inside the existing `AppLayout` route's `children`, so the shell and the guards stay eager and only the page module is deferred. Keep each route's existing comment next to its new entry.
- `/catalog` (both roles, rarely opened by an operator) becomes `lazy` the same way under its existing `RequireAuth` — give it its own tiny pathless `RequireAuth` layout only if it is the sole both-roles lazy route; otherwise keep it simple and note the choice.
- `/ui-kit`: replace the static entry with
  ```tsx
  ...(import.meta.env.DEV
    ? [{ path: '/ui-kit', lazy: () => import('@/pages/ui-kit').then((m) => ({ Component: m.UiKitPage })), errorElement: <RouteError /> }]
    : []),
  ```
  and delete the static `UiKitPage` import. Comment: the gallery is a developer tool; production never ships it.
- `HydrateFallback`: a direct load of a lazy URL renders nothing until the module resolves and React Router warns «No HydrateFallback element provided». Add `hydrateFallbackElement` (or `HydrateFallback`) on the `AppLayout` route: a minimal `<p className="p-6 text-sm text-muted-foreground">…</p>` using `t('common.loading')` (the key exists) — put it in a tiny `app/providers/HydrateFallback.tsx` if it needs `useTranslation`.
- The now-unused static page imports (`UsersPage`, `JournalPage`, `TransfersPage`, `PointsPage`, `CatalogPage`, `UiKitPage`, …) are removed from the top of `router.tsx`; `Outlet` is imported from `react-router`.

**Tests (`router.test.tsx`)** — read it first and keep its helpers:
- Existing assertions on eager routes stay as they are.
- For each lazy owner route: as the owner, navigating renders the page (`await screen.findBy…` on a stable heading/eyebrow already asserted today); as an operator, the guard redirects and the page is NOT rendered (assert on whatever the current `RequireRole` test asserts).
- `/ui-kit`: `vi.stubEnv('DEV', …)` cannot flip `import.meta.env.DEV` after module load, so assert the current (dev) behaviour renders the gallery and add a comment that production drops the route; do not fake the prod branch.

**Verification:** from `frontend/`: `npm test`, `npm run lint`, `npx tsc -b`. Then from the worktree root `npm run verify:full` — paste the `bundle` row's printed lines (sum gzip/raw, headroom, largest chunk) and ALSO the same lines from a build of the base commit for comparison (`git stash` is forbidden: build the base in a throwaway worktree `git worktree add /tmp/lazy-base <base-sha>` + `npm ci` + `npm run build -w frontend`, then `node scripts/verify/checks/bundle-size.mjs` from there, then `git worktree remove /tmp/lazy-base`). List `frontend/dist/assets/*.js` after the build and confirm no `ui-kit` chunk exists. Do NOT run `bundle-size.mjs --write`.

**Commit:** `perf(router): owner screens and the catalog load on demand; the kit gallery is dev-only`.
