import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IntakeTopUp } from './intake-top-up.entity';
import { CreateIntakeTopUpDto } from './dto/create-intake-top-up.dto';
import { IntakeTopUpResponse, toIntakeTopUpResponse } from './intake-top-up.mapper';
import { Intake } from '../intakes/intake.entity';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { AuditService } from '../audit/audit.service';
import { gt } from '../common/money';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * «Фантомний залишок» (#61) — the owner's third source of supplier debt.
 *
 * THIS SERVICE NEVER LOOKS AT A SHIFT, and the absence is the feature. A
 * top-up carries no `shift_id`, so no shift rule reaches it: the owner writes
 * one against a receipt whose shift closed days ago, with no shift open
 * anywhere in the network. That is the scenario #61 describes — «після того,
 * як він уже здав» — and it is why the row hangs off an intake rather than
 * off a shift of its own, which would have forced an open shift onto an owner
 * who is not at the point.
 *
 * IT ALSO TAKES NO SUPPLIER LOCK, and that is safe only because the amount is
 * strictly positive. `PayoutsService.create` reads the ceiling under a lock on
 * the SUPPLIER row; this insert never touches that row, so the two do not
 * serialise. A payout racing a top-up computes a ceiling that is stale-LOW —
 * it refuses money that is now owed, which is retryable and never an
 * overpayment. Anyone making this column signed must add the lock in the same
 * change; see the spec's §7.4.
 */
@Injectable()
export class IntakeTopUpsService {
  constructor(
    @InjectRepository(IntakeTopUp)
    private readonly repo: Repository<IntakeTopUp>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(
    actor: AuthenticatedUser,
    dto: CreateIntakeTopUpDto,
  ): Promise<IntakeTopUpResponse> {
    // Owner only. #61 is written «Як керівник», and the amount is a pricing
    // decision with no operator scenario. The controller's @Auth already says
    // this; the service says it again because the service is what a later
    // internal caller would reach.
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner can top up a receipt',
        code: 'OWNER_ONLY',
      });
    }

    // `gt` and not `>`: `amount` is a decimal STRING and JS comparison on
    // strings would make '9.00' greater than '10.00' (foundation §5.1).
    if (!gt(dto.amount, '0')) {
      throw new BadRequestException({
        message: 'A top-up must add some money to the debt',
        code: 'TOP_UP_AMOUNT_NOT_POSITIVE',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const intake = await m.findOne(Intake, { where: { id: dto.intake_id } });
      if (!intake) throw new NotFoundException('Intake not found');

      // NO CHECK ON `intake.voided_at`. Writing against a voided receipt is
      // legal and pointless: the row simply will not count, and the response
      // says so through `counts_toward_balance`. Refusing it would be a rule
      // the balance formula does not have.
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
  }

  /**
   * §9.3 — a document is never edited. A wrong amount or a wrong reason is
   * corrected by voiding this row and writing a new one; there is no PATCH and
   * there never will be.
   *
   * OWNER ONLY, unlike `IntakesService.void`, which lets an operator void
   * their own receipt in their own open shift (§9.4). The asymmetry is not an
   * oversight: an operator never creates one of these, so «своя квитанція»
   * has no meaning here, and there is no shift whose closure could gate it.
   *
   * THE LOAD AND THE STATE CHECK ARE INSIDE THE TRANSACTION, under a row lock,
   * for the reason `IntakesService.void` spells out: reading `voided_at`
   * before the transaction opens is a check-then-write, and a double-tapped
   * button would write two audit entries naming possibly different reasons
   * while `voided_by_user_id` is last-writer-wins.
   */
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

      const intake = await m.findOne(Intake, { where: { id: topUp.intake_id } });
      if (!intake) throw new NotFoundException('Intake top-up not found');

      topUp.voided_at = new Date();
      topUp.voided_by_user_id = actor.sub;
      topUp.void_reason = dto.reason.trim();
      const saved = await m.save(IntakeTopUp, topUp);

      await this.audit.record(
        {
          action: 'intake-top-up.voided',
          actor_id: actor.sub,
          target_type: 'intake-top-up',
          target_id: saved.id,
          before: { voided_at: null },
          after: { voided_at: saved.voided_at, amount: saved.amount, intake_id: intake.id },
          note: saved.void_reason,
        },
        m,
      );

      return toIntakeTopUpResponse(saved, intake);
    });
  }
}
