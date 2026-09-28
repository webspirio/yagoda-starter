# Yagoda CRM — Stored Payout Allocations (slice 3)

**Date:** 2026-09-26
**Source:** `26-rules-by-example.md` §3.3 (original «розподіл (від найстарішого)»), §3.10,
§9 («сторно розкручує розподіл НАЗАД»); the slice-1 spec
`2026-09-25-yagoda-supplier-settlement-slice.md`; the slice-2 spec
`2026-09-25-yagoda-intake-void-payout-decision-slice.md`; the `/grilling` (Q1–Q7) and
brainstorming sessions of 2026-09-26 that produced §3.

**Builds on:** slice 2. This branch, `feat/payout-allocations`, forks from
`feat/intake-void-payout-decision` (`fdb78dc`). PR stack: slice 1 → slice 2 → this.

**Position in the schema:** one new table, `payout_allocations`, making twenty-three.
One migration with a backfill. No endpoint and no response shape changes, and no frontend
change.

---

## 1. Goal

Store which payout paid for which receipt or top-up as frozen facts, instead of projecting it
on every read.

The 04.09.2026 removal of `payout_allocations` is recorded in the DBML and in `26-rules` as
«рішення власника». It was not. It was an artifact of an earlier attempt to simplify the
schema, and that attempt failed. Slice 1 worked around it by projecting the breakdown on
every read (`settlement.ts`). The projection re-derives history: after a void, older payouts
silently «move» to other receipts. Stored allocations make the breakdown a fact that
changes only by a new event.

**Success criterion:** after every write that touches a supplier's documents, the live rows
of `payout_allocations` satisfy the four invariants in §4.5. `GET /suppliers/:id/settlement`
returns the same shape as today, read from those rows.

## 2. Facts from the code this design rests on

- `settle(lines, payouts)` in `supplier-balance/settlement.ts` is pure. It runs pass 1
  (a bound payout covers its own receipt) and then pass 2 (FIFO from the head of the queue),
  over inputs the caller orders by `(business_date, created_at, id)`.
- `settlementFor` reads live receipts, top-ups and payouts with the four `voided_at IS NULL`
  filters, then calls `settle()` on the result. `debt` comes from `debtSql`, the document
  formula.
- `writePayout` already takes `SELECT id FROM suppliers WHERE id = $1 FOR UPDATE` first and
  uses it as a per-supplier mutex. `crates.service.ts` voids take the supplier lock before
  the document lock, because the opposite order inverts against `returnCrates` and deadlocks.
- `IntakesService.create` inserts the intake before `writePayout` locks the supplier. The
  insert takes `FOR KEY SHARE` on the supplier through the FK, and the later `FOR UPDATE` is
  an upgrade.
- `IntakesService.void` (slice 2) locks intake → bound payout and may call
  `PayoutsService.voidWithin` and `settleReturnWithin`.
- `dev-seed.ts` and several db-specs insert intakes and payouts with raw SQL, bypassing the
  services.
- `crate_return_allocations` is the schema's existing allocation table and serves as the
  style precedent.

## 3. Decisions

1. **An allocation is a frozen, append-only fact.** A row is never updated except to set
   `voided_at`. A document void sets `voided_at` on that document's live allocations. Money
   they freed moves by NEW rows. (Grilling Q1.)
2. **One allocator, run in the transaction of every event.** `allocate(m, supplierId)` runs
   after a payout, intake or top-up is created, and after any of the three is voided. It runs
   the bound pass first, then FIFO `(business_date, created_at, id)`, and only appends.
   (Q2.)
3. **Debt stays the document formula.** `debtSql` is untouched. The invariant
   `Σ open − unallocated = debt` is held by tests, not by the allocator. (Q3.)
4. **Table shape** as in §4.1. There is no uniqueness on (payout, line): a pair can receive
   several rows after release and re-allocation. (Q4.)
