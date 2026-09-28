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

      const { saved, shift } = await this.allocations.withinSupplierLedger(
        m,
        stub.supplier_id,
        () => this.voidLocked(m, actor, id, dto),
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
      throw new ConflictException({
        message: 'That intake is already voided',
        code: 'ALREADY_VOIDED',
      });
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
      // Task 4 rewrites this call to ask the intake's own shift; for now it never returns cash.
      const voided = await this.payouts.void(m, actor, payout, dto.reason, false);
      if (dto.payout === 'void_returned') {
        await this.payouts.settleReturn(m, actor, voided, dto.reason);
      }
    }
    return { saved, shift };
  }
}
