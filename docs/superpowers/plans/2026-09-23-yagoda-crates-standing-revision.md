# Crates Standing — Revision (client's crate flow + reception returns) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recompute the point's crate standing the way the client runs crates (transfers bring empties in; berries leave at close) and let reception return our rented crates, with their deposit refund, in the same «Прийняти» as the receipt.

**Architecture:** The standing SQL is rewritten over the existing shared fragments. Crate returns gain an `intake_id` link. The return write path is extracted from `CratesService.returnCrates` into one writer that both the standalone return and `IntakesService.create` call inside their own transaction; voiding a receipt voids its linked return. The frontend adds one reception field, one receipt line, a reworked bar and a drill-down hint.

**Tech Stack:** NestJS 11 + TypeORM (raw SQL), Postgres, Jest (`*.spec.ts`, `*.db-spec.ts`); React 19, TanStack Query v5, react-hook-form, Vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-09-23-yagoda-crates-standing.md` — **§8 is binding and supersedes §3/§4.1.**

**Builds on:** branch `feat/crates-standing` at `fddf3ab` (plan `docs/superpowers/plans/2026-09-23-yagoda-crates-standing.md`, Tasks 1–10 + final fixes done).

## Slice 2 — reception crate returns (2026-09-24)

**Run R1, R2, R3, R7, R8, R9 and R10 on branch `feat/reception-crate-returns`** (from `main` at
`641ff53`, where R4–R6 already shipped with PR #158). R5's `CrateReturn`, `IntakeDetail` and
`intakeForm` type changes, deferred by the cut below, land here inside R7/R8/R9. Review Focus 1–4
apply. Where this section and the Global Constraints' branch line disagree, this section wins.
Client confirmation 2026-09-24: a crates-drawer shortfall refuses the WHOLE receipt, as spec §8.3 says.

## Scope cut (client, 2026-09-23) — slice 1, done

**Run only R4, R5 (standing type only), R6 and R10.** R1, R2, R3, R7, R8, R9 are
DEFERRED to the next slice with spec §8.3 — do not implement them here. Adjustments
the cut forces:
- R4 step 1, case 4: the return of 50 is a plain standalone return (no `intake_id`
  column exists yet); the expected figures are unchanged.
- R5: only `CrateStanding` changes (and fixtures `tsc -b` flags). No `CrateReturn`,
  `IntakeDetail` or `intakeForm` changes.
- R10: no `CLAUDE.md` «Documents» sentence and no reception line; `frontend/CLAUDE.md`'s
  `pages/crates` line mentions the recomputed standing only.
- Review Focus items 1–4 belong to the deferred tasks; item 5 stays.

## Global Constraints

- Branch `feat/crates-standing` in the main checkout. No worktree. Never push.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never `git checkout --`/`git restore`; undo surgically.
- Money: every arithmetic on a `numeric` goes through `backend/src/common/money.ts`; any new backend module file handling money goes into `backend/eslint.config.mjs`'s money `files` array.
- Every `SUM` over an int column is cast `::int`.
- Voided documents are excluded from every figure; transfers use the three-way CASE (`transferCratesSql`) unchanged.
- A refusal inside `POST /intakes` rolls back the WHOLE receipt (no receipt without its return, no return without its receipt).
- Lock order: **supplier row `FOR UPDATE` before any document row** — the order `returnCrates`, `voidIssuance`, `voidReturn` already use.
- `allotment` / `shortfall` are `null` for «не задано» → UI «—», never 0. `on_hand` is never null now and MAY be negative (red).
- Frontend tests run in English; test files import from 'vitest' explicitly; no `Array.prototype.at`. Vitest does not typecheck — run `npx tsc -b`.
- Ratchets turn one way: no suppression, no baseline widening, no raised timeout.

## Review Focus

1. **A receipt whose `returned_crates` exceeds its own crate-tare units** (e.g. tare typed as «Чешка») → 400 `RETURNED_EXCEEDS_TARE`, nothing written. Task R3.
2. **Crate drawer short at reception** → whole receipt refused with `CRATE_CASH_INSUFFICIENT`; no intake, no payout, no return row. Task R3.
3. **Voiding a receipt that also paid out berry cash and returned crates** → intake and return voided, payout untouched (its own rule), supplier's crate balance restored. Task R3.
4. **Two tabs: standalone «Прийняти ящики» and a reception return for the same supplier at once** → serialised by the supplier lock, the second sees the first's allocation, no over-return. Task R3 (race db-spec).
5. **No open shift at the point** → `with_berry` 0, `on_hand` still correct. Task R4.

---

## File map

Backend:
- Create `backend/src/migrations/1788600000018-CrateReturnIntakeLink.ts`, `backend/src/migrations/crate-return-intake-link-schema.db-spec.ts`.
- Modify `28-db-schema.dbml` (`crate_returns.intake_id` + Note).
- Modify `backend/src/crates/crate-return.entity.ts`, `crate-return.mapper.ts`, `crates.service.ts`, `crate-balance.service.ts` (`listReturns`), `crates.module.ts` (export), `crate-standing.service.ts`, `crate-standing.db-spec.ts`, `crate-standing.service.spec.ts`, `crates.db-spec.ts`.
- Modify `backend/src/intakes/dto/create-intake.dto.ts`, `intakes.service.ts`, `intake.mapper.ts`, `intakes.module.ts`; create `backend/src/intakes/intake-crate-return.db-spec.ts`.

Frontend:
- `entities/crate/model/crate.ts`, `entities/intake/model/intake.ts`.
- `pages/crates/ui/CrateStandingBar.tsx` (+test), `PersonCrateDocs.tsx` (+test), `CratesPage.test.tsx` fixtures.
- `pages/reception/model/intakeForm.ts`, `pages/reception/ui/TotalsSection.tsx` or a new `pages/reception/ui/ReturnedCratesField.tsx` (+test), `pages/reception/ui/ReceptionPage.tsx`, `pages/reception/lib/apiErrorToFields.ts`.
- `widgets/receipt/ui/ReceiptSheet.tsx` (+ `ReceiptDialog.test.tsx`).
- `shared/lib/i18n/locales/en.json`, `uk.json`, `shared/lib/api-error` (new codes).

---

### Task R1: `crate_returns.intake_id` — migration, entity, DBML

**Files:** create the migration and its schema db-spec; modify `crate-return.entity.ts`, `28-db-schema.dbml`.

**Interfaces — Produces:** column `crate_returns.intake_id uuid NULL`, FK `FK_crate_returns_intake` → `intakes(id)` `ON DELETE RESTRICT`, partial unique index `UQ_crate_returns_intake ON crate_returns (intake_id) WHERE intake_id IS NOT NULL`; entity field `intake_id: string | null`.

- [ ] **Step 1: failing schema db-spec** `crate-return-intake-link-schema.db-spec.ts`, shaped like `migrations/shift-broken-crates-schema.db-spec.ts` (raw inserts of point, user, shift, supplier, intake, return):
  - a return with `intake_id = NULL` inserts;
  - a return with a real intake id inserts;
  - a second return with the SAME `intake_id` fails with `/UQ_crate_returns_intake/`;
  - a return with a random uuid `intake_id` fails with `/FK_crate_returns_intake/`.
  Run `cd backend && npm run test:db -- src/migrations/crate-return-intake-link-schema.db-spec.ts` → FAIL (column missing).
- [ ] **Step 2: migration** `1788600000018-CrateReturnIntakeLink.ts`, copying `1788600000017-PayoutIntakeLink.ts`'s shape (ADD COLUMN, ADD CONSTRAINT FK RESTRICT, `CREATE UNIQUE INDEX ... WHERE "intake_id" IS NOT NULL`; `down` reverses). Doc comment: spec §8.3 — a return written by a receipt in the same «Прийняти»; UNIQUE because one receipt writes at most one return; RESTRICT because nothing deletes a document (§9.3).
- [ ] **Step 3: entity** — `@Column({ type: 'uuid', nullable: true }) intake_id: string | null;` on `CrateReturn` (match the entity's existing column style).
- [ ] **Step 4: DBML** — in `Table crate_returns` add `intake_id uuid [ref: > intakes.id]` after `supplier_id`, and append to its Note: «intake_id (2026-09-23, спец crates-standing §8.3) — повернення, записане КВИТАНЦІЄЮ в тому самому «Прийняти»: людина привезла ягоду в наших орендованих ящиках. NULL для звичайного «Прийняти ящики». Частковий UNIQUE (intake_id) WHERE intake_id IS NOT NULL — одна квитанція пише щонайбільше одне повернення (DBML часткових індексів не виражає). Сторно квитанції сторнує і це повернення; окремо його не сторнують.»
- [ ] **Step 5:** run the schema db-spec → PASS; `npm run verify` (the `schema`/`migrations` rows) → green. Commit `feat(crates): link a crate return to the receipt that wrote it`.

---

### Task R2: One return writer; linked returns carry their receipt and refuse a standalone void

**Files:** `crates/crates.service.ts`, `crate-return.mapper.ts`, `crate-balance.service.ts` (`listReturns`), `crates.module.ts`, `crates.service.spec.ts`, `crates.db-spec.ts`.

**Interfaces — Produces:**

```ts
// crates.service.ts — called INSIDE a caller's transaction; the caller has
// already resolved the point and the open shift. Locks the supplier row
// FOR UPDATE itself (idempotent if the caller already holds it).
async writeReturn(
  m: EntityManager,
  args: {
    actor: AuthenticatedUser;
    pointId: string;
    shift: Shift;
    supplierId: string;
    units: number;
    intakeId: string | null;
  },
): Promise<{ ret: CrateReturn; allocations: CrateAllocationRow[]; tranches: CrateTrancheView[] }>;
```

It carries, unchanged, `returnCrates`'s body from «SELECT … FOR UPDATE» through the audit entry: `tranchesFor` → `allocate` → `RETURN_EXCEEDS_OUTSTANDING` → `pointDepositBook` / `CRATE_CASH_INSUFFICIENT` → save return (+ `intake_id`) → allocations → audit (`after` gains `intake_id`). `returnCrates` becomes: resolve point + supplier (as now), open transaction, find open shift (`NO_OPEN_SHIFT` as now), `writeReturn(..., intakeId: null)`, map. `CratesModule` exports `CratesService` (already does).

- `CrateReturnResponse` gains `intake_id: string | null; intake_code: string | null;`. The mapper takes `intakeCode: string | null` as a new REQUIRED last parameter; `returnCrates` passes `null`; `listReturns` loads the codes for the page in ONE query (`SELECT id, code FROM intakes WHERE id = ANY($1)`) and passes each; `voidReturn` loads its one code when `intake_id` is set.
- `voidReturn`: after the lock and load, if `ret.intake_id` is set → `ConflictException({ message: 'This return was recorded with receipt <code> — void the receipt', code: 'RETURN_BELONGS_TO_INTAKE' })`. Place it right after the `ALREADY_VOIDED` check (after `assertMayVoid`, so another point still 404s first).
- A second, internal method for the cascade (used by Task R3):

```ts
/** Voids the return a receipt wrote, inside the receipt's void transaction.
 *  No permission check here — the receipt's own rule (§9.4) already ran.
 *  Returns null when the receipt wrote no return. */
