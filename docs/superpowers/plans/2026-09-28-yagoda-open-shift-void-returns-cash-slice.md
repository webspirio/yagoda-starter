# A Void in an Open Shift Returns the Cash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A payout voided while its shift is open puts its cash back into that same shift's drawer at once; a receipt voided in an open shift always takes its bound payout with it; the UI makes the voider tick every consequence before it lets them submit.

**Architecture:** One new column `payouts.returned_on_void` marks a return that happened at void time. `PayoutWriter.void` stamps it when told `returnToDrawer`; both void commands derive that from `shift.closed_at`. The cash formula adds such returns back to the payout's own shift and keeps the calendar-date rule for owner-confirmed returns only. Responses gain `shift_closed`; the void dialog branches on it.

**Tech Stack:** NestJS 12 + TypeORM + Postgres (backend), React + react-hook-form + TanStack Query + Vitest (frontend).

**Spec:** `docs/superpowers/specs/2026-09-28-yagoda-open-shift-void-returns-cash-slice.md`

## Global Constraints

- Branch `feat/open-shift-void-returns-cash`, in the main checkout (no worktree).
- Migration name `1788600000019-PayoutReturnedOnVoid`; column `"returned_on_void" boolean NOT NULL DEFAULT false`; constraint `"CHK_payouts_returned_on_void"`: `NOT "returned_on_void" OR "return_settled_at" IS NOT NULL`. No backfill.
- Open shift = `shift.closed_at === null`. Nothing about WHO may void changes (`assertCanVoid` untouched).
- Open-shift receipt void: `payout` in the body → `400 PAYOUT_DECISION_NOT_APPLICABLE`; the live bound payout is always voided with the cash returned; audit `payout_decision: 'void_on_open_shift'`.
- Closed-shift receipt void: `keep | void | void_returned`, exactly as today; the `OWNER_ONLY` branch of `assertPayoutDecision` is removed (closed shifts are owner-only via `assertCanVoid`).
- Lock order stays supplier → document → bound payout; `release` / `allocate` calls unchanged.
- Money SQL is a money module: the gate is `npm run verify:full`; quote its verdict line and name every SKIPPED row.
- Never widen a baseline, lower a floor or add a suppression to turn a check green.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Frontend tests pin English (`test-setup` forces `en`); Vitest does not typecheck — run `npx tsc -b` in `frontend/`.

## Review Focus

1. **A void recorded after local midnight in a shift still open from the previous day** — cash must come back to THAT shift, not to "today". Test in Task 2.
2. **A payout voided in a shift the owner reopened** — same: back into the reopened shift. Test in Task 2.
3. **An open-shift receipt void whose payout also covered an older receipt** — the whole payout voids, the older receipt reopens, allocation invariants hold, drawer +full payout. Test in Task 4.
4. **`settle-return` on a payout already returned on void** — must 409 `RETURN_ALREADY_SETTLED`, never double-credit. Test in Task 3.
5. **An operator opening a receipt of a closed shift** — no «Сторнувати» button, rather than a button that always 403s. Test in Task 6.

---

### Task 1: Column, constraint, entity

**Files:**
- Create: `backend/src/migrations/1788600000019-PayoutReturnedOnVoid.ts`
- Create: `backend/src/migrations/payout-returned-on-void-schema.db-spec.ts`
- Modify: `backend/src/payouts/payout.entity.ts` (header comment, `@Check`, column after `return_note`)
- Modify: `backend/src/testing/unit/payouts.mocks.ts` (`payout()` gains `returned_on_void: false`)

**Interfaces:**
- Produces: `Payout.returned_on_void: boolean`.

- [ ] **Step 1: Write the failing schema test**

```ts
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { openTestDataSource } from '../testing/db-harness';

/** `returned_on_void` defaults to false and cannot claim a return nobody stamped. */
describe('PayoutReturnedOnVoid migration', () => {
  let ds: DataSource;
  let shiftId: string;
  let supplierId: string;
  let userId: string;
  const run = randomUUID().slice(0, 8);

  beforeAll(async () => {
    ds = await openTestDataSource();
    [{ id: userId }] = await ds.query(
      `INSERT INTO users (first_name, last_name, role, is_active)
       VALUES ('Тест', $1, 'network_owner', true) RETURNING id`,
      [`rov-${run}`],
    );
    const [{ id: pointId }] = await ds.query(
      `INSERT INTO collection_points (name, code, kind, is_active)
       VALUES ($1, $2, 'reception', true) RETURNING id`,
      [`rov-${run}`, `R${run.slice(0, 6).toUpperCase()}`],
    );
    [{ id: shiftId }] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status)
       VALUES ($1, $2, '2026-09-02', 'open') RETURNING id`,
      [pointId, userId],
    );
    [{ id: supplierId }] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ніна', $2, true) RETURNING id`,
      [pointId, `rov-${run}`],
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  const insert = (extra: string, values: unknown[]) =>
    ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id${extra ? ', ' + extra : ''})
       VALUES ($1, $2, $3, '100.00', $4${values.map((_, i) => `, $${i + 5}`).join('')}) RETURNING returned_on_void`,
      [`PO-${randomUUID().slice(0, 12)}`, shiftId, supplierId, userId, ...values],
    );

  it('defaults to false', async () => {
    const [row] = await insert('', []);
    expect(row.returned_on_void).toBe(false);
  });

  it('rejects returned_on_void without return_settled_at', async () => {
    await expect(
      insert('voided_at, voided_by_user_id, void_reason, returned_on_void', [
        new Date(), userId, 'r', true,
      ]),
    ).rejects.toThrow(/CHK_payouts_returned_on_void/);
  });

  it('accepts returned_on_void with a stamped return', async () => {
    const at = new Date();
    const [row] = await insert(
      'voided_at, voided_by_user_id, void_reason, return_settled_at, return_settled_by_user_id, returned_on_void',
      [at, userId, 'r', at, userId, true],
    );
    expect(row.returned_on_void).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`column "returned_on_void" does not exist`)

Run: `cd backend && npm run test:db -- src/migrations/payout-returned-on-void-schema.db-spec.ts`

- [ ] **Step 3: Write the migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-09-28 team decision: a payout voided while its shift is open puts the cash back into
 * THAT shift's drawer at once. `return_settled_at` alone would book it by calendar date, which
 * misfiles a void after midnight or in a reopened shift. Spec 2026-09-28 §3 decisions 3–4.
 * No backfill: earlier voids keep their pending or date-attributed return (decision 7).
 */
export class PayoutReturnedOnVoid1788600000019 implements MigrationInterface {
  name = 'PayoutReturnedOnVoid1788600000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payouts" ADD COLUMN "returned_on_void" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      ALTER TABLE "payouts" ADD CONSTRAINT "CHK_payouts_returned_on_void"
        CHECK (NOT "returned_on_void" OR "return_settled_at" IS NOT NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payouts" DROP CONSTRAINT "CHK_payouts_returned_on_void"`);
    await queryRunner.query(`ALTER TABLE "payouts" DROP COLUMN "returned_on_void"`);
  }
}
```

- [ ] **Step 4: Entity**

In `payout.entity.ts` add beside the other `@Check`s:

```ts
@Check('CHK_payouts_returned_on_void', `NOT "returned_on_void" OR "return_settled_at" IS NOT NULL`)
```

and after `return_note`:

```ts
  /** The return happened AT the void, in an open shift (2026-09-28): cash goes back to this
   *  payout's own shift, not to the calendar date of `return_settled_at`. */
  @Column({ type: 'boolean', default: false })
  returned_on_void: boolean;
