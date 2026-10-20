# Crate Deposits Counted at Open and Close — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening and closing a shift record two counts — «Каса» (berry book) and «Завдатки» (crates book) — each compared with its own anchored expectation, each discrepancy shown, explained and listed on its own.

**Architecture:** No migration: `cash_counts.book = 'crates'` exists and `UQ_cash_counts_shift_book_kind` already keys on it. `PointCashService` gains a book parameter on the anchor and a crates movements term; `ShiftsService.open/close` write a second row; `GET /point-cash` gains `crate_cash` and `crate_unexplained_difference`; the frontend count dialog gets a second field and every reader of a count learns the book.

**Tech Stack:** NestJS + TypeORM raw SQL on Postgres; React + react-hook-form + TanStack Query; Jest (backend, `npm test` — never bare `npx jest`, see backend CLAUDE), Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-10-14-yagoda-crates-cash-count-design.md`

## Global Constraints

- Request field name: `counted_deposits`, validated exactly like `counted_amount` (`/^\d{1,10}(\.\d{1,2})?$/` + `@CanonicalDecimal()`), required, `0` allowed.
- Money: no `*`, `/`, `Number()`, `toFixed`, `parseInt`, `parseFloat` in money modules; arithmetic in SQL `numeric` or `backend/src/common/money.ts`; amounts cross the driver as `::text`.
- SQL namings spliced into SQL are only bind placeholders, correlated columns or `CashBook` enum literals — never request values.
- Crates movements of a shift: `Σ crate_issuances.deposit_taken − Σ crate_returns.deposit_refund`, `shift_id = <shift>`, `voided_at IS NULL` (spec D4).
- `midday` is never an anchor and never in an unexplained sum. Recount (`POST /cash-counts`) stays berry-only (D6).
- Frontend copy: «Каса», «Завдатки»; result/history/card in Ukrainian (`uk.json`) and English (`en.json`).
- db tests: `TEST_DB_NAME=feat_178_test` (other sessions share `app_test`).
- Gate before PR ready: `npm run verify:full` (money code + real Postgres).

## Review Focus

1. A shift opened BEFORE the release (berry opening row only) is closed AFTER it — the close must succeed and anchor the crates book (`expected = counted`), not 500 on a `null`. → Task 2 test.
2. Reopen then re-close — both books' closing rows demote to `midday`; the re-close writes two fresh rows without hitting `UQ_cash_counts_shift_book_kind`. → Task 2 test.
3. A receipt-mode issuance (`deposit_taken = 0`) and a voided deposit issuance in the same shift move the crates expectation by 0. → Task 1 test.
4. The operator types the berry figure and leaves «Завдатки» empty — the form refuses client-side, nothing is sent. → Task 6 test.
5. A point that never counted its deposits shows «ще не перераховували», not «0,00 ₴», on the card. → Task 8 test.

---

### Task 1: Book-aware expectation in `PointCashService`

**Files:**
- Modify: `backend/src/point-cash/point-cash.service.ts`
- Test: `backend/src/point-cash/point-cash.db-spec.ts` (new `describe` at the end)

**Interfaces:**
- Produces:
  - `crateMovementsSql(shift: string): string` (exported beside `movementsSql`)
  - `anchorSql(point: string, asOf: string, book: CashBook = CashBook.Berry): string`
  - `expectedForOpening(pointId: string, manager?: EntityManager, book: CashBook = CashBook.Berry): Promise<string | null>`
  - `expectedForClosing(shiftId: string, manager?: EntityManager, book: CashBook = CashBook.Berry): Promise<string | null>`
  - `crateCashFor(pointId: string, asOf?: string, manager?: EntityManager): Promise<string | null>`

- [ ] **Step 1: Write the failing tests** — reuse the file's existing point/shift/`crateIssuance`/`returnAgainst` fixtures:

```ts
describe('the crates book expectation (#178)', () => {
  it('opening: null before any crates count, then the last non-midday crates count', async () => {
    const { pointId, shiftId } = await freshPointWithShift();
    expect(await service.expectedForOpening(pointId, undefined, CashBook.Crates)).toBeNull();
    await insertCount(shiftId, 'crates', 'opening', '1200.00', '1200.00');
    expect(await service.expectedForOpening(pointId, undefined, CashBook.Crates)).toBe('1200.00');
    // the berry book does not see it
    expect(await service.expectedForOpening(pointId)).toBeNull();
  });

  it('closing: opening crates count + taken − refunded, voided and receipt-mode excluded', async () => {
    const { pointId, shiftId, supplierId } = await freshPointWithShift();
    await insertCount(shiftId, 'crates', 'opening', '14400.00', '14400.00');
    const issued = await crateIssuance(shiftId, supplierId, 20, 'deposit');      // +2400.00
    await returnAgainst(shiftId, supplierId, issued, 7);                          // −840.00
    await crateIssuance(shiftId, supplierId, 5, 'receipt');                       // 0
    const voided = await crateIssuance(shiftId, supplierId, 20, 'deposit');
    await ds.query(`UPDATE crate_issuances SET voided_at = now(), voided_by_user_id = $2,
                    void_reason = 'помилка' WHERE id = $1`, [voided, ownerId]);
    expect(await service.expectedForClosing(shiftId, undefined, CashBook.Crates)).toBe('15960.00');
    expect(await service.crateCashFor(pointId)).toBe('15960.00');
  });

  it('closing: null when the shift has no crates opening row (opened before the release)', async () => {
    const { shiftId } = await freshPointWithShift();
    await insertCount(shiftId, 'berry', 'opening', '100.00', '100.00');
    expect(await service.expectedForClosing(shiftId, undefined, CashBook.Crates)).toBeNull();
  });

  it('crateCashFor: null for a point that never counted deposits', async () => {
    const { pointId } = await freshPointWithShift();
    expect(await service.crateCashFor(pointId)).toBeNull();
  });
});
```

`insertCount(shiftId, book, kind, counted, expected)` is a small local helper:

```ts
const insertCount = (shiftId: string, book: string, kind: string, counted: string, expected: string) =>
  ds.query(
    `INSERT INTO cash_counts (shift_id, book, kind, counted_amount, expected_amount, counted_by_user_id, counted_at)
     VALUES ($1, $2::cash_book, $3::cash_count_kind, $4, $5, $6, now())`,
    [shiftId, book, kind, counted, expected, ownerId],
  );
