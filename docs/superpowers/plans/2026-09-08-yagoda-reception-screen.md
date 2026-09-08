# «Прийомка ягоди» (Reception Screen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The intake form at `/reception`: pick a supplier, weigh lines with tare, see the server's preview live, save the receipt, print it, pay out from it, void it; plus the day feed opening receipts.

**Architecture:** New slices per spec §4.1 — `entities/supplier` (list/detail/balances reads; the suppliers page keeps its mutations), `entities/tare-type` (active tare options), `entities/product-grade` gains `usePricedGradesQuery(pointId)`, `entities/intake` gains the detail read; `features/void-document` and `features/settle-payout` (dialogs + mutations, each used by ≥2 pages); the first widget `widgets/receipt` (composed receipt dialog with print, payout and void actions); `pages/reception` (form model, preview mutation with debounce, page UI, tests). No client money arithmetic except display sums via `shared/lib/money`.

**Tech Stack:** React 19, TanStack Query v5, react-hook-form (`useFieldArray`), react-router v8, i18next (`uk` default), vitest + testing-library + vitest-axe, the mock's kit in `shared/ui`.

**Spec:** `docs/superpowers/specs/2026-09-08-yagoda-reception-frontend-design.md` (§2, §3, §4.1–4.6, §5.2, §5.5, §6)

## Global Constraints

- Money/weights are strings; the client sends only what the operator typed; numbers shown come from `POST /intakes/preview` or a saved document; display sums via `@/shared/lib/money` (`sum`, `add`, `sub`, `cmp`, `formatUah`, `formatKg`).
- FSD layers `shared < entities < features < pages < app`; `widgets` sits between `features` and `pages`; add `widgets` to the ESLint `layers` list in `frontend/eslint.config.mjs` (read the existing `forbidLayers` helper and extend the ordered list) in the task that creates the first widget. Slices export through `index.ts`; domain file names.
- Reads: `useQuery` + `queryKeys` + `STALE`; writes invalidate by prefix (an intake write invalidates `intakes`, `supplierBalances`; a payout write invalidates `payouts`, `supplierBalances`; both also `shifts`? no — shifts are untouched).
- API (intakes spec §4 + prep): `POST /intakes` `{ code, collection_point_id?, supplier_id, items: [{ product_grade_id, gross_kg, pallet_kg, bonus, tare: [{ tare_type_id, units }] }] }` → `IntakeDetail`; `POST /intakes/preview` (same body WITHOUT `code`; 200) → `{ collection_point_id, supplier_id, business_date, amount, items: [{ item_order, product_grade_id, gross_kg, pallet_kg, tare_weight_kg, net_kg, price, bonus, amount, tare[] }] }`; `GET /intakes/:id` → `IntakeDetail` (`Intake` header + `items[]` with `id`); `POST /intakes/:id/void` `{ reason }`; `POST /payouts` `{ code, collection_point_id?, supplier_id, amount }`; `POST /payouts/:id/void` `{ reason }`; `GET /suppliers/:id/balance` → `{ supplier_id, debt }`; `GET /supplier-balances?collection_point_id&include_zero&page&limit` → `Paginated<{ supplier_id, first_name, last_name, is_active, collection_point_id, debt }>`; `GET /suppliers?search&limit` (point-scoped by the token for operators; `collection_point_id` for owners — read `backend/src/suppliers/dto/list-suppliers.query.ts` for the exact param); `GET /grade-prices/current?collection_point_id` → rows with `product_grade_id, base_price, max_markup, max_discount`; `GET /tare-types` → `{ id, name, weight_kg, deposit_price, is_crate, is_active }`.
- Error codes to map: intakes — `NO_OPEN_SHIFT` (409), `SUPPLIER_INACTIVE`, `GRADE_NOT_PRICED`, `TARE_REQUIRED`, `TARE_TYPE_DUPLICATED`, `TARE_TYPE_UNKNOWN`, `INTAKE_CODE_TAKEN` (409), `NOT_YOUR_DOCUMENT`, `SHIFT_CLOSED`, `ALREADY_VOIDED`, plus the bonus-range and net-positive 400s from `intake-lines.ts` (read the file for their `code` strings); payouts — `PAYOUT_AMOUNT_ZERO`, `PAYOUT_EXCEEDS_DEBT`, `PAYOUT_CODE_TAKEN`, `NO_OPEN_SHIFT`, `SUPPLIER_INACTIVE`, `NOT_YOUR_DOCUMENT`, `SHIFT_CLOSED`, `ALREADY_VOIDED`. class-validator details for nested items look like `items.0.gross_kg must be …` / `items.0.tare.1.units …` — the mapper must parse the index.
- Receipt-number rule (both documents): typed, required, `^[A-Z0-9][A-Z0-9-]{0,15}$` after trim + upper-case; the server composes the stored code.
- Copy through `t()` keys in `uk.json` (default) + `en.json` (tests render in `en`); the mock's Ukrainian copy from spec §5.2/§5.5 is reused verbatim where it still applies.
- Verification before each commit: `npm run lint -w frontend` + the affected `npx vitest run`; end of the last task: `npm test -w frontend` and `npm run build -w frontend`. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: `entities/supplier` — the supplier reads every money screen needs