```

Rewrite the header's «VOIDING A PAYOUT DOES NOT RETURN THE CASH» paragraph to open with:
«IN A CLOSED SHIFT, VOIDING A PAYOUT DOES NOT RETURN THE CASH.» and add one paragraph:
«In an open shift it does (2026-09-28 team decision): the supplier is at the counter, so the
void stamps the return itself and sets `returned_on_void`, and `point-cash` books it to this
payout's own shift.» Update the `return_settled_at` doc comment: «a void alone does NOT do this
— except in an open shift, see `returned_on_void`». Add `returned_on_void: false` to
`payout()` in `testing/unit/payouts.mocks.ts`.

- [ ] **Step 5: Run — expect PASS.** Same command as Step 2; also `cd backend && npm test -- src/payouts`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/migrations/1788600000019-PayoutReturnedOnVoid.ts \
  backend/src/migrations/payout-returned-on-void-schema.db-spec.ts \
  backend/src/payouts/payout.entity.ts backend/src/testing/unit/payouts.mocks.ts
git commit -m "feat(payouts): returned_on_void column — a return made at the void itself"
```

---

### Task 2: Cash formula books an open-shift return to its own shift

**Files:**
- Modify: `backend/src/point-cash/point-cash.service.ts:124-133` (`movementsSql`) and its block comment
- Test: `backend/src/point-cash/point-cash.db-spec.ts` (inside `describe('PointCashService — count-anchored cash (Postgres)')`, after «a return settled on a LATER day…»)

**Interfaces:**
- Consumes: `payouts.returned_on_void` (Task 1).

- [ ] **Step 1: Write the failing scenarios**

```ts
    it('a payout returned ON VOID nets to zero in its own shift', async () => {
      const p = await newPoint();
      const s = await shift(p, '2026-09-02', false);
      const at = new Date('2026-09-02T10:00:00Z');
      await payoutIn(s, '250.00', {
        voided_at: at, voided_by_user_id: ownerId, void_reason: 'помилка',
        return_settled_at: at, return_settled_by_user_id: ownerId, returned_on_void: true,
      });
      await expect(service.movementsForShift(s)).resolves.toBe('0.00');
    });

    it('returned on void after local midnight still lands in the payout’s shift, not the next day’s', async () => {
      const p = await newPoint();
      const paid = await shift(p, '2026-09-02');
      const next = await shift(p, '2026-09-03', false);
      // 00:30 Kyiv on the 3rd — the shift of the 2nd was still open when this was voided.
      const at = new Date('2026-09-02T21:30:00Z');
      await payoutIn(paid, '250.00', {
        voided_at: at, voided_by_user_id: ownerId, void_reason: 'помилка',
        return_settled_at: at, return_settled_by_user_id: ownerId, returned_on_void: true,
      });
      await expect(service.movementsForShift(paid)).resolves.toBe('0.00');
      await expect(service.movementsForShift(next)).resolves.toBe('0.00');
    });

    it('returned on void days later (a reopened shift) still lands in the payout’s shift', async () => {
      const p = await newPoint();
      const paid = await shift(p, '2026-09-02', false);
      const later = await shift(p, '2026-09-06');
      const at = new Date('2026-09-06T09:00:00Z');
      await payoutIn(paid, '250.00', {
        voided_at: at, voided_by_user_id: ownerId, void_reason: 'помилка',
        return_settled_at: at, return_settled_by_user_id: ownerId, returned_on_void: true,
      });
      await expect(service.movementsForShift(paid)).resolves.toBe('0.00');
      await expect(service.movementsForShift(later)).resolves.toBe('0.00');
    });
```

The existing «a return settled on a LATER day belongs to that day's shift» scenario stays as-is: it pins that an owner-confirmed return (`returned_on_void` false) still goes by date.

- [ ] **Step 2: Run — expect FAIL** (the midnight case reads `-250.00` / `250.00`)

Run: `cd backend && npm run test:db -- src/point-cash/point-cash.db-spec.ts`

- [ ] **Step 3: Change `movementsSql`**

Replace the two payout terms with:

```ts
  - COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}), 0.00)
  + COALESCE((SELECT SUM(p.amount) FROM payouts p
        WHERE p.shift_id = ${shift}
          AND p.returned_on_void), 0.00)
  + COALESCE((SELECT SUM(p.amount)
         FROM payouts p
         JOIN shifts ps ON ps.id = p.shift_id
         JOIN shifts s  ON s.id = ${shift}
        WHERE p.return_settled_at IS NOT NULL
          AND NOT p.returned_on_void
          AND ps.collection_point_id = s.collection_point_id
          AND (p.return_settled_at AT TIME ZONE ${tz}::text)::date = s.business_date), 0.00)
```

Add to the block comment above `movementsSql`, after the «payout paid on Tuesday and returned on Friday» paragraph:

