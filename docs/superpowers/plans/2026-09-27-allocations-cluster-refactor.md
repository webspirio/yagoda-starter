# Allocations-Cluster Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the four bloated services of `intakes`, `payouts`, `intake-top-ups` and `supplier-balance` into commands, queries and seams, with behaviour byte-for-byte unchanged.

**Architecture:** Module boundaries stay. Inside each module every write scenario becomes a `commands/*.command.ts`, every read scenario a `queries/*.query.ts`; the one cross-module write (intakes → payouts) goes through `payouts/services/payout-writer.ts`; the «lock supplier first, allocate last» rule becomes `AllocationsService.withinSupplierLedger`; the §9.4 rule becomes two pure functions in `auth/access/document-access.ts`.

**Tech Stack:** NestJS 11, TypeORM (Postgres), Jest (unit `*.spec.ts`, DB `*.db-spec.ts`), the repo's `scripts/verify` layer.

**Spec:** `docs/superpowers/specs/2026-09-27-allocations-cluster-refactor-design.md`

## Global Constraints

- No change to any route, DTO, guard, response shape, status code, error `code` or error `message` text.
- No migration. No SQL change except dropping the redundant supplier re-lock inside the payout writer.
- Lock order stays: supplier → document row → bound payout → `PO` advisory lock.
- Every moved `it(...)` keeps its assertions verbatim; only the subject under test, its constructor and renamed mock keys change. No test is deleted without a named replacement.
- `testing/*pipeline.db-spec.ts`: zero edits.
- No new eslint suppression, no knip baseline entry, no widened baseline, no lowered floor. A `deadcode` finding is fixed by un-exporting, never by `--write`.
- Moved comments shrink to one or two lines of *why* (keep `§` refs, lock-order and 404-not-403 invariants, dated client decisions; drop history and restatements).
- Source of truth for "moved verbatim" is commit `a980b01` — read originals with `git show a980b01:backend/src/<path>`.
- Commands: one public method named for the verb. Queries: one public entry method (plus narrowly named helpers where stated).
- All commands below run from the repo root unless a `cd backend` is shown. Unit test one file: `cd backend && npx jest <path>`. DB test one file: `cd backend && npx jest -c jest.db.config.js <path>` (needs the dev Postgres from `docker compose up postgres`).
- Gate per task: `npm run verify:full`, verdict line quoted in the task report; a `SKIPPED` row is named as skipped.

## Review Focus

1. **A response read after allocation.** `open_amount` in an intake's detail/row response is derived from live `payout_allocations`; today `create` and `void` run `allocate` *before* reading row extras. A ledger that allocates after `work()` returns would silently serve a stale `open_amount`. Commands build extras-bearing responses **after** `withinSupplierLedger` returns — pinned by a unit test in Tasks 4 (create and void).
2. **`work` throws inside the ledger** — nothing may be allocated and the error must surface unchanged. Pinned in Task 2's `allocations.spec.ts`.
3. **A provider missing from a module** boots nowhere but the real app. Every task runs the pipeline DB specs (`testing/documents-pipeline.db-spec.ts`, `testing/pipeline.db-spec.ts`), which compile `AppModule`.
4. **Route order** — `POST /intakes/preview` must stay declared before every `:id` route in `IntakesController`. Kept by copying handler order exactly (Task 4).
5. **Concurrency** — lock order is only observable under races. Every task's DB run includes `payouts/payout-race.db-spec.ts`, `payouts/payout-cash-race.db-spec.ts`, `intakes/intake-reception-race.db-spec.ts`, `supplier-balance/allocation-write-paths.db-spec.ts`.

---

## File map

**Create**