async voidReturnForIntake(
  m: EntityManager,
  args: { actor: AuthenticatedUser; intakeId: string; reason: string },
): Promise<CrateReturn | null>;
```

It finds the live return by `intake_id` with `pessimistic_write`, sets the void trio, saves, and records audit `crate-return.voided` with `note: reason` and `after` including `intake_id`. The CALLER holds the supplier lock (see R3).

- [ ] **Step 1: failing tests.** In `crates.db-spec.ts` (HTTP-level; reuse its setup): insert a linked return directly (`INSERT INTO crate_returns (..., intake_id)` with an allocation against a live issuance and a real intake from the dispatch test's fixture helpers) → `GET /crate-returns?supplier_id=` shows `intake_id` and `intake_code`; `POST /crate-returns/:id/void` → 409 `RETURN_BELONGS_TO_INTAKE`, row still live. Existing standalone-return tests must keep passing untouched (they now go through `writeReturn`).
- [ ] **Step 2:** run `npm run test:db -- src/crates/crates.db-spec.ts` → FAIL.
- [ ] **Step 3:** implement as above. Keep the long doc comments of `returnCrates` on `writeReturn` (they describe the writer), and leave a one-paragraph doc on `returnCrates` pointing at it.
- [ ] **Step 4:** `npx jest src/crates` + `npm run test:db -- src/crates` → PASS; `npx eslint src/crates`. Commit `refactor(crates): one return writer, and a return a receipt wrote refuses a standalone void`.

---

### Task R3: `POST /intakes` returns our crates; voiding the receipt voids the return

**Files:** `intakes/dto/create-intake.dto.ts` (+ its spec), `intakes.service.ts`, `intake.mapper.ts`, `intakes.module.ts`, create `intakes/intake-crate-return.db-spec.ts`; `intakes.service.spec.ts` as needed.

**Interfaces:**
- Consumes: `CratesService.writeReturn`, `CratesService.voidReturnForIntake` (R2).
- Produces:
  - `CreateIntakeDto.returned_crates?: number` — `@IsOptional() @IsInt() @Min(0)`.
  - `IntakeDetailResponse.crate_return: { id: string; units: number; deposit_refund: string; deposit_units: number; receipt_units: number; voided_at: string | null } | null` — `deposit_units`/`receipt_units` summed from the allocation rows by the issuance mode (`allocations` rows already carry `mode` in `CrateReturnAllocationView`). Present on create and on the detail read (`GET /intakes/:id`, whatever `extrasFor`/detail path the receipt widget uses — find it via `toIntakeDetailResponse`'s callers).
  - Error code `RETURNED_EXCEEDS_TARE` (400).

**Create** (inside the existing transaction, in this order):
1. If `returned_crates > 0`: lock the supplier FIRST — `SELECT id FROM suppliers WHERE id = $1 FOR UPDATE` — BEFORE `compute`/the intake insert (constraint: supplier before documents). Read `payouts.service.ts` around its `FOR UPDATE` doc (≈ lines 120–165) — the same reasoning applies; `writePayout` re-locking the same row in the same transaction is a no-op.
2. After `compute`: crate-tare units on this receipt = Σ over `built.items[].tare` where the tare type `is_crate` (the tare types map `compute`/`intake-lines.ts` already loads — expose `is_crate` through `built` rather than re-querying). If `returned_crates` > that sum → `BadRequestException({ message: 'Only N crates on this receipt are crate tare', code: 'RETURNED_EXCEEDS_TARE' })`.
3. After the intake insert + audit, BEFORE the payout: `crates.writeReturn(m, { actor, pointId, shift, supplierId: supplier.id, units: returned_crates, intakeId: intake.id })`. Its refusals (`RETURN_EXCEEDS_OUTSTANDING`, `CRATE_CASH_INSUFFICIENT`) propagate and roll back everything.
4. Payout as now. Response includes `crate_return`.

**Void** (reorder the start of `IntakesService.void`): unlocked stub read of the intake → lock the supplier row `FOR UPDATE` → `pessimistic_write` load of the intake (as `voidIssuance` does) → the existing checks unchanged → save the void → audit → `crates.voidReturnForIntake(m, { actor, intakeId, reason })` → response. The linked payout is NOT touched (payout voids keep their own rule).

**Module:** `IntakesModule` imports `CratesModule`. Check for a cycle (`CratesModule` must not import `IntakesModule`, directly or transitively); if Nest reports one, stop and report NEEDS_CONTEXT rather than adding `forwardRef`.

- [ ] **Step 1: failing db-spec** `intake-crate-return.db-spec.ts`, HTTP-level like `intakes/intake-paid-at-reception.db-spec.ts` (copy its bootstrap: owner + operator tokens, point, open shift, priced grade, crate tare type — reuse the singleton `is_crate` tare the way `crates.db-spec.ts` creates or finds it — a second non-crate tare, supplier). Cases:
  1. supplier holds 20 on deposit @120 + 30 on розписка; receipt with 40 crate-tare units and `returned_crates: 40` → 201; `crate_return` = `{ units: 40, deposit_refund: '2400.00', deposit_units: 20, receipt_units: 20 }`; `GET /suppliers/:id/crate-balance` → 10 outstanding; `GET /point-cash/:point` `crate_deposits` dropped by 2400.00.
  2. `returned_crates: 41` with 40 crate-tare units → 400 `RETURNED_EXCEEDS_TARE`; `SELECT count(*) FROM intakes WHERE supplier_id = …` unchanged.
  3. `returned_crates` > held → 400 `RETURN_EXCEEDS_OUTSTANDING`; no intake written.
  4. crates drawer short: drain the point's crates book by inserting, via raw SQL, a live `crate_returns` row for ANOTHER supplier at the same point with `deposit_refund` equal to the book (no allocation rows — valid documents cannot produce this, which is exactly why the check exists), then post the case-1 receipt with `returned_crates: 40` and `paid_amount` → 409 `CRATE_CASH_INSUFFICIENT`; no intake, no payout, no new return row.
  5. `returned_crates` omitted / 0 → no return row, `crate_return: null`.
  6. void the receipt from case 1 (operator, own receipt, open shift) → 201; the return row is voided with the same reason; crate balance back to 50; crates book restored; a `paid_amount` payout written with it is still live.
  7. race: two concurrent requests for the same supplier holding 20 — `POST /crate-returns {units: 20}` and `POST /intakes {returned_crates: 20, …}` via `Promise.allSettled` → exactly one succeeds, the other is refused with `RETURN_EXCEEDS_OUTSTANDING`; outstanding ends at 0, never negative. (Pattern: `crates/crates-race.db-spec.ts`.)
  Run → FAIL.
- [ ] **Step 2:** DTO field + `create-intake.dto.spec.ts` cases (negative, non-integer rejected; absent OK).
- [ ] **Step 3:** implement create, void, mapper, module wiring as above.
- [ ] **Step 4:** `npx jest src/intakes src/crates`, `npm run test:db -- src/intakes src/crates` → PASS; `npx eslint src/intakes src/crates`. Commit `feat(intakes): return our rented crates in the same «Прийняти», and void them with the receipt`.

---

### Task R4: The standing, recomputed on the client's flow

**Files:** `crates/crate-standing.service.ts`, `crate-standing.service.spec.ts`, `crate-standing.db-spec.ts`, spec `in_field` row untouched.

**Interfaces — Produces** (replaces the old response):

```ts
export interface CrateStandingResponse {
  collection_point_id: string;
  allotment: number | null;
  received: number;       // transferCratesSql
  on_hand: number;        // received − issued + returned − all receipt crates − broken; MAY be < 0
  in_field: number;       // open tranches (unchanged)
  deposit_units: number;
  deposit_held: string;
  with_berry: number;     // crate tare on live receipts of the OPEN shift; 0 if none
  total: number;          // on_hand + in_field + with_berry
  shortfall: number | null; // allotment − total; null when allotment is
}
```

SQL, `$1` = point, all voided excluded:
- `issued` = `SELECT COALESCE(SUM(ci.units),0)::int FROM crate_issuances ci JOIN shifts s ON s.id = ci.shift_id WHERE s.collection_point_id = $1 AND ci.voided_at IS NULL`
- `returned` = same over `crate_returns` (standalone AND receipt-linked).
- `all_receipt_crates` = `crateTareUnitsSql('sh.collection_point_id = $1')`.
- `with_berry` = `crateTareUnitsSql('sh.collection_point_id = $1 AND sh.closed_at IS NULL')`.
- `broken` = `SELECT COALESCE(SUM(broken_crates),0)::int FROM shifts WHERE collection_point_id = $1`.
- `received` = `transferCratesSql('$1')`.
- `in_field`, `deposit_units` from `openTranchesSql` (as now); `deposit_held` from `crateBookSql`.
Compute `on_hand`, `total`, `shortfall` in SQL. Rewrite the class doc: drop every `at_base` paragraph; state spec §8.1's table as the model, «full crates are always ours», breakage out of empties, `with_berry` is the open shift only because berries go to the base at close.

- [ ] **Step 1: rewrite the db-spec** around the client's example at a fresh point with allotment 500 (keep the existing fixture helpers; add `giveBack` linked to an intake by inserting `intake_id`):
  1. transfer 500 accepted → `{ received: 500, on_hand: 500, in_field: 0, with_berry: 0, total: 500, shortfall: 0 }`
  2. issue 100 (80 deposit, 20 receipt) → `on_hand 400, in_field 100`
  3. open-shift receipt with 50 crate tare (+ 30 «Чешка» noise) → `on_hand 350, in_field 100, with_berry 50, total 500`
  4. open-shift receipt with 50 crate tare + a return of 50 with `intake_id` = that receipt → `on_hand 350, in_field 50, with_berry 100, total 500`
  5. close the shift (`status closed, closed_at, closed_by_user_id, broken_crates 0`), open the next day's shift → `on_hand 350, in_field 50, with_berry 0, total 400, shortfall 100`
  plus: a voided receipt and a voided transfer change nothing; breakage 3 on a closed shift → `on_hand` −3; a `sent` and a disputed-resolved transfer follow the CASE; a point with no allotment → `allotment null, shortfall null`; documents that over-issue (issue 600 with 500 received) → `on_hand` −100; operator pinning; owner without point → 400 (unit spec, unchanged); agreement test with `/crate-balances` kept.
  Update the unit spec's `ROW` fixture to the new shape.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx jest src/crates/crate-standing.service.spec.ts`, `npm run test:db -- src/crates/crate-standing.db-spec.ts` → PASS. Commit `fix(crates): compute the standing from transfers in, issues, returns and receipts`.

