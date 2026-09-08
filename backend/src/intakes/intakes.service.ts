import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Intake } from './intake.entity';
import { IntakeItem } from './intake-item.entity';
import { IntakeItemTareType } from './intake-item-tare-type.entity';
import { buildIntake, type PriceSnapshot, type TareSnapshot } from './intake-lines';
import { CreateIntakeDto } from './dto/create-intake.dto';
import { VoidDocumentDto } from './dto/void-document.dto';
import { ListIntakesQueryDto } from './dto/list-intakes.query';
import {
  IntakeDetailResponse,
  IntakeResponse,
  toIntakeDetailResponse,
  toIntakeResponse,
} from './intake.mapper';
import { Shift } from '../shifts/shift.entity';
import { ShiftsService } from '../shifts/shifts.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { GradePricesService } from '../grade-prices/grade-prices.service';
import { TareTypesService } from '../tare-types/tare-types.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { AuditService } from '../audit/audit.service';
import { composeDocumentCode } from '../common/document-code';
import { resolveWritePoint, resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

interface UniqueViolation {
  code?: string;
  constraint?: string;
}

/**
 * The first document in the system.
 *
 * NO `PATCH`, NO `DELETE`, AND NO UPDATE METHOD ON THIS CLASS. §2.7 —
 * `intakes.amount` «після проведення не міняється НІКОЛИ». §9.3 — a correction
 * is a void plus a NEW document, and «Часткового сторно немає». The only
 * mutating verb here is `void`, and it writes nothing but the trio.
 */
@Injectable()
export class IntakesService {
  constructor(
    @InjectRepository(Intake)
    private readonly repo: Repository<Intake>,
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
    private readonly suppliers: SuppliersService,
    private readonly prices: GradePricesService,
    private readonly tare: TareTypesService,
    private readonly points: CollectionPointsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * ONE POST WRITES THE WHOLE DOCUMENT, in one transaction. §2.3 — one visit is
   * one document with several lines. A partially written intake is a receipt
   * that does not match the paper in the supplier's hand.
   *
   * The ORDER inside the transaction is the design: the shift is resolved
   * first (so a closed shift fails before any snapshot is read), then the
   * snapshots (so the price stored is the price current when the row was
   * written), then every rule at once in `buildIntake`, then the insert.
   */
  async create(actor: AuthenticatedUser, dto: CreateIntakeDto): Promise<IntakeDetailResponse> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    // The point row is loaded for its `code`, which is the first segment of
    // every receipt written here. A body-supplied point that names nothing
    // would otherwise reach the FK and produce a 500 — there is no
    // QueryFailedError mapping anywhere in this backend.
    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

    // Outside the transaction on purpose: it is a read that cannot race
    // meaningfully — a supplier deactivated between here and the insert is a
    // document written a second early, not a corrupt one — and doing it first
    // means the common failure returns without ever opening a transaction.
    // `findOne` also enforces visibility, so another point's supplier is a 404.
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
      const shift = await this.shifts.findOpenAtPoint(pointId, m);
      if (!shift) {
        throw new ConflictException({
          message: 'No open shift at this point — open one first',
          code: 'NO_OPEN_SHIFT',
        });
      }

      const prices = await this.snapshotPrices(pointId, dto, m);
      const tareTypes = await this.snapshotTare(dto, m);

      // Every rule and every number, in one pure call. If this throws, the
      // transaction rolls back and no partial document exists.
      const built = buildIntake(dto.items, prices, tareTypes);

      const code = composeDocumentCode(point.code, 'IN', shift.business_date, dto.code);

      try {
        const intake = await m.save(
          Intake,
          m.create(Intake, {
            code,
            shift_id: shift.id,
            supplier_id: supplier.id,
            amount: built.amount,
            // §10.6 — «підпис під документом належить тому, хто натиснув», not
            // to whoever opened the shift.
            received_by_user_id: actor.sub,
            items: built.items.map((line) =>
              m.create(IntakeItem, {
                item_order: line.item_order,
                product_grade_id: line.product_grade_id,
                gross_kg: line.gross_kg,
                pallet_kg: line.pallet_kg,
                tare_weight_kg: line.tare_weight_kg,
                net_kg: line.net_kg,
                price: line.price,
                bonus: line.bonus,
                amount: line.amount,
                tare: line.tare.map((t) =>
                  m.create(IntakeItemTareType, {
                    tare_type_id: t.tare_type_id,
                    units: t.units,
                  }),
                ),
              }),
            ),
          }),
        );

        await this.audit.record(
          {
            action: 'intake.created',
            actor_id: actor.sub,
            target_type: 'intake',
            target_id: intake.id,
            after: { code, amount: built.amount, supplier_id: supplier.id },
          },
          m,
        );

        return toIntakeDetailResponse(intake, shift, intake.items ?? []);
      } catch (error) {
        throw this.translateDuplicateCode(error, dto.code, shift.business_date);
      }
    });
  }

  /**
   * §9.4's table, implemented row by row.
   *
   *   своя квитанція, свій день  → приймальник, з причиною
   *   квитанція минулого дня     → тільки керівник
   *   чужа квитанція             → приймальник НІКОЛИ, навіть на своїй точці
   *                                і в ту саму зміну
   *
   * THE AUTHOR CHECK IS NOT A POINT CHECK, and that distinction is the whole
   * rule: §10.6's mid-day cashier swap puts two operators' documents inside one
   * shift at one point as a matter of routine, so «my point» would let Марія
   * void Оксана's receipt.
   *
   * NOTE THE UNRESOLVED CONTRADICTION IN THE SOURCE: §10.2's summary list puts
   * «сторнувати квитанцію прийомки» under ТІЛЬКИ КЕРІВНИК. This follows §9.4,
   * the section devoted to the question. Spec §10.2 records what changes if
   * §10.2 was meant literally — one decorator, and the operator branch goes.
   */
  async void(actor: AuthenticatedUser, id: string, dto: VoidDocumentDto): Promise<IntakeResponse> {
    // THE LOAD AND THE STATE CHECK ARE INSIDE THE TRANSACTION, under a row
    // lock. Reading `voided_at` before the transaction opens is a
    // check-then-write: two requests — a double-tapped button, or a client
    // retry on a slow response — both see a null `voided_at`, both write, and
    // the audit log ends up with two `intake.voided` entries naming possibly
    // different actors and reasons while `voided_by_user_id` is
    // last-writer-wins. §9.3's «кнопки просто немає» is a claim about the
    // record, and only the lock makes it one.
    return this.dataSource.transaction(async (m) => {
      const intake = await m.findOne(Intake, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!intake) throw new NotFoundException('Intake not found');

      const shift = await this.shifts.findOneRaw(intake.shift_id, m);
      if (!shift) throw new NotFoundException('Intake not found');

      if (actor.role !== UserRole.NetworkOwner) {
        // 404, not 403, for another point — these rows carry a real person's
        // name and a money amount, so the id must not be confirmed.
        if (actor.collection_point_id !== shift.collection_point_id) {
          throw new NotFoundException('Intake not found');
        }
        if (intake.received_by_user_id !== actor.sub) {
          throw new ForbiddenException({
            message: 'You can only void a document you recorded yourself',
            code: 'NOT_YOUR_DOCUMENT',
          });
        }
        if (shift.closed_at) {
          throw new ForbiddenException({
            message: 'That shift is closed — ask the network owner to void it',
            code: 'SHIFT_CLOSED',
          });
        }
      }

      if (intake.voided_at) {
        throw new ConflictException({
          message: 'That intake is already voided',
          code: 'ALREADY_VOIDED',
        });
      }

      // NO BALANCE CHECK HERE, DELIBERATELY. Voiding an intake is the only way
      // a supplier's debt goes negative and it is allowed — «сторно КВИТАНЦІЇ
      // ЄДИНИЙ шлях у мінус, і воно ДОЗВОЛЕНЕ, з попередженням». A floor check
      // would contradict «інваріанта борг >= 0 в цій схемі теж немає».
      intake.voided_at = new Date();
      intake.voided_by_user_id = actor.sub;
      intake.void_reason = dto.reason;
      const saved = await m.save(Intake, intake);

      await this.audit.record(
        {
          action: 'intake.voided',
          actor_id: actor.sub,
          target_type: 'intake',
          target_id: saved.id,
          before: { voided_at: null },
          after: { voided_at: saved.voided_at, code: saved.code, amount: saved.amount },
          note: dto.reason,
        },
        m,
      );

      return toIntakeResponse(saved, shift);
    });
  }

  /**
   * The journal. §11.5 — «Журнал прийомки — усі квитанції поспіль, із
   * фільтрами», and §9.3 keeps a voided receipt in it «НАЗАВЖДИ з печаткою
   * СТОРНОВАНО», which is why `include_voided` defaults to true.
   *
   * THE POINT SCOPE IS A JOIN. `intakes` has no `collection_point_id`; it comes
   * from the shift (§2.3). Every later query over this table has to remember
   * that.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListIntakesQueryDto,
  ): Promise<Paginated<IntakeResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo
      .createQueryBuilder('i')
      .innerJoinAndMapOne('i.shift', Shift, 's', 's.id = i.shift_id');

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (query.shift_id) qb.andWhere('i.shift_id = :shiftId', { shiftId: query.shift_id });
    if (query.supplier_id) {
      qb.andWhere('i.supplier_id = :supplierId', { supplierId: query.supplier_id });
    }
    if (query.from) qb.andWhere('s.business_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('s.business_date <= :to', { to: query.to });
    if (!query.include_voided) qb.andWhere('i.voided_at IS NULL');

    const [data, total] = await qb
      .orderBy('i.created_at', 'DESC')
      // Tiebreaker: two receipts punched in the same millisecond are ordinary
      // at a busy point, and Postgres promises no order among ties — without
      // this, paging could repeat or drop one.
      .addOrderBy('i.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();

    return {
      data: data.map((i) => toIntakeResponse(i, i.shift as Shift)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<IntakeDetailResponse> {
    const intake = await this.repo.findOne({ where: { id } });
    if (!intake) throw new NotFoundException('Intake not found');

    const shift = await this.shifts.findOneRaw(intake.shift_id);
    if (!shift) throw new NotFoundException('Intake not found');

    if (
      actor.role !== UserRole.NetworkOwner &&
      actor.collection_point_id !== shift.collection_point_id
    ) {
      throw new NotFoundException('Intake not found');
    }

    const items = await this.repo.manager.find(IntakeItem, {
      where: { intake_id: intake.id },
      relations: { tare: true },
    });

    return toIntakeDetailResponse(intake, shift, items);
  }

  /** §2.8 — the price is a SNAPSHOT of the row current at this moment, read
   *  inside the transaction so what is stored is what was current. §4.5 makes
   *  a missing row a refusal, raised by `buildIntake` naming the grade. */
  private async snapshotPrices(
    pointId: string,
    dto: CreateIntakeDto,
    m: EntityManager,
  ): Promise<Map<string, PriceSnapshot>> {
    const gradeIds = [...new Set(dto.items.map((i) => i.product_grade_id))];
    const rows = await Promise.all(gradeIds.map((g) => this.prices.currentFor(pointId, g, m)));

    const prices = new Map<string, PriceSnapshot>();
    rows.forEach((row) => {
      if (row) {
        prices.set(row.product_grade_id, {
          base_price: row.base_price,
          max_markup: row.max_markup,
          max_discount: row.max_discount,
        });
      }
    });
    return prices;
  }

  /** §2.5 — «вага тари підставляється сама». */
  private async snapshotTare(
    dto: CreateIntakeDto,
    m: EntityManager,
  ): Promise<Map<string, TareSnapshot>> {
    const tareIds = [...new Set(dto.items.flatMap((i) => i.tare.map((t) => t.tare_type_id)))];
    const rows = await this.tare.findManyRaw(tareIds, m);
    return new Map(rows.map((t) => [t.id, { id: t.id, weight_kg: t.weight_kg }]));
  }

  /**
   * The composed code collides ONLY on same point + same day + same typed
   * number, which is a genuine duplicate entry — so the message must say that.
   * A generic «duplicate key» invites the operator to retype the identical
   * number and be refused again.
   */
  private translateDuplicateCode(error: unknown, typed: string, businessDate: string): unknown {
    const violation = error as UniqueViolation;
    if (violation?.code === '23505' && violation.constraint === 'UQ_intakes_code') {
      return new ConflictException({
        message: `Receipt ${typed} has already been recorded at this point on ${businessDate}`,
        code: 'INTAKE_CODE_TAKEN',
      });
    }
    return error;
  }
}
