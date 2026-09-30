import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Intake } from '../intake.entity';
import { VoidDocumentDto } from '../dto/void-document.dto';
import { IntakeResponse, toIntakeResponse } from '../intake.mapper';
import { LoadVisibleIntakeQuery } from '../queries/load-visible-intake.query';
import { IntakeDetailQuery } from '../queries/intake-detail.query';
import { Shift } from '../../shifts/shift.entity';
import { PayoutWriter } from '../../payouts/services/payout-writer';
import { AllocationsService } from '../../supplier-balance/services/allocations';
import { CratesService } from '../../crates/crates.service';
import { AuditService } from '../../audit/audit.service';
import { assertCanVoid } from '../../auth/access/document-access';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

/**
 * §9.4 void. Lock order: supplier → intake → payout. A bound payout always goes too, cash back
 * at once (2026-09-28). A closed shift refuses everyone, the owner included (2026-09-30): the
 * owner reopens it first. §10.2 lists receipt voids as owner-only; §9.4 (followed here) allows
 * the author.
 */
const SHIFT_CLOSED = 'That shift is closed — the network owner must reopen it first';

@Injectable()
export class VoidIntakeCommand {
  constructor(
    private readonly dataSource: DataSource,
    private readonly visible: LoadVisibleIntakeQuery,
    private readonly allocations: AllocationsService,
    private readonly payouts: PayoutWriter,
    private readonly crates: CratesService,
    private readonly audit: AuditService,
    private readonly detail: IntakeDetailQuery,
  ) {}

  async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<IntakeResponse> {
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
    dto: VoidDocumentDto,
  ): Promise<{ saved: Intake; shift: Shift }> {
    const { intake, shift } = await this.visible.load(actor, id, m);
    assertCanVoid(actor, { authorId: intake.received_by_user_id, shift }, SHIFT_CLOSED);
    if (shift.closed_at) {
      throw new ForbiddenException({ message: SHIFT_CLOSED, code: 'SHIFT_CLOSED' });
    }
    if (intake.voided_at) {
      throw new ConflictException({
        message: 'That intake is already voided',
        code: 'ALREADY_VOIDED',
      });
    }

    // §3.5: a bound payout shares the receipt's author and shift, so the check above covers it.
    const payout = await this.payouts.findLiveBoundToIntake(m, intake.id);

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
        },
        note: dto.reason,
      },
      m,
    );

    // Spec §8.3 — the crates that came back WITH this receipt did not come back if the receipt
    // did not happen. Relies on the supplier lock `withinSupplierLedger` already holds.
    await this.crates.voidReturnForIntake(m, { actor, intakeId: saved.id, reason: dto.reason });

    if (payout) await this.payouts.void(m, actor, payout, dto.reason, true);
    return { saved, shift };
  }
}