**Files:**
- Create: `frontend/src/entities/supplier/model/supplier.ts`, `frontend/src/entities/supplier/api/useSuppliers.ts`, `frontend/src/entities/supplier/api/useSupplierBalances.ts`, `frontend/src/entities/supplier/index.ts`
- Modify: `frontend/src/pages/suppliers/model/supplier.ts` (keep only the input/form types; import `Supplier`, `SupplierKind`, `Paginated` from `@/entities/supplier`), `frontend/src/pages/suppliers/api/suppliers.ts` (drop `useSuppliersQuery`, import it from `@/entities/supplier`; mutations stay), `frontend/src/pages/suppliers/ui/SuppliersPage.tsx` + `SupplierFormDialog.tsx` (import paths), `frontend/src/pages/suppliers/ui/SuppliersPage.test.tsx` (mock `@/entities/supplier` instead of `../api/suppliers` for the list)
- Test: `frontend/src/entities/supplier/api/useSupplierBalances.test.tsx`

**Interfaces:**
- Produces: `Supplier`, `SupplierKind`, `SupplierBalanceRow`, `useSuppliersQuery(search: string, pointId?: string | null)` (as today plus an optional owner point filter → `collection_point_id` param), `useSupplierQuery(id: string | null)` (`GET /suppliers/:id`), `useSupplierBalanceQuery(id: string | null)` → `{ supplier_id, debt }` keyed `[...queryKeys.supplierBalances, 'one', id]`, `useSupplierBalancesQuery({ pointId, includeZero })` → `Paginated<SupplierBalanceRow>` keyed `[...queryKeys.supplierBalances, 'list', filter]`, `enabled` when the caller passes a point or the user is an operator (the caller decides — accept `enabled?: boolean`).

