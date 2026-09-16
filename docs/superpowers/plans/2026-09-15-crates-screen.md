# Crates Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** «Ящики» — the point's crate standing: who is holding how many, on what terms, and the two gestures that move them (видати / прийняти).

**Architecture:** One additive backend route (`GET /crate-balances`, the point-level list twin of `GET /suppliers/:id/crate-balance`, mirroring how `/supplier-balances` twins `/suppliers/:id/balance`), then an `entities/crate` read slice, two write features, and the page. Built on top of PR #92's crates slice; **nothing in `backend/src/crates/` is edited** — only added alongside.

**Tech Stack:** NestJS + TypeORM raw SQL, Jest · React 19, TanStack Query v5, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-15-yagoda-mock-ui-catchup.md` (§1 names the screen; this plan adds §6 below)

## Global Constraints

- **Do not edit any file PR #92 owns.** That branch is still receiving fixes; every rebase must stay trivial. New files only, plus the frontend.
- Money is a DECIMAL STRING end to end (`deposit_taken`, `deposit_held`, `deposit_refund`). Crate COUNTS are integers — `units`, `outstanding_units`, `target_crates` — and the two must never be added together.
- `mode` is `'deposit' | 'receipt'`. §6.4: «різниця лише в грошах» — both put crates on the balance identically. A receipt tranche has **no cash cover at all**, so its deposit column shows «—», **never `0`** (the mock's own note makes this the point of the screen).
- The allotment (`target_crates`) is changed by the **owner only** — §10.2, so the button is ABSENT for an operator, not disabled. An allotment BELOW what is already out is allowed **with a warning**, never refused (§6.1).
- An empty `target_crates` means «не задано», **not zero**, and must not block anything (правка 14).

## What this screen deliberately does NOT show

The mock's `CrateStandingBar` has four figures: Наділ, **Пустих на точці**, У людей, **У нас з ягодою**; and a «Відправлення за сьогодні» dialog. Two of those four and the shipments dialog rest on `crate_shipments` / on-hand tracking, which **is not in the DBML's seventeen tables and has no backend**. They are out of scope and get an issue rather than a fabricated number.

---

### Task 1: `GET /crate-balances` — the point-level twin

**Files:**
- Create: `backend/src/crates/dto/list-crate-balances.query.ts`
- Create: `backend/src/crates/crate-balances.controller.ts`
- Modify: `backend/src/crates/crates.module.ts` (register the controller — the ONE line this plan touches in a #92 file)
- Create: `backend/src/crates/crate-balances.service.ts` + `.spec.ts`
- Create: `backend/src/crates/crate-balances.db-spec.ts`

**Interfaces:**
- Produces:
```ts
export interface CrateBalanceRowResponse {
  supplier_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  collection_point_id: string;
  outstanding_units: number;
  /** Cash cover. A supplier holding ONLY receipt tranches has `'0.00'` here
   *  and `outstanding_units > 0` — the screen renders «—», never a zero. */
  deposit_held: string;
  /** True when at least one live tranche was taken on a paper розписка. */
  has_receipt: boolean;
}
```

- [ ] **Step 1: Write the query DTO**

Mirror `ListSupplierBalancesQueryDto` exactly — `collection_point_id`, `include_zero: boolean = false`, extending `PaginationQueryDto`. Carry a header saying it is the twin and why (the list belongs under its own noun; `/crate-balances` shares a prefix with nothing).

- [ ] **Step 2: Write the failing service test**

```ts
it('pins an operator to their own point and ignores a requested one', async () => {
  await service.list(operatorAtA, { collection_point_id: POINT_B, page: 1, limit: 20 });
  expect(manager.query.mock.calls[0][1]).toContain(POINT_A);
});

it('excludes suppliers holding nothing unless include_zero', async () => { /* ... */ });