---

### Task R5: Frontend types and API bodies

**Files:** `entities/crate/model/crate.ts`, `entities/intake/model/intake.ts`, `pages/reception/model/intakeForm.ts`, test fixtures that build these types (let `tsc -b` find them).

- `CrateStanding` → exactly R4's shape.
- `CrateReturn` gains `intake_id: string | null; intake_code: string | null;`.
- `IntakeDetail` gains `crate_return: IntakeCrateReturn | null` with `IntakeCrateReturn = { id; units; deposit_refund: string; deposit_units; receipt_units; voided_at: string | null }` (exported from `@/entities/intake`).
- `IntakeFormValues` gains `returned_crates: string` (text input value, like `paid_amount`); `CreateIntakeBody` gains `returned_crates?: number`; `toCreateBody` sends it only when it parses to an integer > 0.
- [ ] Update `useCrates.test.tsx`'s `STANDING` fixture and every other fixture `tsc -b` flags; `npx vitest run src/entities src/pages/crates src/pages/reception`; `npx tsc -b` clean. Commit `feat(crates): client types for the recomputed standing and reception returns`.

---

### Task R6: The bar on the new figures

**Files:** `pages/crates/ui/CrateStandingBar.tsx` (+test), en/uk `crates.standing.*`.

- Segments: `onHand` (leaf, clamp 0 for width), `inField` (amber), `withBerry` (primary). Figures: «Пустих на точці» (red when < 0), «У людей», «У нас з ягодою».
- Headline «Наділ» `allotment ?? '—'`; a muted context line «Отримано переказами: {received}».
- Identity line always shown: `Усього за точкою {total} = {on_hand} + {in_field} + {with_berry}`.
- Shortfall line: `allotment === null` → «Не вистачає до наділу: —»; `shortfall > 0` → «Не вистачає до наділу: {shortfall}»; `shortfall === 0` → «Наділ укомплектовано»; `shortfall < 0` → «Понад наділ: {−shortfall}».
- Red warning when `on_hand < 0`: en «More crates were issued or went out with berries than arrived by transfer — check the transfers and issues.» / uk «Видано й відправлено з ягодою більше ящиків, ніж надійшло переказами — перевірте перекази й видачі.»
- Keys: replace `atBase`, `shortfallParts`, `overdrawn`, `unset` with `withBerry`, `received`, `total`, `shortfallNone`, `complete`, `over`, `negative` — delete every key the component no longer uses, keep en/uk parity.
- Tests: the client's day-2 numbers (`received 500, on_hand 350, in_field 50, with_berry 0, total 400, shortfall 100`) print the identity and «short 100»; `shortfall -20` prints «over 20»; `allotment null` prints «—»; `on_hand -5` red + warning; bar widths test keeps its non-vacuous shape; axe test kept. Commit `feat(crates): the bar shows empties, people and berries on hand, and what the allotment is short`.

