# Yagoda CRM — Allocations-Cluster Refactor

**Date:** 2026-09-27
**Source:** the `/grilling` (Q1–Q10) and brainstorming sessions of 2026-09-27; the
`nest-module-conventions` skill (commands / queries / seams).

**Builds on:** `feat/open-amount-allocations` (`a980b01`, unpushed, no PR). This branch,
`refactor/allocations-cluster`, forks from it. PR stack: open-amount → this.

**Position in the schema:** none. No migration, no endpoint, no request or response shape,
no lock order and no error text changes. The only SQL difference is one dropped statement:
the redundant supplier re-lock inside `writePayout` (§4.2). No frontend change.

---

## 1. Goal

The services of the four modules the last two slices touched — `intakes`, `payouts`,
`intake-top-ups`, `supplier-balance` — each hold every write scenario, every read scenario,
the domain rules and the transaction choreography in one class (`IntakesService`: 591 lines,
10 constructor dependencies). Split them so that:

- every write scenario has one home (a command) and every read scenario one home (a query);
- the invariant «lock the supplier first, allocate last» is held by structure, not memory;
- the §9.4 access rule exists once;
- the only cross-module write — intakes writing payouts — goes through one named seam.

**Success:** behaviour is identical. The HTTP pipeline specs are not edited; the backend test
count and the four modules' coverage percentages are not below the baseline; every commit is
green on `npm run verify:full`.

## 2. Scope

**In:** `backend/src/{intakes,payouts,intake-top-ups,supplier-balance}/`, two new pure
modules (`auth/access/document-access.ts`, `common/unique-violation.ts`), the specs of those
modules, `testing/allocation-invariants.ts`.

**Out:** every other module. The only edits outside the cluster are comments that name a
class or method this refactor removes (`PayoutsService.writePayout`, `.loadForWrite`,
`.list`, `.void`, `.create`, `IntakesService.*`) — the name is updated, nothing else.

**Module boundaries do not move.** They already hold: `supplier-balance` is the sole writer
of `payout_allocations`, `payouts` of `payouts`, and dependencies point one way. The problem
is inside each service, not between modules. No domain/operations module split (that would
be pre-splitting).

## 3. Shared pieces

### 3.1 `AllocationsService.withinSupplierLedger`

```ts
async withinSupplierLedger<T>(m: EntityManager, supplierId: string, work: () => Promise<T>): Promise<T> {
  await this.lockSupplier(m, supplierId);
  const result = await work();
  await this.allocate(m, supplierId);
  return result;
}
```

`release` stays public — it is about one document, called inside `work`. `lockSupplier` and
`allocate` also stay public, for one reason found while planning: `seed/dev-seed.ts` and five
DB specs allocate raw-inserted fixtures directly (the seed also reports `allocate`'s row
count), and neither is a debt-writing command. No command, query or writer in the four modules
calls them directly — every command goes through `withinSupplierLedger`, and the method's
doc comment says so. Every debt write (intake create/void, payout create/void,
top-up create/void) finds its `supplier_id` itself first — with its own 404, before any
lock, as today's `lockSupplierOf` copies do — and then wraps its work. The SQL issued and its
order are unchanged (bar the one re-lock of §4.2). If `work` throws, `allocate` is not called and the transaction rolls
back, as today.

**A response that reads allocation-derived columns is built after the ledger returns.** An
intake's `open_amount` (in `intake-row-extras.ts`) sums live `payout_allocations`, and today
`create` and `void` run `allocate` *before* reading those extras. So `CreateIntakeCommand` and
`VoidIntakeCommand` return their document from `work` and read the extras after
`withinSupplierLedger`, still inside the transaction. Building the response inside `work`
would serve a stale `open_amount`.

### 3.2 `auth/access/document-access.ts`

Pure functions, no DI, next to `point-scope.ts`:

- `assertCanSee(actor, shift, notFound: string)` — an operator at another point gets
  `NotFoundException(notFound)` (404, never 403); the owner sees everything.