5. **Backfill in the migration with a frozen copy of `settle()`.** Prod holds seed data only.
   (Q5.)
6. **`GET /suppliers/:id/settlement` keeps its contract** and reads live allocation rows.
   `settle()` becomes the allocator's core. (Q6.)
7. **Per-supplier lock, taken first on every path.** `lockSupplier` runs before any document
   lock, advisory code lock or insert. The global order is supplier → advisory code locks →
   document rows. (Brainstorm, option a.)
8. **Residual settle.** `allocate` feeds `settle()` the residuals (open per line, free per
   payout) and writes its covers as rows. There is no full recompute and no diff, and there
   is no trigger. (Brainstorm, approach 1.)
9. **Rule and DBML edits cancel 04.09 and 25.09 without erasing them** (§6). (Brainstorm,
   option a.)

## 4. Design

### 4.1 Table and migration `1788600000018-PayoutAllocations`

```sql
CREATE TABLE "payout_allocations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "payout_id" uuid NOT NULL,
  "intake_id" uuid NULL,
  "intake_top_up_id" uuid NULL,
  "amount" numeric(12,2) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "voided_at" timestamptz NULL,
  CONSTRAINT "PK_payout_allocations" PRIMARY KEY ("id"),
  CONSTRAINT "FK_payout_allocations_payout" FOREIGN KEY ("payout_id")
    REFERENCES "payouts"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_payout_allocations_intake" FOREIGN KEY ("intake_id")
    REFERENCES "intakes"("id") ON DELETE RESTRICT,
  CONSTRAINT "FK_payout_allocations_top_up" FOREIGN KEY ("intake_top_up_id")
    REFERENCES "intake_top_ups"("id") ON DELETE RESTRICT,
  CONSTRAINT "CHK_payout_allocations_one_target"
    CHECK (num_nonnulls("intake_id", "intake_top_up_id") = 1),
  CONSTRAINT "CHK_payout_allocations_amount" CHECK ("amount" > 0)
);
CREATE INDEX "IDX_payout_allocations_payout" ON "payout_allocations" ("payout_id") WHERE "voided_at" IS NULL;
CREATE INDEX "IDX_payout_allocations_intake" ON "payout_allocations" ("intake_id") WHERE "voided_at" IS NULL;
CREATE INDEX "IDX_payout_allocations_top_up" ON "payout_allocations" ("intake_top_up_id") WHERE "voided_at" IS NULL;
```

- The table has no `supplier_id`, because it comes from `payouts.supplier_id` and one fact
  is stored once. It has no void author or reason, because the void of the document carries
  the audit.
- **Backfill** runs in `up()` after `CREATE`. For each supplier with a live payout, it reads
  live receipts, top-ups and payouts with the same filters and order as `settlementFor`, runs
  a frozen copy of `settle()` embedded in the migration file, and inserts one row per cover.
  The copy works in integer kopecks via `BigInt`, so the migration imports neither
  `settlement.ts` nor `money.ts`: application code may change, a migration may not.
- `down()` drops the table.
- An entity `PayoutAllocation` is registered where `supplier-balance` can inject it. The
  money-module registry test (derived from the DBML) will demand the new module be in the
  eslint money `files` list.

### 4.2 `AllocationsService` (`supplier-balance/allocations.service.ts`)

```ts
lockSupplier(m: EntityManager, supplierId: string): Promise<void>
release(m: EntityManager, target: { payoutId: string } | { intakeId: string } | { topUpId: string }): Promise<void>
allocate(m: EntityManager, supplierId: string): Promise<void>
```

- `lockSupplier` runs `SELECT id FROM suppliers WHERE id = $1 FOR UPDATE`. Its JSDoc carries
  the short form of the mutex rationale now written out at length in `writePayout`.
- `release` runs `UPDATE payout_allocations SET voided_at = now() WHERE <target> AND
  voided_at IS NULL`. `{ intakeId }` also releases the allocations of that intake's top-ups,
  because voiding a receipt neutralises its top-ups in `debtSql`.
