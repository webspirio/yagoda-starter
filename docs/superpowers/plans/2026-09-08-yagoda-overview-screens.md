# Overview Screens (Журнал · Зведення · Ціни для приймальника) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The remaining screens the existing API can already serve: the owner's document register («Журнал прийомки»), a real «Зведення» for today across the network (replacing the starter's dashboard stub), and the prices screen opened to the operator read-only with a per-grade price history.

**Architecture:** No new backend. `entities/intake` and `entities/payout` gain date-range and page filters; `pages/journal` composes `ListPage` + filters + the receipt widget; `pages/dashboard` is rewritten on the `DashboardPage` template over per-point shift/document reads (`useQueries`) and the balances list; `pages/prices` gets a role-aware read-only mode and a history dialog over `GET /grade-prices`. All totals are display sums in kopiykas over loaded pages (stated on screen when truncated).

**Tech Stack:** React 19, TanStack Query v5 (`useQueries`), react-router v8, i18next, vitest + testing-library + vitest-axe.

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-reception-frontend-design.md` (§0, §4.2, §4.4, §4.6) — screens here are the mock's `JournalPage` («Журнал прийомки») and `DashboardPage` («Зведення по сезону»), reduced to what document HEADERS carry (no per-berry tonnage: item details are not in list reads).

## Global Constraints

- Owner-only screens: `/journal` and the owner's `/` overview (`RequireRole`); `/prices` opens to BOTH roles: the operator sees values with a lock and no «Змінити»/«Встановити» (mock §5.4: «приховане поле породжує підозру; заблоковане з підписом вчить правилу»).
- API: `GET /intakes?collection_point_id&supplier_id&from&to&include_voided&page&limit` (`from`/`to` are `YYYY-MM-DD` business dates, `limit ≤ 100`), same for `/payouts`; `GET /shifts?collection_point_id&from&to&limit`; `GET /supplier-balances?collection_point_id&include_zero&page&limit`; `GET /grade-prices?collection_point_id&product_grade_id&page&limit` (journal, newest first, default 20) → rows `{ id, collection_point_id, product_grade_id, base_price, max_markup, max_discount, created_by_user_id, reason, created_at }`.
- Money strings; display sums via `@/shared/lib/money`; dates via `@/shared/lib/date`; copy through `t()` (`uk` default, `en` for tests); FSD layers with `widgets` allowed; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; lint + focused tests per commit, full suite + build at the end.
- Depends on: the day-screen and reception plans being merged (entities/shift/intake/payout/supplier, `widgets/receipt`, `usePointScope`, `shared/lib/money`, `shared/lib/date`).

---

### Task 1: Date-range and page filters on the document reads

**Files:**
- Modify: `frontend/src/entities/intake/model/intake.ts` (`DocumentFilter` gains `from?: string; to?: string; page?: number`), `frontend/src/entities/intake/api/useIntakes.ts` (`documentParams` maps `from`, `to`, `page`; `enabled` also true when `from`/`to` is set — a date range is a valid scope), the twin in `frontend/src/entities/payout/`
- Test: extend `frontend/src/entities/intake/api/useIntakes.test.tsx` (params contain `from`, `to`, `page`; enabled with only a date range)

- [ ] **Step 1: Failing test**
```tsx
it('sends a date range and page, and is enabled by a range alone', async () => {
  mock.onGet('/intakes', { params: { from: '2026-09-01', to: '2026-09-30', page: 2, include_voided: true, limit: 100 } })
    .reply(200, { data: [], total: 0, page: 2, limit: 100 });
  const { result } = renderHook(() => useIntakesQuery({ from: '2026-09-01', to: '2026-09-30', page: 2 }), { wrapper });
  await waitFor(() => expect(result.current.data?.page).toBe(2));
});
```
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/entities/intake` → FAIL.
- [ ] **Step 3: Implement** — in both `documentParams` copies: `...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}), ...(f.page ? { page: f.page } : {})`; `enabled = Boolean(f.shiftId || f.supplierId || f.pointId || (f.from && f.to))`.
- [ ] **Step 4: Run** tests + lint → PASS. **Step 5: Commit** `feat(entities): date range and page on the document reads`