- `assertCanVoid(actor, { authorId, shift }, shiftClosedMessage)` — operator only: not the
  author → 403 `NOT_YOUR_DOCUMENT`; shift closed → 403 `SHIFT_CLOSED`. Payout `settleReturn`
  does not call it: it refuses every non-owner first, so today's `requireAuthor: false`
  branch is unreachable and is dropped rather than carried.

**Messages stay per module.** Today intakes says «…ask the network owner to void it» and
payouts «…ask the network owner»; the caller passes its own text so no response changes.
The drift is a follow-up (§7).

Used by intakes and payouts. Top-ups keep their own «owner only» check — no shift rule reaches
them.

### 3.3 `common/unique-violation.ts`

`translateUniqueViolation(error, constraint, makeConflict: () => ConflictException): unknown`
— returns `makeConflict()` for a 23505 on `constraint`, the error unchanged otherwise.
Replaces the `translateDuplicateCode` twins in intakes and payouts; codes and messages stay
in the modules.

## 4. Module layouts

Convention for all four: `commands/<verb>-<noun>.command.ts` (one public method),
`queries/<scenario>.query.ts`, `services/` for seams. Controllers inject commands and queries
and call exactly one per handler; routes, DTOs and guards do not change.

### 4.1 `supplier-balance`

```
supplier-debt.sql.ts                  debtSql — the formula, once
services/allocations.ts               AllocationsService: withinSupplierLedger, release   (exported)
queries/supplier-debt.query.ts        SupplierDebtQuery.debtFor(supplierId, m?)            (exported)
queries/supplier-settlement.query.ts  SupplierSettlementQuery
queries/list-supplier-balances.query.ts
settlement.ts, supplier-balance.mapper.ts, payout-allocation.entity.ts — unchanged
```

A move, not a rewrite: the three reads of `SupplierBalanceService` become three queries.

### 4.2 `payouts`

```
services/payout-writer.ts        PayoutWriter (the module's only export)
    write(m, input)              open shift → debt ceiling (SupplierDebtQuery) → PO code
                                 → cash ceiling (PointCashService.cashFor) → insert → audit
    findLiveBoundToIntake(m, id) FOR UPDATE
    void(m, actor, payout, reason)          stamp → release → audit
    settleReturn(m, actor, payout, note)    stamp → audit
commands/
    create-payout.command.ts     zero check → point/supplier → tx → ledger → writer.write
    void-payout.command.ts       tx → stub supplier_id → ledger → LoadVisiblePayout(m)
                                 → assertCanVoid → writer.void
    settle-return.command.ts     owner check → tx → LoadVisiblePayout(m) → state checks (no assertCanVoid)
                                 → writer.settleReturn   (no ledger: allocations untouched, as today)
queries/
    load-visible-payout.query.ts {payout, shift}; given `m`, FOR UPDATE
    get-payout.query.ts, list-payouts.query.ts
```

`PayoutWriter` takes no supplier lock, runs no `allocate` and checks no role: it runs only
inside a caller's ledger and transaction. Renames: `writePayout` → `write`,
`findLiveBoundForUpdate` → `findLiveBoundToIntake`, `voidWithin` → `void`,
`settleReturnWithin` → `settleReturn`. The duplicated supplier lock `writePayout` takes today
disappears — on both paths the ledger already holds it (a re-lock in the same transaction is
a no-op, so this changes nothing observable).

### 4.3 `intakes`

```
commands/
    create-intake.command.ts     PriceIntakeQuery (target) → tx → ledger(supplier)
                                 → PriceIntakeQuery (price, in tx) → code → insert → audit
                                 → PayoutWriter.write if paid_amount → IntakeDetailQuery
    void-intake.command.ts       tx → stub supplier_id → ledger → LoadVisibleIntake(m)
                                 → assertCanVoid → ALREADY_VOIDED → stamp → release → audit
                                 → bound payout: assertPayoutDecision → writer.void / settleReturn
queries/
    price-intake.query.ts        resolveTarget + open shift + price/tare snapshots + buildIntake;
                                 shared by create and preview («same reads, same order»)
    preview-intake.query.ts      PriceIntakeQuery + mapper, no transaction
    load-visible-intake.query.ts {intake, shift}; given `m`, FOR UPDATE
    intake-detail.query.ts       items + payouts + row extras + receiver name → detail response
                                 (used by get, create and void)
    get-intake.query.ts, list-intakes.query.ts
intake-lines.ts, payout-decision.ts, intake-row-extras.ts, intake.mapper.ts — unchanged
```