```
 * A RETURN MADE AT THE VOID IS THE EXCEPTION (2026-09-28). A payout voided while
 * its shift is open never left that drawer in any sense a count could see — the
 * supplier handed it back at the counter — so `returned_on_void` books it to the
 * payout's OWN shift. By date it would misfile twice: a void at 00:30 in a shift
 * not yet closed, and a void in a shift the owner reopened days later.
```

- [ ] **Step 4: Run — expect PASS**, whole file (scenarios 1–13 unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/src/point-cash/point-cash.service.ts backend/src/point-cash/point-cash.db-spec.ts
git commit -m "feat(point-cash): a return made at the void goes back to the payout's own shift"
```

---

### Task 3: `PayoutWriter.void` returns the cash; `POST /payouts/:id/void` asks the shift

**Files:**
- Modify: `backend/src/payouts/services/payout-writer.ts` (`void`)
- Modify: `backend/src/payouts/commands/void-payout.command.ts`
- Modify: `backend/src/intakes/commands/void-intake.command.ts` — only the existing `this.payouts.void(...)` call gains `, false` so it compiles; Task 4 rewrites it
- Test: `backend/src/payouts/services/payout-writer.spec.ts`, `backend/src/payouts/commands/void-payout.command.spec.ts`, `backend/src/payouts/commands/settle-return.command.spec.ts`

**Interfaces:**
- Produces: `PayoutWriter.void(m: EntityManager, actor: AuthenticatedUser, payout: Payout, reason: string, returnToDrawer: boolean): Promise<Payout>`.

- [ ] **Step 1: Failing writer tests** (in `describe('helpers used by the intake void')`)

```ts
    it('void with returnToDrawer stamps the return at the void’s own instant', async () => {
      const row = payout();

      await writer.void(manager as never, oksana, row as never, 'повернув', true);

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved.returned_on_void).toBe(true);
      expect(saved.return_settled_at).toBe(saved.voided_at);
      expect(saved.return_settled_by_user_id).toBe(oksana.sub);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout.voided',
          after: expect.objectContaining({ returned_on_void: true }),
        }),
        manager,
      );
    });

    it('void without returnToDrawer leaves the return pending', async () => {
      const row = payout();

      await writer.void(manager as never, owner, row as never, 'r', false);

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved.returned_on_void).toBe(false);
      expect(saved.return_settled_at).toBeNull();
    });
```

Update the two existing `writer.void(...)` calls in this file to pass `false`.

- [ ] **Step 2: Failing command tests** (`void-payout.command.spec.ts`)

Replace «does NOT touch return_settled_at» with:

```ts
    it('in an open shift, returns the cash at the void', async () => {
      await command.void(oksana, PAYOUT_ID, { reason: 'повернув' });

      expect(saved().returned_on_void).toBe(true);
      expect(saved().return_settled_at).toBeInstanceOf(Date);
    });

    it('in a closed shift (owner), leaves the return pending — §9.3', async () => {
      shifts.findOneRaw.mockResolvedValue(
        shift({ closed_at: new Date(), status: ShiftStatus.Closed }),
      );

      await command.void(owner, PAYOUT_ID, { reason: 'пізно' });

      expect(saved().returned_on_void).toBe(false);
      expect(saved().return_settled_at).toBeNull();
    });
```

(import `ShiftStatus` from `'../../shifts/shift-status.enum'`). In `settle-return.command.spec.ts` add:

```ts
  it('409s a payout already returned on void', async () => {
    manager.findOne.mockResolvedValue(
      payout({
        voided_at: new Date(), voided_by_user_id: 'u-oksana', void_reason: 'r',
        return_settled_at: new Date(), return_settled_by_user_id: 'u-oksana', returned_on_void: true,
      }),
    );
    await expect(command.settle(owner, PAYOUT_ID, {})).rejects.toMatchObject({
      response: { code: 'RETURN_ALREADY_SETTLED' },
    });
  });
```

(match that file's existing mock/stub names for `manager`, `command`, `payout`, `owner`; if its load goes through a different mock, stock that one.)

- [ ] **Step 3: Run — expect FAIL**

Run: `cd backend && npm test -- src/payouts`

- [ ] **Step 4: Implement**

`payout-writer.ts`:

```ts
  /** Voids a payout the caller loaded, locked and authorised, and releases its allocations.
   *  `returnToDrawer` (open shift, 2026-09-28): the cash is back at this instant, booked to the
   *  payout's own shift. Otherwise the return waits for `settleReturn` (§9.3). */
  async void(
    m: EntityManager,
    actor: AuthenticatedUser,
    payout: Payout,
    reason: string,
    returnToDrawer: boolean,
  ): Promise<Payout> {
    const now = new Date();
    payout.voided_at = now;
    payout.voided_by_user_id = actor.sub;
    payout.void_reason = reason;
    if (returnToDrawer) {
      payout.return_settled_at = now;
      payout.return_settled_by_user_id = actor.sub;
      payout.returned_on_void = true;
    }
    const saved = await m.save(Payout, payout);
    await this.allocations.release(m, { payoutId: saved.id });
    await this.audit.record(
      {
        action: 'payout.voided',
        actor_id: actor.sub,
        target_type: 'payout',
        target_id: saved.id,
        after: { code: saved.code, amount: saved.amount, returned_on_void: returnToDrawer },
        note: reason,
      },
      m,
    );
    return saved;
  }
