# Operator menu (#221) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Ціни дня» disappears for the operator only; «Каса за день» and «Каса точки» become ONE page — «Каса точки» at `/point-cash` — for both roles.

**Architecture:** Frontend only. `/prices` moves into the owner-only `RequireRole` group (and so into the owner chunk). Everything `pages/day` renders moves into `pages/point-cash` — the four day tiles, the day's documents feed, «Звірка каси» (`DayLedger`) and the owner's «Відкрити зміну наново» — and `pages/day` is deleted; `/day` becomes a redirect to `/point-cash` that keeps the query string. Nothing is dropped yet: the duplicate ledger is a recorded follow-up, not part of this change.

**Tech Stack:** React 19 + React Router + TanStack Query + i18next (Vitest + Testing Library).

**Issue:** #221 «Меню приймальника». Decisions were agreed in a grilling session on 2026-10-20 and posted to the issue.

## Decisions (agreed 2026-10-20)

1. «Ціни дня» — hidden from the OPERATOR only. The owner keeps it unchanged.
2. The merge applies to BOTH roles: `pages/day` goes away for everybody.
3. The surviving page is «Каса точки» at `/point-cash`. `/day` redirects there and keeps `?date=` / `?point=`. Both pages already read the same two params (`useUrlParam('date')`, `useWorkingPoint`).
4. ALL four `pages/day` blocks move over, including «Звірка каси» (`DayLedger`), even though it duplicates `CashLedger`. Pruning is a later, separate decision (follow-up entry, Task 9).
5. Layout, top to bottom:
   - header with the three cash tiles (unchanged) — **changed during implementation:** «Каса за ящики» joined them as a fourth tile, never summed with the berry cash; the old card's note that signed-receipt crates are not counted is kept as the tile's hint;
   - `OpenShiftAlert`;
   - a separate row of the four day tiles;
   - `IncomingTransfers`;
   - the ledger/right-column grid (unchanged);
   - «Звірка каси» full width;
   - one card with two tabs: «Стрічка дня» | «Історія перерахунків».

   Revised after review on 2026-10-20: the feed grows with the day, so «Звірка» moved above it, and the history became a tab rather than a toggle stranded under a long feed.

   «Відкрити зміну наново» goes into `ShiftCountPanel`, not the toolbar.
6. Backend unchanged. `GET /grade-prices/*` stays `@Auth()`, because reception reads the operator's prices from it (the grade option and the lines table already show the price). This is a hidden screen, not a data restriction.
7. All five in-app links to `/day` point straight at `/point-cash`, labelled «Каса точки». The redirect is only for bookmarks.
8. The `day.*` i18n keys still in use are NOT renamed in this PR. Keys that are no longer used are deleted (the `locales` verify row requires it).
9. One PR, two commits: prices first, then the merge.

## Global Constraints

- FSD: a page may not import another page. Everything reused from `pages/day` physically MOVES into `pages/point-cash` (`git mv`, so history follows).
- No user-visible literal outside `uk.json` / `en.json`. Both locales keep identical keys.
- Frontend tests run in English (`test-setup` pins `en`).
- No money arithmetic outside `shared/lib/money`. `daySummary` already complies, so this is a move with no logic change.
- The day documents are read BY SHIFT (`useIntakesQuery({ shiftId })`, `usePayoutsQuery({ shiftId })`), exactly as `pages/day` did. These are NOT the reads `CashLedger` already makes (`pointId` + date range). Do not merge the two — they answer different questions and are capped differently.
- Commit titles in English.
- Gate: `npm run verify:full` once per commit. Routing and chunking (`/prices` into the owner chunk, the bundle ceiling) are visible only in a production build.

## Review Focus

