# «Залишки за нами» + картка постачальника Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/debts` — every supplier's outstanding balance at a point with «Видати без ягоди»; `/suppliers/:id` — one supplier's balance, tiles and the timeline of receipts and payouts, with settlement and receipt viewing.

**Architecture:** Two new page slices over the reads that already exist (`entities/supplier` balances list + detail, `entities/intake`/`entities/payout` by supplier), the shared `features/settle-payout` dialog and the `widgets/receipt` dialog. No new backend, no new entity. Point scope via `usePointScope`.

**Tech Stack:** React 19, TanStack Query v5, react-router v8, i18next (`uk` default), vitest + testing-library + vitest-axe.

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-reception-frontend-design.md` §5.3, §5.4 (and §3 for what the balance is: ONE number, no per-receipt breakdown, no FIFO dates).

## Global Constraints

- Money strings; display sums via `@/shared/lib/money` (`sum`, `cmp`, `isNegative`, `isZero`, `formatUah`); dates via `@/shared/lib/date`.
- Reads: `useSupplierBalancesQuery({ pointId, includeZero, enabled })` → `Paginated<SupplierBalanceRow>` (`{ supplier_id, first_name, last_name, is_active, collection_point_id, debt }`, ordered `debt DESC`, `limit 100`), `useSupplierQuery(id)`, `useSupplierBalanceQuery(id)` → `{ supplier_id, debt }`, `useIntakesQuery({ supplierId, limit: 100 })`, `usePayoutsQuery({ supplierId, limit: 100 })`, `usePointOptionsQuery()`.
- `PayoutDialog({ supplier: { id, first_name, last_name }, pointId, debt, defaultAmount?, open, onClose, onPaid? })` from `@/features/settle-payout`; `ReceiptDialog({ intakeId, open, onClose })` from `@/widgets/receipt`; `VoidDocumentDialog` from `@/features/void-document` for payout rows on the card.
- Roles: both roles use both pages; an operator is pinned to their point (`usePointScope`), an owner sees ALL points on `/debts` by default and may narrow with the picker (`?point=`).
- Copy through `t()` (`uk` default, `en` for tests); the mock's Ukrainian copy from spec §5.3/§5.4 verbatim where it still applies. FSD layers with `widgets`; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; lint + focused tests per commit; full suite + build at the end.

---

### Task 1: `pages/debts` — «Залишки за нами»

**Files:**
- Create: `frontend/src/pages/debts/ui/DebtsPage.tsx` (+ `.test.tsx`), `frontend/src/pages/debts/index.ts`
- Modify: `frontend/src/app/router.tsx` (`/debts`, `RequireAuth`), `frontend/src/app/layouts/AppLayout.tsx` (`nav.debts` → `to: '/debts'`), locales (`debts` block, insert before `"theme"`)

**Behaviour (spec §5.3):**
- `ListPage` template. Eyebrow **«{{count}} постачальників»** (`t('debts.eyebrow', { count: total })` with plural keys `eyebrow_one/_few/_many/_other`), title **«Залишки за нами»**, description (mock verbatim): «Кожен залишок памʼятає, за яку саме здачу він виник. Гроші тут видають тому, хто прийшов без ягоди — якщо ягода є, залишок сам додається в «Разом» у віконечку прийомки.» (drop the middle sentence about the daily report).
- Toolbar: owner point `SelectField` («Усі точки» + points; operator: none), `TextInput type="search"` «Знайти постачальника» (client-side filter over loaded rows by `supplierName`, case-insensitive).
- Stats (`StatItem`s in the `stats` slot via `StatGrid` + `StatTile`): **«Всього винні»** = `sum(rows.filter(debt > 0).map(debt))` amber, hint «на цій сторінці» when `total > data.length`; **«Постачальників із залишком»** = `total`.
- Columns: Постачальник (`supplierName`, `font-medium`; `Badge variant="secondary"` «неактивний» when `!is_active`), Точка (name via `usePointOptionsQuery`, `hideBelow: 'sm'`, shown only when no point is picked), Залишок (mono, right; `isNegative(debt)` → leaf «переплата {{uah}}», else amber `formatUah`), action: `Button size="sm"` **«Видати без ягоди»** (disabled when `!(cmp(debt,'0') === 1)`) → `PayoutDialog` with `debt`, `pointId: row.collection_point_id`; row click → navigate `/suppliers/${supplier_id}`.
- Empty: **«Відкритих залишків немає»** / **«Усі здачі розраховані повністю.»**; owner with no picked point still lists all (the API scopes owners to everything).
- Tests: operator with 3 rows (one negative, one inactive) → tiles «Total owed 18,670.40 ₴» (only positives), «2» suppliers? — use the envelope `total` (3); negative row shows «overpaid»; inactive row shows the badge; search «Кушн» leaves one row; «Pay out» on the first row opens `PayoutDialog` with `debt` (mock `@/features/settle-payout` and assert props); row click navigates to `/suppliers/s1` (memory router); owner without a point shows the point column and the picker; axe clean.

- [ ] **Step 1–5:** RED → implement → GREEN → lint → commit `feat(debts): «Залишки за нами» — balances per point with «Видати без ягоди»`

---

### Task 2: `pages/supplier-card` — картка постачальника

**Files:**
- Create: `frontend/src/pages/supplier-card/ui/SupplierCardPage.tsx` (+ `.test.tsx`), `frontend/src/pages/supplier-card/ui/SupplierTimeline.tsx`, `frontend/src/pages/supplier-card/index.ts`
- Modify: `frontend/src/app/router.tsx` (`/suppliers/:id`, `RequireAuth`, declared alongside `/suppliers`), locales (`supplierCard` block), `frontend/src/pages/suppliers/ui/SuppliersPage.tsx` (a «Картка» link column → `/suppliers/${id}`; row click keeps opening the edit dialog) + its test

**Behaviour (spec §5.4):**
- `useParams().id` → `useSupplierQuery(id)`; 404 → centred muted **«Картку не знайдено.»**; back link **«Усі постачальники»** → `/suppliers`.
- Header (`PageHeader`): eyebrow «{{point}} · {{kind}}», title = `supplierName`, description = phone or **«телефон не вказано»** + note in guillemets when present; actions: **«Видати залишок {{uah}}»** (`cmp(debt,'0') === 1`) → `PayoutDialog` (`defaultAmount = debt`).
- Tiles: **«Здач за сезон»** (`intakes.total`), **«Нараховано»** (Σ non-voided loaded intakes, hint «перші 100» when truncated), **«Видано»** (Σ non-voided loaded payouts), **«Залишок»** (`formatUah(debt)`, tone amber when > 0, leaf when ≤ 0, hint «усе розраховано» when zero).
- `SupplierTimeline`: intakes + payouts merged by `created_at` desc; intake row: `formatShortDate(business_date)` · local time · `code` · **«Квитанція»** badge · amount; payout row: «Видано» badge (outline) · code · amount (leaf); voided rows struck through with the reason as `title`; intake rows open `ReceiptDialog`; payout rows expose **«Анулювати»** (owner or `paid_by_user_id === me.id`) → `VoidDocumentDialog({ kind: 'payout' })`. Empty **«Здач ще не було — це буде перша.»**
- Tests: renders name/phone/point, tiles from mocked data (2 intakes one voided, 1 payout), the voided row struck through, «Pay out balance» visible when debt > 0 and hidden when zero; intake row opens the receipt (mock widget); a 404 supplier → «Card not found»; axe clean.

- [ ] **Step 1–5:** RED → implement → GREEN → lint → commit `feat(supplier-card): the supplier's balance, tiles and timeline of receipts and payouts`

---

### Task 3: Wire-up and full verification

**Files:**
- Modify: `frontend/CLAUDE.md` (routes list gains `/debts`, `/suppliers/:id`), `frontend/src/pages/reception/ui/SupplierSection.tsx` if the «Картка постачальника» link there is still a placeholder (point it at `/suppliers/:id`)

- [ ] **Step 1:** `npm run lint -w frontend && npm test -w frontend && npm run build -w frontend` → green. **Step 2: Commit** `docs(frontend): routes for debts and the supplier card`

---

## Self-review

- **Coverage:** §5.3 (tiles reduced to two by the spec's own decision, list rows, search, settle, link to card, owner all-points) → Task 1; §5.4 (header, tiles, timeline, settle, receipt, void payout, not-found) → Task 2; routes/nav/docs → Tasks 1–3.
- **Placeholders:** none.
- **Type consistency:** `SupplierBalanceRow` fields, `PayoutDialog` props and `ReceiptDialog` props match the reception plan's Tasks 1, 4, 5; `usePointScope` from the day plan.