`resolveTarget` stays outside the transaction and before the ledger, as today.

### 4.4 `intake-top-ups`

```
commands/
    create-intake-top-up.command.ts   owner + amount > 0 → tx → stub → ledger
                                      → re-read under lock → active → insert → audit
    void-intake-top-up.command.ts     owner → tx → stub (top-up → intake) → ledger
                                      → FOR UPDATE → state → stamp → release → audit
queries/
    intake-top-up-rows.ts             shared raw queryBase + RawTopUpRow (a function, not a class)
    get-intake-top-up.query.ts, list-intake-top-ups.query.ts
```

### 4.5 Module exports

| Module | Exports after | Before |
|---|---|---|
| `supplier-balance` | `AllocationsService`, `SupplierDebtQuery` | `SupplierBalanceService`, `AllocationsService` |
| `payouts` | `PayoutWriter` | `PayoutsService` |
| `intakes` | nothing | `IntakesService` (no importer) |
| `intake-top-ups` | nothing | `IntakeTopUpsService` (no importer) |

## 5. Comments

Moved code keeps one or two lines of *why*: `§` references, non-obvious invariants (lock
order, 404 not 403, «not a transaction on purpose»), dated client decisions. Change history
(«used to…»), restatements of the code, and cross-references to methods that no longer
exist are dropped. Module headers are rewritten for the new shape: what the module exports
and why.

## 6. Tests and verification

**Baseline, before the first edit:** `npm run verify:full` — record the verdict line, the
backend test count, and `coverage`'s percentages for the four modules' files.

**Moving tests:**
- `intakes.service.spec.ts`, `payouts.service.spec.ts`, `intake-top-ups.service.spec.ts`,
  `supplier-balance.service.spec.ts`, `allocations.service.spec.ts` are split into
  `*.command.spec.ts` / `*.query.spec.ts` / `*.spec.ts` next to the code. Each `it` moves with
  its assertions verbatim; only the subject and the mocks change. An old spec file is deleted
  only when every case has a new home.
- New direct tests: `document-access.spec.ts` (table: role × point × author × shift state),
  `unique-violation.spec.ts`, and `withinSupplierLedger` (lock → work → allocate order;
  `work` throwing skips `allocate`).
- DB specs change only what they `app.get(...)`; assertions untouched.
  `testing/allocation-invariants.ts` moves to `SupplierDebtQuery`.
- `testing/*pipeline.db-spec.ts` — **zero edits**. They drive the real app over HTTP and are
  the primary proof that behaviour did not change.

**Gate per commit:** `npm run verify:full`, verdict line quoted. Test count ≥ baseline, minus
any removed duplicates listed by name. No new suppression, baseline widening or relaxed rule.
The money eslint ban already covers all four modules by glob (`src/<module>/**/*.ts`), so the
new files fall under it without a config change.

**Commit order** (seams before consumers):
1. `document-access.ts` + `unique-violation.ts` with their tests.
2. `supplier-balance` — queries + `withinSupplierLedger`; import paths updated. Each debt
   writer switches to the ledger in its own module's commit (3–5), so no service is rewritten
   twice.
3. `payouts` — `PayoutWriter` + commands/queries.
4. `intakes`.
5. `intake-top-ups`.
6. Out-of-cluster comment names + follow-ups entry.

## 7. Follow-ups (to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`)

1. `SHIFT_CLOSED` message drift between intakes and payouts.
2. «Supplier exists, visible, at this point, active» is duplicated in `CreateIntakeCommand`'s
   target resolution and `CreatePayoutCommand`; its home is the `suppliers` module.
3. The same §9.4 / supplier-lock / unique-violation copies in `transfers`, `crates` (with its
   2026-09-15 carve-out) and `cash-counts` — candidates for the next refactor passes, along
   with `reweighs`/`day-costs` and `point-cash`.
