import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
import { composeDocumentCode } from '../common/document-code';
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
  ) {}

  /**
   * HALF OF §3.6, AND THE HALF IS DELIBERATE. The full ceiling is
   * `min(Разом, каса за ягоду)`; the cash half needs `transfers`,
   * `cash_counts`, `crate_issuances` and `crate_returns`, none of which exist.
   *
   * SO: A PAYOUT CAN CURRENTLY EXCEED THE CASH PHYSICALLY IN THE DRAWER, and
   * nothing here can notice. Shipping the debt half means the `voided_at IS
   * NULL` filter on both histories is exercised from day one rather than being
   * retrofitted against tables full of rows. Spec §9.
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
      /**
       * THE LOCK COMES FIRST, AND THE ORDER IS THE POINT.
       *
       * The ceiling is a read-then-write over a sum across two tables, and no
       * CHECK can express «not greater than a sum over two tables». Without
       * this line two payouts in flight together — two operators, one
       * double-tapped submit button, or a client retry on a slow response —
       * both read a debt of 380, both pass, both commit, and 760 leaves the
       * drawer against a 380 debt. Nothing downstream notices, because the
       * schema has no `борг >= 0` invariant to violate.
       *
       * The `suppliers` row is a MUTEX, not data being changed. Contention is
       * per supplier: payouts to different suppliers never block each other and
       * intakes are untouched.
       *
       * SERIALIZABLE was rejected — it needs a retry loop for an expected 40001
       * and this repo has no retry infrastructure, which is more new machinery
       * than one route justifies.
       */
      await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [dto.supplier_id]);

      const shift = await this.shifts.findOpenAtPoint(pointId, m);
      if (!shift) {
        throw new ConflictException({
          message: 'No open shift at this point — open one first',
          code: 'NO_OPEN_SHIFT',
        });
      }

      // Read INSIDE the transaction, under the lock taken above — otherwise the
      // value checked is not the value that was locked.
      const debt = await this.balance.debtFor(dto.supplier_id, m);
      if (gt(dto.amount, debt)) {
        // The message NAMES the balance. §3.1 already puts that figure on the
        // operator's screen, and a refusal they cannot act on just gets retried
        // with the same number.
        throw new BadRequestException({
          message: `Payout of ${dto.amount} exceeds the supplier's balance of ${debt}`,
          code: 'PAYOUT_EXCEEDS_DEBT',
        });
      }

      const code = composeDocumentCode(point.code, 'PO', shift.business_date, dto.code);

      try {
        const payout = await m.save(
          Payout,
          m.create(Payout, {
            code,
            shift_id: shift.id,
            supplier_id: supplier.id,
            amount: dto.amount,
            paid_by_user_id: actor.sub,
          }),
        );

        await this.audit.record(
          {
            action: 'payout.created',
            actor_id: actor.sub,
            target_type: 'payout',
            target_id: payout.id,
            after: { code, amount: dto.amount, supplier_id: supplier.id },
          },
          m,
        );

        return toPayoutResponse(payout, shift);
      } catch (error) {
        throw this.translateDuplicateCode(error, dto.code, shift.business_date);
      }
    });
  }

  /**
   * §9.4, identical to `IntakesService.void` — an operator may void only a
   * document they recorded themselves, and only while the shift is open.
   *
   * VOIDING DOES NOT RETURN THE CASH. §9.3: «сторновано виплату 8 000,00 ₴ →
   * каса НЕ виросла на 8 000». Nothing here touches `return_settled_at`; that
   * is a separate, owner-only act recording that a human physically put the
   * money back.
   */
  async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<PayoutResponse> {
    // THE LOAD AND THE STATE CHECK ARE INSIDE THE TRANSACTION, under the row
    // lock `loadForWrite` takes. Checking `voided_at` before the transaction
    // opens is a check-then-write: two requests — a double-tapped button, or a
    // client retry on a slow response — both read a null `voided_at`, both
    // write, and the audit log ends up with two `payout.voided` entries naming
    // possibly different actors and reasons while `voided_by_user_id` is
    // last-writer-wins. §6.5's «409 if already voided» has to be enforced
    // where the write happens or it is not enforced at all.
    return this.dataSource.transaction(async (m) => {
      const { payout, shift } = await this.loadForWrite(actor, id, { requireAuthor: true }, m);

      if (payout.voided_at) {
        throw new ConflictException({
          message: 'That payout is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      payout.voided_at = new Date();
      payout.voided_by_user_id = actor.sub;
      payout.void_reason = dto.reason;
      const saved = await m.save(Payout, payout);

      await this.audit.record(
        {
          action: 'payout.voided',
          actor_id: actor.sub,
          target_type: 'payout',
          target_id: saved.id,
          after: { code: saved.code, amount: saved.amount },
          note: dto.reason,
        },
        m,
      );

      return toPayoutResponse(saved, shift);
    });
  }

  /**
   * The gesture that records the cash physically coming back after a void.
   *
   * OWNER ONLY, AND THAT IS THE POINT. An operator who could both void their
   * own payout and certify the refill would close, alone and unobserved, the
   * exact loop §9.3 names as «спосіб красти». The person holding the drawer is
   * not the person who attests it was refilled.
   *
   * `return_settled_at` IS NOW READ by the cash formula — `movementsSql` in
   * `point-cash.service.ts` credits a settled return to the shift whose
   * business date matches the settlement's LOCAL date (§4.2, reversed from the
   * payout's own day in 7db4619). This comment said «nothing in this slice
   * reads it» when the column shipped ahead of its consumer; both consumers
   * now exist.
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

      payout.return_settled_at = new Date();
      payout.return_settled_by_user_id = actor.sub;
      // NO AMOUNT. It always equals `payout.amount` — «внесення завжди на всю
      // суму: часткового не буває» — and a second copy is what the DBML header
      // forbids.
      payout.return_note = dto.note ?? null;
      const saved = await m.save(Payout, payout);

      await this.audit.record(
        {
          action: 'payout.return-settled',
          actor_id: actor.sub,
          target_type: 'payout',
          target_id: saved.id,
          after: { code: saved.code, amount: saved.amount },
          note: dto.note ?? null,
        },
        m,
      );

      return toPayoutResponse(saved, shift);
    });
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

  private translateDuplicateCode(error: unknown, typed: string, businessDate: string): unknown {
    const violation = error as UniqueViolation;
    if (violation?.code === '23505' && violation.constraint === 'UQ_payouts_code') {
      return new ConflictException({
        message: `Payout ${typed} has already been recorded at this point on ${businessDate}`,
        code: 'PAYOUT_CODE_TAKEN',
      });
    }
    return error;
  }
}