1. **Operator on `/prices`**: redirected to `/`, and the owner chunk is never requested. Pinned in Task 1 (`router.lazy-guard.test.tsx`).
2. **`/day?point=X&date=Y`**: lands on `/point-cash?point=X&date=Y`, not on a bare `/point-cash`. Pinned in Task 7.
3. **Two "empty" states on one page**: no shift on the date → the day tiles are hidden (`figuresVisible`, as on `/day`), while the cash tiles and the ledger still render. A failed day read → `common.somethingWentWrong` in the feed card only, never blanking the cash figures. Pinned in Task 5.
4. **Reopen button**: owner + `closed` shift only, never for an operator, never on `open` / `awaiting_explanation`. Pinned in Task 4.
5. **Truncation**: more than 100 documents in a shift still prints `day.tiles.truncated` above the day tiles. Pinned in Task 5.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `frontend/src/app/layouts/AppLayout.tsx` | modify | `/prices` item `role: 'network_owner'`; drop the `/day` item |
| `frontend/src/app/router.tsx` | modify | `/prices` into the owner group; `/day` → redirect |
| `frontend/src/app/owner-pages.ts`, `lazy-routes.ts` | modify | `PricesPage` joins the owner chunk |
| `frontend/src/pages/reception/ui/ReceptionPage.tsx` | modify | «Ціни дня» owner-only; «До дня» and `goToDay` → `/point-cash` |
| `frontend/src/pages/dashboard/ui/DashboardPage.tsx` | modify | three links → `/point-cash` |
| `frontend/src/pages/day/**` | move → delete | see Tasks 3–6 |
| `frontend/src/pages/point-cash/lib/daySummary.ts` (+ test) | move | unchanged |
| `frontend/src/pages/point-cash/api/shiftActions.ts` (+ test) | move | `useReopenShiftMutation` |
| `frontend/src/pages/point-cash/model/useDayDocuments.ts` (+ test) | create | shift-scoped intakes + payouts → `summary`, `feed`, `truncated`, `ready`, `isError` |
| `frontend/src/pages/point-cash/ui/DayTiles.tsx` | create | the four tiles + the truncation note |
| `frontend/src/pages/point-cash/ui/DayFeed.tsx` (+ test) | create | «Документи дня», lifted from `DayPage`'s `feedContent` |
| `frontend/src/pages/point-cash/ui/DayLedger.tsx` | move | unchanged |
| `frontend/src/pages/point-cash/ui/ReopenShiftDialog.tsx` (+ test) | move | unchanged |
| `frontend/src/pages/point-cash/ui/ShiftCountPanel.tsx` (+ test) | modify | `onReopenShift` |
| `frontend/src/pages/point-cash/ui/PointCashPage.tsx` (+ test) | modify | compose it all |
| `frontend/src/shared/lib/i18n/locales/{uk,en}.json` | modify | drop dead keys |
| `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` | modify | «дві книги каси» entry |
| `frontend/CLAUDE.md` + comments naming `pages/day` | modify | point at `pages/point-cash` |

---

## Commit 1 — `fix(nav): day prices are owner-only (#221)`

### Task 1: `/prices` owner-only

**Files:** `app/layouts/AppLayout.tsx`, `app/router.tsx`, `app/owner-pages.ts`, `app/lazy-routes.ts`, `app/router.lazy-guard.test.tsx`, the AppLayout nav test.