- [ ] **Step 1: Failing test** for `useSupplierBalanceQuery('s1')` (mock `/suppliers/s1/balance` → `{ supplier_id: 's1', debt: '10944.00' }`, expect `data.debt === '10944.00'`) and `useSupplierBalancesQuery({ pointId: 'p1', includeZero: false })` (mock `/supplier-balances` with params `{ collection_point_id: 'p1', include_zero: false, limit: 100 }` → one row; expect the row). Use the `QueryClientProvider` + `axios-mock-adapter` wrapper and module-scope `attachAuthInterceptors(httpClient, …)` exactly as `frontend/src/entities/shift/api/useShifts.test.tsx` does.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/entities/supplier` → FAIL.
- [ ] **Step 3: Implement**

`model/supplier.ts` — move `Supplier`, `SupplierKind`, `Paginated` here verbatim from `pages/suppliers/model/supplier.ts`; add:
```ts
/** One row of `GET /supplier-balances` — the debts list of a point. */
export interface SupplierBalanceRow {
  supplier_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  collection_point_id: string;
  debt: string;
}
export const supplierName = (s: { first_name: string; last_name: string }) => `${s.first_name} ${s.last_name}`;
```
`api/useSuppliers.ts` — `useSuppliersQuery(search, pointId)` copied from the page (same key `[...queryKeys.suppliers, { search, pointId }]`, `STALE.list`, `limit: 100`, add `collection_point_id` only when `pointId`), plus:
```ts
export function useSupplierQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.suppliers, 'one', id],
    enabled: id !== null,
    queryFn: async (): Promise<Supplier> => (await httpClient.get<Supplier>(`/suppliers/${id}`)).data,
    staleTime: STALE.detail,
  });
}
```
`api/useSupplierBalances.ts`:
```ts
export function useSupplierBalanceQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.supplierBalances, 'one', id],
    enabled: id !== null,
    queryFn: async (): Promise<{ supplier_id: string; debt: string }> =>
      (await httpClient.get<{ supplier_id: string; debt: string }>(`/suppliers/${id}/balance`)).data,
    // A balance moves with every receipt and payout; those writes invalidate the prefix.
    staleTime: 30_000,
  });
}
export function useSupplierBalancesQuery(filter: { pointId?: string | null; includeZero?: boolean; enabled?: boolean }) {
  const { pointId, includeZero = false, enabled = true } = filter;
  return useQuery({
    queryKey: [...queryKeys.supplierBalances, 'list', { pointId: pointId ?? null, includeZero }],
    enabled,
    queryFn: async (): Promise<Paginated<SupplierBalanceRow>> =>
      (await httpClient.get<Paginated<SupplierBalanceRow>>('/supplier-balances', {
        params: { ...(pointId ? { collection_point_id: pointId } : {}), include_zero: includeZero, limit: 100 },
      })).data,
    staleTime: 30_000,
  });
}
```
`index.ts` exports all of the above. Update `pages/suppliers` imports; its list read now comes from the entity (the create/update mutations there invalidate `queryKeys.suppliers` — unchanged and still correct).
- [ ] **Step 4: Run** `cd frontend && npx vitest run src/entities/supplier src/pages/suppliers` + lint → PASS.
- [ ] **Step 5: Commit** `feat(supplier): entities/supplier — list, detail and balance reads shared by the money screens`

---

### Task 2: Reads the form and the receipt need — priced grades, tare options, intake detail

**Files:**
- Create: `frontend/src/entities/product-grade/api/usePricedGrades.ts`; `frontend/src/entities/tare-type/model/tare-type.ts`, `frontend/src/entities/tare-type/api/useTareTypeOptions.ts`, `frontend/src/entities/tare-type/index.ts`; `frontend/src/entities/intake/api/useIntake.ts`
- Modify: `frontend/src/entities/product-grade/index.ts`, `frontend/src/entities/intake/model/intake.ts`, `frontend/src/entities/intake/index.ts`
- Test: `frontend/src/entities/product-grade/api/usePricedGrades.test.tsx`

**Interfaces:**
- Produces: `PricedGrade = GradeCatalogItem & { base_price: string; max_markup: string; max_discount: string }`; `usePricedGradesQuery(pointId: string | null)` → `{ data: PricedGrade[]; isPending; isError }` (joins `useGradeCatalogQuery()` with `GET /grade-prices/current?collection_point_id=` keyed `[...queryKeys.gradePrices, pointId]` — reuse the exact key the prices page uses so the two screens share one cache entry; only grades present in the price map are returned, sorted like the catalog).
- `TareTypeOption = { id, name, weight_kg, is_crate }`; `useTareTypeOptionsQuery()` → active tare types (`GET /tare-types`, `include_inactive: false`, key `[...queryKeys.tareTypes, 'options']`, `STALE.reference`).
- `IntakeItem`, `IntakeDetail` (`Intake & { items: IntakeItem[] }`), `useIntakeQuery(id: string | null)` → `IntakeDetail` keyed `[...queryKeys.intakes, 'one', id]`, `STALE.detail`.

- [ ] **Step 1: Failing test** for `usePricedGradesQuery('p1')`: mock `/products` (one product «Малина»), `/product-grades?include_inactive=false` (grades g1, g2), `/grade-prices/current?collection_point_id=p1` (a price only for g1) → data is `[ { id: 'g1', name, productName: 'Малина', base_price: '135.00', max_markup: '30.00', max_discount: '30.00' } ]`, g2 absent.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `usePricedGrades.ts` composes `useGradeCatalogQuery()` and a `useQuery` over `/grade-prices/current` (`CurrentPriceMap`-style reduce as `pages/prices/api/gradePrices.ts` does — copy the 10-line reduce; do not import from `pages`); returns `{ data, isPending: catalog.isPending || prices.isPending, isError: catalog.isError || prices.isError }`. `useTareTypeOptions.ts` mirrors `entities/collection-point/api/usePointOptions.ts`. `intake.ts` adds:
```ts
export interface IntakeItemTare { tare_type_id: string; units: number }
export interface IntakeItem {
  id: string; item_order: number; product_grade_id: string;
  gross_kg: string; pallet_kg: string; tare_weight_kg: string; net_kg: string;
  price: string; bonus: string; amount: string; tare: IntakeItemTare[];
}
export interface IntakeDetail extends Intake { items: IntakeItem[] }
```
- [ ] **Step 4: Run** tests + lint → PASS.
- [ ] **Step 5: Commit** `feat(entities): priced grades per point, tare options, intake detail read`

---

### Task 3: `features/void-document` — «Анулювати» with a reason

**Files:**
- Create: `frontend/src/features/void-document/api/useVoidDocument.ts`, `frontend/src/features/void-document/ui/VoidDocumentDialog.tsx`, `frontend/src/features/void-document/lib/apiErrorToBanner.ts`, `frontend/src/features/void-document/index.ts`
- Test: `frontend/src/features/void-document/ui/VoidDocumentDialog.test.tsx`
- Modify: locales (`void` block)

**Interfaces:**
- Produces: `useVoidDocumentMutation()` → `mutateAsync({ kind: 'intake' | 'payout', id, reason })` posting `/intakes/:id/void` or `/payouts/:id/void`, invalidating `intakes`, `payouts`, `supplierBalances`; `VoidDocumentDialog({ kind, id, code, open, onClose, onVoided? })` — a `Dialog` with title «Анулювати {{code}}?», description from spec §6.5 («Документ не редагується — анулюйте його і випишіть новий»), a required `reason` `Textarea` (`void.errors.reasonRequired`), destructive confirm «Анулювати», cancel; banner keys for `NOT_YOUR_DOCUMENT` («Анулювати може лише той, хто виписав, або керівник»), `SHIFT_CLOSED`, `ALREADY_VOIDED`, fallback `void.errors.failed`; success toast «Документ анульовано».

- [ ] **Step 1: Failing tests** — renders the code in the title; submit without a reason shows the required error and does not call the mutation; with a reason calls `mutateAsync({ kind:'intake', id:'i1', reason:'помилка у вазі' })`, toasts, closes; a rejected mutation with `ApiError(403,'…',undefined,'NOT_YOUR_DOCUMENT')` shows the owner-only banner and stays open. Mock `../api/useVoidDocument` with `vi.hoisted`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** following `pages/prices/ui/SetPriceDialog.tsx`'s scaffold (RHF, `Field` + `Textarea`, `DialogFooter`, `role="alert"` banner). **Step 4: Run** + lint → PASS. **Step 5: Commit** `feat(void-document): void an intake or payout with a reason`

---

### Task 4: `features/settle-payout` — the payout dialog

**Files:**
- Create: `frontend/src/features/settle-payout/api/useCreatePayout.ts`, `frontend/src/features/settle-payout/model/payoutForm.ts`, `frontend/src/features/settle-payout/lib/apiErrorToFields.ts` (+ `.test.ts`), `frontend/src/features/settle-payout/ui/PayoutDialog.tsx` (+ `.test.tsx`), `frontend/src/features/settle-payout/index.ts`
- Modify: locales (`payout` block)

**Interfaces:**
- Produces: `useCreatePayoutMutation()` → `mutateAsync({ code, supplier_id, amount, collection_point_id? })` → `Payout`, invalidating `payouts`, `supplierBalances`; `PayoutDialog({ supplier: { id, first_name, last_name }, pointId, debt: string, defaultAmount?: string, open, onClose, onPaid?(payout) })`.
- Behaviour (spec §5.5): title «Видати залишок — {{name}}», description verbatim from the spec; fields **№ квитанції** (`code`, required, upper-cased, pattern `^[A-Z0-9][A-Z0-9-]{0,15}$`, hint «Номер із паперової книги виплат — система додасть точку й дату»), **Сума видачі** (`amount`, decimal string `^\d{1,8}(\.\d{1,2})?$`, `inputMode="decimal"`, comma → dot on submit, prefilled with `defaultAmount ?? debt`), «Усе — {{uah}}» outline button setting `amount = debt`; client check `cmp(amount, debt) === 1` → field error `payout.errors.exceedsDebt` before submitting; `cmp(amount,'0') !== 1` → `payout.errors.amountZero`. Server codes: `PAYOUT_EXCEEDS_DEBT` → amount field (`payout.errors.exceedsDebtServer` with the message), `PAYOUT_CODE_TAKEN` → code field, `PAYOUT_AMOUNT_ZERO` → amount, `NO_OPEN_SHIFT`/`SUPPLIER_INACTIVE`/`SHIFT_CLOSED` → banner. Success: toast «Видано {{uah}}», `onPaid(payout)`, close.

- [ ] **Step 1: Failing tests** — mapper: `PAYOUT_EXCEEDS_DEBT` lands on `amount`, `PAYOUT_CODE_TAKEN` on `code`, `NO_OPEN_SHIFT` banner, detail `amount must be a decimal…` → amount format key. Dialog: prefilled amount equals `debt`; typing `20000` when debt is `10944.00` shows the exceeds error and does not call the mutation; a valid submit (`code: '00091'`, amount `4000`) calls `mutateAsync({ code:'00091', supplier_id:'s1', amount:'4000', collection_point_id:'p1' })` then toasts and closes; axe clean.
- [ ] **Step 2–5:** RED → implement (RHF, `Field`, `TextInput` with `className="font-mono"`, `formatUah` for the «Усе» label) → GREEN → commit `feat(settle-payout): payout dialog with the debt ceiling mirrored client-side`

---

### Task 5: `widgets/receipt` — the receipt dialog

**Files:**
- Modify: `frontend/eslint.config.mjs` (add `widgets` between `features` and `pages` in the layer order), `frontend/CLAUDE.md` (one line: `widgets/` exists now, why)
- Create: `frontend/src/widgets/receipt/ui/ReceiptDialog.tsx`, `frontend/src/widgets/receipt/ui/ReceiptSheet.tsx`, `frontend/src/widgets/receipt/index.ts`
- Test: `frontend/src/widgets/receipt/ui/ReceiptDialog.test.tsx`
- Modify: locales (`receipt` block)

**Interfaces:**
- Consumes: `useIntakeQuery(id)`, `useSupplierQuery(intake.supplier_id)`, `useSupplierBalanceQuery(intake.supplier_id)`, `useGradeCatalogQuery()`, `useTareTypeOptionsQuery()`, `usePointOptionsQuery()`, `useMeQuery()`, `PayoutDialog`, `VoidDocumentDialog`, `formatUah`, `formatKg`, `formatLongDate`, `cmp`/`sub`.
- Produces: `ReceiptDialog({ intakeId: string | null, open, onClose })`.
- `ReceiptSheet` is the printable body (`className="printable"` — `index.css` already hides everything else under `@media print`): header **«ПРИЙОМКА ЯГОДИ»**, rows Квитанція (code) / Дата (`formatLongDate(business_date)`) / Постачальник / per line: «{product} · {grade}» with Брутто, Піддон (when ≠ 0.00), Тара («{units} × {tare name}» per tare row + `tare_weight_kg`), Нетто, Ціна за кг (`price` and `+bonus` when ≠ 0.00), Сума / Нараховано (amount) / Залишок у цьому пункті (the balance now) / Приймав (received_by display name — only the id is on the wire: show the current user's name when `received_by_user_id === me.id`, else «—»; the users list is owner-only, so no lookup) / footer «Квитанція збережена в системі. Дублікат можна роздрукувати будь-коли.»; a voided document shows a red **«АНУЛЬОВАНО»** stamp with the reason.
- Actions row (`print-hide`): **«Друк»** (`window.print()`), **«Видати готівкою»** (hidden when voided or when `cmp(balance,'0') !== 1`; opens `PayoutDialog` with `defaultAmount = min(amount, debt)` via `cmp`), **«Анулювати»** (shown when not voided and (`me.role === 'network_owner'` or `me.id === received_by_user_id`); opens `VoidDocumentDialog`), **«Закрити»**.

- [ ] **Step 1: Failing tests** (mock every entity hook via `vi.hoisted`): renders the composed code, supplier name, the line «Малина · 1 сорт», `112.00 kg`, `135.00`, the amount `14,560.00 ₴` (en); «Pay out» opens the payout dialog with the amount prefilled to `min(amount, debt)` (mock `PayoutDialog` from `@/features/settle-payout` and assert its `defaultAmount` prop); «Void» hidden for a non-author operator, shown for the owner; a voided intake shows the stamp and hides Pay out/Void; axe clean.
- [ ] **Step 2–5:** RED → implement → GREEN → lint (the new `widgets` layer must be allowed to import `features`/`entities`/`shared` and forbidden to import `pages`/`app`) → commit `feat(receipt): widgets/receipt — the printable receipt with pay-out and void actions`

---

### Task 6: `pages/reception` — form model, preview, create, error mapping

**Files:**
- Create: `frontend/src/pages/reception/model/intakeForm.ts`, `frontend/src/pages/reception/api/intakes.ts`, `frontend/src/pages/reception/lib/apiErrorToFields.ts` (+ `.test.ts`), `frontend/src/pages/reception/lib/useIntakePreview.ts` (+ `.test.tsx`), `frontend/src/pages/reception/lib/receiptCode.ts` (+ `.test.ts`)

**Interfaces:**
- `IntakeFormValues = { code: string; supplier_id: string; items: IntakeLineValues[] }`, `IntakeLineValues = { product_grade_id: string; gross_kg: string; pallet_kg: string; bonus: string; tare: { tare_type_id: string; units: string }[] }` (strings while editing; `units` parsed with `Number.parseInt` — an integer count, not money); `emptyLine(defaultTareTypeId)`; `toPreviewBody(values, pointId | null)` → `{ collection_point_id?, supplier_id, items: [...] }` (trims, comma→dot on the three decimals, drops tare rows with `units < 1`, `units` as number); `toCreateBody(values, pointId)` = preview body + `code: normalizeCode(values.code)`; `normalizeCode(raw)` → trimmed upper-case; `isValidCode(raw)`.
- `useCreateIntakeMutation()` → `mutateAsync(body)` → `IntakeDetail`, invalidates `intakes`, `supplierBalances`; `usePreviewIntakeMutation()` → `mutateAsync(previewBody)` → `IntakePreview` (type the response from Global Constraints).
- `useIntakePreview(values, pointId, { enabled })` → `{ preview: IntakePreview | null; error: MappedErrors | null; isPending }`: debounces the serialized preview body 250 ms, fires the preview mutation when the body is *previewable* (a supplier, ≥1 line with a grade, gross > 0 and ≥1 tare row with units ≥ 1), keeps the last successful preview while a new one is in flight, discards stale responses (compare a request counter), maps a 400/409 through `apiErrorToFields`.
- `apiErrorToFields(error, lineCount)` → `{ fieldErrors: { field: string; messageKey: string }[]; formErrorKey: string | null }` where line-scoped fields are named RHF-style `items.${i}.gross_kg`, `items.${i}.tare.${j}.units`, `items.${i}.bonus`; codes: `INTAKE_CODE_TAKEN` → `code` (`reception.errors.codeTaken`), `GRADE_NOT_PRICED`/`TARE_REQUIRED`/`TARE_TYPE_DUPLICATED`/`TARE_TYPE_UNKNOWN` and the bonus/net codes → the line the message names if it carries an index, else the last line; `NO_OPEN_SHIFT`, `SUPPLIER_INACTIVE`, `SHIFT_CLOSED` → banner keys; class-validator `items.0.gross_kg …` → that field with `reception.errors.decimalFormat`.

- [ ] **Step 1: Failing tests** — `receiptCode`: `normalizeCode(' 00412 ') === '00412'`, `isValidCode('ab-1')` true after upper-casing, `isValidCode('')`/`isValidCode('a'.repeat(17))` false. `apiErrorToFields`: each code above lands where stated (build `ApiError` as `new ApiError(status, message, details, code)` — see `shared/api/client.ts`). `useIntakePreview` (renderHook with fake timers): no call while the form is not previewable; one call 250 ms after the last change of two rapid edits; a stale earlier response never overwrites a later one; a 400 maps into `error`.
- [ ] **Step 2–5:** RED → implement (`useDebouncedValue` from `@/shared/lib/useDebouncedValue` for the serialized body; the mutation via `useMutation`; a `useRef` request counter) → GREEN → commit `feat(reception): intake form model, server preview with debounce, create mutation, error mapping`

---

### Task 7: `pages/reception/ui` — the screen

**Files:**
- Create: `frontend/src/pages/reception/ui/ReceptionPage.tsx`, `SupplierSection.tsx`, `LineEditor.tsx`, `LinesTable.tsx`, `TotalsSection.tsx`, `TodayReceipts.tsx`, `ShiftBanner.tsx`, `frontend/src/pages/reception/ui/ReceptionPage.test.tsx`, `frontend/src/pages/reception/index.ts`
- Modify: locales (`reception` block — the spec's §5.2 copy), `frontend/src/app/router.tsx` (`/reception`, `RequireAuth`), `frontend/src/app/layouts/AppLayout.tsx` (`nav.reception` → `to: '/reception'`, `nav.day` already wired)

**Layout (spec §5.2, the mock's `ReceptionPage`):** `PageHeader` (eyebrow «{point} · {longDate(today)}», title **«Прийомка ягоди»**, actions: «Ціни дня» outline → `/prices` (owner only), «Каса за день» secondary → `/day`); owner point picker in the toolbar (`usePointScope`); `ShiftBanner` when `useCurrentShiftQuery(pointId)` is `null` (operator: «Зміну не відкрито» + **«Відкрити зміну»** calling the same `POST /shifts` mutation — import `useOpenShiftMutation` from `@/pages/day`? NO (pages cannot import pages): duplicate the 8-line mutation into `pages/reception/api/intakes.ts` as `useOpenShiftMutation` — note the duplication in a comment; owner: «Зміну не відкрито — відкриває приймальник»); the form is disabled until a shift is open. Grid `xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]`: left `Card` with four numbered sections separated by `border-t border-border` (`Eyebrow` «1 · Постачальник», «2 · Вага з тарою», «3 · Товар, сорт і ціна дня», «4 · Розрахунок»); right column `TodayReceipts` (`Card`, eyebrow **«Сьогоднішні квитанції»**, count badge, rows = this shift's intakes newest first, click → `ReceiptDialog`; empty **«Ще нічого не прийнято. Перша квитанція зʼявиться тут.»**).
- `SupplierSection`: a `TextInput type="search"` («Прізвище або телефон…») + the filtered list of the point's suppliers (`useSuppliersQuery(search, pointId)`, active only, first 30) as a `Card` list of buttons (name, kind badge via `suppliers.kindLabel.*`, `aria-current` on the chosen one); when chosen: the row collapses into a chip with «Змінити»; the balance banner from `useSupplierBalanceQuery` (**«Попередній залишок {uah}»** amber when > 0 / **«Переплата за нами {uah}»** leaf when < 0); **«Історія здач»** — last 5 of `useIntakesQuery({ supplierId, limit: 5 })` (code · date · amount) with a link **«Картка постачальника»** → `/suppliers/:id` (route lands in the debts portion; render the link anyway).
- `LineEditor` (the draft line, RHF `useFieldArray` index `draftIndex`): **№ квитанції** input sits above section 2 (mono, uppercase, required, hint from spec §5.2); **Брутто** (`h-14`, mono `text-2xl`, `inputMode="decimal"`, placeholder `0,00`, suffix «кг»), **«+ Піддон»** ghost reveals the pallet input; tare rows (type `SelectField` over `useTareTypeOptionsQuery()` showing «{name} {weight_kg} кг», units stepper `−`/input/`+` with min 1, trash when > 1 rows, **«Інша тара»** adds the first unused type); **Товар** `SelectField` (distinct `productName` from `usePricedGradesQuery(pointId)`), **Сорт і ціна дня** `SelectField` (grades of that product, label «{name} · {base_price} ₴/кг»), **Дод. ціна** stepper (`−`/input/`+`, step 1, decimal, negatives allowed) with «межі: −{max_discount} … +{max_markup} ₴/кг» of the chosen grade and an amber note «поза межею» when `cmp` says so (no clamp); the preview line for the draft: «тара {tare_weight_kg} · нетто {net_kg} · {price}+{bonus} → {amount}» (muted «…» while pending, the mapped line error in `text-destructive` when the server refused). Client warnings (never blocking, `text-amber`): gross > 750 → «{gross} кг — більше за найбільший рядок сезону (701,5 кг). Перевірте брутто.»; per-crate (`net / units`) outside 2–14 → «{n} кг у ящику. Перевірте брутто або кількість тари.» — compute the per-crate figure ONLY from the preview's `net_kg` and the integer units, with `BigInt` kopiyka division in `shared/lib/money` (`div(a: string, by: number)` — add it in this task with a test) so no float touches money.
- **«Ще позиція»** (cap 5 lines total: 4 committed + draft) commits the draft into `LinesTable` (columns Сорт · Брутто · Піддон · Тара · Нетто · Ціна · Сума from the preview's items, trash per row) and resets the draft (default tare = the first crate type).
- `TotalsSection`: **«Нараховано»** = preview `amount`; when balance > 0: **«Попередній залишок»** and **«Разом до видачі»** (`add`); submit button full-width `h-14` **«Прийняти {N позицій · }{kg}»** (label from the preview's summed `net_kg` via `sum`; `disabled` until `isValidCode(code)`, a supplier, ≥1 previewable line, no line error, preview settled); on success: `toast.success('Прийнято {kg} — {uah}')`, open `ReceiptDialog` for the created id, reset the form (keep the supplier? NO — the mock resets everything; reset all).
- Tests (mock `@/entities/*`, `@/features/*`, `@/widgets/receipt`, `../api/intakes`, `../lib/useIntakePreview` — the preview hook is mocked to return a fixed preview so the UI test is deterministic): (1) no open shift → banner + disabled submit; (2) picks a supplier by search, sees the balance banner and history; (3) types a code, gross, one tare row with units, picks product+grade → the preview line shows `net_kg`/`amount`; submit calls `createMock` with `{ code:'00412', supplier_id:'s1', items:[{ product_grade_id:'g1', gross_kg:'126.40', pallet_kg:'0.00', bonus:'0.00', tare:[{ tare_type_id:'t1', units:12 }] }] }` (no `collection_point_id` for an operator) and opens the receipt; (4) «Ще позиція» moves the draft into the table and the cap disables it at 5; (5) a mapped server error on `items.0.gross_kg` shows under the gross field; (6) axe clean at rest and with a supplier chosen.

- [ ] **Step 1: Failing tests** (write all six). **Step 2: Run** → FAIL. **Step 3: Implement** in the file split above — each section is a component taking `control`/`register` from the page's `useForm`; keep the page under ~250 lines. **Step 4:** focused tests + lint. **Step 5: Commit** `feat(reception): «Прийомка ягоди» — supplier, weights and tare, priced grades, live server preview, receipt`

---

### Task 8: Wire-up — day feed opens receipts, nav, locales, full verification

**Files:**
- Modify: `frontend/src/pages/day/ui/DayPage.tsx` (+ test): intake rows in the feed become buttons that open `ReceiptDialog` (`widgets/receipt`); `frontend/src/app/layouts/AppLayout.tsx` (`nav.reception` `to`), `frontend/src/app/router.tsx` (`/reception`), `frontend/CLAUDE.md` (routes list, `widgets/` line if Task 5 did not add it)

- [ ] **Step 1:** add a DayPage test: clicking an intake row opens the receipt dialog for that id (mock `@/widgets/receipt`'s `ReceiptDialog` and assert `intakeId`). **Step 2:** RED. **Step 3:** implement. **Step 4:** `npm run lint -w frontend && npm test -w frontend && npm run build -w frontend` → green. **Step 5: Commit** `feat(day,app): day feed opens the receipt; /reception routed and in the nav`

---

## Self-review

- **Spec coverage:** §3 decisions → Tasks 6/7 (typed code, preview, no client math, cap 5, shift banner, priced grades, void, payout from receipt); §4.1 slices → Tasks 1–5, 7; §4.2 keys/invalidation → Tasks 1–4, 6; §4.3 RHF + field mapping → Tasks 6/7; §4.4 point scope → Task 7; §4.5 route/nav → Tasks 7/8; §4.6 money → Task 7's `div`; §5.2 screen → Task 7; §5.5 payout dialog → Task 4; §6 tests → every task. Not covered here (next portion): `/debts`, `/suppliers/:id` (the link renders; the route lands with the debts plan).
- **Placeholders:** none — where a task says «follow X's scaffold», X is a named existing file; every behaviour has its copy key and its assertion.
- **Type consistency:** `useSupplierBalanceQuery(id)` → `{ supplier_id, debt }` used by Tasks 5/7; `PayoutDialog` props `{ supplier, pointId, debt, defaultAmount, open, onClose, onPaid }` used by Task 5; `ReceiptDialog({ intakeId, open, onClose })` used by Tasks 7/8; `usePricedGradesQuery(pointId).data: PricedGrade[]` used by Task 7; `IntakePreview` shape from Global Constraints used by Tasks 6/7; `useIntakePreview(values, pointId, { enabled })` return `{ preview, error, isPending }` used by Task 7.
