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
  async void(
    m: EntityManager,
    actor: AuthenticatedUser,
    payout: Payout,
    reason: string,
  ): Promise<Payout> {
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
