import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { Payout } from './payout.entity';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { SettleReturnDto } from './dto/settle-return.dto';
import { ListPayoutsQueryDto } from './dto/list-payouts.query';
import { PayoutResponse, toPayoutResponse } from './payout.mapper';
import { VoidDocumentDto } from '../intakes/dto/void-document.dto';
import { Shift } from '../shifts/shift.entity';
import { ShiftsService } from '../shifts/shifts.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { SupplierBalanceService } from '../supplier-balance/supplier-balance.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { AuditService } from '../audit/audit.service';
import { PointCashService } from '../point-cash/point-cash.service';
import { AllocationsService } from '../supplier-balance/allocations.service';
import { nextDocumentCode } from '../common/document-code';
import { gt, isZero } from '../common/money';
import { resolveWritePoint, resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

interface UniqueViolation {
  code?: string;
  constraint?: string;
}

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

@Injectable()
export class PayoutsService {
  constructor(
    @InjectRepository(Payout)
    private readonly repo: Repository<Payout>,
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
    private readonly suppliers: SuppliersService,
    private readonly balance: SupplierBalanceService,
    private readonly points: CollectionPointsService,
    private readonly audit: AuditService,
    private readonly pointCash: PointCashService,
    private readonly allocations: AllocationsService,
  ) {}

  /**
   * §3.6 IN FULL, since 2026-09-21. The ceiling is `min(Разом, каса за ягоду)`;
   * for years the cash half was unreachable because `transfers`, `cash_counts`
   * and the crate books did not exist. They do now, `PointCashService.cashFor`
   * reads the drawer inside a caller's transaction, and `writePayout` below is
   * the ONE place both halves are enforced — for this route and for a payout
   * written with a receipt (`IntakesService.create`).
   */
  async create(actor: AuthenticatedUser, dto: CreatePayoutDto): Promise<PayoutResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    // Spec §8.6 — stricter than §3.7's «будь-яка сума від 0 до "Разом"». A zero
    // payout is a receipt for handing over nothing; §3.7's «видано 0,00 ₴»
    // describes an intake with NO payout document, not a payout row of zero.
    //
    // `CHK_payouts_amount` is the real guarantee, and this is only here to make
    // the refusal a 400 with a sentence rather than a 500: there is no
    // QueryFailedError mapping anywhere in this backend, so a constraint
    // violation that no service pre-check catches reaches the client as an
    // opaque server error. Caught by the pipeline spec doing exactly that.
    if (isZero(dto.amount)) {
      throw new BadRequestException({
        message: 'A payout must hand over some money',
        code: 'PAYOUT_AMOUNT_ZERO',
      });
    }

    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

    const supplier = await this.suppliers.findOne(actor, dto.supplier_id);
    if (supplier.collection_point_id !== pointId) {
      throw new NotFoundException('Supplier not found');
    }
    if (!supplier.is_active) {
      throw new BadRequestException({
        message: 'That supplier is deactivated',
        code: 'SUPPLIER_INACTIVE',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const { payout, shift } = await this.writePayout(m, {
        actor,
        pointId,
        pointCode: point.code,
        supplierId: supplier.id,
        amount: dto.amount,
        intakeId: null,
      });
      await this.allocations.allocate(m, supplier.id);
      return toPayoutResponse(payout, shift);
    });
  }

  /** THE payout writer, inside the caller's transaction (standalone create and §2.1 ⑥
   *  reception). Lock order: supplier (already held on the reception path) → open shift →
   *  debt → PO code lock → cash → insert. The supplier row is the per-supplier mutex behind
   *  both ceilings; SERIALIZABLE was rejected (no retry infrastructure). Callers have checked
   *  point, supplier activity and supplier-at-point. Callers run `allocate`. */
  async writePayout(
    m: EntityManager,
    { actor, pointId, pointCode, supplierId, amount, intakeId }: WritePayoutInput,
  ): Promise<{ payout: Payout; shift: Shift }> {
    await this.allocations.lockSupplier(m, supplierId);

    const shift = await this.shifts.findOpenAtPoint(pointId, m);
    if (!shift) {
      throw new ConflictException({
        message: 'No open shift at this point — open one first',
        code: 'NO_OPEN_SHIFT',
      });
    }

    // Read INSIDE the transaction, under the lock taken above — otherwise the
    // value checked is not the value that was locked. When the caller has
    // just inserted an intake in this same transaction, this debt already
    // includes it: that is how «Разом» (§3.1) reaches the ceiling.
    const debt = await this.balance.debtFor(supplierId, m);
    if (gt(amount, debt)) {
      // The message NAMES the balance. §3.1 already puts that figure on the
      // operator's screen, and a refusal they cannot act on just gets retried
      // with the same number.
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

    // The other half of §3.6: «у поле підставляється 1 616,10 ₴, а не 5 497,37».
    // A negative drawer (reachable — the owner may lower a target after the
    // fact) admits nothing, and that is correct: the berries are taken, the
    // money lands in the supplier's balance, and a transfer restores the cash.
    //
    // Cash is shift-wide: read it under the PO code lock (the shift mutex),
    // not only the supplier lock — PR #137.
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
      throw this.translateDuplicateCode(error, code);
    }
  }

  /** §9.4 as in `IntakesService.void`. Voiding does not return the cash (§9.3). */
  async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<PayoutResponse> {
    // Load and state check under the row lock, or a double tap audits twice.
    return this.dataSource.transaction(async (m) => {
      const supplierId = await this.lockSupplierOf(m, id);
      const { payout, shift } = await this.loadForWrite(actor, id, { requireAuthor: true }, m);
      if (payout.voided_at) {
        throw new ConflictException({
          message: 'That payout is already voided',
          code: 'ALREADY_VOIDED',
        });
      }
      const voided = await this.voidWithin(m, actor, payout, dto.reason);
      await this.allocations.allocate(m, supplierId);
      return toPayoutResponse(voided, shift);
    });
  }

  /** Unlocked stub read (a missing id 404s before any lock), then the supplier lock — always first. */
  private async lockSupplierOf(m: EntityManager, id: string): Promise<string> {
    const stub = await m.findOne(Payout, { where: { id } });
    if (!stub) throw new NotFoundException('Payout not found');
    await this.allocations.lockSupplier(m, stub.supplier_id);
    return stub.supplier_id;
  }

  /** The live payout issued with this receipt, locked for the caller's transaction. */
  findLiveBoundForUpdate(m: EntityManager, intakeId: string): Promise<Payout | null> {
    return m.findOne(Payout, {
      where: { intake_id: intakeId, voided_at: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
  }

  /** Voids a payout the caller loaded, locked and authorised, and releases its allocations. The caller allocates. */
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

  /**
   * Owner-only because whoever holds the drawer must not attest its refill (§9.3).
   * `return_settled_at` is read by `point-cash`'s `movementsSql`.
   * No amount — always the whole payout.
   */
  async settleReturn(
    actor: AuthenticatedUser,
    id: string,
    dto: SettleReturnDto,
  ): Promise<PayoutResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may record a returned payout',
        code: 'OWNER_ONLY',
      });
    }

    // Under the lock, for the reason `void` states — and it matters more here:
    // this row is the owner's attestation that the cash went back in the
    // drawer, and two differently-attributed records of one attestation is the
    // ambiguity §9.3 is entirely about.
    return this.dataSource.transaction(async (m) => {
      const { payout, shift } = await this.loadForWrite(actor, id, { requireAuthor: false }, m);

      if (!payout.voided_at) {
        throw new ConflictException({
          message: 'Only a voided payout can have its cash returned',
          code: 'PAYOUT_NOT_VOIDED',
        });
      }
      if (payout.return_settled_at) {
        throw new ConflictException({
          message: 'That payout’s cash has already been recorded as returned',
          code: 'RETURN_ALREADY_SETTLED',
        });
      }

      return toPayoutResponse(
        await this.settleReturnWithin(m, actor, payout, dto.note ?? null),
        shift,
      );
    });
  }

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

  async list(
    actor: AuthenticatedUser,
    query: ListPayoutsQueryDto,
  ): Promise<Paginated<PayoutResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo
      .createQueryBuilder('p')
      .innerJoinAndMapOne('p.shift', Shift, 's', 's.id = p.shift_id');

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (query.shift_id) qb.andWhere('p.shift_id = :shiftId', { shiftId: query.shift_id });
    if (query.supplier_id) {
      qb.andWhere('p.supplier_id = :supplierId', { supplierId: query.supplier_id });
    }
    if (query.from) qb.andWhere('s.business_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('s.business_date <= :to', { to: query.to });
    if (!query.include_voided) qb.andWhere('p.voided_at IS NULL');

    const [data, total] = await qb
      .orderBy('p.created_at', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();

    return {
      data: data.map((p) => toPayoutResponse(p, p.shift as Shift)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<PayoutResponse> {
    const { payout, shift } = await this.loadVisible(actor, id);
    return toPayoutResponse(payout, shift);
  }

  private async loadVisible(
    actor: AuthenticatedUser,
    id: string,
    manager?: EntityManager,
  ): Promise<{ payout: Payout; shift: Shift }> {
    // A `manager` means the caller is about to WRITE this row, so the read
    // takes `FOR UPDATE` on it: the state the caller checks is then the state
    // it writes against. The read path passes no manager and takes no lock.
    const payout = manager
      ? await manager.findOne(Payout, { where: { id }, lock: { mode: 'pessimistic_write' } })
      : await this.repo.findOne({ where: { id } });
    if (!payout) throw new NotFoundException('Payout not found');

    const shift = await this.shifts.findOneRaw(payout.shift_id, manager);
    if (!shift) throw new NotFoundException('Payout not found');

    // 404, not 403 — these rows carry a real person's name and a money amount.
    if (
      actor.role !== UserRole.NetworkOwner &&
      actor.collection_point_id !== shift.collection_point_id
    ) {
      throw new NotFoundException('Payout not found');
    }

    return { payout, shift };
  }

  /**
   * §9.4's table for a mutating verb. `requireAuthor` is false for
   * `settleReturn`, which is owner-only anyway and therefore never reaches the
   * operator branch.
   */
  private async loadForWrite(
    actor: AuthenticatedUser,
    id: string,
    { requireAuthor }: { requireAuthor: boolean },
    manager: EntityManager,
  ): Promise<{ payout: Payout; shift: Shift }> {
    const { payout, shift } = await this.loadVisible(actor, id, manager);

    if (actor.role !== UserRole.NetworkOwner) {
      // «чужа квитанція → приймальник НІКОЛИ, навіть на своїй точці і в ту саму
      // зміну» — an AUTHOR check, not a point check, because §10.6's mid-day
      // cashier swap puts two operators' documents in one shift routinely.
      if (requireAuthor && payout.paid_by_user_id !== actor.sub) {
        throw new ForbiddenException({
          message: 'You can only void a document you recorded yourself',
          code: 'NOT_YOUR_DOCUMENT',
        });
      }
      // «квитанція минулого дня → тільки керівник».
      if (shift.closed_at) {
        throw new ForbiddenException({
          message: 'That shift is closed — ask the network owner',
          code: 'SHIFT_CLOSED',
        });
      }
    }

    return { payout, shift };
  }

  /** The payout twin of `IntakesService.translateDuplicateCode` — unreachable
   *  now that the number is generated under a lock, and kept for the one case
   *  that survives it: a shift numbered by hand before 2026-09-18 that already
   *  holds the code this count composes. See that method for the full reasoning. */
  private translateDuplicateCode(error: unknown, code: string): unknown {
    const violation = error as UniqueViolation;
    if (violation?.code === '23505' && violation.constraint === 'UQ_payouts_code') {
      return new ConflictException({
        message: `Payout ${code} already exists — this shift was numbered by hand before the server took it over`,
        code: 'PAYOUT_CODE_TAKEN',
      });
    }
    return error;
  }
}