| Path | Responsibility |
|---|---|
| `backend/src/auth/access/document-access.ts` (+ `.spec.ts`) | §9.4 visibility and void authority, pure |
| `backend/src/common/unique-violation.ts` (+ `.spec.ts`) | 23505 → caller's 409, pure |
| `backend/src/supplier-balance/supplier-debt.sql.ts` | `debtSql` — the debt formula, once |
| `backend/src/supplier-balance/services/allocations.ts` (+ `allocations.spec.ts`) | moved `AllocationsService` + `withinSupplierLedger` |
| `backend/src/supplier-balance/queries/supplier-debt.query.ts` (+ spec) | `SupplierDebtQuery.debtFor` |
| `backend/src/supplier-balance/queries/list-supplier-balances.query.ts` (+ spec) | «Залишки» list |
| `backend/src/supplier-balance/queries/supplier-settlement.query.ts` (+ spec) | settlement breakdown |
| `backend/src/payouts/services/payout-writer.ts` (+ spec) | the only payout writer, inside a caller's tx |
| `backend/src/payouts/commands/{create-payout,void-payout,settle-return}.command.ts` (+ specs) | payout write scenarios |
| `backend/src/payouts/queries/{load-visible-payout,get-payout,list-payouts}.query.ts` | payout reads |
| `backend/src/intakes/commands/{create-intake,void-intake}.command.ts` (+ specs) | intake write scenarios |
| `backend/src/intakes/queries/{price-intake,preview-intake,load-visible-intake,intake-detail,get-intake,list-intakes}.query.ts` (+ specs for preview/get/list) | intake reads |
| `backend/src/intake-top-ups/commands/{create-intake-top-up,void-intake-top-up}.command.ts` (+ specs) | top-up write scenarios |
| `backend/src/intake-top-ups/queries/{intake-top-up-rows.ts,get-intake-top-up.query.ts,list-intake-top-ups.query.ts}` | top-up reads |
| `backend/src/testing/unit/payouts.mocks.ts`, `backend/src/testing/unit/intakes.mocks.ts` | shared unit-test mocks (excluded from the build by `tsconfig.build.json`'s `src/testing/**`) |

**Delete** (each only in the task that replaces it): `supplier-balance/{supplier-balance.service.ts,supplier-balance.service.spec.ts,allocations.service.ts,allocations.service.spec.ts}`, `payouts/{payouts.service.ts,payouts.service.spec.ts}`, `intakes/{intakes.service.ts,intakes.service.spec.ts}`, `intake-top-ups/{intake-top-ups.service.ts,intake-top-ups.service.spec.ts}`.

**Modify:** the four `*.module.ts`, the six controllers, `supplier-balance.controller.spec.ts`, `testing/allocation-invariants.ts`, `seed/dev-seed.ts` (import path only), the DB specs listed per task, comments naming removed symbols (Task 6), `backend/CLAUDE.md` lines describing the four modules (Task 6), the follow-ups doc (Task 6).

---

### Task 0: Baseline

**Files:** none (record into the task report).

- [ ] **Step 1: Start the database**

Run: `docker compose up -d postgres redis`
Expected: both containers healthy (`docker compose ps`).

- [ ] **Step 2: Run the full tier**

Run: `npm run verify:full 2>&1 | tee /tmp/verify-baseline.txt | tail -40`
Expected: verdict line green. Record verbatim: the verdict line, every `SKIPPED` row, the backend unit test count (`Tests: N passed`), the backend DB test count, and `coverage`'s percentages for files under `src/intakes`, `src/payouts`, `src/intake-top-ups`, `src/supplier-balance`.

- [ ] **Step 3: Record the "it" inventory**

Run:
```bash
cd backend && for f in src/intakes/intakes.service.spec.ts src/payouts/payouts.service.spec.ts src/intake-top-ups/intake-top-ups.service.spec.ts src/supplier-balance/supplier-balance.service.spec.ts src/supplier-balance/allocations.service.spec.ts; do printf '%s ' "$f"; grep -cE "^\s*it(\.each)?\(" "$f"; done
```
Expected at `a980b01`: 62 / 40 / 18 / 22 / 5 (`it.each` counted once). Each later task must show the same count summed over the new spec files that replace one of these.

If the baseline is red, STOP and report — do not refactor on a red tree.

---

### Task 1: Pure access and unique-violation helpers

**Files:**
- Create: `backend/src/auth/access/document-access.ts`, `backend/src/auth/access/document-access.spec.ts`
- Create: `backend/src/common/unique-violation.ts`, `backend/src/common/unique-violation.spec.ts`

**Interfaces:**
- Produces:
  - `assertCanSee(actor: AuthenticatedUser, shift: DocumentShift, notFound: string): void`
  - `assertCanVoid(actor: AuthenticatedUser, doc: { authorId: string; shift: DocumentShift }, shiftClosedMessage: string): void`
  - `interface DocumentShift { collection_point_id: string; closed_at: Date | null }` (a `Shift` entity satisfies it)
  - `translateUniqueViolation(error: unknown, constraint: string, conflict: () => ConflictException): unknown`

- [ ] **Step 1: Write the failing tests**

`backend/src/auth/access/document-access.spec.ts`:
```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../jwt.strategy';
import { assertCanSee, assertCanVoid } from './document-access';

const A = 'point-a';
const B = 'point-b';
const owner = { sub: 'owner', role: UserRole.NetworkOwner, collection_point_id: null } as AuthenticatedUser;
const oksana = { sub: 'oksana', role: UserRole.PointOperator, collection_point_id: A } as AuthenticatedUser;
const open = { collection_point_id: A, closed_at: null };
const closed = { collection_point_id: A, closed_at: new Date('2026-09-08T18:00:00Z') };
const CLOSED_MSG = 'That shift is closed — ask the network owner';

describe('assertCanSee', () => {
  it('lets the owner see any point', () => {
    expect(() => assertCanSee(owner, { collection_point_id: B, closed_at: null }, 'X not found')).not.toThrow();
  });

  it('lets an operator see their own point', () => {
    expect(() => assertCanSee(oksana, open, 'X not found')).not.toThrow();
  });

  it('404s — never 403s — another point for an operator, with the caller’s text', () => {
    const run = () => assertCanSee(oksana, { collection_point_id: B, closed_at: null }, 'Payout not found');
    expect(run).toThrow(NotFoundException);
    expect(run).toThrow('Payout not found');
  });
});

describe('assertCanVoid', () => {
  it.each([
    ['owner, someone else’s, closed shift', owner, 'maria', closed],
    ['operator, own, open shift', oksana, 'oksana', open],
  ])('allows %s', (_label, actor, authorId, shift) => {
    expect(() => assertCanVoid(actor, { authorId, shift }, CLOSED_MSG)).not.toThrow();
  });

  it('403s NOT_YOUR_DOCUMENT for a colleague’s document in an open shift', () => {
    try {
      assertCanVoid(oksana, { authorId: 'maria', shift: open }, CLOSED_MSG);
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toEqual({
        message: 'You can only void a document you recorded yourself',
        code: 'NOT_YOUR_DOCUMENT',
      });
    }
  });

  it('checks authorship before the shift: a colleague’s document in a closed shift is NOT_YOUR_DOCUMENT', () => {
    expect(() => assertCanVoid(oksana, { authorId: 'maria', shift: closed }, CLOSED_MSG)).toThrow(
      'You can only void a document you recorded yourself',
    );
  });

  it('403s SHIFT_CLOSED with the caller’s message for the author once the shift is closed', () => {
    try {
      assertCanVoid(oksana, { authorId: 'oksana', shift: closed }, 'That shift is closed — ask the network owner to void it');
      throw new Error('did not throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toEqual({
        message: 'That shift is closed — ask the network owner to void it',
        code: 'SHIFT_CLOSED',
      });
    }
  });
});
```

`backend/src/common/unique-violation.spec.ts`:
```ts
import { ConflictException } from '@nestjs/common';
import { translateUniqueViolation } from './unique-violation';

const conflict = () => new ConflictException({ message: 'taken', code: 'X_TAKEN' });

describe('translateUniqueViolation', () => {
  it('turns a 23505 on the named constraint into the caller’s conflict', () => {
    const out = translateUniqueViolation({ code: '23505', constraint: 'UQ_x' }, 'UQ_x', conflict);
    expect(out).toBeInstanceOf(ConflictException);
    expect((out as ConflictException).getResponse()).toEqual({ message: 'taken', code: 'X_TAKEN' });
  });

  it('passes a 23505 on another constraint through unchanged', () => {
    const err = { code: '23505', constraint: 'UQ_other' };
    expect(translateUniqueViolation(err, 'UQ_x', conflict)).toBe(err);
  });

  it('passes any other error through unchanged', () => {
    const err = new Error('boom');
    expect(translateUniqueViolation(err, 'UQ_x', conflict)).toBe(err);
  });

  it('tolerates a null or non-object error', () => {
    expect(translateUniqueViolation(null, 'UQ_x', conflict)).toBeNull();
    expect(translateUniqueViolation('x', 'UQ_x', conflict)).toBe('x');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/auth/access/document-access.spec.ts src/common/unique-violation.spec.ts`
Expected: FAIL — `Cannot find module './document-access'` / `'./unique-violation'`.

- [ ] **Step 3: Implement**

`backend/src/auth/access/document-access.ts`:
```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../jwt.strategy';

/** The shift facts §9.4 reads — a `Shift` entity satisfies it. */
export interface DocumentShift {
  collection_point_id: string;
  closed_at: Date | null;
}

/** Another point's document is a 404, never a 403: its existence must not be confirmed. */
export function assertCanSee(actor: AuthenticatedUser, shift: DocumentShift, notFound: string): void {
  if (
    actor.role !== UserRole.NetworkOwner &&
    actor.collection_point_id !== shift.collection_point_id
  ) {
    throw new NotFoundException(notFound);
  }
}

/**
 * §9.4 for a void: an operator only on a document they recorded (an author check — §10.6
 * puts two operators in one shift) and only while its shift is open; the owner always.
 * Run after `assertCanSee`. The closed-shift text stays per module.
 */
export function assertCanVoid(
  actor: AuthenticatedUser,
  { authorId, shift }: { authorId: string; shift: DocumentShift },
  shiftClosedMessage: string,
): void {
  if (actor.role === UserRole.NetworkOwner) return;
  if (authorId !== actor.sub) {
    throw new ForbiddenException({
      message: 'You can only void a document you recorded yourself',
      code: 'NOT_YOUR_DOCUMENT',
    });
  }
  if (shift.closed_at) {
    throw new ForbiddenException({ message: shiftClosedMessage, code: 'SHIFT_CLOSED' });
  }
}
```

`backend/src/common/unique-violation.ts`:
```ts
import type { ConflictException } from '@nestjs/common';

/** A 23505 on `constraint` becomes the caller's 409; anything else passes through. Nothing
 *  maps QueryFailedError in this backend, so without this it would reach the client as a 500. */
export function translateUniqueViolation(
  error: unknown,
  constraint: string,
  conflict: () => ConflictException,
): unknown {
  const violation = error as { code?: string; constraint?: string } | null;
  return violation?.code === '23505' && violation.constraint === constraint ? conflict() : error;
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `cd backend && npx jest src/auth/access/document-access.spec.ts src/common/unique-violation.spec.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Gate and commit**

Run: `npm run verify` — green. (knip treats `src/**/*.spec.ts` as entries, so the specs keep the new exports live before Task 3 adds production callers. If `deadcode` reports them anyway, do NOT touch the baseline: leave this task uncommitted and commit it together with Task 3.) Then:
```bash
git add backend/src/auth/access/document-access.ts backend/src/auth/access/document-access.spec.ts backend/src/common/unique-violation.ts backend/src/common/unique-violation.spec.ts
git commit -m "refactor(access): §9.4 document access and unique-violation as pure helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `supplier-balance` — queries, allocations seam, ledger

**Files:**
- Create: `backend/src/supplier-balance/supplier-debt.sql.ts`
- Create: `backend/src/supplier-balance/queries/supplier-debt.query.ts`, `…/supplier-debt.query.spec.ts`
- Create: `backend/src/supplier-balance/queries/list-supplier-balances.query.ts`, `…/list-supplier-balances.query.spec.ts`
- Create: `backend/src/supplier-balance/queries/supplier-settlement.query.ts`, `…/supplier-settlement.query.spec.ts`
- Create (move): `backend/src/supplier-balance/services/allocations.ts`, `…/services/allocations.spec.ts`
- Delete: `supplier-balance/supplier-balance.service.ts`, `supplier-balance.service.spec.ts`, `allocations.service.ts`, `allocations.service.spec.ts`
- Modify: `supplier-balance/supplier-balance.module.ts`, `supplier-balance.controller.ts`, `supplier-balances.controller.ts`, `supplier-balance.controller.spec.ts`
- Modify (import path / class swap only): `payouts/payouts.service.ts`, `intakes/intakes.service.ts`, `intake-top-ups/intake-top-ups.service.ts`, `seed/dev-seed.ts`, `testing/allocation-invariants.ts`, and DB specs `migrations/payout-allocations-schema.db-spec.ts`, `intake-top-ups/intake-top-ups-list.db-spec.ts`, `intakes/intake-void-payout-decision.db-spec.ts`, `supplier-balance/settlement.db-spec.ts`, `supplier-balance/allocations.db-spec.ts`, `supplier-balance/intake-top-ups-balance.db-spec.ts`, `supplier-balance/supplier-balance-list.db-spec.ts`, `payouts/payout-ceiling-top-ups.db-spec.ts`

**Interfaces:**
- Produces:
  - `AllocationsService` (path `supplier-balance/services/allocations`): `withinSupplierLedger<T>(m: EntityManager, supplierId: string, work: () => Promise<T>): Promise<T>`; `release(m, target: ReleaseTarget): Promise<void>`; `lockSupplier(m, supplierId): Promise<void>`; `allocate(m, supplierId): Promise<number>` (the last two public for seed/fixtures only)
  - `SupplierDebtQuery.debtFor(supplierId: string, manager?: EntityManager): Promise<string>`
  - `ListSupplierBalancesQuery.list(actor, query: ListSupplierBalancesQueryDto): Promise<Paginated<SupplierBalanceRowResponse>>`
  - `SupplierSettlementQuery.settlementFor(supplierId: string): Promise<Settlement & { debt: string }>`
  - Module exports: `AllocationsService`, `SupplierDebtQuery`

- [ ] **Step 1: Write the failing ledger test**

Create `backend/src/supplier-balance/services/allocations.spec.ts` by `git mv backend/src/supplier-balance/allocations.service.spec.ts backend/src/supplier-balance/services/allocations.spec.ts`, then change its import to `import { AllocationsService } from './allocations';` and append inside the `describe`:
```ts
  describe('withinSupplierLedger', () => {
    it('locks, runs the work, then allocates — in that order — and returns the work’s result', async () => {
      const order: string[] = [];
      const lock = jest.spyOn(service, 'lockSupplier').mockImplementation(async () => { order.push('lock'); });
      const alloc = jest.spyOn(service, 'allocate').mockImplementation(async () => { order.push('allocate'); return 0; });
      const m = manager([]);
      const out = await service.withinSupplierLedger(m, 's1', async () => { order.push('work'); return 'done'; });
      expect(out).toBe('done');
      expect(order).toEqual(['lock', 'work', 'allocate']);
      expect(lock).toHaveBeenCalledWith(m, 's1');
      expect(alloc).toHaveBeenCalledWith(m, 's1');
      lock.mockRestore();
      alloc.mockRestore();
    });

    it('does not allocate when the work throws, and rethrows the same error', async () => {
      const lock = jest.spyOn(service, 'lockSupplier').mockResolvedValue(undefined);
      const alloc = jest.spyOn(service, 'allocate').mockResolvedValue(0);
      const boom = new Error('boom');
      await expect(service.withinSupplierLedger(manager([]), 's1', async () => { throw boom; })).rejects.toBe(boom);
      expect(alloc).not.toHaveBeenCalled();
      lock.mockRestore();
      alloc.mockRestore();
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/supplier-balance/services/allocations.spec.ts`
Expected: FAIL — `Cannot find module './allocations'`.

- [ ] **Step 3: Move `AllocationsService` and add the ledger**

`git mv backend/src/supplier-balance/allocations.service.ts backend/src/supplier-balance/services/allocations.ts`. In the moved file change `import { settle, DebtLine, PayoutLine } from './settlement';` to `'../settlement'`, replace the class doc comment with:
```ts
/**
 * The only writer of `payout_allocations` (spec 2026-09-26 §4.2). Rows are frozen: `release`
 * stamps `voided_at`, `allocate` appends. Commands go through `withinSupplierLedger`;
 * `lockSupplier`/`allocate` are public only for the seed and raw-SQL fixtures.
 */
```
and add as the first method of the class:
```ts
  /** Every debt write: supplier lock first, one `allocate` last. A throw skips the allocate and rolls back. */
  async withinSupplierLedger<T>(m: EntityManager, supplierId: string, work: () => Promise<T>): Promise<T> {
    await this.lockSupplier(m, supplierId);
    const result = await work();
    await this.allocate(m, supplierId);
    return result;
  }
```

- [ ] **Step 4: Run the ledger test**

Run: `cd backend && npx jest src/supplier-balance/services/allocations.spec.ts`
Expected: PASS, 7 tests (5 moved + 2 new).

- [ ] **Step 5: Split the balance service into queries**

`backend/src/supplier-balance/supplier-debt.sql.ts`:
```ts
/**
 * THE DEBT FORMULA, ONCE — `Σ intakes + Σ intake_top_ups − Σ payouts`, four `voided_at IS NULL`
 * filters (the top-ups term carries two: itself and its parent receipt, which is how a voided
 * receipt neutralises its top-ups without a cascading write). `supplier` is a code literal —
 * `$1` or a correlated `s.id` — never request input. `0.00`, not `0`, so an empty supplier
 * reads to two places like every other balance. No point filter: `supplier_id` already is the
 * point (§3.9). A negative result is legal and must not be clamped.
 */
export const debtSql = (supplier: string): string =>
  `(COALESCE((SELECT SUM(i.amount) FROM intakes i
               WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL), 0.00)
  + COALESCE((SELECT SUM(t.amount) FROM intake_top_ups t
                JOIN intakes ti ON ti.id = t.intake_id
               WHERE ti.supplier_id = ${supplier}
                 AND ti.voided_at IS NULL
                 AND t.voided_at  IS NULL), 0.00)
  - COALESCE((SELECT SUM(p.amount) FROM payouts p
               WHERE p.supplier_id = ${supplier} AND p.voided_at IS NULL), 0.00))`;
```
(The SQL string must be byte-identical to `a980b01`'s `debtSql` — diff it: `diff <(git show a980b01:backend/src/supplier-balance/supplier-balance.service.ts | sed -n '/^const debtSql/,/0.00))`;/p' | tail -n +2) <(sed -n '/^export const debtSql/,/0.00))`;/p' backend/src/supplier-balance/supplier-debt.sql.ts | tail -n +2)` → no output.)

`backend/src/supplier-balance/queries/supplier-debt.query.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { debtSql } from '../supplier-debt.sql';

/** A supplier's debt as a decimal string. The payout ceiling passes its manager so the read
 *  sits under the supplier lock it checks against. Nothing is cached, nothing stored (§3.2). */
@Injectable()
export class SupplierDebtQuery {
  constructor(private readonly dataSource: DataSource) {}

  async debtFor(supplierId: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    // `::text` so the numeric never passes through a JS number (foundation §5.1).
    const [row] = (await runner.query(`SELECT ${debtSql('$1')}::text AS debt`, [supplierId])) as {
      debt: string;
    }[];
    return row.debt;
  }
}
```

`backend/src/supplier-balance/queries/list-supplier-balances.query.ts` — class `ListSupplierBalancesQuery`, constructor `(private readonly dataSource: DataSource)`, one method `list(actor, query)` whose body is `a980b01`'s `SupplierBalanceService.list` body verbatim, with `debtSql` imported from `'../supplier-debt.sql'`. Imports:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ListSupplierBalancesQueryDto } from '../dto/list-supplier-balances.query';
import { SupplierBalanceRow, SupplierBalanceRowResponse, toSupplierBalanceRowResponse } from '../supplier-balance.mapper';
import { debtSql } from '../supplier-debt.sql';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';
```
Doc comment (replaces the 25-line original):
```ts
/**
 * The «Залишки» screen: every supplier in scope with THE debt formula correlated per row,
 * filtered, ordered and paged in Postgres. `include_zero=false` drops exactly `0.00` — a
 * deactivated supplier still owed money stays. The order is total (debt, names, id) so paging
 * is stable. The point filter chooses WHICH suppliers appear; the formula has none.
 */
```
Keep the inline comments on `scoped` and on `COUNT(*)::int` (one line each).

`backend/src/supplier-balance/queries/supplier-settlement.query.ts` — class `SupplierSettlementQuery`, constructor `(private readonly dataSource: DataSource, private readonly debt: SupplierDebtQuery)`, one method `settlementFor(supplierId)` whose body is `a980b01`'s `settlementFor` verbatim except the last lines become `const debt = await this.debt.debtFor(supplierId, manager);`. Move `byQueueKey` (module-level const, unexported, verbatim, comment cut to one line: `/** Queue key (business_date, created_at, id); ISO dates and timestamp::text sort lexicographically. */`). Imports:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { fromAllocations, AllocationRow, DebtLine, PayoutLine, Settlement } from '../settlement';
import { SupplierDebtQuery } from './supplier-debt.query';
```
Keep the original one-line doc comment of `settlementFor` on the class.

Delete `backend/src/supplier-balance/supplier-balance.service.ts`.

- [ ] **Step 6: Split the balance unit spec**

From `a980b01:backend/src/supplier-balance/supplier-balance.service.spec.ts` create three files, each starting with the original constants block (lines 1–19, the `SupplierBalanceService` import replaced):
- `queries/supplier-debt.query.spec.ts` — `describe('SupplierDebtQuery', …)` with the original top-level `beforeEach`/`sql` helper and every top-level `it` (the 8 before `describe('list')`); construct `new SupplierDebtQuery(dataSource as never)`; `service.debtFor(` stays (`service` is the variable name).
- `queries/list-supplier-balances.query.spec.ts` — `describe('ListSupplierBalancesQuery', …)` with the same top-level `let query/dataSource/service` + `beforeEach`, then the whole `describe('list', …)` block verbatim; construct `new ListSupplierBalancesQuery(dataSource as never)`.
- `queries/supplier-settlement.query.spec.ts` — `describe('SupplierSettlementQuery', …)` with the top-level lets + `beforeEach`, then `describe('settlementFor', …)` verbatim, except its inner `beforeEach` constructs:
```ts
      const ds = {
        manager: { query },
        transaction: (_level: string, fn: (m: { query: jest.Mock }) => unknown) => fn({ query }),
      } as never;
      service = new SupplierSettlementQuery(ds, new SupplierDebtQuery(ds));
```
Type the `service` variable per file (`SupplierDebtQuery` / `ListSupplierBalancesQuery` / `SupplierSettlementQuery`). Imports are relative to `queries/` (`'../../users/user-role.enum'`). Delete `supplier-balance.service.spec.ts`.

- [ ] **Step 7: Controllers, controller spec, module**

`supplier-balance.controller.ts` constructor becomes:
```ts
  constructor(
    private readonly debt: SupplierDebtQuery,
    private readonly settlementQuery: SupplierSettlementQuery,
    private readonly suppliers: SuppliersService,
  ) {}
```
with `this.balance.debtFor(` → `this.debt.debtFor(` and `this.balance.settlementFor(` → `this.settlementQuery.settlementFor(`; imports `./queries/supplier-debt.query` and `./queries/supplier-settlement.query`. Shorten the class comment to: the §3.1 purpose line, the one-more-segment registration-order warning (two lines), and «visibility is `SuppliersService.findOne`'s — another point's supplier is a 404».

`supplier-balances.controller.ts`: inject `private readonly balances: ListSupplierBalancesQuery`, call `this.balances.list(actor, query)`; comment cut to three lines (the screen, why a second controller, scope decided by `resolvePointFilter` in the query).

`supplier-balance.controller.spec.ts`: constructor call becomes
```ts
  const controller = new SupplierBalanceController(
    { debtFor } as never,
    { settlementFor } as never,
    { findOne } as never,
  );
```
Nothing else changes.

`supplier-balance.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PayoutAllocation } from './payout-allocation.entity';
import { AllocationsService } from './services/allocations';
import { SupplierDebtQuery } from './queries/supplier-debt.query';
import { ListSupplierBalancesQuery } from './queries/list-supplier-balances.query';
import { SupplierSettlementQuery } from './queries/supplier-settlement.query';
import { SupplierBalanceController } from './supplier-balance.controller';
import { SupplierBalancesController } from './supplier-balances.controller';

/**
 * Owns `payout_allocations` and the debt formula. Reads `intakes`, `intake_top_ups` and
 * `payouts` directly (reads are open); writes only its own table, through
 * `AllocationsService`. Exports the ledger (every debt write) and `SupplierDebtQuery` (the
 * payout ceiling).
 */
@Module({
  imports: [SuppliersModule, TypeOrmModule.forFeature([PayoutAllocation])],
  providers: [AllocationsService, SupplierDebtQuery, ListSupplierBalancesQuery, SupplierSettlementQuery],
  controllers: [SupplierBalanceController, SupplierBalancesController],
  exports: [AllocationsService, SupplierDebtQuery],
})
export class SupplierBalanceModule {}
```
(Keep the original import lines of `supplier-balance.module.ts` for anything not listed above if the file has more.)

- [ ] **Step 8: Repoint every caller (import path / class name only)**

```bash
cd backend/src
grep -rl "supplier-balance/allocations.service\|'./allocations.service'" --include='*.ts' . | grep -v coverage \
  | xargs sed -i '' -e "s#supplier-balance/allocations.service#supplier-balance/services/allocations#g" -e "s#'./allocations.service'#'./services/allocations'#g"
```
Then by hand:
- `payouts/payouts.service.ts`: `import { SupplierBalanceService } from '../supplier-balance/supplier-balance.service';` → `import { SupplierDebtQuery } from '../supplier-balance/queries/supplier-debt.query';` and the constructor param type `SupplierBalanceService` → `SupplierDebtQuery` (name `balance` stays).
- `testing/allocation-invariants.ts`: import `SupplierDebtQuery` from `'../supplier-balance/queries/supplier-debt.query'`; `new SupplierBalanceService(m.connection).debtFor(` → `new SupplierDebtQuery(m.connection).debtFor(`.
- `supplier-balance/intake-top-ups-balance.db-spec.ts`: `debtFor` calls go to `new SupplierDebtQuery(ds)`, `list` calls to `new ListSupplierBalancesQuery(ds)`. Replace the single `service` with two: `let debt: SupplierDebtQuery; let balances: ListSupplierBalancesQuery;`, construct both where `service` was built, and rewrite `service.debtFor(` → `debt.debtFor(`, `service.list(` → `balances.list(`.
- `supplier-balance/supplier-balance-list.db-spec.ts`: `SupplierBalanceService` → `ListSupplierBalancesQuery` (type, import, `new …(ds)`); calls unchanged.
- `supplier-balance/settlement.db-spec.ts`: `service = new SupplierSettlementQuery(ds, new SupplierDebtQuery(ds));`, type/import accordingly.
- `intakes/intake-void-payout-decision.db-spec.ts`: `app.get(SupplierBalanceService).debtFor(` → `app.get(SupplierDebtQuery).debtFor(`; `app.get(SupplierBalanceService).settlementFor(` → `app.get(SupplierSettlementQuery).settlementFor(`. `SupplierSettlementQuery` is not exported by the module but `app.get` resolves any provider in the app (strict: false default) — keep it.
- `payouts/payout-ceiling-top-ups.db-spec.ts`: `balance = app.get(SupplierBalanceService)` → `app.get(SupplierDebtQuery)`, type `SupplierDebtQuery`.

Verify nothing still names the old class: `grep -rn "SupplierBalanceService\|allocations.service" backend/src --include='*.ts' | grep -v coverage` → only comments (listed for Task 6) or nothing.

- [ ] **Step 9: Run unit + DB tests**

Run:
```bash
cd backend && npx jest src/supplier-balance src/payouts src/intakes src/intake-top-ups
npx jest -c jest.db.config.js src/supplier-balance src/payouts src/intakes src/intake-top-ups src/migrations/payout-allocations-schema.db-spec.ts src/seed src/testing
```
Expected: all PASS. The five balance-spec counts sum to the baseline (22 across the three query specs; allocations 5 + 2 new).

- [ ] **Step 10: Gate and commit**

Run: `npm run verify:full` — green; quote the verdict line.
```bash
git add -A backend/src
git commit -m "refactor(supplier-balance): debt/list/settlement queries and the supplier ledger

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `payouts` — `PayoutWriter`, commands, queries

**Files:**
- Create: `backend/src/payouts/services/payout-writer.ts`, `…/services/payout-writer.spec.ts`
- Create: `backend/src/payouts/commands/create-payout.command.ts` (+ `.spec.ts`), `void-payout.command.ts` (+ spec), `settle-return.command.ts` (+ spec)
- Create: `backend/src/payouts/queries/load-visible-payout.query.ts`, `get-payout.query.ts`, `list-payouts.query.ts`
- Create: `backend/src/testing/unit/payouts.mocks.ts`
- Delete: `payouts/payouts.service.ts`, `payouts/payouts.service.spec.ts`
- Modify: `payouts/payouts.controller.ts`, `payouts/payouts.module.ts`
- Modify (swap to the writer, rename calls): `intakes/intakes.service.ts`, `intakes/intakes.service.spec.ts`
- Modify (DB specs): `payouts/payout-ceiling-top-ups.db-spec.ts`, `intakes/intake-void-payout-decision.db-spec.ts`, plus any file `grep -rln "PayoutsService" backend/src --include='*.db-spec.ts'` reports that uses it in code

**Interfaces:**
- Consumes: `AllocationsService.withinSupplierLedger/release`, `SupplierDebtQuery.debtFor` (Task 2); `assertCanSee`, `assertCanVoid`, `translateUniqueViolation` (Task 1)
- Produces:
  - `PayoutWriter.write(m: EntityManager, input: WritePayoutInput): Promise<{ payout: Payout; shift: Shift }>`
  - `PayoutWriter.findLiveBoundToIntake(m: EntityManager, intakeId: string): Promise<Payout | null>`
  - `PayoutWriter.void(m: EntityManager, actor: AuthenticatedUser, payout: Payout, reason: string): Promise<Payout>`
  - `PayoutWriter.settleReturn(m: EntityManager, actor: AuthenticatedUser, payout: Payout, note: string | null): Promise<Payout>`
  - `export interface WritePayoutInput { actor; pointId; pointCode; supplierId; amount; intakeId: string | null }` (same fields as today)
  - `CreatePayoutCommand.create(actor, dto: CreatePayoutDto): Promise<PayoutResponse>`
  - `VoidPayoutCommand.void(actor, id, dto: VoidDocumentDto): Promise<PayoutResponse>`
  - `SettleReturnCommand.settle(actor, id, dto: SettleReturnDto): Promise<PayoutResponse>`
  - `LoadVisiblePayoutQuery.load(actor, id, manager?: EntityManager): Promise<{ payout: Payout; shift: Shift }>`
  - `GetPayoutQuery.get(actor, id)`, `ListPayoutsQuery.list(actor, query)`
  - Module exports: `PayoutWriter` only

- [ ] **Step 1: Create the shared payouts mocks**

`backend/src/testing/unit/payouts.mocks.ts` — move from `a980b01:backend/src/payouts/payouts.service.spec.ts` the constants (`POINT_A` … `elsewhere`, lines 6–36) and the factories `shift`, `payout`, `dto` (now top-level, exported), and turn the `beforeEach` body into a factory:
```ts
import { UserRole } from '../../users/user-role.enum';
import { ShiftStatus } from '../../shifts/shift-status.enum';
import { PayoutWriter } from '../../payouts/services/payout-writer';
import { CreatePayoutCommand } from '../../payouts/commands/create-payout.command';
import { VoidPayoutCommand } from '../../payouts/commands/void-payout.command';
import { SettleReturnCommand } from '../../payouts/commands/settle-return.command';
import { LoadVisiblePayoutQuery } from '../../payouts/queries/load-visible-payout.query';

export const POINT_A = '11111111-1111-1111-1111-111111111111';
export const POINT_B = '22222222-2222-2222-2222-222222222222';
export const SHIFT_ID = '33333333-3333-3333-3333-333333333333';
export const SUPPLIER = '44444444-4444-4444-4444-444444444444';
export const PAYOUT_ID = '77777777-7777-7777-7777-777777777777';
export const owner = { sub: 'u-owner', username: 'owner', role: UserRole.NetworkOwner, collection_point_id: null };
export const oksana = { sub: 'u-oksana', username: 'oksana', role: UserRole.PointOperator, collection_point_id: POINT_A };
export const maria = { sub: 'u-maria', username: 'maria', role: UserRole.PointOperator, collection_point_id: POINT_A };
export const elsewhere = { sub: 'u-b', username: 'b', role: UserRole.PointOperator, collection_point_id: POINT_B };

export const shift = (over: Record<string, unknown> = {}) => ({
  id: SHIFT_ID, collection_point_id: POINT_A, business_date: '2026-09-08', closed_at: null, status: ShiftStatus.Open, ...over,
});
export const payout = (over: Record<string, unknown> = {}) => ({
  id: PAYOUT_ID, code: 'KPG-PO-20260908-003', shift_id: SHIFT_ID, supplier_id: SUPPLIER, amount: '1000.00',
  paid_by_user_id: 'u-oksana', voided_at: null, voided_by_user_id: null, void_reason: null,
  return_settled_at: null, return_settled_by_user_id: null, return_note: null,
  created_at: new Date('2026-09-08T07:00:00.000Z'), updated_at: new Date('2026-09-08T07:00:00.000Z'), ...over,
});
export const dto = (over: Record<string, unknown> = {}) => ({ supplier_id: SUPPLIER, amount: '380.00', ...over });

export function makePayoutsMocks() {
  const manager = {
    // The supplier row lock, then `nextDocumentCode`'s advisory lock and count (two payouts
    // already in this shift, so the next is 003).
    query: jest.fn().mockImplementation((sql: string) => Promise.resolve(sql.includes('count(*)') ? [{ n: 2 }] : [])),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((_e, v) => Promise.resolve(payout(v))),
    create: jest.fn().mockImplementation((_e, v) => v),
  };
  const allocations = {
    lockSupplier: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    allocate: jest.fn().mockResolvedValue(0),
    withinSupplierLedger: jest.fn(),
  };
  // Delegates to the two spies so the lock/allocate order assertions read as before.
  allocations.withinSupplierLedger.mockImplementation(async (m: unknown, id: string, work: () => Promise<unknown>) => {
    await allocations.lockSupplier(m, id);
    const result = await work();
    await allocations.allocate(m, id);
    return result;
  });
  return {
    manager,
    dataSource: { transaction: jest.fn().mockImplementation((cb: (m: unknown) => unknown) => cb(manager)) },
    repo: { findOne: jest.fn().mockResolvedValue(null), createQueryBuilder: jest.fn() },
    shifts: { findOpenAtPoint: jest.fn().mockResolvedValue(shift()), findOneRaw: jest.fn().mockResolvedValue(shift()) },
    suppliers: { findOne: jest.fn().mockResolvedValue({ id: SUPPLIER, collection_point_id: POINT_A, is_active: true }) },
    balance: { debtFor: jest.fn().mockResolvedValue('380.00') },
    points: { findOneRaw: jest.fn().mockResolvedValue({ id: POINT_A, code: 'KPG' }) },
    audit: { record: jest.fn().mockResolvedValue(undefined) },
    pointCash: { cashFor: jest.fn().mockResolvedValue('10000.00') },
    allocations,
  };
}
export type PayoutsMocks = ReturnType<typeof makePayoutsMocks>;

/** The real classes over the mocks — commands run the REAL writer, as in production. */
export function buildPayouts(m: PayoutsMocks) {
  const writer = new PayoutWriter(m.shifts as never, m.balance as never, m.pointCash as never, m.audit as never, m.allocations as never);
  const visible = new LoadVisiblePayoutQuery(m.repo as never, m.shifts as never);
  return {
    writer,
    create: new CreatePayoutCommand(m.dataSource as never, m.points as never, m.suppliers as never, m.allocations as never, writer),
    voidCmd: new VoidPayoutCommand(m.dataSource as never, m.allocations as never, visible, writer),
    settle: new SettleReturnCommand(m.dataSource as never, visible, writer),
  };
}
```
(Format with Prettier — `npx prettier --write` — before committing; the compact lines above are for the plan only.)

- [ ] **Step 2: Split the payouts unit spec (tests first — they fail until Step 3)**

Every new spec file opens with:
```ts
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import {
  POINT_A, POINT_B, SHIFT_ID, SUPPLIER, PAYOUT_ID, owner, oksana, maria, elsewhere,
  shift, payout, dto, makePayoutsMocks, buildPayouts, type PayoutsMocks,
} from '../../testing/unit/payouts.mocks';

  let repo: PayoutsMocks['repo'];
  let manager: PayoutsMocks['manager'];
  let dataSource: PayoutsMocks['dataSource'];
  let shifts: PayoutsMocks['shifts'];
  let suppliers: PayoutsMocks['suppliers'];
  let balance: PayoutsMocks['balance'];
  let points: PayoutsMocks['points'];
  let audit: PayoutsMocks['audit'];
  let pointCash: PayoutsMocks['pointCash'];
  let allocations: PayoutsMocks['allocations'];

  beforeEach(() => {
    const mocks = makePayoutsMocks();
    ({ repo, manager, dataSource, shifts, suppliers, balance, points, audit, pointCash, allocations } = mocks);
    <subject> = buildPayouts(mocks).<key>;
  });

  const saved = () => manager.save.mock.calls[0][1] as Record<string, unknown>;
```
(drop the imports and `let`s a file does not use — `eslint` runs on specs too.) Then move the `describe` blocks from `a980b01:backend/src/payouts/payouts.service.spec.ts` **verbatim**, applying only the renames in the table:

| Target file | Original describes | Subject (`<subject>` / `<key>`) | Renames inside the moved bodies |
|---|---|---|---|
| `commands/create-payout.command.spec.ts` | `create — the debt half of §3.6`, `the cash half of §3.6` | `let command: CreatePayoutCommand` / `create` | `service.create(` → `command.create(` |
| `commands/void-payout.command.spec.ts` | `void` | `let command: VoidPayoutCommand` / `voidCmd` | `service.void(` → `command.void(` |
| `commands/settle-return.command.spec.ts` | `settleReturn` | `let command: SettleReturnCommand` / `settle` | `service.settleReturn(` → `command.settle(` |
| `services/payout-writer.spec.ts` | `writePayout (the shared writer)`, `helpers used by the intake void` | `let writer: PayoutWriter` / `writer` | `service.writePayout(` → `writer.write(`; `service.findLiveBoundForUpdate(` → `writer.findLiveBoundToIntake(`; `service.voidWithin(` → `writer.void(`; `service.settleReturnWithin(` → `writer.settleReturn(`; the same four names in `it(...)` titles and `describe` titles (`'PayoutWriter.write'`, `'helpers used by the intake void'` stays) |

Wrap each file's moved blocks in `describe('<ClassName>', () => { … })`. Any test in the writer spec that asserts `allocations.lockSupplier` was called by `writePayout` itself is now asserting removed behaviour (the writer no longer re-locks — spec §4.2): in that single case, change the assertion to `expect(allocations.lockSupplier).not.toHaveBeenCalled()` and note it in the commit body. (At `a980b01` no such test exists — the lock-order tests are under `create`, where the ledger still locks first — so expect zero such edits.)

Delete `payouts/payouts.service.spec.ts`.

Run: `cd backend && npx jest src/payouts`
Expected: FAIL — cannot find the new modules.

- [ ] **Step 3: Implement `PayoutWriter`**

`backend/src/payouts/services/payout-writer.ts`:
```ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { EntityManager, IsNull } from 'typeorm';
import { Payout } from '../payout.entity';
import { Shift } from '../../shifts/shift.entity';
import { ShiftsService } from '../../shifts/shifts.service';
import { SupplierDebtQuery } from '../../supplier-balance/queries/supplier-debt.query';
import { PointCashService } from '../../point-cash/point-cash.service';
import { AuditService } from '../../audit/audit.service';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { nextDocumentCode } from '../../common/document-code';
import { gt } from '../../common/money';
import { translateUniqueViolation } from '../../common/unique-violation';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

export interface WritePayoutInput {
  actor: AuthenticatedUser;
  pointId: string;
  pointCode: string;
  supplierId: string;
  /** Canonical decimal string, already known to be > 0. */
  amount: string;
  /** The receipt this cash goes with (§2.1 ⑥), or null for «Видати без ягоди». */
  intakeId: string | null;
}

/**
 * THE payout writer, always inside a caller's transaction AND supplier ledger — it takes no
 * supplier lock, runs no `allocate` and checks no role. Used by this module's commands and by
 * the intake commands (§2.1 ⑥ reception, #125 void).
 */
@Injectable()
export class PayoutWriter {
  constructor(
    private readonly shifts: ShiftsService,
    private readonly debt: SupplierDebtQuery,
    private readonly pointCash: PointCashService,
    private readonly audit: AuditService,
    private readonly allocations: AllocationsService,
  ) {}

  /**
   * §3.6 in full: the ceiling is `min(Разом, каса за ягоду)`. Order: open shift → debt (under
   * the caller's supplier lock) → PO code lock → cash (read after that per-shift mutex, since
   * READ COMMITTED gives each statement a fresh snapshot — PR #137) → insert. Callers have
   * checked point, supplier activity and supplier-at-point.
   */
  async write(
    m: EntityManager,
    { actor, pointId, pointCode, supplierId, amount, intakeId }: WritePayoutInput,
  ): Promise<{ payout: Payout; shift: Shift }> {
    const shift = await this.shifts.findOpenAtPoint(pointId, m);
    if (!shift) {
      throw new ConflictException({
        message: 'No open shift at this point — open one first',
        code: 'NO_OPEN_SHIFT',
      });
    }

    // Includes an intake the caller just inserted in this transaction: that is «Разом» (§3.1).
    const debt = await this.debt.debtFor(supplierId, m);
    if (gt(amount, debt)) {
      // Names the balance: §3.1 already shows it, and an unactionable refusal just gets retried.
      throw new BadRequestException({
        message: `Payout of ${amount} exceeds the supplier's balance of ${debt}`,
        code: 'PAYOUT_EXCEEDS_DEBT',
      });
    }

    const code = await nextDocumentCode(m, {
      pointCode,
      businessDate: shift.business_date,
      kind: 'PO',
      shiftId: shift.id,
      table: 'payouts',
    });

    // A negative drawer admits nothing: the berries are taken, the debt stands, a transfer restores cash.
    const cash = await this.pointCash.cashFor(pointId, undefined, m);
    if (gt(amount, cash)) {
      throw new BadRequestException({
        message: `Payout of ${amount} exceeds the cash for berries at this point (${cash})`,
        code: 'PAYOUT_EXCEEDS_CASH',
      });
    }

    try {
      const payout = await m.save(
        Payout,
        m.create(Payout, {
          code,
          shift_id: shift.id,
          supplier_id: supplierId,
          amount,
          paid_by_user_id: actor.sub,
          intake_id: intakeId,
        }),
      );
      await this.audit.record(
        {
          action: 'payout.created',
          actor_id: actor.sub,
          target_type: 'payout',
          target_id: payout.id,
          after: { code, amount, supplier_id: supplierId, intake_id: intakeId },
        },
        m,
      );
      return { payout, shift };
    } catch (error) {
      // Only a shift numbered by hand before 2026-09-18 can still collide.
      throw translateUniqueViolation(
        error,
        'UQ_payouts_code',
        () =>
          new ConflictException({
            message: `Payout ${code} already exists — this shift was numbered by hand before the server took it over`,
            code: 'PAYOUT_CODE_TAKEN',
          }),
      );
    }
  }

  /** The live payout issued with this receipt, locked for the caller's transaction. */
  findLiveBoundToIntake(m: EntityManager, intakeId: string): Promise<Payout | null> {
    return m.findOne(Payout, {
      where: { intake_id: intakeId, voided_at: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Voids a payout the caller loaded, locked and authorised, and releases its allocations.
   *  Does not return the cash (§9.3) — that is `settleReturn`. */
  async void(m: EntityManager, actor: AuthenticatedUser, payout: Payout, reason: string): Promise<Payout> {
    payout.voided_at = new Date();
    payout.voided_by_user_id = actor.sub;
    payout.void_reason = reason;
    const saved = await m.save(Payout, payout);
    await this.allocations.release(m, { payoutId: saved.id });
    await this.audit.record(
      {
        action: 'payout.voided',
        actor_id: actor.sub,
        target_type: 'payout',
        target_id: saved.id,
        after: { code: saved.code, amount: saved.amount },
        note: reason,
      },
      m,
    );
    return saved;
  }

  /** The full cash return of a voided payout the caller locked. Owner-only is the caller's
   *  check; `return_settled_at` is what `point-cash` reads. */
  async settleReturn(
    m: EntityManager,
    actor: AuthenticatedUser,
    payout: Payout,
    note: string | null,
  ): Promise<Payout> {
    payout.return_settled_at = new Date();
    payout.return_settled_by_user_id = actor.sub;
    payout.return_note = note;
    const saved = await m.save(Payout, payout);
    await this.audit.record(
      {
        action: 'payout.return-settled',
        actor_id: actor.sub,
        target_type: 'payout',
        target_id: saved.id,
        after: { code: saved.code, amount: saved.amount },
        note,
      },
      m,
    );
    return saved;
  }
}
```
Note one behavioural nuance kept from `a980b01`: the original wrapped the audit write in the same `try` as the insert; keep that (as above).

- [ ] **Step 4: Implement the queries**

`backend/src/payouts/queries/load-visible-payout.query.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Payout } from '../payout.entity';
import { Shift } from '../../shifts/shift.entity';
import { ShiftsService } from '../../shifts/shifts.service';
import { assertCanSee } from '../../auth/access/document-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** One payout and its shift, if the caller may see it. Given a manager the caller is about to
 *  write, so the row is read `FOR UPDATE` — the state checked is the state written against. */
@Injectable()
export class LoadVisiblePayoutQuery {
  constructor(
    @InjectRepository(Payout) private readonly repo: Repository<Payout>,
    private readonly shifts: ShiftsService,
  ) {}

  async load(
    actor: AuthenticatedUser,
    id: string,
    manager?: EntityManager,
  ): Promise<{ payout: Payout; shift: Shift }> {
    const payout = manager
      ? await manager.findOne(Payout, { where: { id }, lock: { mode: 'pessimistic_write' } })
      : await this.repo.findOne({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');

    const shift = await this.shifts.findOneRaw(payout.shift_id, manager);
    if (!shift) throw new NotFoundException('Payout not found');

    assertCanSee(actor, shift, 'Payout not found');
    return { payout, shift };
  }
}
```

`backend/src/payouts/queries/get-payout.query.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { LoadVisiblePayoutQuery } from './load-visible-payout.query';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class GetPayoutQuery {
  constructor(private readonly visible: LoadVisiblePayoutQuery) {}

  async get(actor: AuthenticatedUser, id: string): Promise<PayoutResponse> {
    const { payout, shift } = await this.visible.load(actor, id);
    return toPayoutResponse(payout, shift);
  }
}
```

`backend/src/payouts/queries/list-payouts.query.ts` — class `ListPayoutsQuery`, constructor `(@InjectRepository(Payout) private readonly repo: Repository<Payout>)`, method `list(actor, query: ListPayoutsQueryDto): Promise<Paginated<PayoutResponse>>` with `a980b01`'s `PayoutsService.list` body verbatim. Imports: `Injectable`, `InjectRepository`, `Repository`, `Payout`, `Shift`, `ListPayoutsQueryDto` (`../dto/list-payouts.query`), `PayoutResponse, toPayoutResponse`, `resolvePointFilter`, `Paginated`, `skipOf`, `AuthenticatedUser` (paths one level deeper than the original).

- [ ] **Step 5: Implement the commands**

`backend/src/payouts/commands/create-payout.command.ts`:
```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreatePayoutDto } from '../dto/create-payout.dto';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { PayoutWriter } from '../services/payout-writer';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { CollectionPointsService } from '../../collection-points/collection-points.service';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { isZero } from '../../common/money';
import { resolveWritePoint } from '../../auth/access/point-scope';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** «Видати без ягоди» — a payout not tied to a receipt. */
@Injectable()
export class CreatePayoutCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly points: CollectionPointsService,
    private readonly suppliers: SuppliersService,
    private readonly allocations: AllocationsService,
    private readonly writer: PayoutWriter,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreatePayoutDto): Promise<PayoutResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    // Spec §8.6: a zero payout is a receipt for nothing. `CHK_payouts_amount` is the real
    // guarantee; this makes the refusal a 400 with a sentence instead of a 500.
    if (isZero(dto.amount)) {
      throw new BadRequestException({
        message: 'A payout must hand over some money',
        code: 'PAYOUT_AMOUNT_ZERO',
      });
    }

    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!supplier.is_active) {
      throw new BadRequestException({
        message: 'That supplier is deactivated',
        code: 'SUPPLIER_INACTIVE',
      });
    }

    return this.dataSource.transaction((m) =>
      this.allocations.withinSupplierLedger(m, supplier.id, async () => {
        const { payout, shift } = await this.writer.write(m, {
          actor,
          pointId,
          pointCode: point.code,
          supplierId: supplier.id,
          amount: dto.amount,
          intakeId: null,
        });
        return toPayoutResponse(payout, shift);
      }),
    );
  }
}
```

`backend/src/payouts/commands/void-payout.command.ts`:
```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Payout } from '../payout.entity';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { PayoutWriter } from '../services/payout-writer';
import { LoadVisiblePayoutQuery } from '../queries/load-visible-payout.query';
import { VoidDocumentDto } from '../../intakes/dto/void-document.dto';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { assertCanVoid } from '../../auth/access/document-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** §9.4 void. Load and state check under the row lock, or a double tap audits twice. */
@Injectable()
export class VoidPayoutCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly allocations: AllocationsService,
    private readonly visible: LoadVisiblePayoutQuery,
    private readonly writer: PayoutWriter,
  ) {}

  async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<PayoutResponse> {
    return this.dataSource.transaction(async (m) => {
      // Unlocked stub: a missing id 404s before any lock; then the supplier lock, always first.
      const stub = await m.findOne(Payout, { where: { id } });
      if (!stub) throw new NotFoundException('Payout not found');

      return this.allocations.withinSupplierLedger(m, stub.supplier_id, async () => {
        const { payout, shift } = await this.visible.load(actor, id, m);
        assertCanVoid(
          actor,
          { authorId: payout.paid_by_user_id, shift },
          'That shift is closed — ask the network owner',
        );
        if (payout.voided_at) {
          throw new ConflictException({
            message: 'That payout is already voided',
            code: 'ALREADY_VOIDED',
          });
        }
        return toPayoutResponse(await this.writer.void(m, actor, payout, dto.reason), shift);
      });
    });
  }
}
```

`backend/src/payouts/commands/settle-return.command.ts`:
```ts
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SettleReturnDto } from '../dto/settle-return.dto';
import { PayoutResponse, toPayoutResponse } from '../payout.mapper';
import { PayoutWriter } from '../services/payout-writer';
import { LoadVisiblePayoutQuery } from '../queries/load-visible-payout.query';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * Owner-only: whoever holds the drawer must not attest its refill (§9.3). Always the whole
 * payout. Under the row lock — two differently-attributed records of one attestation are
 * exactly the ambiguity §9.3 is about. Touches no allocation, so no ledger.
 */
@Injectable()
export class SettleReturnCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly visible: LoadVisiblePayoutQuery,
    private readonly writer: PayoutWriter,
  ) {}

  async settle(actor: AuthenticatedUser, id: string, dto: SettleReturnDto): Promise<PayoutResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may record a returned payout',
        code: 'OWNER_ONLY',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const { payout, shift } = await this.visible.load(actor, id, m);
      if (!payout.voided_at) {
        throw new ConflictException({
          message: 'Only a voided payout can have its cash returned',
          code: 'PAYOUT_NOT_VOIDED',
        });
      }
      if (payout.return_settled_at) {
        throw new ConflictException({
          message: 'That payout’s cash has already been recorded as returned',
          code: 'RETURN_ALREADY_SETTLED',
        });
      }
      return toPayoutResponse(await this.writer.settleReturn(m, actor, payout, dto.note ?? null), shift);
    });
  }
}
```

- [ ] **Step 6: Controller and module**

`payouts.controller.ts`: keep the class comment (trim to the settle-return reason + «no PATCH/DELETE — §2.7, §9.3»; replace «decided in the SERVICE» with «decided in the command»), same handlers in the same order, constructor:
```ts
  constructor(
    private readonly createCommand: CreatePayoutCommand,
    private readonly voidCommand: VoidPayoutCommand,
    private readonly settleCommand: SettleReturnCommand,
    private readonly getQuery: GetPayoutQuery,
    private readonly listQuery: ListPayoutsQuery,
  ) {}
```
Handlers: `create` → `this.createCommand.create(actor, dto)`, `list` → `this.listQuery.list(actor, query)`, `findOne` → `this.getQuery.get(actor, id)`, `void` → `this.voidCommand.void(actor, id, dto)`, `settleReturn` → `this.settleCommand.settle(actor, id, dto)`.

`payouts.module.ts`: same `imports` as today; header comment replaced by:
```ts
/**
 * Cash over the counter. `PayoutWriter` is the one writer of `payouts` and the module's only
 * export — the intake commands write the payout handed over with a receipt through it. The
 * debt half of §3.6 comes from `supplier-balance`, the cash half from `point-cash`; neither
 * formula is re-derived here. Does not import `IntakesModule`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Payout]),
    ShiftsModule,
    SuppliersModule,
    SupplierBalanceModule,
    CollectionPointsModule,
    AuditModule,
    PointCashModule,
  ],
  providers: [
    PayoutWriter,
    CreatePayoutCommand,
    VoidPayoutCommand,
    SettleReturnCommand,
    LoadVisiblePayoutQuery,
    GetPayoutQuery,
    ListPayoutsQuery,
  ],
  controllers: [PayoutsController],
  exports: [PayoutWriter],
})
export class PayoutsModule {}
```
Delete `payouts/payouts.service.ts`.

- [ ] **Step 7: Point intakes at the writer (temporary, until Task 4)**

In `intakes/intakes.service.ts`: `import { PayoutsService } from '../payouts/payouts.service';` → `import { PayoutWriter } from '../payouts/services/payout-writer';`; constructor param `private readonly payouts: PayoutsService` → `private readonly payouts: PayoutWriter`; calls `this.payouts.writePayout(` → `this.payouts.write(`, `findLiveBoundForUpdate(` → `findLiveBoundToIntake(`, `voidWithin(` → `void(`, `settleReturnWithin(` → `settleReturn(`.
In `intakes/intakes.service.spec.ts`: the `payouts` mock's keys and every `payouts.<key>` reference get the same four renames (`sed -i '' -e 's/writePayout/write/g' -e 's/findLiveBoundForUpdate/findLiveBoundToIntake/g' -e 's/voidWithin/void/g' -e 's/settleReturnWithin/settleReturn/g' backend/src/intakes/intakes.service.spec.ts`, then read the diff — `write` must not have clobbered anything else).

- [ ] **Step 8: DB specs**

- `payouts/payout-ceiling-top-ups.db-spec.ts`: `let payouts: CreatePayoutCommand; … payouts = app.get(CreatePayoutCommand);` (import from `./commands/create-payout.command`). `payouts.create(` calls unchanged.
- `intakes/intake-void-payout-decision.db-spec.ts`: `jest.spyOn(app.get(PayoutsService), 'voidWithin')` → `jest.spyOn(app.get(PayoutWriter), 'void')`; import `PayoutWriter` from `'../payouts/services/payout-writer'`; drop the `PayoutsService` import.
- Then `grep -rn "PayoutsService" backend/src --include='*.ts' | grep -v coverage` — any remaining hit in code (not a comment) gets the equivalent swap; comments are Task 6.

- [ ] **Step 9: Run tests**

Run:
```bash
cd backend && npx jest src/payouts src/intakes src/auth src/common
npx jest -c jest.db.config.js src/payouts src/intakes src/supplier-balance src/testing
```
Expected: PASS. `grep -cE "^\s*it(\.each)?\(" src/payouts/**/*.spec.ts` sums to the Task 0 payouts count.

- [ ] **Step 10: Gate and commit**

Run: `npm run verify:full` — green; quote the verdict line; confirm `deadcode` shows no new finding.
```bash
git add -A backend/src
git commit -m "refactor(payouts): PayoutWriter seam, create/void/settle-return commands, read queries

The writer no longer re-takes the supplier lock: every caller already holds it via
AllocationsService.withinSupplierLedger (a same-transaction re-lock was a no-op).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `intakes` — commands and queries

**Files:**
- Create: `backend/src/intakes/commands/create-intake.command.ts` (+ spec), `void-intake.command.ts` (+ spec)
- Create: `backend/src/intakes/queries/price-intake.query.ts`, `preview-intake.query.ts` (+ spec), `load-visible-intake.query.ts`, `intake-detail.query.ts`, `get-intake.query.ts` (+ spec), `list-intakes.query.ts` (+ spec)
- Create: `backend/src/testing/unit/intakes.mocks.ts`
- Delete: `intakes/intakes.service.ts`, `intakes/intakes.service.spec.ts`
- Modify: `intakes/intakes.controller.ts`, `intakes/intakes.module.ts`, `payouts/payout-ceiling-top-ups.db-spec.ts`, any other code hit of `IntakesService`

**Interfaces:**
- Consumes: `PayoutWriter.write/findLiveBoundToIntake/void/settleReturn` (Task 3); `withinSupplierLedger`, `release` (Task 2); `assertCanSee`, `assertCanVoid`, `translateUniqueViolation` (Task 1); unchanged `buildIntake` (`intake-lines.ts`), `assertPayoutDecision` (`payout-decision.ts`), `ROW_EXTRAS_SQL`/`rowExtrasSelects` (`intake-row-extras.ts`), mappers
- Produces:
  - `PriceIntakeQuery.target(actor, dto: PreviewIntakeDto): Promise<{ pointId: string; point: CollectionPoint; supplier: SupplierResponse }>`
  - `PriceIntakeQuery.price(pointId: string, dto: PreviewIntakeDto, m: EntityManager): Promise<{ shift: Shift; built: BuiltIntake }>`
  - `PreviewIntakeQuery.preview(actor, dto): Promise<PreviewIntakeResponse>`
  - `LoadVisibleIntakeQuery.load(actor, id, m?: EntityManager): Promise<{ intake: Intake; shift: Shift }>`
  - `IntakeDetailQuery.extras(intakeId, m): Promise<IntakeRowExtras>`, `.receiverName(userId, m): Promise<string | null>`, `.forIntake(intake, shift): Promise<IntakeDetailResponse>`
  - `GetIntakeQuery.get(actor, id)`, `ListIntakesQuery.list(actor, query)`
  - `CreateIntakeCommand.create(actor, dto: CreateIntakeDto): Promise<IntakeDetailResponse>`
  - `VoidIntakeCommand.void(actor, id, dto: VoidIntakeDto): Promise<IntakeResponse>`
  - Module exports: none

- [ ] **Step 1: Shared intakes mocks**

`backend/src/testing/unit/intakes.mocks.ts`: move from `a980b01:backend/src/intakes/intakes.service.spec.ts` (after Task 3's renames) the constants (lines 6–38 — `POINT_A` … `elsewhere`), the factories `shift`, `intake`, `dto` (top-level, exported) and the whole `beforeEach` body into:
```ts
export function makeIntakesMocks() {
  // <the beforeEach body from the original, turning each `x = …` into `const x = …`,
  //  with `payouts` keys write / findLiveBoundToIntake / void / settleReturn>
  const allocations = {
    lockSupplier: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    allocate: jest.fn().mockResolvedValue(0),
    withinSupplierLedger: jest.fn(),
  };
  allocations.withinSupplierLedger.mockImplementation(async (m: unknown, id: string, work: () => Promise<unknown>) => {
    await allocations.lockSupplier(m, id);
    const result = await work();
    await allocations.allocate(m, id);
    return result;
  });
  return { itemRepo, manager, plainManager, dataSource, repo, shifts, suppliers, prices, tare, points, audit, payouts, allocations };
}
export type IntakesMocks = ReturnType<typeof makeIntakesMocks>;

export function buildIntakes(m: IntakesMocks) {
  const pricing = new PriceIntakeQuery(m.points as never, m.suppliers as never, m.shifts as never, m.prices as never, m.tare as never);
  const detail = new IntakeDetailQuery(m.repo as never);
  const visible = new LoadVisibleIntakeQuery(m.repo as never, m.shifts as never);
  return {
    create: new CreateIntakeCommand(m.dataSource as never, pricing, m.allocations as never, m.payouts as never, m.audit as never, detail),
    voidCmd: new VoidIntakeCommand(m.dataSource as never, visible, m.allocations as never, m.payouts as never, m.audit as never, detail),
    preview: new PreviewIntakeQuery(m.dataSource as never, pricing),
    get: new GetIntakeQuery(visible, detail),
    list: new ListIntakesQuery(m.repo as never),
  };
}
```
The body between the comment markers is the literal original code — the two `queryExtrasOrCount`/`findOneUserOrNull` helpers included — not a summary. Keep the original comments on those helpers (they explain the mock, not the product).

- [ ] **Step 2: Split the intakes unit spec (tests first)**

Each new spec opens like Task 3's (imports from `'../../testing/unit/intakes.mocks'`, typed `let`s for `itemRepo, manager, plainManager, dataSource, repo, shifts, suppliers, prices, tare, points, audit, payouts, allocations`, a `beforeEach` destructuring `makeIntakesMocks()` and taking the subject from `buildIntakes(mocks)`), plus the original helpers `advisoryOrder` and `savedIntake` in the files that use them. Then move the describes **verbatim**:

| Target file | Original describes | Subject / key | Renames |
|---|---|---|---|
| `commands/create-intake.command.spec.ts` | `create`, `paid at reception (§2.1 ⑥, §3.1)`, `there is no update path` | `let command: CreateIntakeCommand` / `create` | `service.create(` → `command.create(` |
| `commands/void-intake.command.spec.ts` | `void` (with nested `with a live bound payout (#125)`) | `let command: VoidIntakeCommand` / `voidCmd` | `service.void(` → `command.void(` |
| `queries/preview-intake.query.spec.ts` | `preview` | `let query: PreviewIntakeQuery` / `preview` | `service.preview(` → `query.preview(` |
| `queries/list-intakes.query.spec.ts` | `list` | `let query: ListIntakesQuery` / `list` | `service.list(` → `query.list(` |
| `queries/get-intake.query.spec.ts` | `findOne` | `let query: GetIntakeQuery` / `get` | `service.findOne(` → `query.get(` |

`there is no update path` can no longer inspect one service. Replace its single assertion (keep the `it` title and comment) with a check over the whole write surface:
```ts
      const commands = readdirSync(__dirname).filter((f) => f.endsWith('.command.ts'));
      expect(commands.sort()).toEqual(['create-intake.command.ts', 'void-intake.command.ts']);
      expect((command as unknown as Record<string, unknown>).update).toBeUndefined();
```
(`import { readdirSync } from 'fs';`).

Add the Review-Focus #1 tests — to `create-intake.command.spec.ts` inside `describe('create')`:
```ts
    it('reads the row extras AFTER allocating, so open_amount reflects this receipt’s allocations', async () => {
      await command.create(oksana, dto());
      const extrasCall = manager.query.mock.calls.findIndex(([sql]) => /AS net_kg/.test(sql as string));
      expect(manager.query.mock.invocationCallOrder[extrasCall]).toBeGreaterThan(
        allocations.allocate.mock.invocationCallOrder[0],
      );
    });
```
and to `void-intake.command.spec.ts` inside `describe('void')` (the `void` block's `beforeEach` already stocks a voidable intake):
```ts
    it('reads the row extras AFTER allocating, so open_amount reflects the release', async () => {
      await command.void(oksana, INTAKE_ID, { reason: 'помилка' });
      const extrasCall = manager.query.mock.calls.findIndex(([sql]) => /AS net_kg/.test(sql as string));
      expect(manager.query.mock.invocationCallOrder[extrasCall]).toBeGreaterThan(
        allocations.allocate.mock.invocationCallOrder[0],
      );
    });
```
(If the `void` block uses a different actor or dto for the happy path, use the same ones its `writes the whole trio and audits with the reason` test uses.)

Delete `intakes/intakes.service.spec.ts`. Run `cd backend && npx jest src/intakes` → FAIL (modules missing).

- [ ] **Step 3: Implement the queries**

`backend/src/intakes/queries/price-intake.query.ts`:
```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { buildIntake, type BuiltIntake, type PriceSnapshot, type TareSnapshot } from '../intake-lines';
import { PreviewIntakeDto } from '../dto/preview-intake.dto';
import { Shift } from '../../shifts/shift.entity';
import { ShiftsService } from '../../shifts/shifts.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import type { SupplierResponse } from '../../suppliers/supplier.mapper';
import { GradePricesService } from '../../grade-prices/grade-prices.service';
import { TareTypesService } from '../../tare-types/tare-types.service';
import { CollectionPointsService } from '../../collection-points/collection-points.service';
import type { CollectionPoint } from '../../collection-points/collection-point.entity';
import { resolveWritePoint } from '../../auth/access/point-scope';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * The reads a receipt is computed from, shared by create and preview so the two are the SAME
 * reads in the SAME order: a preview can then disagree with the document that follows only if
 * a price or tare row changed in between — and then the document is right to win.
 */
@Injectable()
export class PriceIntakeQuery {
  constructor(
    private readonly points: CollectionPointsService,
    private readonly suppliers: SuppliersService,
    private readonly shifts: ShiftsService,
    private readonly prices: GradePricesService,
    private readonly tare: TareTypesService,
  ) {}

  /** Where the document lands and who it is for. Outside any transaction on purpose: the common
   *  failure returns without opening one, and a supplier deactivated a moment later is a
   *  document written a second early, not a corrupt one. */
  async target(
    actor: AuthenticatedUser,
    dto: PreviewIntakeDto,
  ): Promise<{ pointId: string; point: CollectionPoint; supplier: SupplierResponse }> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    // Loaded for its `code` (the receipt's first segment); a bad body-supplied point would
    // otherwise reach the FK as a 500.
    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

    // `findOne` enforces visibility, so another point's supplier is a 404.
    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!supplier.is_active) {
      throw new BadRequestException({
        message: 'That supplier is deactivated',
        code: 'SUPPLIER_INACTIVE',
      });
    }
    return { pointId, point, supplier };
  }

  /** Open shift, then the two snapshots, then every rule in one pure call. Create runs it inside
   *  its transaction so the stored price is the one current at the insert. */
  async price(
    pointId: string,
    dto: PreviewIntakeDto,
    m: EntityManager,
  ): Promise<{ shift: Shift; built: BuiltIntake }> {
    const shift = await this.shifts.findOpenAtPoint(pointId, m);
    if (!shift) {
      throw new ConflictException({
        message: 'No open shift at this point — open one first',
        code: 'NO_OPEN_SHIFT',
      });
    }
    const prices = await this.snapshotPrices(pointId, dto, m);
    const tareTypes = await this.snapshotTare(dto, m);
    return { shift, built: buildIntake(dto.items, prices, tareTypes) };
  }

  /** §2.8 — a snapshot of the row current now; §4.5 makes a missing one `buildIntake`'s refusal. */
  private async snapshotPrices(
    pointId: string,
    dto: PreviewIntakeDto,
    m: EntityManager,
  ): Promise<Map<string, PriceSnapshot>> {
    const gradeIds = [...new Set(dto.items.map((i) => i.product_grade_id))];
    const rows = await Promise.all(gradeIds.map((g) => this.prices.currentFor(pointId, g, m)));
    const prices = new Map<string, PriceSnapshot>();
    rows.forEach((row) => {
      if (row) {
        prices.set(row.product_grade_id, {
          base_price: row.base_price,
          max_markup: row.max_markup,
          max_discount: row.max_discount,
        });
      }
    });
    return prices;
  }

  /** §2.5 — «вага тари підставляється сама». */
  private async snapshotTare(dto: PreviewIntakeDto, m: EntityManager): Promise<Map<string, TareSnapshot>> {
    const tareIds = [...new Set(dto.items.flatMap((i) => i.tare.map((t) => t.tare_type_id)))];
    const rows = await this.tare.findManyRaw(tareIds, m);
    return new Map(rows.map((t) => [t.id, { id: t.id, weight_kg: t.weight_kg }]));
  }
}
```

`backend/src/intakes/queries/preview-intake.query.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PreviewIntakeDto } from '../dto/preview-intake.dto';
import { PreviewIntakeResponse, toPreviewIntakeResponse } from '../intake.mapper';
import { PriceIntakeQuery } from './price-intake.query';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * Create up to the write, then nothing — the reception screen's live numbers, computed only
 * here (§2.4/§2.8/§2.9), with the same refusals so the operator learns early. NOT a
 * transaction on purpose: nothing is saved, audited or numbered.
 */
@Injectable()
export class PreviewIntakeQuery {
  constructor(
    private readonly dataSource: DataSource,
    private readonly pricing: PriceIntakeQuery,
  ) {}

  async preview(actor: AuthenticatedUser, dto: PreviewIntakeDto): Promise<PreviewIntakeResponse> {
    const { pointId, supplier } = await this.pricing.target(actor, dto);
    const { shift, built } = await this.pricing.price(pointId, dto, this.dataSource.manager);
    return toPreviewIntakeResponse(
      { collection_point_id: pointId, supplier_id: supplier.id, business_date: shift.business_date },
      built,
    );
  }
}
```

`backend/src/intakes/queries/load-visible-intake.query.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Intake } from '../intake.entity';
import { Shift } from '../../shifts/shift.entity';
import { ShiftsService } from '../../shifts/shifts.service';
import { assertCanSee } from '../../auth/access/document-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** One receipt and its shift, if the caller may see it. With a manager the row is read
 *  `FOR UPDATE` inside the caller's transaction (the void path). The point comes from the shift (§2.3). */
@Injectable()
export class LoadVisibleIntakeQuery {
  constructor(
    @InjectRepository(Intake) private readonly repo: Repository<Intake>,
    private readonly shifts: ShiftsService,
  ) {}

  async load(actor: AuthenticatedUser, id: string, m?: EntityManager): Promise<{ intake: Intake; shift: Shift }> {
    const intake = m
      ? await m.findOne(Intake, { where: { id }, lock: { mode: 'pessimistic_write' } })
      : await this.repo.findOne({ where: { id } });
    if (!intake) throw new NotFoundException('Intake not found');

    // Two call shapes on purpose: the read path has always called `findOneRaw(id)` with one argument.
    const shift = m
      ? await this.shifts.findOneRaw(intake.shift_id, m)
      : await this.shifts.findOneRaw(intake.shift_id);
    if (!shift) throw new NotFoundException('Intake not found');

    assertCanSee(actor, shift, 'Intake not found');
    return { intake, shift };
  }
}
```

`backend/src/intakes/queries/intake-detail.query.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Intake } from '../intake.entity';
import { IntakeItem } from '../intake-item.entity';
import { IntakeDetailResponse, toIntakeDetailResponse } from '../intake.mapper';
import { ROW_EXTRAS_SQL, type IntakeRowExtras } from '../intake-row-extras';
import { Payout } from '../../payouts/payout.entity';
import { Shift } from '../../shifts/shift.entity';
import { User } from '../../users/user.entity';
import { displayNameOf } from '../../users/display-name';

/** The printed-receipt facts beyond the row itself: derived columns, lines, payouts, receiver. */
@Injectable()
export class IntakeDetailQuery {
  constructor(@InjectRepository(Intake) private readonly repo: Repository<Intake>) {}

  /** The derived columns for ONE document — read after any allocation in the same transaction,
   *  so `open_amount` and `paid_amount` see it. */
  async extras(intakeId: string, m: EntityManager): Promise<IntakeRowExtras> {
    const [row] = (await m.query(ROW_EXTRAS_SQL, [intakeId])) as IntakeRowExtras[];
    if (!row) throw new Error('intake row extras missing for ' + intakeId);
    return row;
  }

  /** `displayNameOf` — the ONE definition of a user's name. */
  async receiverName(userId: string, m: EntityManager): Promise<string | null> {
    const user = await m.findOne(User, { where: { id: userId } });
    return user ? displayNameOf(user) : null;
  }

  async forIntake(intake: Intake, shift: Shift): Promise<IntakeDetailResponse> {
    const m = this.repo.manager;
    const items = await m.find(IntakeItem, { where: { intake_id: intake.id }, relations: { tare: true } });
    // Tiebreaker: two payouts in one millisecond are ordinary, and Postgres orders no ties.
    const payouts = await m.find(Payout, {
      where: { intake_id: intake.id },
      order: { created_at: 'ASC', id: 'ASC' },
    });
    return toIntakeDetailResponse(
      intake,
      shift,
      items,
      await this.extras(intake.id, m),
      payouts,
      await this.receiverName(intake.received_by_user_id, m),
    );
  }
}
```

`backend/src/intakes/queries/get-intake.query.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { LoadVisibleIntakeQuery } from './load-visible-intake.query';
import { IntakeDetailQuery } from './intake-detail.query';
import { IntakeDetailResponse } from '../intake.mapper';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class GetIntakeQuery {
  constructor(
    private readonly visible: LoadVisibleIntakeQuery,
    private readonly detail: IntakeDetailQuery,
  ) {}

  async get(actor: AuthenticatedUser, id: string): Promise<IntakeDetailResponse> {
    const { intake, shift } = await this.visible.load(actor, id);
    return this.detail.forIntake(intake, shift);
  }
}
```

`backend/src/intakes/queries/list-intakes.query.ts` — class `ListIntakesQuery`, constructor `(@InjectRepository(Intake) private readonly repo: Repository<Intake>)`, method `list(actor, query: ListIntakesQueryDto): Promise<Paginated<IntakeResponse>>` with `a980b01`'s `IntakesService.list` body verbatim. Class doc: `/** The journal (§11.5); §9.3 keeps a voided receipt in it forever, hence include_voided defaults to true. The point scope is a JOIN through shifts. */`. Keep the three inline comments but cut each to one line: the tiebreaker, `qb.clone()` for the count («`getCount()` mutates the builder `getRawAndEntities()` is using»), and map-by-id («a position mismatch would hand one intake's extras to another, silently»). Imports: `Injectable`, `InjectRepository`, `Repository`, `Intake`, `Shift`, `Supplier`, `ListIntakesQueryDto`, `IntakeResponse, toIntakeResponse`, `rowExtrasSelects`, `resolvePointFilter`, `Paginated`, `skipOf`, `AuthenticatedUser`.

- [ ] **Step 4: Implement the commands**

`backend/src/intakes/commands/create-intake.command.ts`:
```ts
import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Intake } from '../intake.entity';
import { IntakeItem } from '../intake-item.entity';
import { IntakeItemTareType } from '../intake-item-tare-type.entity';
import type { BuiltIntake } from '../intake-lines';
import { CreateIntakeDto } from '../dto/create-intake.dto';
import { IntakeDetailResponse, toIntakeDetailResponse } from '../intake.mapper';
import { PriceIntakeQuery } from '../queries/price-intake.query';
import { IntakeDetailQuery } from '../queries/intake-detail.query';
import { Payout } from '../../payouts/payout.entity';
import { PayoutWriter } from '../../payouts/services/payout-writer';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { AuditService } from '../../audit/audit.service';
import { nextDocumentCode } from '../../common/document-code';
import { isZero } from '../../common/money';
import { translateUniqueViolation } from '../../common/unique-violation';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * One POST, one transaction, the whole receipt (§2.3) — and, since 2026-09-21, the payout
 * handed over with it (§2.1 ⑥). No update path exists: §2.7 freezes `amount`, §9.3 corrects
 * by void plus a new document.
 */
@Injectable()
export class CreateIntakeCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly pricing: PriceIntakeQuery,
    private readonly allocations: AllocationsService,
    private readonly payouts: PayoutWriter,
    private readonly audit: AuditService,
    private readonly detail: IntakeDetailQuery,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateIntakeDto): Promise<IntakeDetailResponse> {
    const { pointId, point, supplier } = await this.pricing.target(actor, dto);

    return this.dataSource.transaction(async (m) => {
      const { intake, shift, paid } = await this.allocations.withinSupplierLedger(m, supplier.id, async () => {
        const { shift, built } = await this.pricing.price(pointId, dto, m);
        const code = await nextDocumentCode(m, {
          pointCode: point.code,
          businessDate: shift.business_date,
          kind: 'IN',
          shiftId: shift.id,
          table: 'intakes',
        });
        const intake = await this.insert(m, actor, code, shift.id, supplier.id, built);
        await this.audit.record(
          {
            action: 'intake.created',
            actor_id: actor.sub,
            target_type: 'intake',
            target_id: intake.id,
            after: { code, amount: built.amount, supplier_id: supplier.id },
          },
          m,
        );

        // §2.1 ⑥ — the cash leaves in the same transaction; a ceiling refusal rolls the receipt
        // back with it. Truthiness on purpose: absent, null and '' all mean «нічого не видано» (§3.7).
        const paid: Payout[] = [];
        if (dto.paid_amount && !isZero(dto.paid_amount)) {
          const { payout } = await this.payouts.write(m, {
            actor,
            pointId,
            pointCode: point.code,
            supplierId: supplier.id,
            amount: dto.paid_amount,
            intakeId: intake.id,
          });
          paid.push(payout);
        }
        return { intake, shift, paid };
      });

      // After the ledger's allocate: `open_amount` must see this receipt's allocations.
      return toIntakeDetailResponse(
        intake,
        shift,
        intake.items ?? [],
        await this.detail.extras(intake.id, m),
        paid,
        await this.detail.receiverName(actor.sub, m),
      );
    });
  }

  /** Only this insert can hit `UQ_intakes_code` — a shift numbered by hand before 2026-09-18. */
  private async insert(
    m: EntityManager,
    actor: AuthenticatedUser,
    code: string,
    shiftId: string,
    supplierId: string,
    built: BuiltIntake,
  ): Promise<Intake> {
    try {
      return await m.save(
        Intake,
        m.create(Intake, {
          code,
          shift_id: shiftId,
          supplier_id: supplierId,
          amount: built.amount,
          // §10.6 — the signature belongs to whoever pressed the button.
          received_by_user_id: actor.sub,
          items: built.items.map((line) =>
            m.create(IntakeItem, {
              item_order: line.item_order,
              product_grade_id: line.product_grade_id,
              gross_kg: line.gross_kg,
              pallet_kg: line.pallet_kg,
              tare_weight_kg: line.tare_weight_kg,
              net_kg: line.net_kg,
              price: line.price,
              bonus: line.bonus,
              amount: line.amount,
              tare: line.tare.map((t) =>
                m.create(IntakeItemTareType, { tare_type_id: t.tare_type_id, units: t.units }),
              ),
            }),
          ),
        }),
      );
    } catch (error) {
      throw translateUniqueViolation(
        error,
        'UQ_intakes_code',
        () =>
          new ConflictException({
            message: `Receipt ${code} already exists — this shift was numbered by hand before the server took it over`,
            code: 'INTAKE_CODE_TAKEN',
          }),
      );
    }
  }
}
```

`backend/src/intakes/commands/void-intake.command.ts`:
```ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Intake } from '../intake.entity';
import { VoidIntakeDto } from '../dto/void-intake.dto';
import { IntakeResponse, toIntakeResponse } from '../intake.mapper';
import { assertPayoutDecision } from '../payout-decision';
import { LoadVisibleIntakeQuery } from '../queries/load-visible-intake.query';
import { IntakeDetailQuery } from '../queries/intake-detail.query';
import { Shift } from '../../shifts/shift.entity';
import { PayoutWriter } from '../../payouts/services/payout-writer';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { AuditService } from '../../audit/audit.service';
import { assertCanVoid } from '../../auth/access/document-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * §9.4 void plus #125's decision about a bound payout. Lock order: supplier → intake → payout.
 * §10.2 lists receipt voids as owner-only; §9.4 (followed here) allows the author.
 */
@Injectable()
export class VoidIntakeCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly visible: LoadVisibleIntakeQuery,
    private readonly allocations: AllocationsService,
    private readonly payouts: PayoutWriter,
    private readonly audit: AuditService,
    private readonly detail: IntakeDetailQuery,
  ) {}

  async void(actor: AuthenticatedUser, id: string, dto: VoidIntakeDto): Promise<IntakeResponse> {
    return this.dataSource.transaction(async (m) => {
      // Unlocked stub: a missing id 404s before any lock.
      const stub = await m.findOne(Intake, { where: { id } });
      if (!stub) throw new NotFoundException('Intake not found');

      const { saved, shift } = await this.allocations.withinSupplierLedger(m, stub.supplier_id, () =>
        this.voidLocked(m, actor, id, dto),
      );
      // After the ledger's allocate: `open_amount` must see the release.
      return toIntakeResponse(saved, shift, await this.detail.extras(saved.id, m));
    });
  }

  private async voidLocked(
    m: EntityManager,
    actor: AuthenticatedUser,
    id: string,
    dto: VoidIntakeDto,
  ): Promise<{ saved: Intake; shift: Shift }> {
    const { intake, shift } = await this.visible.load(actor, id, m);
    assertCanVoid(
      actor,
      { authorId: intake.received_by_user_id, shift },
      'That shift is closed — ask the network owner to void it',
    );
    if (intake.voided_at) {
      throw new ConflictException({ message: 'That intake is already voided', code: 'ALREADY_VOIDED' });
    }

    // §3.5: a bound payout is written only at reception by the same actor in the same shift, so
    // the check above covers it; `void_returned` alone is owner-only.
    const payout = await this.payouts.findLiveBoundToIntake(m, intake.id);
    assertPayoutDecision(actor, payout !== null, dto.payout);

    // No balance floor: voiding a receipt is the one allowed way into negative debt.
    intake.voided_at = new Date();
    intake.voided_by_user_id = actor.sub;
    intake.void_reason = dto.reason;
    const saved = await m.save(Intake, intake);
    await this.allocations.release(m, { intakeId: saved.id });
    await this.audit.record(
      {
        action: 'intake.voided',
        actor_id: actor.sub,
        target_type: 'intake',
        target_id: saved.id,
        before: { voided_at: null },
        after: {
          voided_at: saved.voided_at,
          code: saved.code,
          amount: saved.amount,
          ...(payout ? { payout_decision: dto.payout } : {}),
        },
        note: dto.reason,
      },
      m,
    );

    if (payout && dto.payout !== 'keep') {
      const voided = await this.payouts.void(m, actor, payout, dto.reason);
      if (dto.payout === 'void_returned') {
        await this.payouts.settleReturn(m, actor, voided, dto.reason);
      }
    }
    return { saved, shift };
  }
}
```

- [ ] **Step 5: Controller and module**

`intakes.controller.ts`: identical handlers **in identical order** (`create`, `preview`, `list`, `findOne`, `void`), the `preview` comment kept but cut to its first paragraph (declared before every `:id` route and why) plus «200 — computed, nothing created». Constructor:
```ts
  constructor(
    private readonly createCommand: CreateIntakeCommand,
    private readonly voidCommand: VoidIntakeCommand,
    private readonly previewQuery: PreviewIntakeQuery,
    private readonly getQuery: GetIntakeQuery,
    private readonly listQuery: ListIntakesQuery,
  ) {}
```
Bodies: `this.createCommand.create(actor, dto)`, `this.previewQuery.preview(actor, dto)`, `this.listQuery.list(actor, query)`, `this.getQuery.get(actor, id)`, `this.voidCommand.void(actor, id, dto)`.

`intakes.module.ts`: same `imports`; `providers: [CreateIntakeCommand, VoidIntakeCommand, PriceIntakeQuery, PreviewIntakeQuery, LoadVisibleIntakeQuery, IntakeDetailQuery, GetIntakeQuery, ListIntakesQuery]`; no `exports`. Header:
```ts
/**
 * The berry receipt. Reads other modules through their services (grade prices and tare for
 * §2.8/§2.5 snapshots, shifts for the point and business date its tables do not store).
 * Writes payouts only through `PayoutWriter` and allocations only through the supplier ledger.
 * Exports nothing — no other module writes or reads receipts through it.
 */
```
Delete `intakes/intakes.service.ts`.

- [ ] **Step 6: DB specs**

- `payouts/payout-ceiling-top-ups.db-spec.ts`: `let intakes: VoidIntakeCommand; … intakes = app.get(VoidIntakeCommand);` (import `'../intakes/commands/void-intake.command'`). If the file also calls `intakes.create(`, add `let createIntake: CreateIntakeCommand` and route those calls to it.
- `grep -rn "IntakesService" backend/src --include='*.ts' | grep -v coverage` — swap every code hit the same way; comments are Task 6.

- [ ] **Step 7: Run tests**

```bash
cd backend && npx jest src/intakes src/payouts
npx jest -c jest.db.config.js src/intakes src/payouts src/supplier-balance src/testing
```
Expected: PASS. Intakes `it` count = Task 0's 62 + 2 new (Review Focus #1).

- [ ] **Step 8: Gate and commit**

Run: `npm run verify:full` — green; quote the verdict line.
```bash
git add -A backend/src
git commit -m "refactor(intakes): create/void commands and preview/get/list queries over a shared pricing query

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `intake-top-ups` — commands and queries

**Files:**
- Create: `backend/src/intake-top-ups/commands/create-intake-top-up.command.ts` (+ spec), `void-intake-top-up.command.ts` (+ spec)
- Create: `backend/src/intake-top-ups/queries/intake-top-up-rows.ts`, `get-intake-top-up.query.ts`, `list-intake-top-ups.query.ts`
- Delete: `intake-top-ups/intake-top-ups.service.ts`, `intake-top-ups/intake-top-ups.service.spec.ts`
- Modify: `intake-top-ups/intake-top-ups.controller.ts`, `intake-top-ups/intake-top-ups.module.ts`, `intake-top-ups/intake-top-ups-list.db-spec.ts`, `payouts/payout-ceiling-top-ups.db-spec.ts`

**Interfaces:**
- Consumes: `withinSupplierLedger`, `release` (Task 2)
- Produces:
  - `CreateIntakeTopUpCommand.create(actor, dto: CreateIntakeTopUpDto): Promise<IntakeTopUpResponse>`
  - `VoidIntakeTopUpCommand.void(actor, id, dto: VoidDocumentDto): Promise<IntakeTopUpResponse>`
  - `topUpRows(repo: Repository<IntakeTopUp>, pointId?: string)` → a query builder; `toTopUpResponse(row: RawTopUpRow): IntakeTopUpResponse`; `export interface RawTopUpRow`
  - `GetIntakeTopUpQuery.get(actor, id)`, `ListIntakeTopUpsQuery.list(actor, query)`
  - Module exports: none

- [ ] **Step 1: Split the top-ups unit spec (tests first)**

From `a980b01:backend/src/intake-top-ups/intake-top-ups.service.spec.ts`:
- `commands/create-intake-top-up.command.spec.ts`: the constants block (`OWNER` … `SUPPLIER`, lines 9–28) and `describe('IntakeTopUpsService.create', …)` renamed `describe('CreateIntakeTopUpCommand', …)`, verbatim, except: `let service: IntakeTopUpsService` → `let command: CreateIntakeTopUpCommand`; the allocations mock gains a delegating ledger:
```ts
    allocations = { lockSupplier: jest.fn(), release: jest.fn(), allocate: jest.fn().mockResolvedValue(0), withinSupplierLedger: jest.fn() };
    allocations.withinSupplierLedger.mockImplementation(async (m: unknown, id: string, work: () => Promise<unknown>) => {
      await allocations.lockSupplier(m, id);
      const result = await work();
      await allocations.allocate(m, id);
      return result;
    });
    command = new CreateIntakeTopUpCommand(dataSource as never, audit as never, allocations as never);
```
(widen the `allocations` `let` type with `withinSupplierLedger: jest.Mock`), and `service.create(` → `command.create(`.
- `commands/void-intake-top-up.command.spec.ts`: the constants it uses and `describe('IntakeTopUpsService.void', …)` → `describe('VoidIntakeTopUpCommand', …)`, same ledger mock, `command = new VoidIntakeTopUpCommand(dataSource as never, audit as never, allocations as never)`, `service.void(` → `command.void(`.

Import paths become `'../../intakes/intake.entity'`, `'../../suppliers/supplier.entity'`, `'../intake-top-up.entity'`, `'../../users/user-role.enum'`, `'../../auth/jwt.strategy'`. Delete the old spec. Run `cd backend && npx jest src/intake-top-ups` → FAIL.

- [ ] **Step 2: Implement the shared rows and the queries**

`backend/src/intake-top-ups/queries/intake-top-up-rows.ts`:
```ts
import { Repository } from 'typeorm';
import { IntakeTopUp } from '../intake-top-up.entity';
import { IntakeTopUpResponse, toIntakeTopUpResponse } from '../intake-top-up.mapper';
import { Intake } from '../../intakes/intake.entity';

/** Aliased columns: a raw query is the only way to bring the parent's `code` and `voided_at` back in one trip. */
export interface RawTopUpRow {
  t_id: string;
  t_intake_id: string;
  t_amount: string;
  t_reason: string;
  t_created_by_user_id: string;
  t_created_at: Date;
  t_updated_at: Date;
  t_voided_at: Date | null;
  t_voided_by_user_id: string | null;
  t_void_reason: string | null;
  i_code: string;
  i_voided_at: Date | null;
}

/** The join every read shares, so the scope rule is written once. The point is two hops away
 *  (top-up → intake → supplier, §3.9) — do not denormalise it onto this table. */
export function topUpRows(repo: Repository<IntakeTopUp>, pointId?: string) {
  const qb = repo
    .createQueryBuilder('t')
    .innerJoin(Intake, 'i', 'i.id = t.intake_id')
    .innerJoin('suppliers', 's', 's.id = i.supplier_id')
    .select([
      't.id AS t_id',
      't.intake_id AS t_intake_id',
      't.amount AS t_amount',
      't.reason AS t_reason',
      't.created_by_user_id AS t_created_by_user_id',
      't.created_at AS t_created_at',
      't.updated_at AS t_updated_at',
      't.voided_at AS t_voided_at',
      't.voided_by_user_id AS t_voided_by_user_id',
      't.void_reason AS t_void_reason',
      'i.code AS i_code',
      'i.voided_at AS i_voided_at',
    ]);
  if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
  return qb;
}

export function toTopUpResponse(row: RawTopUpRow): IntakeTopUpResponse {
  return toIntakeTopUpResponse(
    {
      id: row.t_id,
      intake_id: row.t_intake_id,
      amount: row.t_amount,
      reason: row.t_reason,
      created_by_user_id: row.t_created_by_user_id,
      created_at: row.t_created_at,
      updated_at: row.t_updated_at,
      voided_at: row.t_voided_at,
      voided_by_user_id: row.t_voided_by_user_id,
      void_reason: row.t_void_reason,
    } as IntakeTopUp,
    { id: row.t_intake_id, code: row.i_code, voided_at: row.i_voided_at },
  );
}
```

`backend/src/intake-top-ups/queries/get-intake-top-up.query.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntakeTopUp } from '../intake-top-up.entity';
import { IntakeTopUpResponse } from '../intake-top-up.mapper';
import { RawTopUpRow, toTopUpResponse, topUpRows } from './intake-top-up-rows';
import { resolvePointFilter } from '../../auth/access/point-scope';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** Another point's top-up is a 404, never a 403: a supplier's name and a money amount. */
@Injectable()
export class GetIntakeTopUpQuery {
  constructor(@InjectRepository(IntakeTopUp) private readonly repo: Repository<IntakeTopUp>) {}

  async get(actor: AuthenticatedUser, id: string): Promise<IntakeTopUpResponse> {
    const row = await topUpRows(this.repo, resolvePointFilter(actor))
      .andWhere('t.id = :id', { id })
      .getRawOne<RawTopUpRow>();
    if (!row) throw new NotFoundException('Intake top-up not found');
    return toTopUpResponse(row);
  }
}
```

`backend/src/intake-top-ups/queries/list-intake-top-ups.query.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntakeTopUp } from '../intake-top-up.entity';
import { IntakeTopUpResponse } from '../intake-top-up.mapper';
import { ListIntakeTopUpsQueryDto } from '../dto/list-intake-top-ups.query';
import { RawTopUpRow, toTopUpResponse, topUpRows } from './intake-top-up-rows';
import { resolvePointFilter } from '../../auth/access/point-scope';
import { Paginated } from '../../common/dto/paginated';
import { skipOf } from '../../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

@Injectable()
export class ListIntakeTopUpsQuery {
  constructor(@InjectRepository(IntakeTopUp) private readonly repo: Repository<IntakeTopUp>) {}

  async list(actor: AuthenticatedUser, query: ListIntakeTopUpsQueryDto): Promise<Paginated<IntakeTopUpResponse>> {
    const qb = topUpRows(this.repo, resolvePointFilter(actor, query.collection_point_id));
    if (query.supplier_id) qb.andWhere('i.supplier_id = :supplierId', { supplierId: query.supplier_id });
    if (query.intake_id) qb.andWhere('t.intake_id = :intakeId', { intakeId: query.intake_id });
    if (!query.include_voided) qb.andWhere('t.voided_at IS NULL');

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('t.created_at', 'DESC')
      .addOrderBy('t.id', 'ASC')
      .limit(query.limit)
      .offset(skipOf(query))
      .getRawMany<RawTopUpRow>();

    return { data: rows.map(toTopUpResponse), total, page: query.page, limit: query.limit };
  }
}
```

- [ ] **Step 3: Implement the commands**

`backend/src/intake-top-ups/commands/create-intake-top-up.command.ts`:
```ts
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IntakeTopUp } from '../intake-top-up.entity';
import { CreateIntakeTopUpDto } from '../dto/create-intake-top-up.dto';
import { IntakeTopUpResponse, toIntakeTopUpResponse } from '../intake-top-up.mapper';
import { Intake } from '../../intakes/intake.entity';
import { Supplier } from '../../suppliers/supplier.entity';
import { AuditService } from '../../audit/audit.service';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { gt } from '../../common/money';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * «Фантомний залишок» (#61): the owner adds debt to a receipt. NO SHIFT RULE, and that is the
 * feature — the owner writes one days after the shift closed, with no shift open anywhere.
 */
@Injectable()
export class CreateIntakeTopUpCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly allocations: AllocationsService,
  ) {}

  async create(actor: AuthenticatedUser, dto: CreateIntakeTopUpDto): Promise<IntakeTopUpResponse> {
    // Owner only (#61 is «Як керівник»). `@Auth` says so too; this guards an internal caller.
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner can top up a receipt',
        code: 'OWNER_ONLY',
      });
    }
    // `gt`, not `>`: decimal strings compare lexically ('9.00' > '10.00').
    if (!gt(dto.amount, '0')) {
      throw new BadRequestException({
        message: 'A top-up must add some money to the debt',
        code: 'TOP_UP_AMOUNT_NOT_POSITIVE',
      });
    }

    return this.dataSource.transaction(async (m) => {
      // Unlocked stub, only to find which supplier to lock; 404s before any lock.
      const stub = await m.findOne(Intake, { where: { id: dto.intake_id } });
      if (!stub) throw new NotFoundException('Intake not found');

      return this.allocations.withinSupplierLedger(m, stub.supplier_id, async () => {
        // Re-read under the lock, or a deactivation between the stub read and the lock slips by.
        // A voided parent is legal: the row simply never counts.
        const intake = await m.findOne(Intake, { where: { id: dto.intake_id } });
        if (!intake) throw new NotFoundException('Intake not found');
        const supplier = await m.findOne(Supplier, { where: { id: intake.supplier_id } });
        if (!supplier) throw new NotFoundException('Intake not found');
        if (!supplier.is_active) {
          throw new BadRequestException({
            message: 'That supplier is deactivated',
            code: 'SUPPLIER_INACTIVE',
          });
        }

        const saved = await m.save(IntakeTopUp, {
          intake_id: intake.id,
          amount: dto.amount,
          reason: dto.reason.trim(),
          created_by_user_id: actor.sub,
          voided_at: null,
          voided_by_user_id: null,
          void_reason: null,
        } as IntakeTopUp);

        await this.audit.record(
          {
            action: 'intake-top-up.created',
            actor_id: actor.sub,
            target_type: 'intake-top-up',
            target_id: saved.id,
            after: { amount: saved.amount, intake_id: intake.id, intake_code: intake.code },
            note: saved.reason,
          },
          m,
        );
        return toIntakeTopUpResponse(saved, intake);
      });
    });
  }
}
```
Note: the original allocated for `supplier.id`; the ledger allocates for `stub.supplier_id`. They are the same row (`intakes.supplier_id` has no update path), so the SQL is identical.

`backend/src/intake-top-ups/commands/void-intake-top-up.command.ts`:
```ts
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IntakeTopUp } from '../intake-top-up.entity';
import { IntakeTopUpResponse, toIntakeTopUpResponse } from '../intake-top-up.mapper';
import { Intake } from '../../intakes/intake.entity';
import { VoidDocumentDto } from '../../intakes/dto/void-document.dto';
import { AuditService } from '../../audit/audit.service';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { UserRole } from '../../users/user-role.enum';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/** §9.3: correct by void and reissue. Owner only — an operator never writes one, so §9.4's
 *  «своя квитанція» has no meaning here. Lock order: supplier → top-up. */
@Injectable()
export class VoidIntakeTopUpCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly allocations: AllocationsService,
  ) {}

  async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<IntakeTopUpResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner can void a top-up',
        code: 'OWNER_ONLY',
      });
    }

    return this.dataSource.transaction(async (m) => {
      // Unlocked stub reads (404 before any lock); the 404 names the top-up, the id the caller sent.
      const stub = await m.findOne(IntakeTopUp, { where: { id } });
      if (!stub) throw new NotFoundException('Intake top-up not found');
      const intake = await m.findOne(Intake, { where: { id: stub.intake_id } });
      if (!intake) throw new NotFoundException('Intake top-up not found');

      return this.allocations.withinSupplierLedger(m, intake.supplier_id, async () => {
        // State check under the row lock, so a double tap cannot void (and audit) twice.
        const topUp = await m.findOne(IntakeTopUp, { where: { id }, lock: { mode: 'pessimistic_write' } });
        if (!topUp) throw new NotFoundException('Intake top-up not found');
        if (topUp.voided_at) {
          throw new ConflictException({ message: 'That top-up is already voided', code: 'ALREADY_VOIDED' });
        }

        topUp.voided_at = new Date();
        topUp.voided_by_user_id = actor.sub;
        topUp.void_reason = dto.reason.trim();
        const saved = await m.save(IntakeTopUp, topUp);
        await this.allocations.release(m, { topUpId: saved.id });
        await this.audit.record(
          {
            action: 'intake-top-up.voided',
            actor_id: actor.sub,
            target_type: 'intake-top-up',
            target_id: saved.id,
            before: { voided_at: null },
            after: {
              voided_at: saved.voided_at,
              amount: saved.amount,
              intake_id: intake.id,
              intake_code: intake.code,
            },
            note: saved.void_reason,
          },
          m,
        );
        return toIntakeTopUpResponse(saved, intake);
      });
    });
  }
}
```

- [ ] **Step 4: Controller, module, DB specs**

`intake-top-ups.controller.ts`: same handlers and order; constructor `(createCommand: CreateIntakeTopUpCommand, voidCommand: VoidIntakeTopUpCommand, getQuery: GetIntakeTopUpQuery, listQuery: ListIntakeTopUpsQuery)` (all `private readonly`); bodies `createCommand.create`, `listQuery.list`, `getQuery.get`, `voidCommand.void`.

`intake-top-ups.module.ts`:
```ts
/**
 * Owner-written debt on a receipt (#61). No `ShiftsModule` (no shift rule applies) and no
 * `SuppliersModule` (the supplier is reached by JOIN — a "which rows" question, not "may this
 * actor see this supplier"). Allocations go through the supplier ledger. Exports nothing.
 */