- `allocate`:
  1. Reads residual lines: live receipts and live top-ups of live receipts, with
     `open = amount − Σ live allocations`, keeping only `open > 0`, ordered by the queue key.
     Top-ups take the parent's `business_date`.
  2. Reads residual payouts: live payouts with `free = amount − Σ live allocations`, keeping
     only `free > 0`, in the same order, carrying `intake_id`.
  3. Calls `settle(residualLines, residualPayouts)`, with `amount` set to the residual.
  4. Inserts one row per `cover`. There is a single multi-row insert, or none when there are
     no covers.

  `allocate` assumes the caller holds `lockSupplier`. It is idempotent: a second call with
  nothing changed inserts nothing.

### 4.3 Write paths

The same rule holds on every path: `lockSupplier` first, then documents, then `release` on a
void, then exactly one `allocate` at the end of the transaction.

| Event | Change |
|---|---|
| Payout (`PayoutsService.create`) | `writePayout` calls `lockSupplier` instead of its inline query; `create` calls `allocate` at the end. |
| Intake (`IntakesService.create`) | `lockSupplier` before `nextDocumentCode` and the insert, so there is no upgrade from `KEY SHARE`. `allocate` runs at the end, after the optional bound payout. |
| Top-up (`IntakeTopUpsService.create`) | Unlocked read of the intake → `lockSupplier` → insert → `allocate`. |
| Payout void | Unlocked stub read → `lockSupplier` → `loadForWrite` → `voidWithin` → `allocate`. |
| Intake void | Unlocked stub read → `lockSupplier` → `loadForVoid` → bound payout → `release({intakeId})` → decision (`voidWithin` …) → `allocate`. |
| Top-up void | Unlocked stub read → `lockSupplier` → locked load → `release({topUpId})` → `allocate`. |
| `settle-return` | No change: it moves cash, not debt or allocations. |

- `voidWithin` calls `release({ payoutId })` itself, because voiding a payout always frees its
  allocations. It does **not** call `allocate`. The outer operation does, once, so an intake
  void that also voids its payout does not allocate an intermediate state.
- `writePayout` does not call `allocate`. Its callers (`PayoutsService.create`,
  `IntakesService.create`) do, once.
- Refusal order is unchanged. A missing id is a 404 from the unlocked stub read. Other-point
  404, `NOT_YOUR_DOCUMENT`, `SHIFT_CLOSED` and `ALREADY_VOIDED` are raised after the locks,
  exactly as today.
- Slice 2's comment «Lock order: intake, then payout» becomes «supplier → intake → payout».
- Crates keep their inline lock (adjacent module; see the follow-ups).
- **Leaner code:** the methods touched get short why-comments. The repeated «stub → lock»
  opening becomes one small private helper per service.

### 4.4 Read path

- `settlement.ts` gains a pure `fromAllocations(lines, payouts, allocations): Settlement`. It
  builds `paid`, `open`, `covered_by`, `covers` and `unallocated` from the live rows. Several
  rows for one (payout, line) pair stay separate entries in `covered_by` and `covers`.
- `settlementFor` stays one `REPEATABLE READ` transaction. Its three document reads stay as
  they are. A fourth read fetches the live allocations of the supplier (`JOIN payouts` on
  `supplier_id`, `voided_at IS NULL`). It returns `{ debt, ...fromAllocations(...) }`. It
  calls `settle()` no more.
- `Settlement`, the mapper and the response do not change, so `otherCovered` on the frontend
  keeps working unchanged.
- The header of `settlement.ts` («NOTHING HERE IS STORED…») is rewritten in a few lines.

### 4.5 Invariants (held by tests, §5)

For every supplier, after every committed write:

1. `Σ open − Σ unallocated = debt`, where `debt` comes from `debtSql`.
2. No live line with `open > 0` coexists with a live payout with `unallocated > 0`.
3. No live allocation references a voided payout, voided intake, voided top-up, or a top-up
   of a voided intake.
