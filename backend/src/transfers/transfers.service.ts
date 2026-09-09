import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transfer } from './transfer.entity';
import { TransferStatus } from './transfer-status.enum';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransferResponse, toTransferResponse } from './transfer.mapper';
import { AuditService } from '../audit/audit.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { TimeService } from '../time/time.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * §7.9 — money and empty crates from the base to a point.
 *
 * THIS SERVICE DOES NOT INJECT `ShiftsService`, AND THAT IS THE RULE RATHER
 * THAN AN OMISSION. `transfers` is the only money document carrying its own
 * point and its own date; accepting one requires no open shift (spec §6.4).
 * The carrier arrives when they arrive.
 *
 * THE OWNER MAY NOT ACCEPT OR DISPUTE, which inverts this codebase's usual
 * shape where an owner may do anything an operator may. §7.9 step 3 with
 * §10.3: «Натиснути "Прийняв" може ТІЛЬКИ точка — керівник не може зробити це
 * за неї.» A signature under money must belong to whoever physically counted
 * it, and an owner pressing it from an office is a signature under money they
 * never touched.
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly repo: Repository<Transfer>,
    private readonly points: CollectionPointsService,
    private readonly audit: AuditService,
    private readonly time: TimeService,
    private readonly dataSource: DataSource,
  ) {}

  /** §7.9 step 1 — OWNER ONLY. */
  async create(actor: AuthenticatedUser, dto: CreateTransferDto): Promise<TransferResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may send a transfer',
        code: 'OWNER_ONLY',
      });
    }

    const point = await this.points.findOneRaw(dto.collection_point_id);
    if (!point) throw new NotFoundException('Collection point not found');

    // THE ACTIVE CHECK BINDS `create` ONLY. A transfer already in flight to a
    // point deactivated since it was sent stays acceptable, resolvable and
    // voidable — the money physically travelled, and refusing the acceptance
    // would strand it in `sent` forever with no verb able to touch it. §5.6's
    // deactivation stops new business; it does not abandon open documents.
    if (!point.is_active) {
      throw new BadRequestException({
        message: 'That collection point is deactivated',
        code: 'POINT_INACTIVE',
      });
    }

    // `kind` IS DELIBERATELY NOT CHECKED. §7.3's «своєї каси в бази немає» is
    // about the SENDING side — creating a transfer debits no base account,
    // because the network's money comes from outside the system entirely. §4.8
    // makes the warehouse an ordinary intake point that buys berries and
    // therefore pays suppliers, and §7.3's own closed list makes an accepted
    // transfer the only way to refill any drawer. Refusing on `kind` would
    // block that point's only cash source, and the failure would surface as an
    // unexplainable growing shortage rather than as an error. Spec §8.3.

    if (dto.correction_of_transfer_id) {
      const original = await this.repo.findOne({
        where: { id: dto.correction_of_transfer_id },
      });
      if (!original) throw new NotFoundException('The transfer being corrected was not found');
      // A correction pointing at another point's document would silently move
      // money between drawers — the one cross-point write this table permits
      // by shape and must not permit in fact.
      if (original.collection_point_id !== dto.collection_point_id) {
        throw new BadRequestException({
          message: 'A correction must name a transfer at the same collection point',
          code: 'CORRECTION_POINT_MISMATCH',
        });
      }
    }

    const transfer = await this.repo.save(
      this.repo.create({
        collection_point_id: dto.collection_point_id,
        cash: dto.cash,
        crates: dto.crates,
        carrier: dto.carrier.trim(),
        sent_by_user_id: actor.sub,
        sent_at: this.time.now().toJSDate(),
        status: TransferStatus.Sent,
        correction_of_transfer_id: dto.correction_of_transfer_id ?? null,
        // Explicit, not left implicit: `repo.save()` returns the in-memory
        // entity rather than re-reading the row (the same hazard
        // `CanonicalDecimal`'s doc comment describes), so the response this
        // request gets back must already carry the nulls a fresh SELECT would
        // — a freshly sent transfer has accepted, disputed, resolved and void
        // nothing yet.
        accepted_by_user_id: null,
        accepted_date: null,
        accepted_at: null,
        reported_cash: null,
        reported_crates: null,
        dispute_note: null,
        resolved_cash: null,
        resolved_crates: null,
        resolved_by_user_id: null,
        resolved_at: null,
        voided_at: null,
        voided_by_user_id: null,
        void_reason: null,
      }),
    );

    await this.audit.record({
      action: 'transfer.created',
      actor_id: actor.sub,
      target_type: 'transfer',
      target_id: transfer.id,
      after: {
        collection_point_id: transfer.collection_point_id,
        cash: transfer.cash,
        crates: transfer.crates,
        carrier: transfer.carrier,
      },
    });

    return toTransferResponse(transfer);
  }
}