```

`freshPointWithShift()` — build from the file's existing point/shift/supplier insert code (fresh point per call; one shift `business_date = current_date`).

- [ ] **Step 2: Run, expect FAIL** — `cd backend && TEST_DB_NAME=feat_178_test npm run test:db -- point-cash.db-spec` → fails: `crateCashFor` is not a function / expectation is berry's.

- [ ] **Step 3: Implement**

```ts
import { CashBook } from '../cash-counts/cash-book.enum';

/** The crates book's movements of ONE shift (#178, spec D4) — a voided crate
 *  document is out at once: in an open shift the deposit went back over the
 *  counter, the same reading `returned_on_void` gives a payout. Receipt-mode
 *  issuances carry 0 by CHK_crate_issuances_receipt_no_money. */
const crateMovementsSql = (shift: string): string => `(
    COALESCE((SELECT SUM(ci.deposit_taken) FROM crate_issuances ci
        WHERE ci.shift_id = ${shift} AND ci.voided_at IS NULL), 0.00)
  - COALESCE((SELECT SUM(cr.deposit_refund) FROM crate_returns cr
        WHERE cr.shift_id = ${shift} AND cr.voided_at IS NULL), 0.00)
)`;

const anchorSql = (point: string, asOf: string, book: CashBook = CashBook.Berry): string => `(
  SELECT c.counted_amount, c.kind, c.shift_id
    FROM cash_counts c
    JOIN shifts s ON s.id = c.shift_id
   WHERE s.collection_point_id = ${point}
     AND c.book = '${book}'
     AND c.kind <> 'midday'
     AND s.business_date <= ${asOf}
   ORDER BY s.business_date DESC, (c.kind = 'closing') DESC, c.counted_at DESC
   LIMIT 1
)`;
```

`expectedForOpening(pointId, manager, book = CashBook.Berry)` → `anchorSql('$1::uuid', "'infinity'::date", book)`.

`expectedForClosing(shiftId, manager, book = CashBook.Berry)`:

```ts
const movements = book === CashBook.Crates ? crateMovementsSql('$1::uuid') : movementsSql('$1::uuid', '$2');
const rows = (await runner.query(
  `SELECT (c.counted_amount + ${movements})::text AS expected
     FROM cash_counts c
    WHERE c.shift_id = $1::uuid AND c.book = '${book}' AND c.kind = 'opening'`,
  book === CashBook.Crates ? [shiftId] : [shiftId, this.tz.appTimezone],
)) as { expected: string }[];
```

`crateCashFor`:

```ts
async crateCashFor(pointId: string, asOf?: string, manager?: EntityManager): Promise<string | null> {
  const runner = manager ?? this.dataSource.manager;
  const [row] = (await runner.query(
    `SELECT (SELECT (a.counted_amount
                     + CASE WHEN a.kind = 'opening' THEN ${crateMovementsSql('a.shift_id')} ELSE 0.00 END)
               FROM ${anchorSql('$1::uuid', asOfSql('$2', '$3'), CashBook.Crates)} a)::text AS crate_cash`,
    [pointId, asOf ?? null, this.tz.appTimezone],
  )) as { crate_cash: string | null }[];
  return row.crate_cash;
}
```

Export `crateMovementsSql` in the closing `export { … }`. Update the header comment «THE CRATES BOOK IS HERE NOW…/IT DOES NOT HONOUR as_of» to say: `crate_deposits` (liability) stays lifetime; `crate_cash` (drawer) is anchored like berry since #178.

- [ ] **Step 4: Run, expect PASS** (same command), plus `npm test -- point-cash` for the unit spec.
- [ ] **Step 5: Commit** — `feat(point-cash): the crates book is anchored on its own count (#178)`

---

### Task 2: Open and close write both books

**Files:**
- Modify: `backend/src/shifts/dto/open-shift.dto.ts`, `backend/src/shifts/dto/close-shift.dto.ts`, `backend/src/shifts/shifts.service.ts`
- Modify (mechanical — every `open(…, { counted_amount })` / `close(…, { counted_amount, broken_crates })` / HTTP body gains `counted_deposits: '0.00'`): files from `grep -rln "counted_amount" backend/src --include=*spec.ts` plus `backend/src/testing/crate-stock-fixture.ts`
- Test: `backend/src/shifts/shift-close.db-spec.ts` (new `describe`), `backend/src/shifts/dto/close-shift.dto.spec.ts`, `backend/src/shifts/shifts.service.spec.ts`

**Interfaces:**
- Consumes: Task 1's `expectedForOpening/expectedForClosing(…, book)`.
- Produces: `OpenShiftDto.counted_deposits: string`, `CloseShiftDto.counted_deposits: string`; audit `cash-count.recorded.after.book`.

- [ ] **Step 1: Failing tests**

DTO spec: a body without `counted_deposits` fails validation; `'0'` canonicalises to `'0.00'`; `'1,5'` fails.

db-spec (constructs `ShiftsService` like the existing describe; fresh point per test):

```ts
describe('both books at open and close (#178)', () => {
  it('first open anchors both books; close compares each with its own expectation', async () => {
    const shift = await service.open(operator, { counted_amount: '1000.00', counted_deposits: '14400.00' });
    const opening = await countsOf(shift.id, 'opening');
    expect(opening).toEqual([
      { book: 'berry', counted: '1000.00', expected: '1000.00' },
      { book: 'crates', counted: '14400.00', expected: '14400.00' },
    ]);
    await issueDeposit(shift.id, '2400.00');          // direct INSERT, deposit mode
    await service.close(operator, shift.id, { counted_amount: '1000.00', counted_deposits: '16440.00', broken_crates: 0 });
    expect(await countsOf(shift.id, 'closing')).toEqual([
      { book: 'berry', counted: '1000.00', expected: '1000.00' },
      { book: 'crates', counted: '16440.00', expected: '16800.00' },   // −360.00
    ]);
  });

  it('closes a shift opened before the release (berry opening only) and anchors crates', async () => {
    const shiftId = await insertOpenShiftWithBerryOpeningOnly('500.00');
    await service.close(operator, shiftId, { counted_amount: '500.00', counted_deposits: '0.00', broken_crates: 0 });
    expect(await countsOf(shiftId, 'closing')).toContainEqual({ book: 'crates', counted: '0.00', expected: '0.00' });
  });

  it('reopen demotes both closing rows; re-close writes both again', async () => {
    // open, close, reopen (owner), close again → 2 midday + 2 closing rows, no 23505
  });

  it('records one audit entry per count with its book', async () => {
    // after open: two `cash-count.recorded` rows for the shift's counts, after.book ∈ {berry, crates}
  });
});
```

`countsOf(shiftId, kind)` selects `book, counted_amount::text, expected_amount::text … ORDER BY book`.

- [ ] **Step 2: Run, expect FAIL** — `TEST_DB_NAME=feat_178_test npm run test:db -- shift-close` and `npm test -- shifts`.

- [ ] **Step 3: Implement**

DTOs: add (both files)

```ts
  /** #178 — the crate-deposits drawer, counted beside the berry one. Required
   *  for the reason `counted_amount` is: a figure that can be skipped gets
   *  skipped. `0` is a valid answer (a point that has never taken a deposit). */
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message: 'counted_deposits must be a non-negative decimal string with at most 2 decimal places',
  })
  @CanonicalDecimal()
  counted_deposits: string;
```

`ShiftsService`: extract one private helper used by `open` and `close`:

```ts
private async writeCount(
  m: EntityManager, actor: AuthenticatedUser, shiftId: string, book: CashBook,
  kind: CashCountKind, counted: string, expected: string | null, countedAt: Date,
): Promise<void> {
  // `null` — the book's first count at this point (or a shift opened before
  // #178 for crates): the counted figure becomes the anchor.
  const exp = expected ?? counted;
  const row = await m.save(CashCount, {
    shift_id: shiftId, book, kind, counted_amount: counted, expected_amount: exp,
    counted_by_user_id: actor.sub, counted_at: countedAt,
  });
  await this.audit.record({
    action: 'cash-count.recorded', actor_id: actor.sub, target_type: 'cash_count', target_id: row.id,
    after: { shift_id: shiftId, book, kind, counted_amount: counted, expected_amount: exp },
  }, m);
}
```

`open`: after `shift.opened` audit,

```ts
await this.writeCount(m, actor, shift.id, CashBook.Berry, CashCountKind.Opening, dto.counted_amount,
  await this.cash.expectedForOpening(pointId, m), countedAt);
await this.writeCount(m, actor, shift.id, CashBook.Crates, CashCountKind.Opening, dto.counted_deposits,
  await this.cash.expectedForOpening(pointId, m, CashBook.Crates), countedAt);
```

`close`: same with `CashCountKind.Closing`, `expectedForClosing(shift.id, m[, CashBook.Crates])`, `closedAt`. Keep the order audit-wise: `shift.closed` then the two counts. `reopen` unchanged (its `UPDATE … kind = 'closing'` already covers both books) — add one comment line saying so.

Then update every test caller (`grep -rn "counted_amount: '" backend/src --include=*.ts`): add `counted_deposits: '0.00'` next to each `counted_amount` in an open/close call or HTTP body. Do NOT touch `POST /cash-counts` recount bodies.

- [ ] **Step 4: Run** `npm test` (backend unit) and `TEST_DB_NAME=feat_178_test npm run test:db` (whole db suite, one database) → PASS.
- [ ] **Step 5: Commit** — `feat(shifts): open and close count the crate deposits too (#178)`

---

### Task 3: Explanations and notes on a crates count; list order

**Files:**
- Modify: `backend/src/cash-counts/count-notes.ts`, `backend/src/cash-counts/cash-counts.service.ts` (ORDER BY)
- Test: `backend/src/cash-counts/count-notes.spec.ts`, `backend/src/cash-counts/count-notes.db-spec.ts`

- [ ] **Step 1: Failing tests** — `count-notes.spec.ts`: a `book: CashBook.Crates`, `kind: Closing` count with a discrepancy → `countNoteRefusal(owner, count, 'explanation')` is `null`; same count with `kind: Midday` → `COUNT_NOT_EXPLAINABLE`. db-spec: `PUT /cash-counts/:id/explanation` on a crates closing row with −360 → 200 and `is_open` false after; list with `shift_id` returns berry before crates for the same `counted_at`.
- [ ] **Step 2: Run, expect FAIL** — `npm test -- count-notes`.
- [ ] **Step 3: Implement** — `count-notes.ts`: `if (count.kind === CashCountKind.Midday)` (drop the `book !== Berry` arm; update its comment: «either book since #178»); remove the now-unused `CashBook` import if nothing else uses it. `cash-counts.service.ts` list: `ORDER BY s.business_date DESC, c.counted_at DESC, c.book ASC, c.id ASC` (enum order: berry, crates).
- [ ] **Step 4: Run, expect PASS** — `npm test -- cash-counts count-notes` + `TEST_DB_NAME=feat_178_test npm run test:db -- count-notes`.
- [ ] **Step 5: Commit** — `feat(cash-counts): a crates discrepancy is explained like a berry one (#178)`

---

### Task 4: `crate_cash` and `crate_unexplained_difference` on `GET /point-cash`

> **Superseded after the second review (2026-10-20):** `crate_cash` lives on the LIST row only. `GET /point-cash/:pointId` and `PointCashOne` no longer carry it, and `crateCashFor` is gone. The drawer and the discrepancy sum for each book come from `drawerSql` / `discrepancySql` in `point-cash.sql.ts`. The steps below record what was first built.

**Files:**
- Modify: `backend/src/point-cash/point-cash.service.ts` (`list`), `backend/src/point-cash/point-cash.mapper.ts`, `backend/src/point-cash/point-cash.controller.ts` (`findOne`)
- Test: `backend/src/point-cash/point-cash.db-spec.ts`

**Interfaces:**
- Produces on `PointCashRowResponse` and the single read: `crate_cash: string | null`, `crate_unexplained_difference: string` (single read: `crate_cash` only).

- [ ] **Step 1: Failing test** — a point with crates opening 14 400 / closing counted 16 440 vs expected 16 800 → list row `crate_cash = '16440.00'`, `crate_unexplained_difference = '-360.00'`, `crate_deposits` unchanged (lifetime liability); a point without crates counts → `crate_cash = null`, `crate_unexplained_difference = '0.00'`; `as_of` before the first crates count → `null`. `GET /point-cash/:id` returns `crate_cash`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — in the `scoped` CTE:

```sql
(SELECT (a.counted_amount
         + CASE WHEN a.kind = 'opening' THEN ${crateMovementsSql('a.shift_id')} ELSE 0.00 END)
   FROM ${anchorSql('cp.id', 'b.as_of', CashBook.Crates)} a) AS crate_cash,
COALESCE((SELECT SUM(c.counted_amount - c.expected_amount)
            FROM cash_counts c JOIN shifts sh ON sh.id = c.shift_id
           WHERE sh.collection_point_id = cp.id AND c.book = 'crates'
             AND c.kind <> 'midday' AND sh.business_date <= b.as_of), 0.00) AS crate_unexplained_difference,
```

select `s.crate_cash::text AS crate_cash, s.crate_unexplained_difference::text AS crate_unexplained_difference`; add both to `PointCashRow`/`PointCashRowResponse`/`toPointCashRowResponse` with doc comments (drawer figure anchored on the crates count, `null` = never counted; the sum mirrors `unexplained_difference`). Rewrite the `crate_deposits` doc comment: «supplier liability, lifetime — no longer "never counted"; the counted drawer is `crate_cash`». Controller `findOne`: add `this.cash.crateCashFor(pointId, query.as_of)` → `crate_cash`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(point-cash): the crates drawer and its drift beside the liability (#178)`

---

### Task 5: Seed and docs

**Files:**
- Modify: `backend/src/seed/dev-seed.ts` (the `allCashCounts` loop), `backend/src/seed/dev-seed.db-spec.ts`
- Modify: `28-db-schema.dbml` (`cash_counts` Note), `backend/src/cash-counts/cash-book.enum.ts` (header), `backend/src/cash-counts/dto/create-cash-count.dto.ts` (comment: recount stays berry, D6)

- [ ] **Step 1: Failing test** — `dev-seed.db-spec.ts`: every seeded shift with a berry opening/closing count has a crates count of the same kind; crates closing `expected = opening counted + that shift's deposit movements`.
- [ ] **Step 2: Run, expect FAIL** — `TEST_DB_NAME=feat_178_test npm run test:db -- dev-seed`.
- [ ] **Step 3: Implement** — in the loop, after the berry insert (and with the idempotency `found` check made per book), write a crates row: `expected = c.kind === 'opening' ? (await cash.expectedForOpening(pid, qr.manager, CashBook.Crates)) : (await cash.expectedForClosing(shift, qr.manager, CashBook.Crates))`, `?? '0.00'` for the first one; `counted = expected` (seeded deposits always reconcile — no demo crates drift), same `counted_by`/time. Docs: DBML Note — replace «Тригер переглянути це рішення…» with the #178 ruling (D1, D2, D4, D6) in the Note's own style; `cash-book.enum.ts` — `crates` is counted at open/close since #178, the split problem is solved by the client's answer that deposits lie apart.
- [ ] **Step 4: Run, expect PASS**; `npm run lint`.
- [ ] **Step 5: Commit** — `feat(seed): seeded shifts count their deposits too; schema note (#178)`

---

### Task 6: Frontend — the dialog asks for both figures

**Files:**
- Modify: `frontend/src/features/count-shift/ui/CountDrawerDialog.tsx`, `frontend/src/features/count-shift/api/shiftActions.ts`, callers of `onConfirm` (`features/count-shift/ui/OpenShiftAlert.tsx`, `pages/point-cash/ui/PointCashPage.tsx`, `pages/day/ui/DayPage.tsx`, `pages/reception/ui/ReceptionPage.tsx`), `shared/lib/i18n/locales/{uk,en}.json`
- Test: `frontend/src/features/count-shift/ui/CountDrawerDialog.test.tsx` and the callers' tests that assert the POST body

**Interfaces:**
- Produces: `onConfirm(countedAmount: string, countedDeposits: string, brokenCrates: number | null)`; `useOpenShiftMutation({ counted_amount, counted_deposits })`; `useCloseShiftMutation({ id, counted_amount, counted_deposits, broken_crates })`.

- [ ] **Step 1: Failing tests** — dialog: two labelled fields «Каса, ₴» and «Завдатки, ₴»; submit with deposits empty shows the required error and does not call `onConfirm` (Review Focus 4); `'0'` in deposits submits as `'0.00'`/the normalised value the amount field produces; `onConfirm` receives `('1000.00', '14400.00', null)` in open mode.
- [ ] **Step 2: Run, expect FAIL** — `cd frontend && npx vitest run src/features/count-shift`.
- [ ] **Step 3: Implement** — `CountFormValues.deposits: string`, default `''`; a second `Field name="deposits" label={t('day.count.deposits')} required` with `DecimalInput {...register('deposits', decimalRules())}` directly under the amount field; relabel `day.count.amount` → «Каса, ₴» (en «Cash, ₴»), add `day.count.deposits` «Завдатки, ₴» (en «Deposits, ₴»); adjust `openBody`/`closeBody` copy to say «гроші за ягоду і завдатки за ящики — окремо». Mutations send `counted_deposits`. Every caller passes the new argument through.
- [ ] **Step 4: Run** `npx vitest run` (whole frontend) and `npm run build -w frontend` (tsc catches missed callers) → PASS.
- [ ] **Step 5: Commit** — `feat(count-shift): the drawer dialog asks for «Каса» and «Завдатки» (#178)`

---

### Task 7: Frontend — the result shows both books

**Files:**
- Modify: `frontend/src/widgets/count-result/ui/ShiftCountResult.tsx`, `frontend/src/features/count-shift/ui/CountResultView.tsx` (a `rows` prop), i18n
- Test: `ShiftCountResult.test.tsx`, `CountResultView.test.tsx`

- [ ] **Step 1: Failing tests** — after a close with counts berry 0.00 drift / crates −360: the result shows a «Каса» row and a «Завдатки» row, each with counted, expected and discrepancy; the crates discrepancy is in the destructive tone; title says «Зміна закрита з розбіжністю» when ANY book differs. Operator note: offered for berry when berry differs; when only crates differs, offered for the crates row; when both differ, berry first, and after saving it, crates.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — `CountResultBody` gains optional `rows?: { label: string; counted: string; expected: string; discrepancy: string }[]`; when given, render one block per row (label, `LedgerRow` counted/expected, discrepancy `Badge` with `discrepancyTone`) instead of the single counted/expected/discrepancy trio (recount keeps the trio). `ShiftCountResult` finds both rows (`book === 'berry'` / `'crates'`, kind by mode); `view` holds the two rows; the title keys pick «discrepancy» when any row's discrepancy is non-zero, amount = the berry one if non-zero else the crates one; note target = the first row (berry, crates) with `operator_note_editable` not yet offered — keep a `noteOfferedFor: Set<CashBook>` instead of the boolean; `OperatorNoteForm onDone` moves to the next editable row or closes.
- [ ] **Step 4: Run** `npx vitest run src/widgets src/features/count-shift` → PASS.
- [ ] **Step 5: Commit** — `feat(count-result): the result lists Каса and Завдатки separately (#178)`

---

### Task 8: Frontend — history column and the crates card

**Files:**
- Modify: `frontend/src/pages/point-cash/ui/CashCountHistory.tsx`, `frontend/src/pages/point-cash/ui/CratesBookCard.tsx`, `frontend/src/pages/point-cash/ui/PointCashPage.tsx` (props), `frontend/src/entities/point-cash/model/point-cash.ts`, i18n
- Test: `CashCountHistory` cases in `PointCashPage.test.tsx` (or its own test if present), `CratesBookCard.test.tsx`

- [ ] **Step 1: Failing tests** — history: a «Книга» column reads «Каса»/«Завдатки»; a crates closing row with −360 and `is_open` shows ⚠ and the owner's «Пояснити». Card: `crate_cash = '14400.00'` is the headline; muted line «завдатків за 123 ящики — 14 760,00 ₴»; «Розбіжність −360,00 ₴» line when `crate_unexplained_difference` ≠ 0; `crate_cash = null` → «ще не перераховували» headline (Review Focus 5).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — `PointCashRow` gains `crate_cash: string | null; crate_unexplained_difference: string`, `PointCashOne` gains `crate_cash`. History: new first-after-«when» column `{ id: 'book', header: t('pointCash.countHistory.columns.book'), cell: (row) => t(\`pointCash.countHistory.book.${row.book}\`) }`. Card props: `crateCash: string | null`, `crateDeposits`, `crateDepositUnits`, `crateUnexplained: string`, `berryCash`; headline `crateCash === null ? t('pointCash.crates.notCounted') : formatUah(crateCash)`; caption becomes `pointCash.crates.liability` with `{ count, amount }` (plural forms like the existing `caption_*`); discrepancy line when `!isZero(crateUnexplained)`; the two-books line prints `crateCash ?? crateDeposits`. i18n keys in uk and en.
- [ ] **Step 4: Run** `npx vitest run src/pages/point-cash src/entities` and `npm run lint -w frontend` → PASS.
- [ ] **Step 5: Commit** — `feat(point-cash): the history names the book; the crates card shows the drawer (#178)`

---

### Task 9: Verification and evidence (not a code task)

- [ ] `rm -rf frontend/dist && npm run verify:full` — quote the verdict line; name every SKIPPED row.
- [ ] Code review (`/code-review` on the branch); fix findings; re-run `npm run verify`.
- [ ] Playwright on the local stack: open a shift with two figures, issue crates, close with a −360 crates drift → screenshots of the dialog, the result and «Історія перерахунків»; attach to the issue and the PR body (gh attachments, not committed).
