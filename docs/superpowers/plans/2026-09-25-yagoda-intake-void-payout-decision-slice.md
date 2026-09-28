# Intake Void With a Payout Decision (slice 2, #125) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Voiding a receipt that has a live bound payout requires an explicit decision about that payout (`keep` / `void` / `void_returned`), enforced by the API and carried out in one transaction.

**Architecture:** `PayoutsService` gains three manager-aware helpers (`findLiveBoundForUpdate`, `voidWithin`, `settleReturnWithin`); its public `void`/`settleReturn` delegate to them. `IntakesService.void` locks the intake, then the bound payout, validates the decision with a pure `assertPayoutDecision`, and calls the helpers inside its own transaction. The frontend's `VoidDocumentDialog` gets a `PayoutDecisionField` section; `ReceiptDialog` (the only intake-void entry point) computes its props.

**Tech Stack:** NestJS + TypeORM, Jest (unit + `*.db-spec.ts` against Postgres via `npm run test:db`), React + react-hook-form + TanStack Query, Vitest + Testing Library, i18next.

**Spec:** `docs/superpowers/specs/2026-09-25-yagoda-intake-void-payout-decision-slice.md`

## Global Constraints

- Branch `feat/intake-void-payout-decision` (forked from `feat/supplier-settlement`). No table, no column, no migration.
- Error codes, verbatim: `PAYOUT_DECISION_REQUIRED` (400), `PAYOUT_DECISION_NOT_APPLICABLE` (400), `OWNER_ONLY` (403).
- Decision values, verbatim: `'keep' | 'void' | 'void_returned'`.
- Lock order: intake → payout. Never the reverse.
- Audit actions, existing names only: `intake.voided`, `payout.voided`, `payout.return-settled`. `intake.voided` gains `after.payout_decision` only when a live bound payout was found.
- `POST /payouts/:id/void` and `POST /payouts/:id/settle-return` keep their contracts; their existing tests stay green without edits.
- **Leaner code (user request, 2026-09-25):** methods this slice touches get shorter, not longer. Extract focused helpers; comments are 1–3 lines stating *why*, no multi-paragraph essays in new code; when a touched method carries an essay, cut it to its load-bearing sentence. Do not refactor untouched methods.
- Money: no `*`, `/`, `Number()`, `toFixed`, `parseFloat` on amounts. Backend uses `common/money.ts`; frontend uses `@/shared/lib/money`.
- Ratchets: no baseline widening, no new eslint/knip ignores, no lowered floors.
- Frontend tests run in English (`test-setup` pins `en`); assert English strings.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` on its own line after a blank line.

## Review Focus

1. **A stale dialog:** the payout was voided (or the receipt got voided) by someone else after the dialog opened → the user sees a readable banner, not a generic failure. Pinned in Task 5 (banner for `PAYOUT_DECISION_NOT_APPLICABLE`).
2. **An operator sending `void_returned` directly to the API** → 403 `OWNER_ONLY` and nothing written. Pinned in Task 2 (unit) and Task 3 (db-spec).
3. **A failure between the two voids** → the receipt stays live. Pinned in Task 3 (atomicity).
4. **Two concurrent voids of one receipt** → one wins, the other gets `ALREADY_VOIDED`, one `payout.voided` entry. Pinned in Task 3.
5. **A receipt whose payout was already voided on its own** → voiding the receipt needs no decision and rejects one. Pinned in Task 2.

## Rulings made while planning (deviations from the spec's letter)

- **One call site, not two.** Spec §4.4 names `SupplierCardPage` as a second intake-void entry point. It is not one: the card voids only payouts and top-ups; intakes are voided from `ReceiptDialog`, which the card opens. Only `ReceiptDialog` is wired. — Cost if wrong: a future intake-void button elsewhere would need the same props.
- **The dialog receives computed props; it does not fetch.** Spec §4.4 has `VoidDocumentDialog` call `useSupplierSettlementQuery`. Instead `ReceiptDialog` (which already holds `intake` and `me`) fetches the settlement and passes `linkedPayout = { code, amount, otherCovered }` and `canConfirmReturn`. Keeps the feature presentational and its tests free of query mocks (leaner-code constraint). — Cost if wrong: none functional.
- **The bound payout is loaded through `PayoutsService.findLiveBoundForUpdate`**, not `m.findOne(Payout)` in `IntakesService` — payout queries stay in the payouts module, and the intake unit tests' shared `manager.findOne` mock is not overloaded.

---

### Task 1: `PayoutsService` — manager-aware helpers

**Files:**
- Modify: `backend/src/payouts/payouts.service.ts` (`void`, `settleReturn`, new helpers)
- Test: `backend/src/payouts/payouts.service.spec.ts`

**Interfaces:**
- Produces:
  - `findLiveBoundForUpdate(m: EntityManager, intakeId: string): Promise<Payout | null>`
  - `voidWithin(m: EntityManager, actor: AuthenticatedUser, payout: Payout, reason: string): Promise<Payout>`
  - `settleReturnWithin(m: EntityManager, actor: AuthenticatedUser, payout: Payout, note: string | null): Promise<Payout>`

- [ ] **Step 1: Write the failing tests** — append to `payouts.service.spec.ts`, inside the top-level `describe`, reusing the file's `manager`, `audit`, `payout()`, `oksana`, `owner` fixtures:

```ts
  describe('helpers used by the intake void', () => {
    it('findLiveBoundForUpdate locks the live payout bound to the intake', async () => {
      manager.findOne.mockResolvedValue(payout());

      await service.findLiveBoundForUpdate(manager as never, 'intake-1');

      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { intake_id: 'intake-1', voided_at: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('voidWithin writes the trio and audits payout.voided', async () => {
      const row = payout();

      await service.voidWithin(manager as never, oksana, row as never, 'помилка');

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved).toMatchObject({ voided_by_user_id: oksana.sub, void_reason: 'помилка' });
      expect(saved.voided_at).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout.voided', target_id: row.id, note: 'помилка' }),
        manager,
      );
    });

    it('settleReturnWithin records the return and audits payout.return-settled', async () => {
      const row = payout({ voided_at: new Date() });

      await service.settleReturnWithin(manager as never, owner, row as never, 'повернув');

      const saved = manager.save.mock.calls[0][1] as Record<string, unknown>;
      expect(saved).toMatchObject({ return_settled_by_user_id: owner.sub, return_note: 'повернув' });
      expect(saved.return_settled_at).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'payout.return-settled', note: 'повернув' }),
        manager,
      );
    });
  });