@Module({
  imports: [TypeOrmModule.forFeature([IntakeTopUp]), AuditModule, SupplierBalanceModule],
  providers: [CreateIntakeTopUpCommand, VoidIntakeTopUpCommand, GetIntakeTopUpQuery, ListIntakeTopUpsQuery],
  controllers: [IntakeTopUpsController],
})
export class IntakeTopUpsModule {}
```
Delete `intake-top-ups/intake-top-ups.service.ts`.

- `intake-top-ups/intake-top-ups-list.db-spec.ts`: `let service: ListIntakeTopUpsQuery; … service = new ListIntakeTopUpsQuery(ds.getRepository(IntakeTopUp));` — drop the `AllocationsService` import if now unused. `service.list(` unchanged.
- `payouts/payout-ceiling-top-ups.db-spec.ts`: `let topUps: CreateIntakeTopUpCommand; … topUps = app.get(CreateIntakeTopUpCommand);`.
- `grep -rn "IntakeTopUpsService" backend/src --include='*.ts' | grep -v coverage` — swap any remaining code hit.

- [ ] **Step 5: Run tests**

```bash
cd backend && npx jest src/intake-top-ups src/supplier-balance
npx jest -c jest.db.config.js src/intake-top-ups src/payouts src/supplier-balance src/testing
```
Expected: PASS; top-ups `it` count = Task 0's 18.

- [ ] **Step 6: Gate and commit**

Run: `npm run verify:full` — green; quote the verdict line.
```bash
git add -A backend/src
git commit -m "refactor(intake-top-ups): create/void commands and get/list queries

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Stale names, docs, follow-ups, final review

**Files:**
- Modify (comment text only): every hit of `grep -rnE "PayoutsService|IntakesService|IntakeTopUpsService|SupplierBalanceService|writePayout|voidWithin|settleReturnWithin|findLiveBoundForUpdate|loadForWrite|lockSupplierOf|allocations\.service" backend/src --include='*.ts' | grep -v coverage` — at `a980b01` that includes `crates/crates.service.ts` (2), `crates/crate-balance.service.ts` (1), `transfers/transfers.service.ts` (2), `seed/dev-seed.history.ts` (1), `intakes/dto/void-document.dto.ts` (1), plus comments inside the four modules' remaining files.
- Modify: `backend/CLAUDE.md` — the `intakes/`, `payouts/`, `supplier-balance/` entries of the tree (lines ~129–133) and the «A document is never edited» bullet (~166)
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`

- [ ] **Step 1: Rename stale references in comments**

For each grep hit, replace only the name, e.g. `PayoutsService.writePayout` → `PayoutWriter.write`, `PayoutsService.loadForWrite` → `LoadVisiblePayoutQuery.load`, `PayoutsService.list` → `ListPayoutsQuery.list`, `PayoutsService.void` → `VoidPayoutCommand.void`, `PayoutsService.create` → `CreatePayoutCommand.create`, `IntakesService` → the matching intake command/query, `SupplierBalanceService` → `SupplierDebtQuery` (debt) / `ListSupplierBalancesQuery` / `SupplierSettlementQuery`. Do not reword the surrounding sentence. Re-run the grep: no hits.

- [ ] **Step 2: `backend/CLAUDE.md`**

In the tree entries, replace the service names with the new homes, e.g. for `payouts/`: «`PayoutWriter` (`services/payout-writer.ts`) is the ONE writer — open shift → debt → number → cash → insert, inside the caller's supplier ledger»; for `supplier-balance/`: «`AllocationsService.withinSupplierLedger` (lock → work → allocate) is how every debt write runs; `lockSupplier`/`allocate` stay public only for raw-SQL fixtures and the seed»; for `intakes/`: «writes the payout handed over with the receipt through `PayoutWriter.write`». In the «never edited» bullet: «no update method on any intake or payout command». Add one line under the backend module conventions (wherever the file describes module layout): «Feature modules in the allocations cluster use `commands/`, `queries/`, `services/` (seams) — spec `docs/superpowers/specs/2026-09-27-allocations-cluster-refactor-design.md`.»

- [ ] **Step 3: Follow-ups**

Append to `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` a dated section `## 2026-09-27 — allocations-cluster refactor` with the three items of spec §7, verbatim in substance:
1. `SHIFT_CLOSED` message drift: intakes «That shift is closed — ask the network owner to void it», payouts «That shift is closed — ask the network owner». Client-visible, so left as is.
2. «Supplier exists, is visible, is at this point, is active» duplicated in `PriceIntakeQuery.target` and `CreatePayoutCommand.create`; home is the `suppliers` module.
3. The same §9.4 / supplier-lock / unique-violation copies remain in `transfers`, `crates` (2026-09-15 carve-out) and `cash-counts`; `reweighs`/`day-costs` and `point-cash` are the other candidates for the next passes.

- [ ] **Step 4: Final gate**

Run: `npm run verify:full` — green. Report: the verdict line, every `SKIPPED` row by name, backend unit/DB test counts vs Task 0 (expected delta: +15 unit tests — 11 in Task 1, 2 ledger tests in Task 2, 2 open_amount-order tests in Task 4 — and 0 DB tests; explain any other difference by name), `coverage`'s percentages for the four modules vs Task 0.
Also: `git diff a980b01 --stat -- backend/src/testing/pipeline.db-spec.ts backend/src/testing/documents-pipeline.db-spec.ts backend/src/testing/catalog-pipeline.db-spec.ts` → empty.

- [ ] **Step 5: Commit**

```bash
git add -A backend docs
git commit -m "docs(refactor): new names in comments and backend/CLAUDE.md; refactor follow-ups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Whole-branch review**

Invoke `superpowers:requesting-code-review` against `a980b01..HEAD`, with the spec and this plan as the brief and Review Focus as the checklist.
