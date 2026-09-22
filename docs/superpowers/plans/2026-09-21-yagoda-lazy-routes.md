# Lazy owner routes and a dev-only kit gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Shrink what an operator downloads on first paint and what the production bundle ships: the owner-only screens and the catalog load on demand, and the `/ui-kit` gallery exists in dev builds only.

**Architecture:** React Router 8 route-level `lazy` (data router: navigation waits for the module, no Suspense flash) under ONE eager owner-only layout route that keeps `RequireAuth`/`RequireRole` in the entry chunk; `/ui-kit` is spread into `routes` only when `import.meta.env.DEV`, so Rollup drops its chunk from the production build entirely. The bundle budget check (`scripts/verify/checks/bundle-size.mjs`) measures the SUM of `frontend/dist/assets/*.{js,css}` and separately prints the largest `.js` chunk — this plan expects the sum to fall (gallery gone) and the largest chunk to fall further (owner screens split out). The ceiling is NOT edited: raising is an exception, and `--write` after a reduction would raise it (min headroom 25 KiB > today's 5 KiB).

**Tech Stack:** react-router 8.3.1 (`lazy: () => import(...).then(m => ({ Component: m.Page }))`), Vite 8, Vitest.

**Spec:** none — this closes the bundle-headroom warning the reception slice's final review named (PR #137); `frontend/CLAUDE.md` «Routing» is the record.

## Global Constraints
- No new npm dependency. FSD import direction only (`app` may import every `pages/*`).
- Guards stay EAGER and OUTSIDE the lazy boundary. React Router resolves `lazy` for every matched route before it renders, so an operator who TYPES an owner URL still fetches that chunk before the guard redirects — accepted (ruling 2026-09-21): the operator's own navigation never links an owner URL, and a session check inside `lazy()` would couple the router to the query client for no operator-visible gain. Document it; do not build around it.
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

---

### Task 2: The budget measures first paint, and reports the sum

**Why (measured in Task 1):** splitting cut the largest chunk 276.4 → 157.7 KiB gzip but the SUM the check budgets rose 295.5 → 302.6 KiB (each chunk carries its own wrapper and shared modules get their own files). Under a sum budget, code splitting can never pay for itself, and a chart library for an owner-only screen (programme slice 12) would trip the gate although no operator ever downloads it. The check's own header names the audience — operators on mobile data — and names this blind spot. Task 2 makes the budgeted number the one that audience pays: the bytes a first visit must download before the app can paint.

**Files:**
- Modify `frontend/vite.config.ts` — `build: { manifest: true }` (Vite writes `frontend/dist/.vite/manifest.json`; nothing else changes).
- Modify `scripts/verify/checks/bundle-size.mjs`, `scripts/verify/checks/bundle-size.test.mjs`, `scripts/verify/baselines/bundle-budget.json`; `scripts/verify/registry.mjs` (the `bundle` row's `proves`/`blindSpot` prose); `.claude/skills/verify/SKILL.md` only if it describes the bundle row's metric.

**Read first:** `.claude/skills/verify/SKILL.md` «Rules for adding or editing a row» (no hand-written numbers in prose — derive and print; every positive test carries a discriminator; tests write only `mkdtempSync` roots via `--root`/`VERIFY_SCAN_ROOT`; a check that scanned nothing refuses a verdict) and the whole header of `bundle-size.mjs` (its two corrections stay true and stay in the file).

**Design:**
- `measure()` keeps reading every `.js`/`.css` under `dist/assets` (the SUM) and additionally reads `dist/.vite/manifest.json`. First paint = the manifest entry (`isEntry: true`) plus the transitive closure of its `imports` (static) — NOT `dynamicImports` — plus every `css` those chunks list. Resolve manifest `file` values (relative to `dist/`) to the measured asset records; a manifest that names a file the directory does not contain, or a missing manifest, is a FAIL with a named reason (a stale or partial build is not "zero bytes, budget met").
- The budget file gains the first-paint pair: `measuredFirstPaintGzipBytes`, `measuredFirstPaintRawBytes`, `maxFirstPaintGzipBytes`, `maxFirstPaintRawBytes`, `headroomFirstPaint*`, same `minHeadroom*`/`step*` rule. **The gate is first paint** (this task; a second gate, lazy, joined it later — see «Deviations, recorded» below, this was NOT part of Task 2). The sum stays measured and printed on every run as an unconditional WARNING line, so a whole-package regression still shows; its own ceiling no longer fails the row. Rationale for the demotion goes in the budget `reason` and the check header: the sum is what the CDN stores, first paint is what the operator pays. (As planned here the sum was meant to keep its `measured*`/`max*` fields in the budget file, just unenforced — «Deviations, recorded» below says why that changed too.)
- `--write` sets BOTH pairs from the measurement with the existing min-headroom-then-round rule. Run it ONCE in this task to establish the first-paint baseline — this is the first measurement of a new metric, not a raise of an old one; say so in the `reason` and in the commit message, and paste the printed line in the report. Do not hand-edit numbers.
- Prose: the check's `WARNING` lines and the registry row's `proves` derive every number at runtime; no count, KiB or date typed into a string.

**Tests (`bundle-size.test.mjs`)** — extend the fixture builder to write a `dist/.vite/manifest.json` and assert: (1) first paint = entry + static imports + their css, EXCLUDING a chunk reachable only through `dynamicImports` (the discriminator: the same fixture with the lazy chunk listed as a static import must measure larger); (2) the row FAILS when the first-paint pair exceeds its ceiling while the sum is under its own, and PASSES in the opposite case (sum over, first paint under) with the sum WARNING printed; (3) a manifest naming a file absent from `assets/` fails with the named reason; (4) a missing manifest fails, not passes; (5) `--write` writes both pairs with the headroom rule. Keep every existing test that still describes true behaviour; rewrite the ones whose premise (sum is the gate) changed, do not delete them silently — say which in the report.

**Verification:** `node --test scripts/verify/checks/bundle-size.test.mjs` (or the repo's runner for `scripts/verify` tests — see `package.json`), `node scripts/verify/registry.test.mjs` if prose changed, then `npm run verify:full` from the worktree root; paste the `bundle` row's printed lines (first paint, sum, largest chunk — three as of this task; four once lazy joined as a second gate, see «Deviations, recorded» below) and the verdict line.

---

## Deviations, recorded (2026-09-21, PR #140 round-2 review)

This plan covered Tasks 1–2 only; everything below happened in later commits on the same
branch, after this document was last edited as a plan. Recorded here rather than silently
left for the diff to explain, per the review that found the paragraphs above stale:

- **Task 2's demotion of the sum became its removal.** Task 2 planned for the sum to keep its
  `measured*`/`max*` fields in `scripts/verify/baselines/bundle-budget.json`, just unenforced
  (a ceiling that stops failing the row, not a ceiling that stops existing). What actually
  shipped, once lazy became a second gate (next bullet), drops those fields from the budget
  file entirely — `bundle-size.mjs`'s own header states why: first paint and lazy between
  them already cover every manifest-listed byte, so a third, overlapping figure with its own
  `max*` would only double-book bytes the other two already price. The sum is still measured
  and printed as an unconditional WARNING line every run; it just records nothing in the
  budget file any more.
- **A lazy closure was added as the second gate** (`f2df27d`), closing a gap Task 2 left open:
  the old sum ceiling had been kept as a frozen, printed-only figure, so the five split-off
  owner screens — everything reachable from the entry only through a `dynamicImports` edge —
  had no ceiling of its own at all. Lazy now ratchets on every `--write` exactly like first
  paint, sharing the same `MIN_HEADROOM`/`STEP` pair; neither metric is ever frozen.
- **The manifest is stripped from the production image** (this round, PR #140's second review
  pass): `build.manifest: true` (added by Task 2) writes `dist/.vite/manifest.json`, which
  `nginx/Dockerfile` was copying verbatim into the image and `nginx/nginx.conf` was serving at
  `/.vite/manifest.json`. It is a local input to `bundle-size.mjs`, never a deployable — the
  Dockerfile now `rm -rf`s it in the builder stage, and `nginx.conf` 404s any dotfile request
  as defense in depth.
- **The typed-owner-URL cost gained a redeploy failure mode.** Global Constraints above
  accepted that an operator who types an owner URL still fetches that group's `lazy` chunk
  before `RequireRole` redirects them. A later commit (`fe98267`) extended that acceptance:
  an ordinary redeploy retires old hashed chunks, so a session holding a stale `index.html`
  can have one of those five `lazy()` imports reject outright. The owner-only group route now
  carries its own `errorElement` (`<RouteError fullHeight={false} />`) so a rejected fetch
  replaces only that group's own content instead of bubbling up and unmounting `AppLayout`'s
  whole shell — and, as of this same round-2 pass, that fallback renders at pane height
  (`min-h-[50vh]`, via `ErrorFallback`'s new `fullHeight` prop) rather than whole-page height,
  since it now renders inside `AppLayout`'s `<main>` alongside a sidebar that survives.

**Commit:** `feat(verify): the bundle budget gates first paint from the Vite manifest and reports the sum`.
