# #145 Payout Receipt & Sectioned Receipt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Print a receipt for a standalone payout («Видати без ягоди»), with a balance frozen at payout time, and rebuild every receipt from one sectioned model with a common header and footer.

**Architecture:** Backend gains `payouts.balance_after` (written by `PayoutWriter` under the supplier lock, backfilled by migration) and staff name parts on the payout/intake detail responses. Frontend gains a pure `ReceiptDocument` model + `ReceiptView` renderer in `shared/ui/receipt.tsx`; two pure builders in `widgets/receipt/model` turn an intake / a payout into a document; `ReceiptDialog` (intake) and a new `PayoutReceiptDialog` render it.

**Tech Stack:** NestJS 11 + TypeORM + Postgres (backend), React 19 + TanStack Query + i18next + Tailwind/shadcn, Vitest + Testing Library (frontend), Jest (backend; `npm test` in `backend/`, never bare `npx jest`).

**Spec:** `docs/superpowers/specs/2026-10-13-issue-145-receipts-design.md` — read it first.

## Global Constraints

- Work only in the worktree `/home/dz/Work/yagoda-starter/.claude/worktrees/145-payout-receipt`, branch `feat/145-payout-receipt`.
- DB tests: `TEST_DB_NAME=feat145_test` on every `npm run test:db` / db-spec run (other sessions share `app_test`). Run the WHOLE db suite on one database before claiming green.
- Money: every arithmetic on a `numeric` goes through `backend/src/common/money.ts` (`sub`, `add`, …). No `Number()`, `*`, `/`, `toFixed`, `parseFloat` in money modules. Frontend: no arithmetic on money for the payout receipt — only `formatUah`.
- Header copy: title always «КВИТАНЦІЯ»; under it `{pointName} · {last_name} {first_name}`.
- Meta rows, in order: «№ квитанції», «Операція», «Дата», «Постачальник». Operation values: «Прийомка ягоди» (intake), «Видача боргу» (payout with `intake_id === null`).
- Footer, centred, in order: network `receipt_note` lines (if any) → «Дякуємо за співпрацю!» → small «Не є фіскальним чеком». The screen-only line «Квитанція збережена в системі…» stays screen-only (`print:hidden`).
- Payout receipt totals: «Видано готівкою» (strong) = `amount`; «Залишок після видачі» = `balance_after`.
- Date row: `formatLongDate(business_date) · formatTime(created_at)` — never print time.
- `balance_after` is never read to compute debt. Debt stays `debtSql`.
- i18n: every new string in BOTH `frontend/src/shared/lib/i18n/locales/uk.json` and `en.json`.
- React Compiler lint: no refs read during render, no synchronous setState in effects.
- Commit after each task with a conventional message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never put «Closes #145» in a commit message.

## Review Focus

