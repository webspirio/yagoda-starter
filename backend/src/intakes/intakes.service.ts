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
import {
  buildIntake,
  type BuiltIntake,
  type PriceSnapshot,
  type TareSnapshot,
} from './intake-lines';
import { CreateIntakeDto } from './dto/create-intake.dto';
import { PreviewIntakeDto } from './dto/preview-intake.dto';
import { VoidDocumentDto } from './dto/void-document.dto';
import { ListIntakesQueryDto } from './dto/list-intakes.query';
import {
  IntakeCrateReturnRow,
  IntakeDetailResponse,
  IntakeResponse,
  PreviewIntakeResponse,
  toIntakeDetailResponse,
  toIntakeResponse,
  toPreviewIntakeResponse,
} from './intake.mapper';
import { Shift } from '../shifts/shift.entity';
import { ShiftsService } from '../shifts/shifts.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { Supplier } from '../suppliers/supplier.entity';
import type { SupplierResponse } from '../suppliers/supplier.mapper';
import { User } from '../users/user.entity';
import { displayNameOf } from '../users/display-name';
import { ROW_EXTRAS_SQL, rowExtrasSelects, type IntakeRowExtras } from './intake-row-extras';
import { GradePricesService } from '../grade-prices/grade-prices.service';
import { TareTypesService } from '../tare-types/tare-types.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import type { CollectionPoint } from '../collection-points/collection-point.entity';
import { AuditService } from '../audit/audit.service';
import { PayoutsService } from '../payouts/payouts.service';
import { Payout } from '../payouts/payout.entity';
import { CratesService } from '../crates/crates.service';
import { nextDocumentCode } from '../common/document-code';
import { isZero } from '../common/money';
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
    private readonly payouts: PayoutsService,
    private readonly crates: CratesService,
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
   *
   * `resolveTarget` and `compute` are the steps `preview` SHARES — the point
   * and supplier outside the transaction, the shift, snapshots and rules
   * inside it — so a preview and the document that follows it are the same
   * reads in the same order, and the only thing this method adds is the write.
   *
   * Since 2026-09-21 the same transaction may also write the payout handed
   * over with the receipt (`paid_amount`, §2.1 ⑥) — see
   * `PayoutsService.writePayout`, which owns both ceilings. Since 2026-09-24
   * it may also write the return of OUR crates the supplier brought back
   * (`returned_crates`, spec §8.3) — see `CratesService.writeReturn`, which
   * owns FIFO and the crates-book check. Any refusal from either rolls back
   * the WHOLE receipt: no receipt without its return, no return without its
   * receipt.
   *
   * LOCK ORDER — ONE ORDER FOR EVERY RECEIPT, crates or not:
   *
   *   supplier row `FOR UPDATE` → `intakes` advisory (`nextDocumentCode`)
   *     → [crate return: supplier re-lock, a no-op]
   *     → [payout: supplier re-lock, a no-op → `payouts` advisory]
   *
   * The supplier row is taken FIRST, before `compute` and before the intake
   * insert, because a crate return must hold it before any document row
   * («supplier before documents», the order `returnCrates`, `voidIssuance`
   * and `voidReturn` share). It is taken UNCONDITIONALLY — not only when
   * `returned_crates > 0` — because a conditional lock would give two
   * concurrent receipts at one shift for one supplier OPPOSITE orders: the
   * crates receipt holding the supplier row and waiting on the `intakes`
   * advisory lock, while a plain receipt holds that advisory lock and waits on
   * the supplier row (its intake INSERT needs `FOR KEY SHARE` on it for the
   * FK, which conflicts with `FOR UPDATE`). That is a deadlock, not a wait.
   * With one order, the worst case is two receipts for the SAME supplier
   * queueing behind each other, which is the contention the payout path
   * already accepted. Before 2026-09-24 the paid-at-reception path took the
   * advisory lock first and the supplier second (inside `writePayout`); the
   * supplier now comes first there too, so `intakes` advisory → `suppliers`
   * row no longer occurs anywhere, and `suppliers` → `intakes` advisory →
   * `payouts` advisory is the whole, acyclic hierarchy.
   */
  async create(actor: AuthenticatedUser, dto: CreateIntakeDto): Promise<IntakeDetailResponse> {
    const { pointId, point, supplier } = await this.resolveTarget(actor, dto);

    return this.dataSource.transaction(async (m) => {
      // FIRST, and on every receipt — see the lock order in this method's doc.
      await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [supplier.id]);

      const { shift, built } = await this.compute(pointId, dto, m);

      // Spec §8.3 — the crates coming back must be crates THIS receipt
      // carries. A return beyond them is a typo or a tare line recorded as the
      // wrong type (a «Лубянка» typed where «Чешка» was meant), and letting
      // it through would refund deposit for crates nobody weighed in.
      const returned = dto.returned_crates ?? 0;
      if (returned > built.crate_units) {
        throw new BadRequestException({
          message: `Only ${built.crate_units} crates on this receipt are crate tare`,
          code: 'RETURNED_EXCEEDS_TARE',
        });
      }

      const code = await nextDocumentCode(m, {
        pointCode: point.code,
        businessDate: shift.business_date,
        kind: 'IN',
        shiftId: shift.id,
        table: 'intakes',
      });

      // NARROW ON PURPOSE — only the insert that can hit `UQ_intakes_code`
      // belongs inside this catch. The audit write, the payout write and the
      // response building below throw their own, unrelated errors, and
      // wrapping them too used to route every one of them through
      // `translateDuplicateCode`, which recognises exactly one violation and
      // rethrows anything else unchanged anyway — the narrower scope just
      // says so.
      let intake: Intake;
      try {
        intake = await m.save(
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
      } catch (error) {
        throw this.translateDuplicateCode(error, code);
      }

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

      // Spec §8.3 — BEFORE the payout, so the crates refusals
      // (`RETURN_EXCEEDS_OUTSTANDING`, `CRATE_CASH_INSUFFICIENT`) roll back a
      // receipt that has not yet handed any cash over. Linked by `intakeId`,
      // which is what lets this receipt's void strike the return too.
      if (returned > 0) {
        await this.crates.writeReturn(m, {
          actor,
          pointId,
          shift,
          supplierId: supplier.id,
          units: returned,
          intakeId: intake.id,
        });
      }

      // §2.1 ⑥ — the cash for THIS visit leaves the drawer in the same
      // transaction as the receipt. The debt `writePayout` checks already
      // includes the intake saved above (same transaction), so «Разом» is
      // the ceiling as §3.1 defines it. A refusal throws, and the intake is
      // rolled back with it: a receipt without its «видано» would not match
      // the paper in the supplier's hand.
      //
      // TRUTHINESS, not `!== undefined`: `null`, `undefined` and `''` all
      // mean «no payout» here — an omitted field, a JSON `null` and an empty
      // string all describe the same «нічого не видано» (§3.7). `'0.00'` is
      // truthy and `isZero` catches it below.
      const paid: Payout[] = [];
      if (dto.paid_amount && !isZero(dto.paid_amount)) {
        const { payout } = await this.payouts.writePayout(m, {
          actor,
          pointId,
          pointCode: point.code,
          supplierId: supplier.id,
          amount: dto.paid_amount,
          intakeId: intake.id,
        });
        paid.push(payout);
      }

      return toIntakeDetailResponse(
        intake,
        shift,
        intake.items ?? [],
        await this.extrasFor(intake.id, m),
        paid,
        await this.nameOf(actor.sub, m),
        await this.crateReturnFor(intake.id, m),
      );
    });
  }

  /**
   * `create` UP TO THE POINT WHERE IT WOULD WRITE, and then nothing.
   *
   * The reception screen shows net weight, price, bonus and the line and
   * document amounts LIVE as the operator types, and §2.4/§2.8/§2.9 make the
   * server the only place those may be computed — so the client asks for the
   * numbers without asking for a document. Same body minus `code`, same
   * refusals in the same order: an inactive supplier, a missing shift, an
   * unpriced grade, an unknown tare type or an out-of-range bonus all fail
   * here exactly as they would on submit, which is the point — the operator
   * learns the form is unusable BEFORE typing a whole receipt into it.
   *
   * NOT A TRANSACTION, ON PURPOSE. Nothing here writes, so there is nothing
   * for one to make atomic; the snapshot reads go through the plain manager.
   * Nothing is saved, audited or numbered — a preview is not an event.
   */
  async preview(actor: AuthenticatedUser, dto: PreviewIntakeDto): Promise<PreviewIntakeResponse> {
    const { pointId, supplier } = await this.resolveTarget(actor, dto);
    const { shift, built } = await this.compute(pointId, dto, this.dataSource.manager);

    return toPreviewIntakeResponse(
      {
        collection_point_id: pointId,
        supplier_id: supplier.id,
        business_date: shift.business_date,
      },
      built,
    );
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
      // A cheap, UNLOCKED read, only to learn who the supplier is — 404s
      // before any lock is taken if the document simply does not exist.
      const stub = await m.findOne(Intake, { where: { id } });
      if (!stub) throw new NotFoundException('Intake not found');

      // THE SUPPLIER ROW BEFORE THE DOCUMENT ROW — the order `create`,
      // `CratesService.writeReturn`, `voidIssuance` and `voidReturn` all use
      // (see `CratesService.voidIssuance` for the interleaving a reversed
      // order opens). Taken on EVERY void, linked return or not: the order
      // must not depend on the data. `voidReturnForIntake` below relies on
      // this lock and takes none of its own.
      await m.query('SELECT id FROM suppliers WHERE id = $1 FOR UPDATE', [stub.supplier_id]);

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

      // Spec §8.3 — the crates that came back WITH this receipt did not come
      // back if the receipt did not happen. Same transaction, same reason.
      // The payout handed over with it is NOT touched: §3.5's recorded
      // exception, and voiding a payout is its own verb with its own rule.
      await this.crates.voidReturnForIntake(m, {
        actor,
        intakeId: saved.id,
        reason: dto.reason,
      });

      return toIntakeResponse(saved, shift, await this.extrasFor(saved.id, m));
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
      .innerJoinAndMapOne('i.shift', Shift, 's', 's.id = i.shift_id')
      .innerJoin(Supplier, 'sup', 'sup.id = i.supplier_id');
    for (const { sql, alias } of rowExtrasSelects('i', 'sup')) qb.addSelect(sql, alias);

    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (query.shift_id) qb.andWhere('i.shift_id = :shiftId', { shiftId: query.shift_id });
    if (query.supplier_id) {
      qb.andWhere('i.supplier_id = :supplierId', { supplierId: query.supplier_id });
    }
    if (query.from) qb.andWhere('s.business_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('s.business_date <= :to', { to: query.to });
    if (!query.include_voided) qb.andWhere('i.voided_at IS NULL');

    qb.orderBy('i.created_at', 'DESC')
      // Tiebreaker: two receipts punched in the same millisecond are ordinary
      // at a busy point, and Postgres promises no order among ties — without
      // this, paging could repeat or drop one.
      .addOrderBy('i.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit);

    // `getManyAndCount` cannot carry raw selects; `getRawAndEntities` keeps
    // `raw[n]` aligned with `entities[n]` for a to-one join, but the count
    // below deliberately does NOT rely on that positional alignment (see the
    // `byId` map). `qb.clone()` — NOT `qb` — for the count: `getCount()`
    // flips `expressionMap.queryEntity` on the builder it runs on, and
    // running it on the same builder `getRawAndEntities()` is still using
    // would have the two in-flight calls fight over one mutable query.
    const [{ entities, raw }, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.clone().getCount(),
    ]);

    // Map raw rows BY ID, not by array position. `getRawAndEntities` documents
    // `raw[n]`/`entities[n]` alignment for a to-one join, but the position is
    // exactly the kind of implicit contract that doesn't survive a future
    // join added above without a note here — a mismatch would hand one
    // intake's `net_kg`/`paid_amount` to another intake's row, silently.
    // TypeORM prefixes a raw column with `<alias>_<column>`, so the intakes
    // alias `i` makes the primary key `i_id`.
    const byId = new Map(raw.map((r) => [r.i_id as string, r]));

    return {
      data: entities.map((i) => {
        const row = byId.get(i.id);
        if (!row) throw new Error('intake row extras missing for ' + i.id);
        return toIntakeResponse(i, i.shift as Shift, {
          net_kg: row.net_kg,
          lines_count: row.lines_count,
          supplier_name: row.supplier_name,
          paid_amount: row.paid_amount,
        });
      }),
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

    const m = this.repo.manager;

    const items = await m.find(IntakeItem, {
      where: { intake_id: intake.id },
      relations: { tare: true },
    });

    const payouts = await m.find(Payout, {
      where: { intake_id: intake.id },
      // Tiebreaker, like `list` — two payouts written in the same millisecond
      // are ordinary, and Postgres promises no order among ties.
      order: { created_at: 'ASC', id: 'ASC' },
    });

    return toIntakeDetailResponse(
      intake,
      shift,
      items,
      await this.extrasFor(intake.id, m),
      payouts,
      await this.nameOf(intake.received_by_user_id, m),
      await this.crateReturnFor(intake.id, m),
    );
  }

  /**
   * The crate return written WITH this receipt (spec §8.3), voided or not —
   * `create` (after `writeReturn`, same transaction) and `findOne` both read
   * it here, so the receipt printed at the counter and the one reopened later
   * are the same query. `UQ_crate_returns_intake` makes it at most one row.
   *
   * The split by MODE is summed from the FIFO allocation rows joined to the
   * issuance each drew from — the same rows `CrateReturnAllocationView`
   * carries `mode` on — and cast `::int` so the driver hands back numbers.
   */
  private async crateReturnFor(
    intakeId: string,
    m: EntityManager,
  ): Promise<IntakeCrateReturnRow | null> {
    const [row] = (await m.query(
      `SELECT cr.id,
              cr.units,
              cr.deposit_refund,
              cr.voided_at,
              COALESCE(SUM(a.units) FILTER (WHERE ci.mode = 'deposit'), 0)::int AS deposit_units,
              COALESCE(SUM(a.units) FILTER (WHERE ci.mode = 'receipt'), 0)::int AS receipt_units
         FROM crate_returns cr
         LEFT JOIN crate_return_allocations a ON a.return_id = cr.id
         LEFT JOIN crate_issuances ci ON ci.id = a.issuance_id
        WHERE cr.intake_id = $1
        GROUP BY cr.id`,
      [intakeId],
    )) as IntakeCrateReturnRow[];
    return row ?? null;
  }

  /** The four derived columns for ONE document, read by id — `findOne`,
   *  `create` (after the insert, so `paid_amount` sees the payout it just
   *  wrote) and `void` all go through here. */
  private async extrasFor(intakeId: string, m: EntityManager): Promise<IntakeRowExtras> {
    const [row] = (await m.query(ROW_EXTRAS_SQL, [intakeId])) as IntakeRowExtras[];
    if (!row) throw new Error('intake row extras missing for ' + intakeId);
    return row;
  }

  /** The receiver's display name for the printed receipt — `displayNameOf`,
   *  the ONE definition of a user's name. */
  private async nameOf(userId: string, m: EntityManager): Promise<string | null> {
    const user = await m.findOne(User, { where: { id: userId } });
    return user ? displayNameOf(user) : null;
  }

  /**
   * WHERE the document lands and WHO it is for — the first two steps of both
   * `create` and `preview`, shared so the two cannot drift.
   *
   * Outside any transaction on purpose: these are reads that cannot race
   * meaningfully — a supplier deactivated between here and the insert is a
   * document written a second early, not a corrupt one — and doing them first
   * means the common failure returns without ever opening a transaction.
   */
  private async resolveTarget(
    actor: AuthenticatedUser,
    dto: PreviewIntakeDto,
  ): Promise<{ pointId: string; point: CollectionPoint; supplier: SupplierResponse }> {
    const pointId = resolveWritePoint(actor, dto.collection_point_id);

    // The point row is loaded for its `code`, which is the first segment of
    // every receipt written here. A body-supplied point that names nothing
    // would otherwise reach the FK and produce a 500 — there is no
    // QueryFailedError mapping anywhere in this backend.
    const point = await this.points.findOneRaw(pointId);
    if (!point) throw new NotFoundException('Collection point not found');

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

    return { pointId, point, supplier };
  }

  /**
   * The open shift, the two snapshots and every rule in one pure call — steps
   * three to five of both verbs. `create` runs it inside its transaction so
   * the price stored is the price current when the row is written; `preview`
   * runs it on the plain manager. SAME reads, SAME order, in both — which is
   * what makes a preview trustworthy: it cannot disagree with the document
   * that follows it except by a price or tare row changing in between, and
   * then the document is right to win.
   */
  private async compute(
    pointId: string,
    dto: PreviewIntakeDto,
    m: EntityManager,
  ): Promise<{ shift: Shift; built: BuiltIntake }> {
    const shift = await this.shifts.findOpenAtPoint(pointId, m);
    if (!shift) {
      throw new ConflictException({
        message: 'No open shift at this point — open one first',
        code: 'NO_OPEN_SHIFT',
      });
    }

    const prices = await this.snapshotPrices(pointId, dto, m);
    const tareTypes = await this.snapshotTare(dto, m);

    // Every rule and every number, in one pure call. If this throws inside
    // `create`, the transaction rolls back and no partial document exists.
    return { shift, built: buildIntake(dto.items, prices, tareTypes) };
  }

  /** §2.8 — the price is a SNAPSHOT of the row current at this moment, read
   *  inside the transaction so what is stored is what was current. §4.5 makes
   *  a missing row a refusal, raised by `buildIntake` naming the grade. */
  private async snapshotPrices(
    pointId: string,
    dto: PreviewIntakeDto,
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
    dto: PreviewIntakeDto,
    m: EntityManager,
  ): Promise<Map<string, TareSnapshot>> {
    const tareIds = [...new Set(dto.items.flatMap((i) => i.tare.map((t) => t.tare_type_id)))];
    const rows = await this.tare.findManyRaw(tareIds, m);
    return new Map(
      rows.map((t) => [t.id, { id: t.id, weight_kg: t.weight_kg, is_crate: t.is_crate }]),
    );
  }

  /**
   * UNREACHABLE BY ANY ORDINARY PATH, AND KEPT ANYWAY.
   *
   * The code is generated under an advisory lock from a count of this shift's
   * intakes, so two concurrent receipts cannot compose the same number. What
   * CAN still collide is a generated `…-004` meeting a row written before
   * 2026-09-18, when the number came off the paper book and an operator was
   * free to type `004` by hand. That is a legacy shift only, it does not clear
   * itself on a retry, and the operator cannot fix it — so the message names
   * the code and the 409 is the signal to go look, not a prompt to try again.
   *
   * Without this, a 23505 would reach the client as an opaque 500: there is no
   * QueryFailedError mapping anywhere in this backend.
   */
  private translateDuplicateCode(error: unknown, code: string): unknown {
    const violation = error as UniqueViolation;
    if (violation?.code === '23505' && violation.constraint === 'UQ_intakes_code') {
      return new ConflictException({
        message: `Receipt ${code} already exists — this shift was numbered by hand before the server took it over`,
        code: 'INTAKE_CODE_TAKEN',
      });
    }
    return error;
  }
}