```

`void-payout.command.ts`: `this.writer.void(m, actor, payout, dto.reason, shift.closed_at === null)`, and the class doc becomes «§9.4 void. An open shift returns the cash at once (2026-09-28). Load and state check under the row lock, or a double tap audits twice.»

`void-intake.command.ts`: add `, false` to the existing `this.payouts.void(m, actor, payout, dto.reason)` call (Task 4 replaces this line). Update the matching expectation in `void-intake.command.spec.ts` («void: voids the payout with the same reason, no return», and the `void_returned` test) to include `false`.

- [ ] **Step 5: Run — expect PASS**: `cd backend && npm test -- src/payouts src/intakes`

- [ ] **Step 6: Commit**

```bash
git add backend/src/payouts backend/src/intakes/commands
git commit -m "feat(payouts): a payout voided in an open shift returns its cash at once"
```

---

### Task 4: Receipt void in an open shift always takes its payout

**Files:**
- Modify: `backend/src/intakes/payout-decision.ts`, `backend/src/intakes/payout-decision.spec.ts`
- Modify: `backend/src/intakes/commands/void-intake.command.ts`, `backend/src/intakes/commands/void-intake.command.spec.ts`
- Modify: `backend/src/intakes/dto/void-intake.dto.ts` (doc comment only)
- Modify: `backend/src/intakes/intake-void-payout-decision.db-spec.ts`

**Interfaces:**
- Consumes: `PayoutWriter.void(..., returnToDrawer)` (Task 3).
- Produces: `assertPayoutDecision(shiftClosed: boolean, hasLivePayout: boolean, decision: PayoutDecision | undefined): void`.

- [ ] **Step 1: Failing unit tests — replace `payout-decision.spec.ts` body**

```ts
import { BadRequestException } from '@nestjs/common';
import { assertPayoutDecision } from './payout-decision';

const code = (c: string) => expect.objectContaining({ response: expect.objectContaining({ code: c }) });

describe('assertPayoutDecision', () => {
  describe('open shift — the payout always goes with the receipt', () => {
    it('takes no decision, bound payout or not', () => {
      expect(() => assertPayoutDecision(false, true, undefined)).not.toThrow();
      expect(() => assertPayoutDecision(false, false, undefined)).not.toThrow();
    });

    it.each(['keep', 'void', 'void_returned'] as const)('rejects %s', (d) => {
      expect(() => assertPayoutDecision(false, true, d)).toThrow(BadRequestException);
      expect(() => assertPayoutDecision(false, true, d)).toThrow(code('PAYOUT_DECISION_NOT_APPLICABLE'));
    });
  });

  describe('closed shift — #125 as before', () => {
    it('requires a decision when a live payout is bound', () => {
      expect(() => assertPayoutDecision(true, true, undefined)).toThrow(code('PAYOUT_DECISION_REQUIRED'));
    });

    it('rejects a decision when nothing is bound', () => {
      expect(() => assertPayoutDecision(true, false, 'keep')).toThrow(code('PAYOUT_DECISION_NOT_APPLICABLE'));
    });

    it.each(['keep', 'void', 'void_returned'] as const)('accepts %s', (d) => {
      expect(() => assertPayoutDecision(true, true, d)).not.toThrow();
    });
  });
});
```

- [ ] **Step 2: Failing command tests** — in `void-intake.command.spec.ts`, replace `describe('with a live bound payout (#125)')` with two blocks:

```ts
    describe('with a live bound payout, open shift', () => {
      const bound = { id: 'po-1', code: 'KPG-PO-20260908-001', amount: '1500.00', voided_at: null };
      beforeEach(() => payouts.findLiveBoundToIntake.mockResolvedValue(bound));

      it('locks the payout after the intake, in the same transaction', async () => {
        await command.void(oksana, INTAKE_ID, { reason: 'r' });

        expect(payouts.findLiveBoundToIntake).toHaveBeenCalledWith(manager, INTAKE_ID);
        const locked = manager.findOne.mock.calls.findIndex(([, opts]) => opts?.lock);
        expect(manager.findOne.mock.invocationCallOrder[locked]).toBeLessThan(
          payouts.findLiveBoundToIntake.mock.invocationCallOrder[0],
        );
      });

      it('always voids the payout with the cash returned, and says so in the audit', async () => {
        await command.void(oksana, INTAKE_ID, { reason: 'помилка' });

        expect(payouts.void).toHaveBeenCalledWith(manager, oksana, bound, 'помилка', true);
        expect(payouts.settleReturn).not.toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'intake.voided',
            after: expect.objectContaining({ payout_decision: 'void_on_open_shift' }),
          }),
          manager,
        );
      });

      it('400s any decision and writes nothing', async () => {
        await expect(
          command.void(oksana, INTAKE_ID, { reason: 'r', payout: 'keep' }),
        ).rejects.toMatchObject({ response: { code: 'PAYOUT_DECISION_NOT_APPLICABLE' } });
        expect(manager.save).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      });
    });

    describe('with a live bound payout, closed shift (owner)', () => {
      const bound = { id: 'po-1', code: 'KPG-PO-20260908-001', amount: '1500.00', voided_at: null };
      beforeEach(() => {
        payouts.findLiveBoundToIntake.mockResolvedValue(bound);
        shifts.findOneRaw.mockResolvedValue(
          shift({ closed_at: new Date(), status: ShiftStatus.Closed }),
        );
      });

      it('400s without a decision', async () => {
        await expect(command.void(owner, INTAKE_ID, { reason: 'r' })).rejects.toMatchObject({
          response: { code: 'PAYOUT_DECISION_REQUIRED' },
        });
        expect(manager.save).not.toHaveBeenCalled();
      });

      it('keep: voids only the intake and records the decision', async () => {
        await command.void(owner, INTAKE_ID, { reason: 'r', payout: 'keep' });

        expect(payouts.void).not.toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({ after: expect.objectContaining({ payout_decision: 'keep' }) }),
          manager,
        );
      });

      it('void: voids the payout, return pending', async () => {
        await command.void(owner, INTAKE_ID, { reason: 'помилка', payout: 'void' });

        expect(payouts.void).toHaveBeenCalledWith(manager, owner, bound, 'помилка', false);
        expect(payouts.settleReturn).not.toHaveBeenCalled();
      });

      it('void_returned: voids, then settles the return with the reason as note', async () => {
        await command.void(owner, INTAKE_ID, { reason: 'повернув', payout: 'void_returned' });

        expect(payouts.void).toHaveBeenCalledWith(manager, owner, bound, 'повернув', false);
        expect(payouts.settleReturn).toHaveBeenCalledWith(
          manager, owner, expect.objectContaining({ id: 'po-1' }), 'повернув',
        );
      });
    });
```

Also update, outside those blocks: «400s a decision when no live payout is bound» stays (open shift, `payout: 'void'`, no bound payout → `PAYOUT_DECISION_NOT_APPLICABLE`); «with payout decision void, allocates once, after both voids» drops `payout: 'void'` from the body (open shift). Remove the old «403s an operator choosing void_returned» test.

- [ ] **Step 3: Run — expect FAIL**: `cd backend && npm test -- src/intakes`

- [ ] **Step 4: Implement**

`payout-decision.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import type { PayoutDecision } from './dto/void-intake.dto';

