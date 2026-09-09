import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transfer } from './transfer.entity';
import { TransferStatus } from './transfer-status.enum';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { DisputeTransferDto } from './dto/dispute-transfer.dto';
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

  /**
   * §7.9 step 4а — «Прийняв». OPERATOR AT THAT POINT ONLY.
   *
   * No body, and that is a rule: §7.9 gives the point «рівно дві дії» and
   * «поля суми в точки НЕМАЄ». A point that could type a number here would
   * never press the other button, and the dispute record — the only thing that
   * reaches the owner — would never be written.
   */
  async accept(actor: AuthenticatedUser, id: string): Promise<TransferResponse> {
    return this.transition(actor, id, 'transfer.accepted', (transfer, now, today) => {
      transfer.status = TransferStatus.Accepted;
      this.stampArrival(transfer, actor, now, today);
      return { after: { status: TransferStatus.Accepted, accepted_date: today }, note: null };
    });
  }

  /**
   * §7.9 step 4б — «Не сходиться». OPERATOR AT THAT POINT ONLY.
   */
  async dispute(
    actor: AuthenticatedUser,
    id: string,
    dto: DisputeTransferDto,
  ): Promise<TransferResponse> {
    return this.transition(actor, id, 'transfer.disputed', (transfer, now, today) => {
      transfer.status = TransferStatus.Disputed;
      this.stampArrival(transfer, actor, now, today);
      transfer.reported_cash = dto.reported_cash;
      transfer.reported_crates = dto.reported_crates;
      transfer.dispute_note = dto.dispute_note.trim();
      return {
        after: {
          status: TransferStatus.Disputed,
          accepted_date: today,
          reported_cash: dto.reported_cash,
          reported_crates: dto.reported_crates,
        },
        note: dto.dispute_note,
      };
    });
  }

  /**
   * BOTH POINT ACTIONS STAMP THE ARRIVAL, and this shared helper is what makes
   * that visible rather than a coincidence of two code paths.
   *
   * «Прийняв» and «Не сходиться» record the same physical fact — the money got
   * here today — and differ only on whether the amount matched. §7.9's own
   * reason for using the acceptance day at all is «машина виїхала ввечері,
   * точка порахувала вранці, і гроші не мають лежати в касі за день, коли їх
   * фізично не було»: the point counted the disputed money on the 5th, so it
   * belongs in the drawer from the 5th.
   *
   * Without this on the dispute path, the `cash_counts` formula — whose outer
   * filter is `accepted_date <= D` — can never see a disputed transfer, and
   * both of its `disputed` branches are dead code. Spec §6.2.
   */
  private stampArrival(
    transfer: Transfer,
    actor: AuthenticatedUser,
    now: Date,
    today: string,
  ): void {
    transfer.accepted_by_user_id = actor.sub;
    transfer.accepted_at = now;
    transfer.accepted_date = today;
  }

  /**
   * The two point actions share everything but their body: authority, the row
   * lock, the state check and the audit entry.
   *
   * THE LOAD AND THE STATE CHECK ARE INSIDE THE TRANSACTION, under the row
   * lock, exactly as `PayoutsService.void` does and for the same reason.
   * Checking `status` before the transaction opens is a check-then-write: two
   * operators at one point — or one double-tapped button — both read `sent`,
   * both write, and `accepted_by_user_id` becomes last-writer-wins while the
   * audit log gains two entries naming different people. §6.11's 409 has to be
   * enforced where the write happens or it is not enforced at all.
   */
  private async transition(
    actor: AuthenticatedUser,
    id: string,
    action: 'transfer.accepted' | 'transfer.disputed',
    apply: (
      transfer: Transfer,
      now: Date,
      today: string,
    ) => { after: Record<string, unknown>; note: string | null },
  ): Promise<TransferResponse> {
    // §7.9 with §10.3 — «керівник не може зробити це за неї». The owner is
    // refused OUTRIGHT here, which inverts this codebase's usual shape.
    if (actor.role !== UserRole.PointOperator) {
      throw new ForbiddenException({
        message: 'Only the collection point may accept or dispute a transfer',
        code: 'POINT_OPERATOR_ONLY',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const transfer = await m.findOne(Transfer, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!transfer) throw new NotFoundException('Transfer not found');

      // A 404, not a 403 — matching ShiftsService.loadVisible. Another point's
      // delivery is not this operator's business to know about.
      if (transfer.collection_point_id !== actor.collection_point_id) {
        throw new NotFoundException('Transfer not found');
      }

      if (transfer.voided_at) {
        throw new ConflictException({
          message: 'That transfer is voided',
          code: 'TRANSFER_VOIDED',
        });
      }
      if (transfer.status !== TransferStatus.Sent) {
        throw new ConflictException({
          message: 'That transfer has already been answered',
          code: 'TRANSFER_ALREADY_ANSWERED',
        });
      }

      const now = this.time.now().toJSDate();
      const today = this.time.now().toISODate()!;
      const { after, note } = apply(transfer, now, today);
      const saved = await m.save(Transfer, transfer);

      await this.audit.record(
        {
          action,
          actor_id: actor.sub,
          target_type: 'transfer',
          target_id: saved.id,
          after,
          note,
        },
        m,
      );

      return toTransferResponse(saved);
    });
  }
}