it('reports a receipt-only holder as units > 0 with no deposit', async () => {
  // The whole reason `has_receipt` exists: `deposit_held === '0.00'` is
  // ambiguous on its own — it is also what a fully refunded deposit holder
  // looks like.
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -w backend -- crate-balances`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Reuse `crateBookSql` from `crate-balance.service.ts` (already exported there — that is why it is exported) so this list and the single read cannot disagree about what «outstanding» means. Scope with `resolvePointFilter`. Order total: `outstanding_units DESC, last_name, first_name, supplier_id`.

- [ ] **Step 5: db-spec against real Postgres**

Prove: a supplier with a live issuance appears; one whose issuance was voided does not; one whose returns consumed everything does not (unless `include_zero`); a receipt-only holder has `has_receipt: true` and `deposit_held: '0.00'`; an operator gets only their point.

- [ ] **Step 6: Run and commit**

```bash
npm test -w backend -- crate
npm run lint -w backend
npm run test:db -w backend -- crate-balances
git commit -m "feat(crates): GET /crate-balances — the point's crate standing in one read"
```

---

### Task 2: `entities/crate`

**Files:**
- Create: `frontend/src/entities/crate/model/crate.ts`
- Create: `frontend/src/entities/crate/api/useCrateBalances.ts`, `useCrateIssuances.ts`, `useCrateReturns.ts`
- Create: `frontend/src/entities/crate/index.ts`
- Modify: `frontend/src/shared/api/queryKeys.ts` (`crates`, `crateBalances`)

**Interfaces:**
- Produces: `useCrateBalancesQuery({pointId})`, `useCrateBalanceQuery(supplierId)`, `useCrateIssuancesQuery(filter)`, `useCrateReturnsQuery(filter)`, and the types mirroring #92's mappers verbatim.

- [ ] **Step 1: Mirror the wire types**

Copy `CrateIssuanceResponse`, `CrateReturnResponse`, `CrateReturnPreviewResponse`, `CrateBalanceResponse`, `CrateTrancheView` from `backend/src/crates/*.mapper.ts` and `crate-balance.service.ts`. `mode` is a union of the two literals, not a bare string.

- [ ] **Step 2: Query keys**

```ts
  /** Ящики — префікс для видач і повернень; читання дописує свій фільтр. */
  crates: ['crates'] as const,
  /** Складські залишки ящиків — і список точки, і баланс однієї людини. */
  crateBalances: ['crate-balances'] as const,
```

- [ ] **Step 3: The hooks**

Follow `entities/payout`'s shape. `enabled` on the filter that scopes them; `staleTime: STALE.list`.

- [ ] **Step 4: Lint and commit**

---

### Task 3: `features/issue-crates` and `features/return-crates`

**Files:**
- Create: `frontend/src/features/issue-crates/{api,ui,index.ts}`
- Create: `frontend/src/features/return-crates/{api,ui,index.ts}`
- Modify: `frontend/src/features/void-document/api/useVoidDocument.ts` (+ the dialog's union)
- Modify: both locale files

- [ ] **Step 1: `IssueCratesDialog`**

Fields: supplier (picker, scoped to the point), `units` (integer ≥ 1), `mode` (deposit / receipt). The dialog must SAY what each mode means, because that is the whole difference: `deposit` takes money now, `receipt` takes a signature and **no cash cover at all**.

- [ ] **Step 2: `ReturnCratesDialog` with the live preview**

`POST /crate-returns/preview` on every change of supplier or units (debounced), rendering the **FIFO split the server computed** — tranche by tranche, each at the price it was taken at (§6.5) — plus `deposit_refund` and `shortfall`.

**The preview is the point of this dialog.** §6.5 says the operator is never asked to choose which tranche a return comes from, so the screen must SHOW the choice the server made, or the refund looks arbitrary. Never recompute the split client-side.

`shortfall > 0` means the person is bringing back more than they took — surface it as a named condition, not a silent clamp.

- [ ] **Step 3: Two more void kinds**

```ts
  crateIssuance: {
    path: (id) => `/crate-issuances/${id}/void`,
    invalidates: [queryKeys.crates, queryKeys.crateBalances],
  },
  crateReturn: {
    path: (id) => `/crate-returns/${id}/void`,
    invalidates: [queryKeys.crates, queryKeys.crateBalances],
  },
```

Neither touches `supplierBalances`: crates are not money owed for berries. `pointCash` IS touched by a deposit issuance, so include it — check what #92's own service invalidates conceptually and match it.

- [ ] **Step 4: Tests for both dialogs**

```tsx
it('sends units as an integer and the chosen mode', async () => {});
it('refuses zero and fractional units', async () => {});
it('renders the server FIFO split rather than recomputing it', async () => {});
it('names a shortfall instead of silently clamping', async () => {});
it('explains what a розписка means before the operator picks it', async () => {});
```

---

### Task 4: `pages/crates`

**Files:**
- Create: `frontend/src/pages/crates/{ui,index.ts}`
- Modify: `frontend/src/app/router.tsx`, `frontend/src/app/layouts/AppLayout.tsx` (nav)
- Modify: both locale files

- [ ] **Step 1: The standing bar**

Two figures only — **Наділ** (`target_crates`, «—» when unset) and **У людей** (Σ `outstanding_units`). The mock's other two rest on a backend that does not exist; see «What this screen deliberately does NOT show» above, and say so on screen rather than leaving a reader to wonder.

When `target_crates` is set and «у людей» exceeds it, warn — never block (§6.1).

- [ ] **Step 2: The in-field table**

Columns: Людина · Ящиків · Як брала · Завдаток, with a РАЗОМ row. «Завдаток» renders «—» for a receipt-only holder, never `0` — the mock's note on this screen is explicitly about that difference.

Clicking a person opens their tranches (`GET /suppliers/:id/crate-balance`), which is where a void becomes reachable.

- [ ] **Step 3: Role handling**

«Змінити наділ» is owner-only and ABSENT otherwise (§10.2). Both gestures are open to both roles — the operator is the one standing at the table.

- [ ] **Step 4: Route and nav**

`/crates`, `RequireAuth` without a role gate (both roles), in the «Робота на точці» nav group, matching the mock's order: after «Прийомка», before «Каса за день».

- [ ] **Step 5: Page tests**

```tsx
it('shows «—» for an unset allotment, never 0', () => {});
it('warns, but does not block, when more crates are out than the allotment', () => {});
it('renders «—» in the deposit column for a receipt-only holder', () => {});
it('never offers «Змінити наділ» to an operator', () => {});
it('totals the units column', () => {});
```

- [ ] **Step 6: The full gate — all three commands**

```bash
npm test
npm run lint
npm run build      # tsc -b: Vitest does NOT type-check, and CI surfaces this
                   # only as «Build (and push) nginx image» failing
```

- [ ] **Step 7: Look at it in the browser**

```bash
docker compose up -d && npm run db:seed
```
#92 seeds Василь Яремчук with two deposit tranches at different prices and Христина Каленчук with a receipt issuance. Confirm: the table shows both, the receipt holder's deposit column reads «—», and a partial return of Василь's crates refunds from the OLDER tranche at ITS price.

- [ ] **Step 8: Commit, PR, stack**

```bash
git push -u origin feat/crates-screen
gh pr create --base feat/box-distribution --title "feat(crates): «Ящики» — the point's crate standing"
gh stack link 92 <new-pr>    # only once the head shows mergeable=clean and CI has started
```