---

### Task R7: Drill-down — a receipt-linked return points at its receipt

**Files:** `pages/crates/ui/PersonCrateDocs.tsx` (+test), en/uk `crates.docs.*`.

- For `kind === 'crateReturn' && doc.intake_id`: no void button; muted text en «recorded with receipt {{code}} — void the receipt» / uk «записано з квитанцією {{code}} — сторнуйте квитанцію»; its terms line prefixed en «with berries · » / uk «з ягодою · ».
- Test: a linked return shows the hint and no button for the owner too; an unlinked return still shows the button. Commit `feat(crates): a return written by a receipt points at the receipt instead of offering a void`.

---

### Task R8: Reception — «З них наших ящиків»

**Files:** create `pages/reception/ui/ReturnedCratesField.tsx` (+ `ReturnedCratesField.test.tsx`); modify `ReceptionPage.tsx` (render it under the lines/tare, wire form value), `lib/apiErrorToFields.ts` (+test) or `shared/lib/api-error` for the three codes, en/uk `reception.returned.*`.

Behaviour (spec §8.4):
- Reads the supplier's crates via `useCrateBalanceQuery(supplierId)` (`@/entities/crate`) and the crate-tare units on the form from the current line values (tare rows whose tare type `is_crate` — `useTareTypeOptionsQuery` options carry `is_crate`).
- Hidden when no supplier is picked or the supplier holds 0.
- `max = min(crateTareUnits, outstanding_units)`. Pre-fill: whenever `max` changes AND the operator has not edited the field since the supplier was picked, set the value to `max`; once edited, only clamp into `[0, max]` on blur and when `max` drops below it. Picking another supplier resets the «edited» flag.
- Digits only; empty = 0.
- Beside it, when value > 0: `useReturnPreviewQuery({ supplierId, units, pointId })` (`@/features/return-crates`, debounced like the page's other live previews) → en «deposit to refund {{amount}}» / uk «завдаток до повернення {{amount}}» (`formatUah`), or en «on a receipt, no money» / uk «за розпискою, без грошей» when `deposit_refund` is zero; hint en «of the {{held}} crates this person holds» / uk «із {{held}} ящиків, що в цієї людини».
- Submit sends `returned_crates` via `toCreateBody`.
- Error banners: `RETURNED_EXCEEDS_TARE` en «More returned crates than crate tare on this receipt» / uk «Наших ящиків більше, ніж ящиків у тарі цієї квитанції»; `RETURN_EXCEEDS_OUTSTANDING` and `CRATE_CASH_INSUFFICIENT` reuse the existing `crates.errors.returnExceeds` / `crates.errors.cashInsufficient` copy.
- After a successful «Прийняти», invalidate `queryKeys.crateBalances` and `queryKeys.crates` in addition to what the intake mutation already invalidates (find the create-intake mutation in `pages/reception/api/intakes.ts`).
- Tests (mock the hooks like `ReceptionPage.test.tsx` does): hidden when held 0; pre-fills `min(tare 40, held 30) = 30`; editing to 10 sticks when tare rises; clamps 50 → 30 on blur; preview text for deposit and for receipt; the create body carries `returned_crates: 30`; each refusal code maps to its banner; axe on the field.
- Commit `feat(reception): return our rented crates with the receipt`.

---

### Task R9: The receipt prints the returned crates

**Files:** `widgets/receipt/ui/ReceiptSheet.tsx`, `ReceiptDialog.test.tsx`, en/uk `receipt.*`.

- When `intake.crate_return` is present and not voided: a line under the tare/lines block, apart from «Видано готівкою»: en «Returned our crates: {{units}} · deposit refunded {{amount}}» / uk «Повернено наших ящиків: {{units}} · завдаток повернуто {{amount}}»; when `deposit_refund` is zero: «… · за розпискою, без грошей» / «… · on a receipt, no money»; when mixed, the amount form (the amount covers the deposit part).
- When voided: muted «повернення ящиків сторновано» / «crate return voided».
- Tests for the three states. Commit `feat(receipt): print the crates returned with the receipt`.

---

### Task R10: Gate and docs

- [ ] `CLAUDE.md` Architecture «Documents» bullet: one sentence — a receipt may write one linked crate return (`crate_returns.intake_id`) in the same transaction; voiding the receipt voids it, and it cannot be voided alone.
- [ ] `frontend/CLAUDE.md`: reception line gains «З них наших ящиків»; `pages/crates` line mentions the recomputed standing.
- [ ] `npm run verify:full` from the root, fresh (not a cache replay — if `build`/`coverage` report sub-second durations, rerun with turbo's cache bypassed per the verify skill, e.g. `TURBO_FORCE=1`, and say so). Quote the verdict line; name every FAILED/SKIPPED row. Fix, never widen.
- [ ] Commit docs `docs: record receipt-linked crate returns`.
