import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