1. A payout whose supplier has a NEGATIVE debt afterwards (overpaid after a voided paid intake) — `balance_after` stores the negative value, receipt prints it with a minus; no clamp. (Task 1 test.)
2. Two payouts for the same supplier racing — each `balance_after` reflects the other (sequential under the lock), never both equal to `debt − amount` of the same starting debt. (Task 1 db-spec.)
3. Migration on history where an intake was voided AFTER a payout — backfilled value counts that intake (it was live at the payout's moment). (Task 1 migration db-spec.)
4. Receipt note absent / note fetch failed — footer still prints «Дякуємо за співпрацю!» and «Не є фіскальним чеком»; the dialog still prints. (Task 3/4 tests.)
5. A voided payout reopened from a list — stamp shows, numbers unchanged, «Анулювати» hidden. Operator viewing another operator's payout or a closed-shift payout — «Анулювати» hidden. (Task 5 tests.)

---

### Task 1: `payouts.balance_after` — column, writer, migration, schema doc

**Files:**
- Create: `backend/src/migrations/1788600000023-PayoutBalanceAfter.ts`
- Create: `backend/src/migrations/payout-balance-after.db-spec.ts`
- Modify: `backend/src/payouts/payout.entity.ts` (new column after `amount`)
- Modify: `backend/src/payouts/services/payout-writer.ts` (`write`: set `balance_after: sub(debt, amount)`)
- Modify: `backend/src/payouts/services/payout-writer.spec.ts`
- Modify: `backend/src/payouts/payout.mapper.ts` + `payout.mapper.spec.ts` (`balance_after: string`)
- Modify: `backend/src/payouts/payout-race.db-spec.ts` (assert `balance_after` in the race)
- Modify: `28-db-schema.dbml` (`Table payouts`: column + one Note paragraph)
- Check: number 023 is free on `origin/main` (`git fetch && git ls-tree origin/main backend/src/migrations/`); take the next free one if not.

**Interfaces:**
- Produces: `Payout.balance_after: string` (entity), `PayoutResponse.balance_after: string`.

- [ ] **Step 1: Writer unit test (failing).** In `payout-writer.spec.ts`, follow the file's existing mocking style for `debt.debtFor`; add:
  ```ts
  it('freezes balance_after = debt − amount on the saved payout', async () => {
    // debtFor → '7266.00', amount '2000.00'
    // expect m.create(Payout, expect.objectContaining({ balance_after: '5266.00' }))
  });
  it('stores a negative balance_after without clamping', async () => {
    // debtFor → '-100.00' is impossible with gt(amount, debt) guarding… use debt '500.00', amount '500.00' → '0.00'
  });
  ```
  (The ceiling `gt(amount, debt)` makes `balance_after >= 0` at write time; negatives only arise LATER via voids, which do not touch the column — so the second test asserts `'0.00'` for a full payout.)
- [ ] **Step 2:** `cd backend && npm test -- payout-writer` → FAIL.
- [ ] **Step 3: Entity + writer.**
  ```ts
  /** The supplier's debt at this point right AFTER this payout, frozen at write time under the
   *  supplier lock (#145) — what the payout receipt prints, so a reprint is the same paper.
   *  A RECORD of what was printed, never a source of debt: `debtSql` is. A void leaves it. */
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  balance_after: string;
  ```
  In `PayoutWriter.write`, import `sub` from `../../common/money` and add `balance_after: sub(debt, amount)` to the `m.create(Payout, {...})` object. Add `balance_after` to the audit `after` payload.
- [ ] **Step 4: Mapper.** Add `balance_after: string` to `PayoutResponse` (doc comment: «frozen at write, #145») and `balance_after: payout.balance_after` to `toPayoutResponse`; update `payout.mapper.spec.ts` fixture/expectation.
- [ ] **Step 5:** `cd backend && npm test -- payout` → PASS.
- [ ] **Step 6: Migration.** Pattern: `1788600000022-CashCountExplanations.ts` (doc comment on top, `name`, `up`, `down`).
  ```ts
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payouts" ADD "balance_after" numeric(12,2)`);
    // Rebuilt AS OF each payout: documents created no later than it and not yet voided then.
    await q.query(`
      UPDATE "payouts" p SET "balance_after" =
          COALESCE((SELECT SUM(i."amount") FROM "intakes" i
                     WHERE i."supplier_id" = p."supplier_id" AND i."created_at" <= p."created_at"
                       AND (i."voided_at" IS NULL OR i."voided_at" > p."created_at")), 0.00)
        + COALESCE((SELECT SUM(t."amount") FROM "intake_top_ups" t
                      JOIN "intakes" ti ON ti."id" = t."intake_id"
                     WHERE ti."supplier_id" = p."supplier_id" AND t."created_at" <= p."created_at"
                       AND (t."voided_at"  IS NULL OR t."voided_at"  > p."created_at")
                       AND (ti."voided_at" IS NULL OR ti."voided_at" > p."created_at")), 0.00)
        - COALESCE((SELECT SUM(q2."amount") FROM "payouts" q2
                     WHERE q2."supplier_id" = p."supplier_id" AND q2."created_at" <= p."created_at"
                       AND (q2."voided_at" IS NULL OR q2."voided_at" > p."created_at")), 0.00)`);
    await q.query(`ALTER TABLE "payouts" ALTER COLUMN "balance_after" SET NOT NULL`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payouts" DROP COLUMN "balance_after"`);
  }
  ```
  Doc comment must state: historic rows are rebuilt by `created_at` (transaction start), so two transactions that queued on the supplier lock may order differently than they committed — historic only; new rows are exact.
  Verify against the real schema that `intake_top_ups` has `created_at` and `voided_at` (`28-db-schema.dbml`); adjust if not.
- [ ] **Step 7: Migration db-spec** `payout-balance-after.db-spec.ts`. Model on an existing migration spec in that folder (e.g. `cash-count-explanations` / `network-settings-schema.db-spec.ts`): run migrations down to before 023, insert fixture rows by raw SQL, run 023 up, assert. Cases:
  1. supplier: intake 1000 (t0), payout 400 (t1), intake 500 (t2), payout 300 (t3) → `600.00`, `800.00`.
  2. intake 1000 (t0), payout 1000 (t1), intake voided at t2 > t1 → payout's `balance_after = 0.00` (the intake was live at t1).
  3. voided payout 200 (t1, voided t2) followed by payout 100 (t3) on intake 1000 → first `800.00`, second `900.00`.
  4. column is NOT NULL after `up`; `down` drops it.
- [ ] **Step 8: Race db-spec.** In `payout-race.db-spec.ts`, where two concurrent payouts already run, assert the two `balance_after` values are `{debt − a1, debt − a1 − a2}` in some order (sorted compare), using string literals.
- [ ] **Step 9: DBML.** In `28-db-schema.dbml` `Table payouts`, after `amount`, add:
  ```
  // Борг постачальника на цій точці одразу ПІСЛЯ цієї виплати, заморожений у момент запису
  // під блокуванням постачальника (#145). Його друкує квитанція видачі, тож передрук — той самий
  // папірець. Це ЗАПИС надрукованого, а не джерело боргу: борг рахує лише формула (Note
  // suppliers), ніхто не читає цю колонку для розрахунків (§3.2 не порушено). Анулювання її не
  // змінює. Додано 2026-10-13; наявні рядки відновлено міграцією станом на created_at.
  balance_after numeric(12,2) [not null]
  ```
- [ ] **Step 10:** `cd backend && TEST_DB_NAME=feat145_test npm run test:db -- payout` then from the worktree root `npm run verify` (fast tier; includes lint and the money-registry check that reads `28-db-schema.dbml`). All PASS; report any SKIPPED row by name.
- [ ] **Step 11: Commit** `feat(payouts): freeze balance_after at write time (#145)`.

---

### Task 2: Staff name parts on payout and intake detail

**Files:**
- Modify: `backend/src/payouts/payout.mapper.ts` (+ spec): optional `paid_by: { first_name: string; last_name: string } | null` on `PayoutResponse`
- Modify: `backend/src/payouts/queries/get-payout.query.ts` (+ spec if present): load the user and pass it
- Modify: `backend/src/payouts/commands/create-payout.command.ts`: pass the actor's user (load by `actor.sub` inside the transaction) so the create response also carries `paid_by`
- Modify: `backend/src/intakes/intake.mapper.ts` + `queries/intake-detail.query.ts` (+ specs): `received_by: { first_name; last_name } | null` beside the existing `received_by_name`
- Test: existing mapper/query specs and the payouts/intakes e2e or controller specs that snapshot responses

**Interfaces:**
- Produces: `PayoutResponse.paid_by: { first_name: string; last_name: string } | null` — `null` on list responses (`GET /payouts`), set on `GET /payouts/:id` and `POST /payouts`. `IntakeDetailResponse.received_by: { first_name; last_name } | null`.

- [ ] **Step 1:** Failing tests: `toPayoutResponse(payout, shift, user)` returns `paid_by: { first_name: 'Тарас', last_name: 'Бондар' }`; without the third arg → `paid_by: null`. `GetPayoutQuery.get` returns `paid_by` from the `users` row of `paid_by_user_id`. `toIntakeDetailResponse(..., receiver)` returns `received_by` parts.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Signature: `toPayoutResponse(payout: Payout, shift: Shift, paidBy: Pick<User,'first_name'|'last_name'> | null = null)`. In `GetPayoutQuery`, `m.findOne(User, { where: { id: payout.paid_by_user_id } })` via an injected `Repository<User>` or the repo's manager — follow `intake-detail.query.ts`'s `receiverName` pattern; refactor that method to return the user (or `null`) and derive `received_by_name` with `displayNameOf` from it, so one read feeds both fields.
- [ ] **Step 4:** `cd backend && npm test` → PASS; `TEST_DB_NAME=feat145_test npm run test:db -- payouts intakes` → PASS.
- [ ] **Step 5: Commit** `feat(api): staff name parts on payout and intake detail (#145)`.

---

### Task 3: `shared/ui/receipt.tsx` — the document model and renderer

**Files:**
- Create: `frontend/src/shared/ui/receipt.tsx`
- Create: `frontend/src/shared/ui/receipt.test.tsx`
- Modify: `uk.json`, `en.json` — keys under `receipt`: `docTitle` («КВИТАНЦІЯ» / «RECEIPT»), `thanks` («Дякуємо за співпрацю!» / «Thank you for working with us!»), `notFiscal` («Не є фіскальним чеком» / «Not a fiscal receipt»), `number` («№ квитанції» / «Receipt No.»), `operation` («Операція» / «Operation»), `operationIntake` («Прийомка ягоди» / «Berry intake»), `operationPayoutDebt` («Видача боргу» / «Debt payout»), `balanceAfterPayout` («Залишок після видачі» / «Balance after payout»), `payoutTitle` («Квитанція видачі {{code}}» / «Payout receipt {{code}}»), `payoutDescription` («Друкована квитанція видачі — тут можна анулювати документ.» / matching en). Keep existing keys used elsewhere.

**Interfaces:**
- Produces (exact):
  ```ts
  export interface ReceiptRow { label: string; value: string; strong?: boolean; muted?: boolean }
  export interface ReceiptBerryLine {
    label: string; gross: string; pallet: string | null; tareLabel: string;
    tareWeight: string; net: string; price: string; amount: string;
  }
  export type ReceiptSection =
    | { kind: 'rows'; rows: ReceiptRow[] }
    | { kind: 'berryLine'; line: ReceiptBerryLine }
    | { kind: 'caption'; text: string };          // muted small line (payout codes, annulments)
  export interface ReceiptDocument {
    voided: { reason: string } | null;
    header: { pointName: string; staffName: string };
    meta: ReceiptRow[];                           // № квитанції, Операція, Дата, Постачальник
    sections: ReceiptSection[][];                 // groups; a dashed rule separates groups
    footer: { note: string | null };
  }
  export function ReceiptView({ doc }: { doc: ReceiptDocument }): JSX.Element
  export function staffName(p: { first_name: string; last_name: string } | null | undefined): string // «Бондар Тарас» or «—»
  ```
  `ReceiptView` renders: root `div.printable` with today's `ReceiptSheet` classes; void stamp (moved verbatim from `ReceiptSheet`); centred header — `t('receipt.docTitle')` then `{pointName} · {staffName}`; dashed rule; meta rows; for each section group: dashed rule then its sections (`berryLine` renders exactly today's per-line block: label muted, Брутто, Піддон if non-null, Тара, solid rule, Нетто strong, Ціна за кг, Сума); footer: screen-only `receipt.footer` line with `print:hidden`, then a centred `font-mono` block: note lines (`whitespace-pre`, `' '` for blank), «Дякуємо за співпрацю!», then small muted «Не є фіскальним чеком». The note+thanks+notFiscal block is printed (NOT `print-only` — the thanks and fiscal lines show on screen too; keep the note's existing `break-inside-avoid`). Exhaustive switch with a `never` default.
  Labels the renderer needs for `berryLine` (Брутто, Піддон, Тара ({{detail}}), Нетто, Ціна за кг, Сума) come from existing `receipt.*` keys via `useTranslation` inside the renderer — the builder passes values only.

- [ ] **Step 1:** Failing tests in `receipt.test.tsx` (render with the repo's i18n test setup — copy from `ReceiptDialog.test.tsx`): header shows «КВИТАНЦІЯ» and «Кониців · Бондар Тарас»; meta rows in order; a `berryLine` shows Піддон only when `pallet !== null`; groups separated (count dashed rules); voided stamp with reason; footer with note → note lines appear BEFORE «Дякуємо за співпрацю!», then «Не є фіскальним чеком»; footer with `note: null` → thanks + fiscal still present; `staffName(null)` → «—», `staffName({first_name:'Тарас', last_name:'Бондар'})` → «Бондар Тарас».
- [ ] **Step 2:** `cd frontend && npx vitest run src/shared/ui/receipt.test.tsx` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS. `npm run lint` in `frontend/`.
- [ ] **Step 5: Commit** `feat(receipt): a sectioned receipt model and its one renderer (#145)`.

---

### Task 4: Intake receipt on the new renderer

**Files:**
- Create: `frontend/src/widgets/receipt/model/buildIntakeReceipt.ts` + `.test.ts`
- Modify: `frontend/src/widgets/receipt/ui/ReceiptDialog.tsx` (+ `ReceiptDialog.test.tsx`)
- Delete: `frontend/src/widgets/receipt/ui/ReceiptSheet.tsx`
- Modify: `frontend/src/entities/intake/model/*` type — add `received_by: { first_name: string; last_name: string } | null` to the intake detail type
- Remove the now-unused `receipt.heading` and `receipt.receivedBy` keys only if nothing else references them (`grep -r`).

**Interfaces:**
- Consumes: Task 3 types, `staffName`.
- Produces: `buildIntakeReceipt(input: { intake: IntakeDetail; supplierName: string; pointName: string; tareNameById: Map<string,string>; note: string | null; t: TFunction; locale: string }): ReceiptDocument`.

Document shape (must match today's numbers exactly):
- `voided`: `intake.voided_at ? { reason: intake.void_reason ?? '' } : null`
- `header`: `{ pointName, staffName: staffName(intake.received_by) }`
- `meta`: № квитанції=`intake.code`; Операція=`t('receipt.operationIntake')`; Дата=`${formatLongDate(business_date)} · ${formatTime(created_at)}`; Постачальник=`supplierName`.
- `sections`: group 1..n — one group per item with one `berryLine` (logic moved verbatim from `ReceiptDialog`'s `lines` map: `add(price, bonus)`, pallet only when non-zero); crate return group (if any) — one `caption` with the existing crateReturn / crateReturnNoMoney / crateReturnVoided text; totals group — rows: Нараховано (strong), Видано готівкою (if `paid_amount` ≠ 0), caption with live payout codes joined by «, », one caption per voided payout (`receipt.payoutVoided`), Залишок у цьому пункті (live `balance.debt`, unchanged behaviour).
- `footer`: `{ note }`.

- [ ] **Step 1:** Failing builder tests: a two-line intake → two berry groups + totals; no crate return → no caption group; crate return voided → `crateReturnVoided` caption; paid 0 → no «Видано готівкою»; operation row = «Прийомка ягоди»; header staff «Бондар Тарас».
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement builder; switch `ReceiptDialog` to `buildIntakeReceipt` + `<ReceiptView doc=… />`, delete `ReceiptSheet.tsx`. Keep everything else in the dialog (queries, void flow, `noteLoadFailed` line, print button disabled while settings fetch).
- [ ] **Step 4:** Update `ReceiptDialog.test.tsx` only where the visible copy changed (heading «ПРИЙОМКА ЯГОДИ» → «КВИТАНЦІЯ», «Приймав» row gone → staff in header, new footer lines). Every numeric assertion must stay untouched. Run `npx vitest run src/widgets` → PASS; `npm run lint`; `npx tsc -b` (or `npm run build -w frontend`) — tests and lint skip tsc.
- [ ] **Step 5: Commit** `refactor(receipt): the intake receipt is built from sections (#145)`.

---

### Task 5: Payout receipt dialog

**Files:**
- Modify: `frontend/src/entities/payout/model/payout.ts` (`balance_after: string`, `paid_by: {first_name;last_name} | null`)
- Create: `frontend/src/entities/payout/api/usePayout.ts` (`usePayoutQuery(id: string | null)` → `GET /payouts/:id`; follow `entities/intake/api/useIntake.ts`) + test
- Create: `frontend/src/entities/payout/model/canVoidPayout.ts` + test; export both from `entities/payout/index.ts`
- Create: `frontend/src/widgets/receipt/model/buildPayoutReceipt.ts` + `.test.ts`
- Create: `frontend/src/widgets/receipt/ui/PayoutReceiptDialog.tsx` + `.test.tsx`
- Modify: `frontend/src/widgets/receipt/index.ts` (export `PayoutReceiptDialog`)
- Fix every test fixture of `Payout` that TypeScript now flags (add `balance_after`, `paid_by: null`).

**Interfaces:**
- Produces: `usePayoutQuery(id: string | null)`, `canVoidPayout(viewer: {id; role}, p: {voided_at; paid_by_user_id; shift_closed}): boolean` = `p.voided_at === null && (viewer.role === 'network_owner' || (viewer.id === p.paid_by_user_id && !p.shift_closed))` (§9.4; doc comment cites it), `buildPayoutReceipt({ payout, supplierName, pointName, note, t, locale }): ReceiptDocument`, `<PayoutReceiptDialog payoutId: string | null; open: boolean; onClose: () => void />`.

Payout document: `voided` from `voided_at`/`void_reason`; header `{ pointName, staffName(payout.paid_by) }`; meta № квитанції=`code`, Операція=`t('receipt.operationPayoutDebt')`, Дата as in Task 4 from the payout's `business_date`/`created_at`, Постачальник; one totals group: Видано готівкою=`formatUah(amount)` strong, Залишок після видачі=`formatUah(balance_after)`; footer note.

`PayoutReceiptDialog` mirrors `ReceiptDialog`'s shell: title `t('receipt.payoutTitle', {code})`, description `t('receipt.payoutDescription')`, refetch network settings on open, «Закрити», «Анулювати» when `canVoidPayout(me, payout)` opening `VoidDocumentDialog kind="payout"` with `shiftClosed`, `payoutAmount`, and `reopens` from `useSupplierSettlementQuery` fetched only while the void dialog is open (same as `SupplierCardPage` does: `reopenedCodes(settlement, payout.id, null)`), «Друк» → `window.print()` disabled while settings fetch. Supplier name via `useSupplierQuery` + `supplierName`, point via `usePointOptionsQuery`.

- [ ] **Step 1:** Failing tests: builder (meta order, operation «Видача боргу», totals, voided stamp, negative `balance_after` '-100.00' prints with minus); `canVoidPayout` table (owner closed shift → true; operator own open → true; operator own closed → false; operator other's → false; voided → false); dialog: renders the document from mocked `/payouts/:id`, «Анулювати» hidden for a voided payout, print calls `window.print`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npx vitest run src/entities/payout src/widgets` → PASS; lint; tsc.
- [ ] **Step 5: Commit** `feat(receipt): print a standalone payout's receipt (#145)`.

---

### Task 6: Open the payout receipt — after paying and from the lists

**Files:**
- Modify: `frontend/src/pages/debts/ui/DebtsPage.tsx`, `frontend/src/pages/supplier-card/ui/SupplierCardPage.tsx` — pass `onPaid={(p) => openPayoutReceipt(p.id)}` to `PayoutDialog` and render one `PayoutReceiptDialog`.
- Modify: `frontend/src/features/settle-payout/ui/PayoutDialog.tsx` only if `onPaid` is not already called with the created payout after success (check; it is declared in props).
- Modify: `frontend/src/pages/day/ui/DayPage.tsx` — payout feed rows with `intake_id === null` become clickable (same affordance intake rows use) and open `PayoutReceiptDialog`; update the comment near line 370 that says a payout row has no dialog.
- Modify: `frontend/src/pages/journal/ui/JournalPage.tsx` / `JournalTable.tsx` — payouts tab: rows with `intake_id === null` open the payout receipt (reuse the receipts tab's row-open affordance; update the header comment that says payouts have no detail dialog).
- Modify: `frontend/src/pages/supplier-card/ui/SupplierTimeline.tsx` (+ `SupplierCardPage`) — payout rows with `intake_id === null` open the receipt; replace the local `canVoid` with `canVoidPayout` from `entities/payout`.
- Tests: the existing page tests for each (`*.test.tsx` beside them) — add one test per page: clicking a standalone payout row opens a dialog titled «Квитанція видачі {code}»; a payout row WITH `intake_id` stays non-clickable. DebtsPage/SupplierCardPage: after a successful payout the receipt dialog opens.

**Interfaces:**
- Consumes: `PayoutReceiptDialog`, `canVoidPayout`.

- [ ] **Step 1:** Failing page tests. **Step 2:** Run → FAIL. **Step 3:** Implement, keeping a single dialog instance per page with `key={payoutId}` (see `ReceiptDialog`'s note on remounting). Mind `portaled-dialog-submit-bubbles`: the receipt dialog has no form, but if any page form wraps it, guard with `currentTarget.contains`. **Step 4:** `npm test -w frontend` (whole frontend) → PASS; lint; tsc.
- [ ] **Step 5: Commit** `feat(receipt): open the payout receipt after paying and from every list (#145)`.

---

### Task 7: Verification, review, screenshots (controller, not a subagent task)

- [ ] `rm -rf frontend/dist`, then `npm run verify:full`; paste the verdict line; name every SKIPPED row.
- [ ] Whole-branch code review (`superpowers:requesting-code-review`).
- [ ] Playwright on the local stack, then on the PR preview: standalone payout → receipt → print preview; reopen from Day, Journal, supplier card; reprint after a new intake shows the same «Залишок після видачі»; void → stamp; intake receipt with the new header/footer. Screenshots to `docs/issue-screenshots` branch, linked in the issue comment and PR body.
- [ ] PR body: what / how to test / preview. Leave the PR as DRAFT — the user reviews before ready.
