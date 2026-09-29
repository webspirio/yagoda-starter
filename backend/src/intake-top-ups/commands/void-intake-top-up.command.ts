import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  async void(
    actor: AuthenticatedUser,
    id: string,
    dto: VoidDocumentDto,
  ): Promise<IntakeTopUpResponse> {
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
        const topUp = await m.findOne(IntakeTopUp, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!topUp) throw new NotFoundException('Intake top-up not found');
        if (topUp.voided_at) {
          throw new ConflictException({
            message: 'That top-up is already voided',
            code: 'ALREADY_VOIDED',
          });
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