4. For each live document, the Σ of its live allocations ≤ its amount.

### 4.6 Seed and raw-SQL fixtures

- `dev-seed.ts` calls `allocate` for every supplier (under `lockSupplier`, in one
  transaction per supplier) after it writes documents. The seed stays idempotent, because
  `allocate` inserts nothing the second time. `dev-seed.db-spec` asserts the invariants after
  the seed runs, and again after it runs twice.
- Db-specs that insert documents with raw SQL and then read `/settlement` or void through
  HTTP (`settlement.db-spec.ts`, `intake-void-payout-decision.db-spec.ts`, and any others the
  plan finds by grep) call `allocate` at the end of their fixture. Allocating once over the
  final raw state equals `settle()` over that state, so their expected values do not change.

## 5. Tests and verification

- **Unit (`settlement.spec.ts`):** `fromAllocations` on empty input, a partial cover, two rows
  on one pair, a payout with no rows (fully unallocated), and a line with no rows (fully
  open).
- **Unit (`allocations.service.spec.ts`):** `allocate` inserts nothing when there are no
  covers. `release` builds the right `WHERE` for each target, including the top-ups of an
  intake.
- **Db-spec `allocations.db-spec.ts`:**
  - A scripted sequence of all six events, with §4.5's four invariants asserted after each
    step.
  - **Frozen:** voiding an older payout does not update any other live row; the freed lines
    are covered by new rows.
  - A bound payout on a receipt voided with `keep` frees its money to FIFO.
  - Top-up void releases only the top-up's rows.
- **Db-spec, seeded random sequence:** about 40 events drawn from the six kinds against one
  supplier, with a fixed seed, and the four invariants after each event.
- **Db-spec, concurrency:** concurrent pairs, each checked for no deadlock, no double
  allocation, and invariants after both settle:
  - two payouts;
  - two intakes;
  - an intake void against creating a payout bound to that intake;
  - a payout void against a new intake.
- **Migration db-spec:** a fixture with a bound payout, bound excess, a voided receipt and a
  top-up. The backfill's rows equal the covers of the application's `settle()` over the same
  documents.
- **Slices 1–2:** existing db-specs pass with unchanged expectations.
- **Verify:** `npm run verify:full` (migration and money code). Ratchets do not widen.

## 6. Rule and schema edits (dated 2026-09-26)

- **`26-rules-by-example.md`:**
  - Add one «Правка (схема, 26.09.2026)» at §3.3. It says the breakdown is stored again in
    `payout_allocations`, and that the 04.09 and 25.09 notes saying «розподілу немає / не
    зберігається» are cancelled. It states that the 04.09 removal was a failed schema
    simplification, not the owner's decision.
  - Short pointers to that edit go at §3.10 and at §9.
  - The old notes stay, prefixed «СКАСОВАНО 26.09.2026 — див. правку §3.3».
- **`28-db-schema.dbml`:**
  - Add `Table payout_allocations` with a Note: the rule, append-only, `voided_at`, and
    supplier lock first.
  - The section «Розподіл є, але не зберігається (2026-09-25)» becomes «Розподіл
    зберігається (2026-09-26)», with one sentence of history.
  - The `suppliers` Note (line ~236) and header line ~23 drop the owner attribution for the
    allocations removal only. Line 23 also covers villages, which stay as they are.
- **`CLAUDE.md`:** «twenty-two tables» becomes twenty-three, naming this slice.
- **`backend/CLAUDE.md`:** the settlement paragraph.
- **Follow-ups:**
  - Mark the «stored allocations» item done.
  - Add: crates could use `lockSupplier`.

## 7. Out of scope → follow-ups

- Crates switching to `AllocationsService.lockSupplier`.
- Any UI showing allocation history (voided rows). The endpoint serves live rows only.
- Settle-return UI and the slice-2 deferrals, which stay as recorded.