/**
 * #125 + 2026-09-28. Open shift: the supplier is at the counter, so a live bound payout always
 * goes with the receipt and there is nothing to decide. Closed shift (owner only, via
 * `assertCanVoid`): the decision is required iff a live payout is bound.
 */
export function assertPayoutDecision(
  shiftClosed: boolean,
  hasLivePayout: boolean,
  decision: PayoutDecision | undefined,
): void {
  if (decision && (!shiftClosed || !hasLivePayout)) {
    throw new BadRequestException({
      message: shiftClosed
        ? 'This receipt has no live payout to decide about'
        : 'In an open shift the payout is voided with the receipt — there is nothing to decide',
      code: 'PAYOUT_DECISION_NOT_APPLICABLE',
    });
  }
  if (shiftClosed && hasLivePayout && !decision) {
    throw new BadRequestException({
      message: 'This receipt has a live payout — say whether to keep or void it',
      code: 'PAYOUT_DECISION_REQUIRED',
    });
  }
}
```

`void-intake.command.ts` `voidLocked`, from the payout lookup on:

```ts
    // §3.5: a bound payout shares the receipt's author and shift, so the check above covers it.
    const payout = await this.payouts.findLiveBoundToIntake(m, intake.id);
    const shiftClosed = shift.closed_at !== null;
    assertPayoutDecision(shiftClosed, payout !== null, dto.payout);
    const decision = shiftClosed ? dto.payout : 'void_on_open_shift';
```

audit `after`: `...(payout ? { payout_decision: decision } : {})`. Then:

```ts
    if (payout && decision !== 'keep') {
      const voided = await this.payouts.void(m, actor, payout, dto.reason, !shiftClosed);
      if (decision === 'void_returned') {
        await this.payouts.settleReturn(m, actor, voided, dto.reason);
      }
    }
```

Class doc: add «Open shift (2026-09-28): the bound payout always goes too, cash back at once.» `void-intake.dto.ts` doc: «Closed shift only: required iff a live payout is bound. An open shift takes none (2026-09-28).»

- [ ] **Step 5: Update the Postgres spec** (`intake-void-payout-decision.db-spec.ts`)

The fixture's `todayShiftId` is open, so the old open-shift cases change. Add a closed shift for the #125 cases: in `beforeAll`, after `todayShiftId`, insert `closedShiftId` for `'2026-07-02'`, closed (same SQL as `old`). Give `scenario` a `shiftId = todayShiftId` parameter used for `rId` and the payout. Then:
- «400s without a decision…» → `scenario(closedShiftId)`, `ownerToken`.
- delete «403s an operator choosing void_returned».
- «keep», «void», «void_returned» → `scenario(closedShiftId)`, `ownerToken`, and `cash` reads `movementsForShift(closedShiftId)`; the «void» case's drawer delta stays `'0.00'`, «void_returned» stays by date (so assert only `p.return_settled_at` not null and `p.returned_on_void === false`; drop its cash delta — it lands in today's shift, not the closed one).
- «is atomic» and «two concurrent voids» → open shift, operator, body `{ reason }` only.
- Add:

```ts
  it('open shift: the payout goes too, the cash is back in this shift, the old receipt reopens', async () => {
    const s = await scenario();
    const before = await cash();
    await voidIntake(operatorToken, s.rId, { reason: 'клієнт повернув' }).expect(201);

    const p = await row('payouts', s.pId);
    expect(p.voided_at).not.toBeNull();
    expect(p.returned_on_void).toBe(true);
    expect(sub(await cash(), before)).toBe('1500.00');
    await expect(debt(s.supplierId)).resolves.toBe('1000.00');
    const settlement = await app.get(SupplierSettlementQuery).settlementFor(s.supplierId);
    expect(settlement.lines.map((l) => [l.id, l.open])).toEqual([[s.oldId, '1000.00']]);
    await assertAllocationInvariants(ds, s.supplierId);
  });

  it('open shift: any payout decision is a 400 and nothing is written', async () => {
    const s = await scenario();
    const res = await voidIntake(operatorToken, s.rId, { reason: 'r', payout: 'keep' }).expect(400);
    expect(res.body.code).toBe('PAYOUT_DECISION_NOT_APPLICABLE');
    expect((await row('intakes', s.rId)).voided_at).toBeNull();
  });
```

`assertAllocationInvariants`: import from `../testing/allocation-invariants` — check its exported name and signature first and use it as the other db-specs do.

- [ ] **Step 6: Run — expect PASS**

Run: `cd backend && npm test -- src/intakes && npm run test:db -- src/intakes/intake-void-payout-decision.db-spec.ts`

- [ ] **Step 7: Commit**

```bash
git add backend/src/intakes
git commit -m "feat(intakes): a receipt voided in an open shift takes its payout and returns the cash"
```

---

### Task 5: Responses say whether the shift is closed

**Files:**
- Modify: `backend/src/intakes/intake.mapper.ts` (`IntakeResponse.shift_closed`, `IntakePayoutResponse.created_at`)
- Modify: `backend/src/payouts/payout.mapper.ts` (`PayoutResponse.shift_closed`)
- Test: the mapper specs if present (`grep -l toIntakeResponse backend/src/**/*.spec.ts`), else add `backend/src/intakes/intake.mapper.spec.ts` and `backend/src/payouts/payout.mapper.spec.ts`

**Interfaces:**
- Produces: `IntakeResponse.shift_closed: boolean`, `PayoutResponse.shift_closed: boolean`, `IntakePayoutResponse.created_at: string` (ISO).

- [ ] **Step 1: Failing test**

```ts
import { toPayoutResponse } from './payout.mapper';
import { payout, shift } from '../testing/unit/payouts.mocks';

describe('toPayoutResponse', () => {
  it('says whether the shift is closed', () => {
    expect(toPayoutResponse(payout() as never, shift() as never).shift_closed).toBe(false);
    expect(
      toPayoutResponse(payout() as never, shift({ closed_at: new Date() }) as never).shift_closed,
    ).toBe(true);
  });
});
```

and for intakes:

```ts
import { toIntakeResponse, toIntakeDetailResponse } from './intake.mapper';
import { intake, shift } from '../testing/unit/intakes.mocks';