```

Add `import { IsNull } from 'typeorm';` at the top of the spec. If the file's `manager.save` mock does not return its second argument, check its `beforeEach` (around line 83) and use whatever it returns — do not change the shared mock.

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && npx jest src/payouts/payouts.service.spec.ts -t "helpers used by the intake void"`
Expected: FAIL — `service.findLiveBoundForUpdate is not a function` (and the same for the other two).

- [ ] **Step 3: Implement.** In `payouts.service.ts` add `IsNull` to the `typeorm` import. Add the helpers and make the public methods delegate. Replace the bodies of `void` and `settleReturn` so they read exactly:

```ts
  /** §9.4 as in `IntakesService.void`. Voiding does not return the cash (§9.3). */
  async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<PayoutResponse> {
    // Load and state check under the row lock, or a double tap audits twice.
    return this.dataSource.transaction(async (m) => {
      const { payout, shift } = await this.loadForWrite(actor, id, { requireAuthor: true }, m);
      if (payout.voided_at) {
        throw new ConflictException({
          message: 'That payout is already voided',
          code: 'ALREADY_VOIDED',
        });
      }
      return toPayoutResponse(await this.voidWithin(m, actor, payout, dto.reason), shift);
    });
  }

  /** The live payout issued with this receipt, locked for the caller's transaction. */
  findLiveBoundForUpdate(m: EntityManager, intakeId: string): Promise<Payout | null> {
    return m.findOne(Payout, {
      where: { intake_id: intakeId, voided_at: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Voids a payout the caller already loaded, locked and authorised. */
  async voidWithin(
    m: EntityManager,
    actor: AuthenticatedUser,
    payout: Payout,
    reason: string,
  ): Promise<Payout> {
    payout.voided_at = new Date();
    payout.voided_by_user_id = actor.sub;
    payout.void_reason = reason;
    const saved = await m.save(Payout, payout);
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
```

For `settleReturn`: keep its owner check and its two `ConflictException`s (`PAYOUT_NOT_VOIDED`, `RETURN_ALREADY_SETTLED`) unchanged; replace everything after them with `return toPayoutResponse(await this.settleReturnWithin(m, actor, payout, dto.note ?? null), shift);`. Add:

```ts
  /** Records the full cash return of a voided payout the caller already locked. Owner-only is the caller's check. */
  async settleReturnWithin(
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
```

Trim the doc comment above `settleReturn` to three lines: owner-only because whoever holds the drawer must not attest its refill (§9.3); `return_settled_at` is read by `point-cash` `movementsSql`; no amount — always the whole payout.

- [ ] **Step 4: Run the whole payouts spec**

Run: `cd backend && npx jest src/payouts`
Expected: PASS, including every pre-existing `void` / `settleReturn` test unchanged.

- [ ] **Step 5: Lint and commit**

```bash
cd backend && npx eslint src/payouts/payouts.service.ts src/payouts/payouts.service.spec.ts && npx tsc --noEmit -p tsconfig.json
git add src/payouts/payouts.service.ts src/payouts/payouts.service.spec.ts
git commit -m "refactor(payouts): void and settle-return bodies become manager-aware helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `POST /intakes/:id/void` takes a payout decision

**Files:**
- Create: `backend/src/intakes/dto/void-intake.dto.ts`
- Create: `backend/src/intakes/payout-decision.ts`
- Create: `backend/src/intakes/payout-decision.spec.ts`
- Modify: `backend/src/intakes/intakes.controller.ts:86-94`
- Modify: `backend/src/intakes/intakes.service.ts` (`void`, ~lines 235-320)
- Test: `backend/src/intakes/intakes.service.spec.ts` (`describe('void')`, ~line 554)

**Interfaces:**
- Consumes: Task 1's `findLiveBoundForUpdate`, `voidWithin`, `settleReturnWithin`.
- Produces: `PayoutDecision`, `PAYOUT_DECISIONS`, `VoidIntakeDto`, `assertPayoutDecision(actor, hasLivePayout, decision)`.

- [ ] **Step 1: Write the DTO** — `backend/src/intakes/dto/void-intake.dto.ts`:

```ts
import { IsIn, IsOptional } from 'class-validator';
import { VoidDocumentDto } from './void-document.dto';

export const PAYOUT_DECISIONS = ['keep', 'void', 'void_returned'] as const;
export type PayoutDecision = (typeof PAYOUT_DECISIONS)[number];

/** §9.3 + #125: what happens to the payout issued with this receipt. Required iff one is live. */
export class VoidIntakeDto extends VoidDocumentDto {
  @IsOptional()
  @IsIn(PAYOUT_DECISIONS)
  payout?: PayoutDecision;
}
```

- [ ] **Step 2: Write the failing test for the pure rule** — `backend/src/intakes/payout-decision.spec.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import { assertPayoutDecision } from './payout-decision';

const owner = { sub: 'o', username: 'o', role: UserRole.NetworkOwner, collection_point_id: null };
const operator = { sub: 'a', username: 'a', role: UserRole.PointOperator, collection_point_id: 'p' };