- [ ] Failing test (`router.lazy-guard.test.tsx`): an operator navigating to `/prices` lands on `/`, and the owner-pages factory is never called. Copy the existing `/journal` case.
- [ ] Failing test (nav): the operator's sidebar has no «Ціни дня»; the owner's still does.
- [ ] Re-export `PricesPage` from `owner-pages.ts`, wrap it in `lazy-routes.ts`, move the route into the owner group's `children` (`{ path: '/prices', element: <PricesPage /> }`, the lazy one), and delete the old top-level route and its eager import. Rewrite the route comment: GET stays open to both roles because reception reads prices, but the SCREEN is the owner's (#221).
- [ ] Add `role: 'network_owner'` to the nav item and replace the «Both roles» comment.
- [ ] Run both tests → green.

### Task 2: Reception's «Ціни дня» button

**Files:** `pages/reception/ui/ReceptionPage.tsx` (+ test)

- [ ] Failing test: the operator's toolbar has no «Ціни дня» link; the owner's does.
- [ ] Wrap the `/prices` toolbar link (`:365–369`) in `isOwner`, and drop the «Both roles: an operator's /prices is read-only» comment. Rewrite the `noPrices` empty-state comment (`:391`): the link was already owner-only, and the reason is now "the screen is the owner's", not "read-only".
- [ ] `PricesPage`'s operator-only "locked" branch is now unreachable through routing. Leave it — it is the page's own defence — but note it in the page's doc comment.
- [ ] `npm run verify:full` → paste the verdict line, name any `SKIPPED` row. Commit.

---

## Commit 2 — `feat(point-cash): merge the day cash screen into point cash (#221)`

### Task 3: Move the pure pieces (no behaviour change)

- [ ] `git mv` into `pages/point-cash`:
  - `pages/day/lib/daySummary.ts` and `daySummary.test.ts` → `lib/`;
  - `pages/day/api/shiftActions.ts` and its test → `api/`;
  - `pages/day/ui/DayLedger.tsx` → `ui/`;
  - `pages/day/ui/ReopenShiftDialog.tsx` and its test → `ui/`.
- [ ] Fix the relative imports. `features/count-shift/api/shiftActions.ts:9`'s comment names `pages/day/api/shiftActions.ts` — update it.
- [ ] `npm test -w frontend -- daySummary shiftActions ReopenShiftDialog` → green with no test edits beyond import paths.

### Task 4: `ShiftCountPanel` — «Відкрити зміну наново»

- [ ] Failing tests:
  - owner + `closed` shows `day.reopen`, and the click calls `onReopenShift`;
  - an operator never sees it;
  - owner + `open` / `awaiting_explanation` never sees it.
- [ ] Add `isOwner` and `onReopenShift` props. Render the button in the closed-shift block, next to the closing count's result.
- [ ] Check whether the panel already prints «бій» (`shift.broken_crates`) for a closed shift. If it does not, move `DayPage`'s badge (the `=== null` → «—» rule and its comment) into the panel with a test. It must not be lost in the merge.

### Task 5: Day documents read + tiles + feed

- [ ] `model/useDayDocuments.ts`: `(shiftId: string | undefined)` → `{ summary, feed, truncated, ready, isError }`. Lift it from `DayPage`, covering `buildDaySummary`, the `FeedRow` mapping and sort, and the `isTruncated` pair. Test with mocked journals:
  - newest first;
  - a standalone payout flagged;
  - truncation.
- [ ] `ui/DayTiles.tsx`: the four `StatItem`s from `DayPage` (`day.tiles.*`, the `paidDown` branch, the amber tone) and the `day.tiles.truncated` note. Render them through the same stat-row primitive `DashboardPage`'s `stats` uses. If the template does not export one, export it rather than copying its markup.
- [ ] `ui/DayFeed.tsx`: `feedContent` from `DayPage` with its four states (no point, error, loading, no shift, empty) and the rows:
  - an intake row opens the receipt;
  - a standalone payout opens the payout receipt;
  - `ReceiptVoidButton` is shown iff `canVoidIntake`.

  `supplierNameById` comes along. It takes `openReceipt` / `openPayoutReceipt` callbacks; the dialogs stay page-level.
- [ ] Port `DayPage.test.tsx`'s feed and tile cases onto `DayFeed`, `DayTiles` and `useDayDocuments`. Every `DayPage` test must end up either ported or named in the PR body as deliberately dropped (only toolbar duplicates that `PointCashPage` already covers).

### Task 6: Compose on `PointCashPage`

- [ ] Failing tests (`PointCashPage.test.tsx`):
  - the day tiles render below the cash tiles when the date has a shift;
  - they are hidden when it has none, while the cash tiles and ledger still render;
  - a failed shift-scoped intakes read shows `common.somethingWentWrong` in the feed card and the cash tiles stay;
  - «Документи дня» and «Звірка каси» sit after the grid;
  - an intake row opens `ReceiptDialog`;
  - the owner's reopen opens `ReopenShiftDialog`.
- [ ] Wire everything in:
  - `useDayDocuments(shift.data?.id)`;
  - `figuresVisible` with the same rule as `DayPage`: a point, a shift, no error, both journals in;
  - `DayTiles` between `OpenShiftAlert` and `{body}`;
  - `DayFeed` and `DayLedger` full width after the grid, before the history toggle;
  - `ReceiptDialog`, `PayoutReceiptDialog` and `ReopenShiftDialog` with their `key` remount counters, same as `DayPage`;
  - `onReopenShift` passed to the panel.
- [ ] Below `lg` the DOM order is the reading order. Check at 375px that nothing scrolls sideways (`/run` skill, screenshot both roles).

### Task 7: `/day` redirect and links

- [ ] Failing test (`router.test.tsx`): `/day?point=p1&date=2026-10-01` → `/point-cash?point=p1&date=2026-10-01`, with `replace`.
- [ ] Replace the `/day` route with a small `RedirectToPointCash` (in `router.tsx`, next to the route) that renders `<Navigate to={{ pathname: '/point-cash', search }} replace />`, with `search` read from `useLocation()`. A bare `<Navigate to="/point-cash">` drops the query, which is the whole point of keeping the redirect. Keep it under `RequireAuth`.
- [ ] Repoint the links and their tests:
  - `DashboardPage.tsx:159`, `:206`, `:293`;
  - `ReceptionPage.tsx:371`;
  - `goToDay` (`:307–311`, rename to `goToPointCash`).

  Labels move to the existing `nav.pointCash` text: reuse that key, or add `dashboard.*.pointCash` only if the sentence differs.
- [ ] Remove the `/day` nav item from `AppLayout`.

### Task 8: Delete `pages/day` and the dead keys

- [ ] `git rm -r frontend/src/pages/day` (only `index.ts`, `DayPage.tsx` and `DayPage.test.tsx` should be left by now).
- [ ] Delete the keys that are no longer read anywhere — expected `nav.day`, `reception.toDay`, `dashboard.points.dayCash`, `dashboard.shortcuts.dayCash`, `day.title`, `day.eyebrow`, `day.description`, `day.pickPoint`, `day.open`, `day.close`, `day.toast.*`, `day.status.*`, `day.currentShiftFailed`. Confirm each one with a grep that ALSO covers the `register`/`validate` path (see `frontend/CLAUDE.md` «A `t('…')` grep does NOT find every key»), and let the `locales` row confirm.
- [ ] Update the comments that name `pages/day`: `pages/cost-of-day/ui/CostOfDayPage.tsx:35`, `pages/reweigh/ui/ReweighPage.tsx:34`, `:108`, `ReweighPage.test.tsx:236`, `pages/dashboard/ui/DashboardPage.tsx:22`, `pages/point-cash/ui/PointCashPage.tsx:49`, `:181`, `pages/reception/ui/ReceptionPage.tsx:122`, `shared/lib/api-error/apiErrorToBanner.ts:13`. Re-grep for `pages/day` and `Каса за день` before committing.

### Task 9: Docs

- [ ] `frontend/CLAUDE.md`:
  - remove `/day` from the router line and the `pages/day/` structure row; fold its description into `pages/point-cash/`'s (day tiles, documents, «Звірка каси», owner reopen);
  - add `/prices` to the owner-only list in «Routing» (now nine pages in the group);
  - in `features/count-shift`'s row, «used by pages/day, pages/reception AND pages/point-cash» → «pages/reception AND pages/point-cash».
- [ ] `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`, new dated entry: «#221: на `/point-cash` дві книги каси — `DayLedger` («Звірка каси», клієнтська сума по документах зміни, не бачить settle-return за попередні зміни) і `CashLedger` (серверна розбивка, #73). Вирішити з клієнтом, що прибрати; разом із цим перейменувати ключі `day.*`, що лишились, у `pointCash.*`.»
- [ ] `npm run verify:full` → paste the verdict line and name every `SKIPPED` row. Commit. Open the PR (`Closes #221`), with the dropped-tests list from Task 5 in its body.