const extras = { net_kg: '0.000', lines_count: 0, supplier_name: 'x', paid_amount: '0.00', open_amount: '0.00' };

describe('intake mapper', () => {
  it('says whether the shift is closed', () => {
    expect(toIntakeResponse(intake() as never, shift() as never, extras).shift_closed).toBe(false);
    expect(
      toIntakeResponse(intake() as never, shift({ closed_at: new Date() }) as never, extras).shift_closed,
    ).toBe(true);
  });

  it('gives each bound payout its created_at', () => {
    const at = new Date('2026-09-08T11:32:00.000Z');
    const res = toIntakeDetailResponse(intake() as never, shift() as never, [], extras,
      [{ id: 'p', code: 'PO', amount: '1.00', voided_at: null, created_at: at }] as never, null);
    expect(res.payouts[0].created_at).toBe('2026-09-08T11:32:00.000Z');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**: `cd backend && npm test -- mapper`

- [ ] **Step 3: Implement** — `shift_closed: shift.closed_at !== null` in both mappers (field after `business_date`, doc «2026-09-28: the void dialog branches on it»); `created_at: payout.created_at.toISOString()` in `toIntakePayoutResponse`.

- [ ] **Step 4: Run — expect PASS**, then the whole backend unit suite: `cd backend && npm test`. HTTP pipeline specs asserting whole response objects may need the new field — add it there, never loosen a matcher.

- [ ] **Step 5: Commit**

```bash
git add backend/src
git commit -m "feat(api): shift_closed on intakes and payouts, created_at on a receipt's payouts"
```

---

### Task 6: Void dialog — consequences, payout card, shift-aware choices

**Files:**
- Modify: `frontend/src/entities/intake/model/intake.ts` (`Intake.shift_closed`, `IntakePayout.created_at`)
- Modify: `frontend/src/entities/payout/model/payout.ts` (`Payout.shift_closed`)
- Modify: `frontend/src/features/void-document/model/otherCovered.ts` (+ `reopenedCodes`), `otherCovered.test.ts`
- Modify: `frontend/src/features/void-document/index.ts` (export `reopenedCodes`)
- Modify: `frontend/src/features/void-document/ui/PayoutDecisionField.tsx` (drop `canConfirmReturn`: always three choices — it now renders only for a closed shift)
- Create: `frontend/src/features/void-document/ui/VoidConsequences.tsx`
- Modify: `frontend/src/features/void-document/ui/VoidDocumentDialog.tsx`, `VoidDocumentDialog.test.tsx`
- Modify: `frontend/src/features/void-document/api/useVoidDocument.ts` (payout invalidates `pointCash`)
- Modify: `frontend/src/widgets/receipt/ui/ReceiptDialog.tsx`, `ReceiptDialog.test.tsx`
- Modify: `frontend/src/pages/supplier-card/ui/SupplierCardPage.tsx`
- Modify: `frontend/src/shared/lib/i18n/locales/{uk,en}.json`
- Update every test fixture of `Intake` / `Payout` / `IntakeDetail` that `tsc -b` flags (add `shift_closed: false`, `created_at`).

**Interfaces:**
- Consumes: `shift_closed`, `IntakePayout.created_at` (Task 5).
- Produces:
  - `reopenedCodes(settlement: SupplierSettlement, payoutId: string, exceptIntakeId: string | null): string[]` — distinct `code`s of lines the payout covers, oldest first, excluding lines whose `intake_id === exceptIntakeId`.
  - `VoidDocumentDialog` props: replace `canConfirmReturn` with `shiftClosed?: boolean` (default `false`) and add `payoutAmount?: string` and `reopens?: string[] | null` (for `kind: 'payout'`); `LinkedPayout` gains `paidAt: string`, `paidBy: string | null`, `reopens: string[] | null`; `intakeAmount?: string` for the no-payout intake checkbox.

- [ ] **Step 1: `reopenedCodes` — failing test** (append to `otherCovered.test.ts`, reusing its `settlement` fixture)

```ts
describe('reopenedCodes', () => {
  it('lists the codes the payout covers outside the receipt, oldest first, once each', () => {
    expect(reopenedCodes(settlement, 'p', 'r')).toEqual(
      settlement.lines.filter((l) => l.intake_id !== 'r').map((l) => l.code),
    );
  });

  it('with no receipt excluded, lists everything the payout covers', () => {
    expect(reopenedCodes(settlement, 'p', null).length).toBeGreaterThan(
      reopenedCodes(settlement, 'p', 'r').length,
    );
  });

  it('is empty when the payout is not in the settlement', () => {
    expect(reopenedCodes({ ...settlement, payouts: [] }, 'p', null)).toEqual([]);
  });
});
```

Check the first expectation against the fixture's real covers before relying on it; if the fixture's payout does not cover every non-`r` line, write the literal expected array instead.

Implementation:

```ts
/** Receipt codes that reopen if this payout is voided — top-ups carry their parent's code. */
export function reopenedCodes(
  settlement: SupplierSettlement,
  payoutId: string,
  exceptIntakeId: string | null,
): string[] {
  const payout = settlement.payouts.find((p) => p.id === payoutId);
  if (!payout) return [];
  const covered = new Set(payout.covers.map((c) => c.line_id));
  const codes = settlement.lines
    .filter((l) => covered.has(l.id) && l.intake_id !== exceptIntakeId)
    .map((l) => l.code);
  return [...new Set(codes)];
}
```

- [ ] **Step 2: i18n keys** — under `void` in both locales:

`uk.json`:
```json
"consequences": {
  "legend": "Підтвердьте, що розумієте наслідки",
  "cashBack": "Клієнт повернув або не отримав {{amount}} — гроші в касі",
  "payoutVoided": "Виплату {{code}} буде скасовано",
  "reopens": "Квитанції {{codes}} знову стануть відкритими",
  "debtDrops": "Квитанцію буде скасовано, борг зменшиться на {{amount}}",
  "payoutCashBack": "Клієнт повернув {{amount}} — гроші в касі",
  "required": "Позначте всі пункти"
},
"payoutCard": {
  "title": "Буде скасовано виплату",
  "paid": "Видано {{when}} · {{who}}"
}
```

`en.json`:
```json
"consequences": {
  "legend": "Confirm you understand what happens",
  "cashBack": "The client returned or never took {{amount}} — the money is in the drawer",
  "payoutVoided": "Payout {{code}} will be voided",
  "reopens": "Receipts {{codes}} will reopen",
  "debtDrops": "The receipt will be voided and the debt drops by {{amount}}",
  "payoutCashBack": "The client returned {{amount}} — the money is in the drawer",
  "required": "Tick every item"
},
"payoutCard": {
  "title": "This payout will be voided",
  "paid": "Paid {{when}} · {{who}}"
}
```

Rewrite `void.payout.void` in both locales to stay closed-shift wording (unchanged text is fine — it only renders for a closed shift now).

- [ ] **Step 3: Failing dialog tests** — append to `VoidDocumentDialog.test.tsx`:

```tsx
function renderOpenShiftIntake(linkedPayout?: Partial<LinkedPayout> | null) {
  render(
    <>
      <VoidDocumentDialog
        kind="intake" id="i1" code="ПР-0012" open onClose={vi.fn()}
        intakeAmount="500.00"
        linkedPayout={linkedPayout === null ? undefined : {
          code: 'PO-7', amount: '1500.00', otherCovered: '1000.00',
          paidAt: '2026-09-28T11:32:00.000Z', paidBy: 'Оксана Т.', reopens: ['ПР-0009'],
          ...linkedPayout,
        }}
      />
      <Toaster />
    </>,
  );
}

describe('VoidDocumentDialog — open shift', () => {
  it('shows the payout card and three consequences, and no decision radios', () => {
    renderOpenShiftIntake();
    expect(screen.getByText('This payout will be voided')).toBeInTheDocument();
    expect(screen.getByText('PO-7', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Оксана Т.', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('omits the reopen line when the payout covered only this receipt', () => {
    renderOpenShiftIntake({ reopens: [] });
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('refuses to submit until every box is ticked, then sends no payout field', async () => {
    renderOpenShiftIntake();
    await userEvent.type(screen.getByLabelText(/Reason/), 'клієнт повернув');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    expect(await screen.findByText('Tick every item')).toBeInTheDocument();
    expect(voidDocumentMock).not.toHaveBeenCalled();

    for (const box of screen.getAllByRole('checkbox')) await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() =>
      expect(voidDocumentMock).toHaveBeenCalledWith({ kind: 'intake', id: 'i1', reason: 'клієнт повернув' }),
    );
  });

  it('with no bound payout, asks for the one debt checkbox', () => {
    renderOpenShiftIntake(null);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText(/debt drops by/)).toBeInTheDocument();
  });

  it('a payout void asks for cash-back and reopen', () => {
    render(
      <VoidDocumentDialog kind="payout" id="p1" code="PO-7" open onClose={vi.fn()}
        payoutAmount="1500.00" reopens={['ПР-0009', 'ПР-0012']} />,
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });
});
```

Rewrite the existing `describe('VoidDocumentDialog with a bound payout (#125)')`: `renderWithPayout` passes `shiftClosed` instead of `canConfirmReturn`, and the two choice-count tests become one — «a closed shift offers the three #125 choices». The plain-document tests (`renderDialog`) keep `kind="intake"` with no payout — pass `shiftClosed` so they stay on the pre-slice path, or add the one debt checkbox tick to the ones that submit; pick the former so they keep testing what they were written for.

- [ ] **Step 4: Run — expect FAIL**: `cd frontend && npx vitest run src/features/void-document`

- [ ] **Step 5: Implement `VoidConsequences.tsx`**

```tsx
import { useId, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

/** 2026-09-28: every consequence of an open-shift void, each one ticked before «Сторнувати». */
export function VoidConsequences({
  items,
  value,
  onChange,
  error,
  firstBoxRef,
}: {
  items: string[];
  value: boolean[];
  onChange: (value: boolean[]) => void;
  error?: string;
  firstBoxRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  return (
    <fieldset className="flex flex-col gap-2" aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}>
      <legend className="mb-2 text-sm font-medium">{t('void.consequences.legend')}</legend>
      {items.map((text, i) => (
        <label key={text} className="flex items-start gap-2 text-sm">
          <input
            ref={i === 0 ? firstBoxRef : undefined}
            type="checkbox"
            className="mt-0.5 size-4 accent-destructive"
            checked={value[i] ?? false}
            onChange={(e) => onChange(items.map((_, j) => (j === i ? e.target.checked : (value[j] ?? false))))}
          />
          {text}
        </label>
      ))}
      {error ? <p id={errorId} className="text-sm text-destructive">{t(error)}</p> : null}
    </fieldset>
  );
}
```

Native checkbox, same reason the radios are native (bundle ceiling — see `PayoutDecisionField`'s comment); check `shared/ui` for an existing native `Checkbox` first and use it if there is one.

- [ ] **Step 6: Implement `VoidDocumentDialog` changes**

- Props as in **Interfaces**. `const openShift = !shiftClosed;`
- `showDecision = kind === 'intake' && linkedPayout !== undefined && shiftClosed` → renders today's `PayoutDecisionField` (no `canConfirmReturn`).
- `consequences: string[] | null` (built with `t` and `formatUah`), only when `openShift`:
  - `kind === 'intake'` with `linkedPayout`: `cashBack(amount)`, `payoutVoided(code)`, and `reopens(codes.join(', '))` when `linkedPayout.reopens?.length`;
  - `kind === 'intake'` without: `[debtDrops(intakeAmount)]` when `intakeAmount` is given;
  - `kind === 'payout'`: `payoutCashBack(payoutAmount)` and `reopens` when `reopens?.length`;
  - otherwise `null` (transfers, top-ups, crates unchanged).
- Form value `acks: boolean[]` (default `[]`); a `Controller` with `rules={{ validate: (v) => (consequences ?? []).every((_, i) => v?.[i]) || 'void.consequences.required' }}` renders `VoidConsequences` when `consequences`.
- Above it, for an open-shift intake with `linkedPayout`, the card:

```tsx
<div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
  <p className="font-medium">{t('void.payoutCard.title')}</p>
  <p>{linkedPayout.code} · {formatUah(linkedPayout.amount, locale)}</p>
  <p className="text-muted-foreground">
    {t('void.payoutCard.paid', {
      when: formatTime(linkedPayout.paidAt, locale),
      who: linkedPayout.paidBy ?? '—',
    })}
  </p>
</div>
```

- Submit sends `payout` only when `showDecision`.
- `useVoidDocument.ts`: `payout.invalidates: [...DOCUMENT_KEYS, queryKeys.pointCash]`; rewrite the comment: «+ pointCash: an open-shift void puts the payout back in the drawer (2026-09-28).» Also fix the intake comment the same way.

- [ ] **Step 7: Run — expect PASS**: `cd frontend && npx vitest run src/features/void-document`

- [ ] **Step 8: `ReceiptDialog` — failing test** (`ReceiptDialog.test.tsx`, following the file's own fixtures/mocks)

```tsx
  it('hides Void from the author operator once the shift is closed', () => {
    setUp({ me: OPERATOR_AUTHOR, intake: buildIntake({ shift_closed: true }) });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
  });

  it('still shows Void to the owner on a closed shift', () => {
    setUp({ me: OWNER, intake: buildIntake({ shift_closed: true }) });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Void' })).toBeInTheDocument();
  });

  it('passes shiftClosed through to the void dialog', () => {
    setUp({ me: OWNER, intake: buildIntake({ shift_closed: true }) });
    render(<ReceiptDialog intakeId="intake-1" open onClose={vi.fn()} />);

    expect(voidDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ shiftClosed: true }),
    );
  });
```

Delete the two `sets canConfirmReturn … for an owner/operator` tests (the prop is gone). `buildIntake` gains `shift_closed: false` in its defaults, and each payout in the file's fixtures gains `created_at`. The `@/features/void-document` mock gains `reopenedCodes: () => []`.

- [ ] **Step 9: Implement `ReceiptDialog`**

```tsx
    const showVoid =
      !voided &&
      (me.role === 'network_owner' || (me.id === intake.received_by_user_id && !intake.shift_closed));
```

`VoidDocumentDialog` props: `shiftClosed={intake.shift_closed}`, `intakeAmount={intake.amount}`, and `linkedPayout` gains `paidAt: livePayout.created_at`, `paidBy: intake.received_by_name`, `reopens: settlementQuery.data ? reopenedCodes(settlementQuery.data, livePayout.id, intake.id) : null`. Drop `canConfirmReturn`.

- [ ] **Step 10: `SupplierCardPage`** — `voidTarget` for a payout carries `amount` and `shiftClosed` from the `Payout` row; pass `shiftClosed`, `payoutAmount`, and `reopens={reopenedCodes(settlement.data, voidTarget.id, null)}` for `kind === 'payout'`. `settlement.data` is already loaded on this page.

- [ ] **Step 11: Run the frontend suite and the typecheck**

```bash
cd frontend && npx vitest run && npx tsc -b
```

Expected: all green; fix every fixture `tsc -b` flags by adding the new fields.

- [ ] **Step 12: Commit**

```bash
git add frontend/src
git commit -m "feat(void-document): open-shift voids list their consequences and name the payout"
```

---

### Task 7: Rules, schema notes, gate

**Files:**
- Modify: `26-rules-by-example.md` §9.3 (after «Сторно виплати НЕ повертає готівку…» block), §9.4 (table row + #125 edit)
- Modify: `28-db-schema.dbml` (`Table payouts`: `returned_on_void boolean [not null, default: false]` after `return_note`; Note gains an edit)
- Modify: `CLAUDE.md` «Documents» bullet, `backend/CLAUDE.md` wherever it says a void does not return cash (`grep -n "return" backend/CLAUDE.md`)

- [ ] **Step 1: §9.3 edit** — insert after the «Інакше сторно стає способом красти.» line:

```markdown
→ **Правка 28.09.2026 (рішення команди).** У **відкритій** зміні сторно виплати повертає готівку
одразу: вважаємо, що все відбулося при клієнті — він повернув гроші або ще не взяв їх у руки.
Гроші повертаються в касу **тієї зміни, де виплату видали** (не за календарною датою: сторно о
00:30 у ще не закритій зміні чи в перевідкритій зміні інакше потрапило б не в той день). У
**закритій** зміні — як і раніше: очікуване повернення, яке підтверджує керівник.
```

- [ ] **Step 2: §9.4 edit** — the row «квитанція минулого дня → тільки керівник» becomes «квитанція закритої зміни → тільки керівник», with a note line under the block: «→ **Правка 28.09.2026:** «минулого дня» → «закритої зміни»: приймальник сторнує свою квитанцію, доки її зміна відкрита, включно з перевідкритою керівником.» Append to the #125 edit: «**Правка 28.09.2026:** у відкритій зміні вибору немає — сторно квитанції завжди сторнує й її виплату, гроші одразу в касі зміни. Три варіанти лишаються для закритої зміни (тільки керівник).»

- [ ] **Step 3: DBML** — column plus, at the end of the `payouts` Note: «Правка 2026-09-28: у відкритій зміні сторно виплати сам заповнює return_settled_at і ставить returned_on_void = true — гроші повертаються в касу зміни виплати, а не за датою внесення. У закритій зміні — як і раніше.»

- [ ] **Step 4: CLAUDE.md files** — root «Documents» bullet: after the §9.4 sentence add «A void in an OPEN shift returns a payout's cash to that same shift at once (`payouts.returned_on_void`, 2026-09-28); in a closed shift the return waits for the owner's `settle-return`.» Same fact in `backend/CLAUDE.md` where it describes payouts.

- [ ] **Step 5: Gate**

```bash
npm run verify:full
```

Expected: `ok=true`. Quote the verdict line; name every SKIPPED row in the report. `test:db`, `migrations`, `schema` and `documents` must be PASSED, not SKIPPED — if Postgres is down, start it (`docker compose up -d postgres redis`) rather than reporting a narrower green.

- [ ] **Step 6: Commit**

```bash
git add 26-rules-by-example.md 28-db-schema.dbml CLAUDE.md backend/CLAUDE.md
git commit -m "docs(rules): §9.3/§9.4 — a void in an open shift returns the cash (2026-09-28)"
```