describe('assertPayoutDecision', () => {
  it('requires a decision when a live payout is bound', () => {
    expect(() => assertPayoutDecision(operator, true, undefined)).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'PAYOUT_DECISION_REQUIRED' }) }),
    );
  });

  it('rejects a decision when no live payout is bound', () => {
    expect(() => assertPayoutDecision(owner, false, 'keep')).toThrow(BadRequestException);
    expect(() => assertPayoutDecision(owner, false, 'keep')).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'PAYOUT_DECISION_NOT_APPLICABLE' }) }),
    );
  });

  it('keeps void_returned for the owner', () => {
    expect(() => assertPayoutDecision(operator, true, 'void_returned')).toThrow(ForbiddenException);
    expect(() => assertPayoutDecision(operator, true, 'void_returned')).toThrow(
      expect.objectContaining({ response: expect.objectContaining({ code: 'OWNER_ONLY' }) }),
    );
    expect(() => assertPayoutDecision(owner, true, 'void_returned')).not.toThrow();
  });

  it('accepts keep and void from an operator, and nothing when nothing is bound', () => {
    expect(() => assertPayoutDecision(operator, true, 'keep')).not.toThrow();
    expect(() => assertPayoutDecision(operator, true, 'void')).not.toThrow();
    expect(() => assertPayoutDecision(operator, false, undefined)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && npx jest src/intakes/payout-decision.spec.ts`
Expected: FAIL — cannot find module `./payout-decision`.

- [ ] **Step 4: Implement** — `backend/src/intakes/payout-decision.ts`:

```ts
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { PayoutDecision } from './dto/void-intake.dto';

/**
 * #125: a receipt with a live bound payout cannot be voided without saying what
 * happens to that payout. `void_returned` attests cash back in the drawer — owner only,
 * like `settle-return`.
 */
export function assertPayoutDecision(
  actor: AuthenticatedUser,
  hasLivePayout: boolean,
  decision: PayoutDecision | undefined,
): void {
  if (hasLivePayout && !decision) {
    throw new BadRequestException({
      message: 'This receipt has a live payout — say whether to keep or void it',
      code: 'PAYOUT_DECISION_REQUIRED',
    });
  }
  if (!hasLivePayout && decision) {
    throw new BadRequestException({
      message: 'This receipt has no live payout to decide about',
      code: 'PAYOUT_DECISION_NOT_APPLICABLE',
    });
  }
  if (decision === 'void_returned' && actor.role !== UserRole.NetworkOwner) {
    throw new ForbiddenException({
      message: 'Only the network owner may record a returned payout',
      code: 'OWNER_ONLY',
    });
  }
}
```

Run: `cd backend && npx jest src/intakes/payout-decision.spec.ts` — Expected: PASS.

- [ ] **Step 5: Write the failing service tests.** In `intakes.service.spec.ts`:
  - extend the `payouts` mock type and `beforeEach` stock:

```ts
  let payouts: {
    writePayout: jest.Mock;
    findLiveBoundForUpdate: jest.Mock;
    voidWithin: jest.Mock;
    settleReturnWithin: jest.Mock;
  };
```

```ts
      findLiveBoundForUpdate: jest.fn().mockResolvedValue(null),
      voidWithin: jest.fn().mockImplementation((_m, _a, p) => Promise.resolve({ ...p, voided_at: new Date() })),
      settleReturnWithin: jest.fn().mockImplementation((_m, _a, p) => Promise.resolve(p)),
```

  - append inside `describe('void', …)`:

```ts
    describe('with a live bound payout (#125)', () => {
      const bound = { id: 'po-1', code: 'KPG-PO-20260908-001', amount: '1500.00', voided_at: null };
      beforeEach(() => payouts.findLiveBoundForUpdate.mockResolvedValue(bound));

      it('locks the payout after the intake, in the same transaction', async () => {
        await service.void(oksana, INTAKE_ID, { reason: 'r', payout: 'keep' });

        expect(payouts.findLiveBoundForUpdate).toHaveBeenCalledWith(manager, INTAKE_ID);
        expect(manager.findOne.mock.invocationCallOrder[0]).toBeLessThan(
          payouts.findLiveBoundForUpdate.mock.invocationCallOrder[0],
        );
      });

      it('400s without a decision and writes nothing', async () => {
        await expect(service.void(oksana, INTAKE_ID, { reason: 'r' })).rejects.toMatchObject({
          response: { code: 'PAYOUT_DECISION_REQUIRED' },
        });
        expect(manager.save).not.toHaveBeenCalled();
        expect(audit.record).not.toHaveBeenCalled();
      });

      it('403s an operator choosing void_returned and writes nothing', async () => {
        await expect(
          service.void(oksana, INTAKE_ID, { reason: 'r', payout: 'void_returned' }),
        ).rejects.toMatchObject({ response: { code: 'OWNER_ONLY' } });
        expect(manager.save).not.toHaveBeenCalled();
      });

      it('keep: voids only the intake and records the decision', async () => {
        await service.void(oksana, INTAKE_ID, { reason: 'r', payout: 'keep' });

        expect(payouts.voidWithin).not.toHaveBeenCalled();
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'intake.voided',
            after: expect.objectContaining({ payout_decision: 'keep' }),
          }),
          manager,
        );
      });

      it('void: voids the payout with the same reason, no return', async () => {
        await service.void(oksana, INTAKE_ID, { reason: 'помилка', payout: 'void' });

        expect(payouts.voidWithin).toHaveBeenCalledWith(manager, oksana, bound, 'помилка');
        expect(payouts.settleReturnWithin).not.toHaveBeenCalled();
      });

      it('void_returned (owner): voids, then settles the return with the reason as note', async () => {
        await service.void(owner, INTAKE_ID, { reason: 'повернув', payout: 'void_returned' });

        expect(payouts.voidWithin).toHaveBeenCalledWith(manager, owner, bound, 'повернув');
        expect(payouts.settleReturnWithin).toHaveBeenCalledWith(
          manager,
          owner,
          expect.objectContaining({ id: 'po-1' }),
          'повернув',
        );
        expect(payouts.voidWithin.mock.invocationCallOrder[0]).toBeLessThan(
          payouts.settleReturnWithin.mock.invocationCallOrder[0],
        );
      });
    });

    it('400s a decision when no live payout is bound (e.g. voided on its own earlier)', async () => {
      await expect(
        service.void(oksana, INTAKE_ID, { reason: 'r', payout: 'void' }),
      ).rejects.toMatchObject({ response: { code: 'PAYOUT_DECISION_NOT_APPLICABLE' } });
    });

    it('records no payout_decision when nothing was bound', async () => {
      await service.void(oksana, INTAKE_ID, { reason: 'r' });

      const entry = audit.record.mock.calls[0][0] as { after: Record<string, unknown> };
      expect(entry.after).not.toHaveProperty('payout_decision');
    });
```

- [ ] **Step 6: Run to verify failure**

Run: `cd backend && npx jest src/intakes/intakes.service.spec.ts -t void`
Expected: FAIL — the `#125` block (no call to `findLiveBoundForUpdate`, no `PAYOUT_DECISION_*`); pre-existing void tests still PASS.

- [ ] **Step 7: Implement `IntakesService.void`.** Import `VoidIntakeDto` (replacing the `VoidDocumentDto` import if nothing else uses it) and `assertPayoutDecision`. Move today's load + §9.4 checks, unchanged in behaviour, into a private `loadForVoid`; the public method becomes:

```ts
  /** §9.4 row by row, plus #125's payout decision. Lock order: intake, then payout. */
  async void(actor: AuthenticatedUser, id: string, dto: VoidIntakeDto): Promise<IntakeResponse> {
    return this.dataSource.transaction(async (m) => {
      const { intake, shift } = await this.loadForVoid(actor, id, m);
      const payout = await this.payouts.findLiveBoundForUpdate(m, intake.id);
      assertPayoutDecision(actor, payout !== null, dto.payout);

      // No balance floor: voiding a receipt is the one allowed way into negative debt.
      intake.voided_at = new Date();
      intake.voided_by_user_id = actor.sub;
      intake.void_reason = dto.reason;
      const saved = await m.save(Intake, intake);
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
        const voided = await this.payouts.voidWithin(m, actor, payout, dto.reason);
        if (dto.payout === 'void_returned') {
          await this.payouts.settleReturnWithin(m, actor, voided, dto.reason);
        }
      }

      return toIntakeResponse(saved, shift, await this.extrasFor(saved.id, m));
    });
  }

  /**
   * §9.4: own receipt + open shift for an operator; anything for the owner. An author
   * check, not a point check — §10.6 puts two operators in one shift. Under a row lock
   * so a double tap cannot void twice.
   */
  private async loadForVoid(actor: AuthenticatedUser, id: string, m: EntityManager) {
    const intake = await m.findOne(Intake, { where: { id }, lock: { mode: 'pessimistic_write' } });
    if (!intake) throw new NotFoundException('Intake not found');
    const shift = await this.shifts.findOneRaw(intake.shift_id, m);
    if (!shift) throw new NotFoundException('Intake not found');

    if (actor.role !== UserRole.NetworkOwner) {
      // 404, not 403: another point's id must not be confirmed.
      if (actor.collection_point_id !== shift.collection_point_id) {
        throw new NotFoundException('Intake not found');
      }
      if (intake.received_by_user_id !== actor.sub) {
        throw new ForbiddenException({
          message: 'You can only void a document you recorded yourself',
          code: 'NOT_YOUR_DOCUMENT',
        });
      }
      if (shift.closed_at) {
        throw new ForbiddenException({
          message: 'That shift is closed — ask the network owner to void it',
          code: 'SHIFT_CLOSED',
        });
      }
    }
    if (intake.voided_at) {
      throw new ConflictException({ message: 'That intake is already voided', code: 'ALREADY_VOIDED' });
    }
    return { intake, shift };
  }
```

Keep the §10.2-contradiction note, cut to one line above `loadForVoid`: `// §10.2 lists receipt voids as owner-only; §9.4 (followed here) allows the author. Spec §10.2 records the switch.` Delete the rest of the old essay comments inside `void`. Add `EntityManager` to the `typeorm` import if absent.

In `intakes.controller.ts` change `@Body() dto: VoidDocumentDto` to `@Body() dto: VoidIntakeDto` and fix imports (remove `VoidDocumentDto` there if now unused).

- [ ] **Step 8: Run the intakes suite**

Run: `cd backend && npx jest src/intakes`
Expected: PASS — all pre-existing tests and the new ones.

- [ ] **Step 9: Lint, typecheck, commit**

```bash
cd backend && npx eslint src/intakes && npx tsc --noEmit -p tsconfig.json
git add src/intakes
git commit -m "feat(intakes): voiding a receipt with a live bound payout requires a decision (#125)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: db-spec — the #125 scenario against Postgres

**Files:**
- Create: `backend/src/intakes/intake-void-payout-decision.db-spec.ts`

**Interfaces:**
- Consumes: `POST /intakes/:id/void` with `{ reason, payout? }` (Task 2); `PayoutsService.voidWithin` (Task 1, spied for atomicity); `SupplierBalanceService.debtFor`, `settlementFor`; `PointCashService.movementsForShift`; `timezoneConfig`.

- [ ] **Step 1: Write the suite.** It runs against Tasks 1–2 already committed, so it goes green first; Step 3 proves it can fail.

```ts
import { randomUUID } from 'crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// MUST precede `../app.module` — it loads `.env` as a side effect.
import {
  ensureTestDatabase,
  relaxThrottleForTests,
  resolveTestDatabaseName,
} from '../testing/db-harness';

import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { CredentialsService } from '../users/credentials.service';
import { LOCAL_PROVIDER } from '../users/user-identity.entity';
import { UserRole } from '../users/user-role.enum';
import { PayoutsService } from '../payouts/payouts.service';
import { SupplierBalanceService } from '../supplier-balance/supplier-balance.service';
import { PointCashService } from '../point-cash/point-cash.service';
import { timezoneConfig } from '../config/timezone.config';
import { sub } from '../common/money';

/**
 * #125 end to end: old debt 1000, receipt R 500 today, payout P 1500 issued with R
 * (it covered R and the old receipt). Each test builds its own supplier; the
 * database persists between runs, so every name carries the run's uuid.
 */