---

### Task 2: `pages/journal` — «Журнал прийомки»

**Files:**
- Create: `frontend/src/pages/journal/model/journalFilters.ts` (+ `.test.ts`), `frontend/src/pages/journal/ui/JournalPage.tsx` (+ `.test.tsx`), `frontend/src/pages/journal/index.ts`
- Modify: `frontend/src/app/router.tsx` (`/journal`, `RequireAuth` + `RequireRole role="network_owner"`), `frontend/src/app/layouts/AppLayout.tsx` (`nav.journal` → `to: '/journal'`), locales (`journal` block)

**Interfaces:**
- `journalFilters.ts`: `monthRange(iso: string): { from: string; to: string }` (first/last day of that month, string arithmetic on `YYYY-MM`), `parseFilters(params: URLSearchParams): { from, to, pointId: string|null, supplierId: string|null, includeVoided: boolean, page: number }` (defaults: the current month via `todayIso()`, page 1, voided included), all URL-backed through `useUrlParam`/`useUrlPatch`.
- Page (`ListPage` template): eyebrow **«повний реєстр»**, title **«Журнал прийомки»**, description (mock verbatim: «Усі квитанції сезону в одному місці…» — shorten to «Усі квитанції й виплати в одному місці, з фільтром за точкою, місяцем і постачальником.»). Toolbar: point `SelectField` («Усі точки» + points), month `<input type="month">` bound to `from`/`to`, supplier `SelectField` (from `useSuppliersQuery('', pointId)`, «Усі постачальники»), `Switch` «показувати анульовані», kind segmented **«Квитанції | Виплати»** (two tabs over `useIntakesQuery` / `usePayoutsQuery` with the same filter — the API has no merged read). Stats row (display sums over the LOADED page, with hint «на цій сторінці» when `total > data.length`): **«Квитанцій»**/**«Виплат»** (`total`), **«Нараховано»** or **«Видано»** (Σ non-voided `amount`). Columns: Дата (`formatShortDate(business_date)`), Час (local time), Квитанція (`code`, mono), Точка (name via `usePointOptionsQuery`), Постачальник (name via a supplier map from `useSuppliersQuery('', pointId)` — for «Усі точки» load once per point? No: use `useSupplierBalancesQuery({ includeZero: true })` rows as the name source — one call, all points, first/last names; fall back to `supplier_id` prefix when missing), Сума (mono, right), Стан (`Badge`: «Анульовано» secondary + reason title, otherwise «—»). Intake rows open `ReceiptDialog`. Pagination: **«Назад» / «Далі»** over `page` with «{{from}}–{{to}} з {{total}}». Empty: **«За цей період записів немає.»**
- Tests: default month + owner with no point → both tabs render, stats count uses `total`; switching to payouts calls `usePayoutsQuery` with the same range; month change updates `?from&to`; an intake row opens the receipt (mock `@/widgets/receipt`); axe clean.

- [ ] **Step 1: Failing tests** (filters unit + page). **Step 2:** RED. **Step 3:** implement. **Step 4:** focused tests + lint. **Step 5: Commit** `feat(journal): «Журнал прийомки» — the owner's register of receipts and payouts by point, month and supplier`

---

### Task 3: `pages/dashboard` — «Зведення» for today

**Files:**
- Rewrite: `frontend/src/pages/dashboard/ui/DashboardPage.tsx` (+ `.test.tsx`), create `frontend/src/pages/dashboard/api/useNetworkToday.ts` (+ `.test.tsx`)
- Modify: locales (`dashboard` block replaces `dashboard.signedInAs`), `frontend/CLAUDE.md` (the dashboard is no longer a stub)

**Interfaces:**
- `useNetworkToday(pointIds: string[])` → `{ rows: PointToday[]; isPending }` where `PointToday = { pointId, shift: Shift | null, receipts: number, accrued: string, paid: string }` built with `useQueries` over `GET /shifts?collection_point_id&from=today&to=today&limit=1`, `GET /intakes?collection_point_id&from&to&limit=100`, `GET /payouts?…` per point (keys reuse the entity keys: `[...queryKeys.shifts,'on',pointId,today]`, `[...queryKeys.intakes, filter]`, `[...queryKeys.payouts, filter]` so the day page shares them), sums via `sum` over non-voided rows.
- Owner page (`DashboardPage` template): eyebrow **«{{weekday}} · сезон 2026»**, title **«Зведення»**, description «Сьогодні по мережі: зміни, квитанції, гроші й залишки — по точках.»; tiles **«Точок працює»** (`open shifts / active points`), **«Квитанцій сьогодні»**, **«Нараховано»**, **«Видано»** (berry), **«Залишків по мережі»** (amber; Σ `debt` of `useSupplierBalancesQuery({ includeZero: false })` page 1, hint «перші 100» when `total > 100`); section **«Точки сьогодні»**: one `Card` row per active point — name, shift `Badge` (open/closed/none), receipts, нараховано, видано, links **«Каса за день»** (`/day?point=`) and **«Прийомка»** (`/reception?point=`); section **«Найбільші залишки»**: top 5 balance rows (name, point, `formatUah`) linking to `/debts?point=`. Operator page: their point's row only + shortcuts **«Прийомка»**, **«Каса за день»**, **«Залишки»**; no network tiles.
- Tests: owner with two active points (one open shift with 3 intakes / 1 payout, one without a shift) → tiles «1 / 2», «3», sums; the no-shift point shows «Зміну ще не відкрито»; operator sees one row and the three shortcuts; axe clean.

- [ ] **Step 1–5:** RED → implement → GREEN → lint → commit `feat(dashboard): «Зведення» — today across the network for the owner, the point's shortcuts for the operator`

---

### Task 4: Prices for the operator, and a price history

**Files:**
- Modify: `frontend/src/pages/prices/ui/PricesPage.tsx` (+ test), `frontend/src/pages/prices/api/gradePrices.ts` (`usePriceHistoryQuery(pointId, gradeId)` → `GET /grade-prices?collection_point_id&product_grade_id&limit=20`, key `[...queryKeys.gradePrices, 'history', pointId, gradeId]`), create `frontend/src/pages/prices/ui/PriceHistoryDialog.tsx` (+ test), `frontend/src/app/router.tsx` (`/prices` → `RequireAuth` only), `frontend/src/app/layouts/AppLayout.tsx` (`nav.prices` loses its `role` gate), locales

**Behaviour:** `usePointScope()` replaces the page's own point state (operator pinned; owner keeps the picker); an operator sees the table with a `Lock` icon in the action column and the mock's one-line banner above the table: **«Ціну дня виставляє керівник — тут вона лише показана. Кожна зміна лишає слід: хто, коли і чому.»**; owner rows keep «Змінити»/«Встановити». Every priced row gets a ghost **«Історія»** button (both roles) opening `PriceHistoryDialog`: title «{{grade}} · історія», rows `formatShortDate(created_at)` · local time · `base_price` · `max_markup`/`max_discount` · `reason` (muted «—» when null), newest first, empty «Ціну ще не змінювали.»
- Tests: operator → lock + banner, no Change/Set buttons; owner → unchanged behaviour; the history dialog lists rows newest first with the reason.

- [ ] **Step 1–5:** RED → implement → GREEN → `npm run lint -w frontend && npm test -w frontend && npm run build -w frontend` → commit `feat(prices): read-only prices for the operator, and a per-grade price history`

---

## Self-review

- **Coverage:** everything the current API can show that the mock has a screen for — journal (headers), today's overview (headers + balances), operator prices + history. Deliberately not here: per-berry tonnage and season charts (need item details), «Середня ціна по мережі» (needs reweighs/expenses), «Каса точки»/«Ящики»/«Перекази»/«Собівартість»/«Аркуш» (tables do not exist), an audit journal (no `GET /audit` route).
- **Placeholders:** none; each task names its files, hooks, keys, copy and assertions.
- **Type consistency:** `DocumentFilter.from/to/page` (Task 1) used by Tasks 2/3; `useSupplierBalancesQuery({ includeZero })` from the reception plan used by Tasks 2/3; `usePointScope` used by Task 4; `ReceiptDialog({ intakeId, open, onClose })` used by Task 2.