describe('intake void with a payout decision (HTTP, Postgres)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let ownerToken: string;
  let operatorToken: string;
  let operatorId: string;
  let pointId: string;
  let oldShiftId: string;
  let todayShiftId: string;
  const run = randomUUID();

  beforeAll(async () => {
    process.env.DB_NAME = resolveTestDatabaseName();
    await ensureTestDatabase();
    relaxThrottleForTests();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));
    await app.init();
    ds = app.get(DataSource);

    const users = app.get(UsersService);
    const credentials = app.get(CredentialsService);
    const jwt = app.get(JwtService);
    const make = (role: UserRole, point: string | null, tag: string) =>
      users.createWithIdentity(
        {
          provider: LOCAL_PROVIDER,
          providerUserId: `ivpd-${tag}-${randomUUID()}`,
          first_name: tag,
          last_name: 'Test',
          role,
          ...(point ? { collection_point_id: point } : {}),
        },
        async (created, manager) => credentials.set(created.id, 'hunter2!!', manager),
      );

    const { user: owner } = await make(UserRole.NetworkOwner, null, 'owner');
    ownerToken = jwt.sign({ sub: owner.id });

    const [point] = await ds.query(
      `INSERT INTO collection_points (name, kind, code) VALUES ($1, 'reception', $2) RETURNING id`,
      [`ivpd-${run}`, run.replace(/-/g, '').slice(0, 8).toUpperCase()],
    );
    pointId = point.id;

    const { user: operator } = await make(UserRole.PointOperator, pointId, 'oksana');
    operatorId = operator.id;
    operatorToken = jwt.sign({ sub: operator.id });

    const tz = app.get<{ appTimezone: string }>(timezoneConfig.KEY).appTimezone;
    const [old] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date,
                           closed_at, closed_by_user_id, status)
       VALUES ($1, $2, '2026-07-01', now(), $2, 'closed') RETURNING id`,
      [pointId, operatorId],
    );
    oldShiftId = old.id;
    // Today's local date: a settled return is credited to the shift of its local date.
    const [today] = await ds.query(
      `INSERT INTO shifts (collection_point_id, opened_by_user_id, business_date, status)
       VALUES ($1, $2, (now() AT TIME ZONE $3::text)::date, 'open') RETURNING id`,
      [pointId, operatorId, tz],
    );
    todayShiftId = today.id;
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  let seq = 0;
  /** A fresh supplier with the #125 fixture. Returns the ids the tests need. */
  const scenario = async () => {
    const [supplier] = await ds.query(
      `INSERT INTO suppliers (collection_point_id, first_name, last_name, is_active)
       VALUES ($1, 'Ніна', $2, true) RETURNING id`,
      [pointId, `ivpd-${run}-${++seq}`],
    );
    const intake = async (shiftId: string, amount: string) => {
      const [row] = await ds.query(
        `INSERT INTO intakes (code, shift_id, supplier_id, amount, received_by_user_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [`IN-${run}-${++seq}`, shiftId, supplier.id, amount, operatorId],
      );
      return row.id as string;
    };
    const oldId = await intake(oldShiftId, '1000.00');
    const rId = await intake(todayShiftId, '500.00');
    const [p] = await ds.query(
      `INSERT INTO payouts (code, shift_id, supplier_id, amount, paid_by_user_id, intake_id)
       VALUES ($1, $2, $3, '1500.00', $4, $5) RETURNING id`,
      [`PO-${run}-${++seq}`, todayShiftId, supplier.id, operatorId, rId],
    );
    return { supplierId: supplier.id as string, oldId, rId, pId: p.id as string };
  };

  const voidIntake = (token: string, id: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/intakes/${id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const row = async (table: 'intakes' | 'payouts', id: string) =>
    (await ds.query(`SELECT * FROM ${table} WHERE id = $1`, [id]))[0];
  const debt = (supplierId: string) => app.get(SupplierBalanceService).debtFor(supplierId);
  const cash = () => app.get(PointCashService).movementsForShift(todayShiftId);

  it('400s without a decision and leaves both documents live', async () => {
    const s = await scenario();
    const res = await voidIntake(operatorToken, s.rId, { reason: 'помилка' }).expect(400);
    expect(res.body.code).toBe('PAYOUT_DECISION_REQUIRED');
    expect((await row('intakes', s.rId)).voided_at).toBeNull();
    expect((await row('payouts', s.pId)).voided_at).toBeNull();
  });

  it('403s an operator choosing void_returned and writes nothing', async () => {
    const s = await scenario();
    const res = await voidIntake(operatorToken, s.rId, {
      reason: 'повернув',
      payout: 'void_returned',
    }).expect(403);
    expect(res.body.code).toBe('OWNER_ONLY');
    expect((await row('intakes', s.rId)).voided_at).toBeNull();
  });

  it('keep: the payout re-routes to the old receipt and leaves 500 as an advance', async () => {
    const s = await scenario();
    await voidIntake(operatorToken, s.rId, { reason: 'помилка', payout: 'keep' }).expect(201);

    expect((await row('payouts', s.pId)).voided_at).toBeNull();
    await expect(debt(s.supplierId)).resolves.toBe('-500.00');
    const settlement = await app.get(SupplierBalanceService).settlementFor(s.supplierId);
    expect(settlement.lines.map((l) => [l.id, l.open])).toEqual([[s.oldId, '0.00']]);
    expect(settlement.payouts[0].unallocated).toBe('500.00');
  });

  it('void: both voided, the old receipt reopens, the drawer does not change', async () => {
    const s = await scenario();
    const before = await cash();
    await voidIntake(operatorToken, s.rId, { reason: 'помилка', payout: 'void' }).expect(201);

    const p = await row('payouts', s.pId);
    expect(p.voided_at).not.toBeNull();
    expect(p.void_reason).toBe('помилка');
    expect(p.return_settled_at).toBeNull();
    await expect(debt(s.supplierId)).resolves.toBe('1000.00');
    expect(sub(await cash(), before)).toBe('0.00');
  });

  it('void_returned (owner): both voided and 1500 back in the drawer', async () => {
    const s = await scenario();
    const before = await cash();
    await voidIntake(ownerToken, s.rId, { reason: 'повернув', payout: 'void_returned' }).expect(201);

    const p = await row('payouts', s.pId);
    expect(p.return_settled_at).not.toBeNull();
    expect(p.return_note).toBe('повернув');
    await expect(debt(s.supplierId)).resolves.toBe('1000.00');
    expect(sub(await cash(), before)).toBe('1500.00');
    const actions = await ds.query(
      `SELECT action FROM audit_log WHERE target_id IN ($1, $2) ORDER BY at, action`,
      [s.rId, s.pId],
    );
    expect(actions.map((a: { action: string }) => a.action).sort()).toEqual([
      'intake.voided',
      'payout.return-settled',
      'payout.voided',
    ]);
  });

  it('is atomic: a failure voiding the payout leaves the receipt live', async () => {
    const s = await scenario();
    const spy = jest
      .spyOn(app.get(PayoutsService), 'voidWithin')
      .mockRejectedValueOnce(new Error('boom'));
    try {
      await voidIntake(operatorToken, s.rId, { reason: 'помилка', payout: 'void' }).expect(500);
    } finally {
      spy.mockRestore();
    }
    expect((await row('intakes', s.rId)).voided_at).toBeNull();
    expect((await row('payouts', s.pId)).voided_at).toBeNull();
  });

  it('two concurrent voids: one wins, the other is ALREADY_VOIDED, one payout.voided entry', async () => {
    const s = await scenario();
    const results = await Promise.all([
      voidIntake(operatorToken, s.rId, { reason: 'a', payout: 'void' }),
      voidIntake(operatorToken, s.rId, { reason: 'b', payout: 'void' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe('ALREADY_VOIDED');
    const [{ n }] = await ds.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE target_id = $1 AND action = 'payout.voided'`,
      [s.pId],
    );
    expect(n).toBe(1);
  });
});
```

If `movementsForShift` does not credit a settled return to an OPEN shift, or `timezoneConfig.KEY` resolves differently, read `point-cash.service.ts` `movementsSql` (~line 113) and adapt the fixture, not the assertion.

- [ ] **Step 2: Run it**

Run: `npm run test:db -- intake-void-payout-decision` (from the repo root; check `package.json` for the exact pass-through form if that filter is not accepted)
Expected: PASS, 7 tests.

- [ ] **Step 3: Prove it bites.** Temporarily change `if (payout && dto.payout !== 'keep')` in `intakes.service.ts` to `if (false)`; rerun; Expected: the `void`, `void_returned`, atomicity and concurrency tests FAIL. Revert (`git checkout -- src/intakes/intakes.service.ts` is safe here — the file is committed and only this probe changed it; confirm with `git diff` first).

- [ ] **Step 4: Commit**

```bash
git add backend/src/intakes/intake-void-payout-decision.db-spec.ts
git commit -m "test(intakes): #125 void decisions, atomicity and the race against Postgres

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: frontend data layer — mutation payload, invalidation, `otherCovered`

**Files:**
- Modify: `frontend/src/features/void-document/api/useVoidDocument.ts`
- Test: `frontend/src/features/void-document/api/useVoidDocument.test.tsx`
- Create: `frontend/src/features/void-document/model/otherCovered.ts`
- Create: `frontend/src/features/void-document/model/otherCovered.test.ts`
- Modify: `frontend/src/features/void-document/index.ts`
- Modify: `frontend/src/entities/supplier/index.ts` (export type `SupplierSettlement`)
- Modify: `frontend/src/entities/supplier/model/supplier.ts` (export `SupplierSettlement` if it is not exported)

**Interfaces:**
- Produces: `type PayoutDecision = 'keep' | 'void' | 'void_returned'`; `VoidDocumentInput.payout?: PayoutDecision`; `otherCovered(settlement: SupplierSettlement, payoutId: string, intakeId: string): string`.

- [ ] **Step 1: Failing tests.** Append to `useVoidDocument.test.tsx`:

```ts
  it('sends the payout decision for an intake', async () => {
    mock.onPost('/intakes/i1/void').reply(201);
    const { result } = renderHook(() => useVoidDocumentMutation(), { wrapper });

    await result.current.mutateAsync({ kind: 'intake', id: 'i1', reason: 'r', payout: 'void' });

    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({ reason: 'r', payout: 'void' });
  });

  it('invalidates point cash after an intake void (a returned payout refills the drawer)', async () => {
    mock.onPost('/intakes/i1/void').reply(201);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useVoidDocumentMutation(), { wrapper });

    await result.current.mutateAsync({ kind: 'intake', id: 'i1', reason: 'r' });

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.pointCash }),
    );
  });
```

Create `otherCovered.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { SupplierSettlement } from '@/entities/supplier';
import { otherCovered } from './otherCovered';

const line = (id: string, kind: 'intake' | 'top_up', intake_id: string) => ({
  kind, id, code: 'C', intake_id, business_date: '2026-09-25', created_at: '', amount: '0.00',
  paid: '0.00', open: '0.00', covered_by: [],
});

const settlement: SupplierSettlement = {
  debt: '0.00',
  unallocated: '0.00',
  lines: [line('old', 'intake', 'old'), line('r', 'intake', 'r'), line('t', 'top_up', 'r')],
  payouts: [
    {
      id: 'p', code: 'P', business_date: '2026-09-25', created_at: '', amount: '1500.00',
      intake_id: 'r', unallocated: '0.00',
      covers: [
        { line_id: 'r', kind: 'intake', amount: '400.00' },
        { line_id: 't', kind: 'top_up', amount: '100.00' },
        { line_id: 'old', kind: 'intake', amount: '1000.00' },
      ],
    },
  ],
};

describe('otherCovered', () => {
  it('sums what the payout covers outside the receipt and its top-ups', () => {
    expect(otherCovered(settlement, 'p', 'r')).toBe('1000.00');
  });

  it('seen from another receipt, counts this receipt and its top-up as "other"', () => {
    expect(otherCovered(settlement, 'p', 'old')).toBe('500.00');
  });

  it('is zero when the payout is not in the settlement', () => {
    expect(otherCovered({ ...settlement, payouts: [] }, 'p', 'r')).toBe('0.00');
  });
});
```

If `SupplierSettlement`'s actual fields differ from the fixture, match the fixture to `entities/supplier/model/supplier.ts` — do not change the type.

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/features/void-document`
Expected: FAIL — body lacks `payout`; no `pointCash` invalidation; `./otherCovered` not found.

- [ ] **Step 3: Implement.** In `useVoidDocument.ts`:

```ts
export type PayoutDecision = 'keep' | 'void' | 'void_returned';

export interface VoidDocumentInput {
  kind: 'intake' | 'payout' | 'transfer' | 'topUp' | 'crateIssuance' | 'crateReturn';
  id: string;
  reason: string;
  /** Intake only (#125): what happens to the payout issued with it. */
  payout?: PayoutDecision;
}
```

`intake.invalidates` becomes `[...DOCUMENT_KEYS, queryKeys.pointCash]` (comment: `// + pointCash: a void_returned puts the payout back in the drawer.`). `mutationFn`:

```ts
    mutationFn: async ({ kind, id, reason, payout }: VoidDocumentInput): Promise<void> => {
      await httpClient.post(DOCUMENTS[kind].path(id), payout ? { reason, payout } : { reason });
    },
```

Trim the file's leading doc comment to 3 lines: one void per kind; invalidation differs by kind on purpose (§9.3); a voided payout stays subtracted from cash until its return is recorded.

`model/otherCovered.ts`:

```ts
import type { SupplierSettlement } from '@/entities/supplier';
import { sum } from '@/shared/lib/money';

/** What a payout covers beyond this receipt and its top-ups — the debt that reopens if both are voided. */
export function otherCovered(
  settlement: SupplierSettlement,
  payoutId: string,
  intakeId: string,
): string {
  const payout = settlement.payouts.find((p) => p.id === payoutId);
  if (!payout) return '0.00';
  const own = new Set(settlement.lines.filter((l) => l.intake_id === intakeId).map((l) => l.id));
  return sum(payout.covers.filter((c) => !own.has(c.line_id)).map((c) => c.amount));
}
```

`index.ts` adds `export type { PayoutDecision } from './api/useVoidDocument';` and `export { otherCovered } from './model/otherCovered';`. `entities/supplier/index.ts` adds `SupplierSettlement` to its type exports (export it from `model/supplier.ts` if it is not already).

- [ ] **Step 4: Run tests and typecheck**

Run: `cd frontend && npx vitest run src/features/void-document && npx tsc -b`
Expected: PASS; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/void-document frontend/src/entities/supplier
git commit -m "feat(void-document): carry the payout decision and compute what else a payout covers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: the choice in the dialog, wired from `ReceiptDialog`

**Files:**
- Create: `frontend/src/features/void-document/ui/PayoutDecisionField.tsx`
- Modify: `frontend/src/features/void-document/ui/VoidDocumentDialog.tsx`
- Test: `frontend/src/features/void-document/ui/VoidDocumentDialog.test.tsx`
- Modify: `frontend/src/widgets/receipt/ui/ReceiptDialog.tsx` (~lines 60-80 hooks, ~203 dialog)
- Modify: `frontend/src/shared/lib/api-error/apiErrorToBanner.ts` (`CODE` map)
- Modify: `frontend/src/shared/lib/i18n/locales/uk.json`, `en.json` (`void` block)

**Interfaces:**
- Consumes: Task 4's `PayoutDecision`, `otherCovered`, `VoidDocumentInput.payout`; `useSupplierSettlementQuery(id: string | null)` from `@/entities/supplier`; `useMeQuery` from `@/entities/user`.
- Produces: `VoidDocumentDialog` props `linkedPayout?: { code: string; amount: string; otherCovered: string | null }` and `canConfirmReturn?: boolean`.

- [ ] **Step 1: i18n.** Add to `uk.json` → `void`:

```json
    "payout": {
      "legend": "Що з виплатою {{code}} ({{amount}})?",
      "keep": "Залишити виплату",
      "void": "Сторнувати й виплату — постачальник поверне гроші",
      "voidReturned": "Сторнувати й виплату — гроші вже повернуто в касу",
      "cashWarning": "Каса буде меншою на {{amount}}, доки керівник не підтвердить повернення",
      "otherCovered": "З них {{amount}} покривали інші квитанції — вони знову стануть відкритими",
      "required": "Оберіть, що зробити з виплатою"
    },
```

and in `void.errors`: `"payoutChanged": "Виплату до цієї квитанції щойно змінено — закрийте й відкрийте діалог знову"`. Add to `en.json` → `void`:

```json
    "payout": {
      "legend": "What about payout {{code}} ({{amount}})?",
      "keep": "Keep the payout",
      "void": "Void the payout too — the supplier will return the money",
      "voidReturned": "Void the payout too — the money is already back in the drawer",
      "cashWarning": "The drawer will be {{amount}} short until the owner confirms the return",
      "otherCovered": "{{amount}} of it covered other receipts — they will reopen",
      "required": "Choose what to do with the payout"
    },
```

and `void.errors.payoutChanged`: `"The payout on this receipt just changed — close and reopen the dialog"`. In `apiErrorToBanner.ts` `CODE`, under `// features/void-document`, add:

```ts
  PAYOUT_DECISION_REQUIRED: 'void.errors.payoutChanged',
  PAYOUT_DECISION_NOT_APPLICABLE: 'void.errors.payoutChanged',
```

(`OWNER_ONLY` already maps to `day.errors.ownerOnly`; reuse it.)

- [ ] **Step 2: Failing dialog tests.** In `VoidDocumentDialog.test.tsx`, add a render helper and tests:

```tsx
function renderWithPayout({
  canConfirmReturn = false,
  otherCovered = null as string | null,
} = {}) {
  const onClose = vi.fn();
  render(
    <>
      <VoidDocumentDialog
        kind="intake"
        id="i1"
        code="ПР-0012"
        open
        onClose={onClose}
        linkedPayout={{ code: 'PO-7', amount: '1500.00', otherCovered }}
        canConfirmReturn={canConfirmReturn}
      />
      <Toaster />
    </>,
  );
  return { onClose };
}

describe('VoidDocumentDialog with a bound payout (#125)', () => {
  it('offers two choices to an operator, none preselected', () => {
    renderWithPayout();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    radios.forEach((r) => expect(r).not.toBeChecked());
    expect(screen.queryByLabelText(/already back in the drawer/)).not.toBeInTheDocument();
  });

  it('offers the third choice to the owner', () => {
    renderWithPayout({ canConfirmReturn: true });
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('refuses to submit without a choice', async () => {
    renderWithPayout();
    await userEvent.type(screen.getByLabelText('Reason'), 'помилка');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(await screen.findByText('Choose what to do with the payout')).toBeInTheDocument();
    expect(voidDocumentMock).not.toHaveBeenCalled();
  });

  it('warns about the drawer only for void, and sends the decision', async () => {
    renderWithPayout();
    await userEvent.click(screen.getByLabelText('Keep the payout'));
    expect(screen.queryByText(/drawer will be/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/supplier will return the money/));
    expect(screen.getByText(/drawer will be/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Reason'), 'помилка');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    await waitFor(() =>
      expect(voidDocumentMock).toHaveBeenCalledWith({
        kind: 'intake',
        id: 'i1',
        reason: 'помилка',
        payout: 'void',
      }),
    );
  });

  it('says which other receipts reopen, only when there are some', () => {
    renderWithPayout({ otherCovered: '1000.00' });
    expect(screen.getByText(/covered other receipts/)).toBeInTheDocument();
  });

  it('hides that line when the payout covered only this receipt', () => {
    renderWithPayout({ otherCovered: '0.00' });
    expect(screen.queryByText(/covered other receipts/)).not.toBeInTheDocument();
  });

  it('shows the stale-dialog banner on PAYOUT_DECISION_NOT_APPLICABLE', async () => {
    voidDocumentMock.mockRejectedValue(
      new ApiError(400, 'bad', undefined, 'PAYOUT_DECISION_NOT_APPLICABLE'),
    );
    renderWithPayout();
    await userEvent.click(screen.getByLabelText('Keep the payout'));
    await userEvent.type(screen.getByLabelText('Reason'), 'помилка');
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('just changed');
  });
});
```

Also assert, in the existing «voids with the typed reason» test, that the call has no `payout` key — it already uses `toHaveBeenCalledWith({ kind, id, reason })`, which fails if `payout: undefined` is added, so pass the key only when set.

- [ ] **Step 3: Run to verify failure**

Run: `cd frontend && npx vitest run src/features/void-document/ui`
Expected: FAIL — no radios.

- [ ] **Step 4: Implement `PayoutDecisionField.tsx`:**

```tsx
import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { formatUah, isZero } from '@/shared/lib/money';
import type { PayoutDecision } from '../api/useVoidDocument';

export interface LinkedPayout {
  code: string;
  amount: string;
  /** Null while the settlement loads — the line is then simply absent. */
  otherCovered: string | null;
}

/** #125: what happens to the payout issued with the receipt. No default on purpose. */
export function PayoutDecisionField({
  payout,
  canConfirmReturn,
  value,
  onChange,
  error,
}: {
  payout: LinkedPayout;
  canConfirmReturn: boolean;
  value: PayoutDecision | undefined;
  onChange: (value: PayoutDecision) => void;
  error?: string;
}) {
  const { t, i18n } = useTranslation();
  const money = (v: string) => formatUah(v, i18n.resolvedLanguage);
  const options: PayoutDecision[] = canConfirmReturn ? ['keep', 'void', 'void_returned'] : ['keep', 'void'];
  const labelKey = { keep: 'keep', void: 'void', void_returned: 'voidReturned' } as const;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">
        {t('void.payout.legend', { code: payout.code, amount: money(payout.amount) })}
      </legend>
      <RadioGroup value={value ?? ''} onValueChange={(v) => onChange(v as PayoutDecision)}>
        {options.map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm">
            <RadioGroupItem value={option} />
            {t(`void.payout.${labelKey[option]}`)}
          </label>
        ))}
      </RadioGroup>
      {value === 'void' ? (
        <p className="text-sm text-warning">{t('void.payout.cashWarning', { amount: money(payout.amount) })}</p>
      ) : null}
      {payout.otherCovered && !isZero(payout.otherCovered) ? (
        <p className="text-sm text-muted-foreground">
          {t('void.payout.otherCovered', { amount: money(payout.otherCovered) })}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{t(error)}</p> : null}
    </fieldset>
  );
}
```

Check `formatUah`'s actual signature in `shared/lib/money/format.ts` and the project's warning text token (`text-warning` or equivalent in `index.css`); adapt those two calls, not the structure.

In `VoidDocumentDialog.tsx`: import `Controller` from `react-hook-form`; add props `linkedPayout?: LinkedPayout; canConfirmReturn?: boolean`; extend `VoidFormValues` with `payout?: PayoutDecision`; add `control` from `useForm` and render, between the description and the reason field, when `kind === 'intake' && linkedPayout`:

```tsx
          {showPayout ? (
            <Controller
              control={control}
              name="payout"
              rules={{ validate: (v) => v !== undefined || 'void.payout.required' }}
              render={({ field, fieldState }) => (
                <PayoutDecisionField
                  payout={linkedPayout}
                  canConfirmReturn={canConfirmReturn}
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                />
              )}
            />
          ) : null}
```

with `const showPayout = kind === 'intake' && linkedPayout !== undefined;` and the submit call:

```ts
      await voidDocument.mutateAsync({
        kind,
        id,
        reason: values.reason.trim(),
        ...(showPayout && values.payout ? { payout: values.payout } : {}),
      });
```

Export `LinkedPayout` type from `index.ts` only if `ReceiptDialog` needs to name it (it should not — pass an object literal).

- [ ] **Step 5: Run the dialog tests**

Run: `cd frontend && npx vitest run src/features/void-document`
Expected: PASS (old tests unchanged + 7 new).

- [ ] **Step 6: Wire `ReceiptDialog.tsx`.** Next to the other top-level hooks (before any early return):

```tsx
  const livePayout = intake?.payouts.find((p) => p.voided_at === null) ?? null;
  // Only fetched when there is a payout to explain; the line waits for it, the choice does not.
  const settlementQuery = useSupplierSettlementQuery(livePayout ? (intake?.supplier_id ?? null) : null);
```

Import `useSupplierSettlementQuery` from `@/entities/supplier` and `otherCovered` from `@/features/void-document`. Pass to the existing `<VoidDocumentDialog kind="intake" …>`:

```tsx
        linkedPayout={
          livePayout
            ? {
                code: livePayout.code,
                amount: livePayout.amount,
                otherCovered: settlementQuery.data
                  ? otherCovered(settlementQuery.data, livePayout.id, intake.id)
                  : null,
              }
            : undefined
        }
        canConfirmReturn={me.role === 'network_owner'}
```

Do NOT add `settlementQuery.isError` to the dialog's `isError` — a failed settlement read must not blank the receipt.

- [ ] **Step 7: Run the widget and the whole frontend**

Run: `cd frontend && npx vitest run src/widgets/receipt src/features/void-document && npx tsc -b && npx eslint src/features/void-document src/widgets/receipt src/shared/lib/api-error`
Expected: PASS; tsc and eslint clean. If `ReceiptDialog.test.tsx` mocks `@/entities/supplier` by listing hooks, add `useSupplierSettlementQuery: () => ({ data: undefined })` to that mock.

- [ ] **Step 8: Commit**

```bash
git add frontend/src
git commit -m "feat(receipt): voiding a receipt asks what happens to its payout (#125)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: rules, schema note, follow-ups — and the full gate

**Files:**
- Modify: `26-rules-by-example.md` §9.3 (~line 1577) and §9.4 (~line 1635)
- Modify: `28-db-schema.dbml` — the `payouts` Note
- Modify: `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md` (~line 1212)

- [ ] **Step 1: §9.4 dated entry.** Append at the end of §9.4:

```markdown
**Правка 25.09.2026 (#125) — сторно квитанції з виплатою.** Якщо до квитанції прив'язана жива
виплата (видана разом із нею), сторнувати квитанцію без рішення про виплату не можна. Три
варіанти, жоден не обраний заздалегідь:
- **Залишити виплату** — звичайний випадок: буде нова правильна квитанція, і виплата покриє її
  за чергою (§3.3).
- **Сторнувати й виплату — постачальник поверне гроші.** Каса менша на суму виплати, доки
  керівник не підтвердить повернення (§9.3).
- **Сторнувати й виплату — гроші вже в касі.** Тільки керівник: хто тримає шухляду, той не
  засвідчує, що її поповнено.

Обидва сторно — одна дія, одна причина, два записи в журналі. Приклад: старий борг 1 000,
квитанція 500, виплата 1 500 з нею. «Залишити» → борг −500 (аванс). «Сторнувати обидві» →
борг 1 000: стара квитанція знову відкрита, бо виплата повертається вся — часткового сторно немає.
```

- [ ] **Step 2: §9.3 cross-reference.** At the end of §9.3 add one line: `**Правка 25.09.2026:** сторно квитанції разом із її виплатою — §9.4, «сторно квитанції з виплатою».`

- [ ] **Step 3: DBML.** In the `payouts` table Note, after the text about `intake_id`, add: `Правка 2026-09-25 (#125): жива виплата з intake_id сторнується разом зі своєю квитанцією, якщо так вирішено при сторно квитанції (POST /intakes/:id/void, payout = void | void_returned) — в одній транзакції. Схема не змінюється.` Keep the DBML valid (`npx @dbml/cli dbml2sql 28-db-schema.dbml > /dev/null` if the CLI is available; otherwise the `registry.test.mjs` run in Step 6 parses it).

- [ ] **Step 4: Follow-ups.** In `docs/superpowers/2026-09-05-foundation-slice-follow-ups.md`, replace the slice-1 bullet «**Slice 2 — voiding a receipt that has a bound payout (#125).** …» with `- ~~**Slice 2 (#125).**~~ Done 2026-09-25 — spec docs/superpowers/specs/2026-09-25-yagoda-intake-void-payout-decision-slice.md.`, then append:

```markdown
## Deferred from slice 2 — intake void with a payout decision (2026-09-25)

- **The owner's `settle-return` screen.** `POST /payouts/:id/settle-return` exists; no screen
  calls it. A payout voided with «постачальник поверне гроші» has its return recorded only
  through the API until then.
- **A shift-close reminder** listing the shift's payouts voided with no recorded return.
- **`SupplierCardPage` has no intake-void entry.** Intakes are voided from `ReceiptDialog`
  only; a future second entry point must pass `linkedPayout` / `canConfirmReturn` the same way.
```

- [ ] **Step 5: Commit the docs**

```bash
git add 26-rules-by-example.md 28-db-schema.dbml docs/superpowers/2026-09-05-foundation-slice-follow-ups.md
git commit -m "docs(rules): §9.3/§9.4 — voiding a receipt decides its payout (#125)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: The full gate**

Run: `npm run verify:full`
Expected: every row PASSED, none SKIPPED (a SKIPPED row is named in the report, never called green), exit 0. Quote the verdict line. Money modules and SQL behaviour changed, so the fast tier alone is not evidence.
