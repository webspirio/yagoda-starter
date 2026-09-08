import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { Shift } from './shift.entity';
import { ShiftStatus } from './shift-status.enum';
import { ReopenShiftDto } from './dto/reopen-shift.dto';
import { ListShiftsQueryDto } from './dto/list-shifts.query';
import { CurrentShiftQueryDto } from './dto/current-shift.query';
import { ShiftResponse, toShiftResponse } from './shift.mapper';
import { AuditService } from '../audit/audit.service';
import { CollectionPointsService } from '../collection-points/collection-points.service';
import { assertOwnsPoint, resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import { TimeService } from '../time/time.service';
import { UserRole } from '../users/user-role.enum';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** Shape of the driver error TypeORM surfaces for a unique violation. Narrowed
 *  rather than cast, because `constraint` is what tells the two apart. */
interface UniqueViolation {
  code?: string;
  constraint?: string;
}

@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(Shift)
    private readonly repo: Repository<Shift>,
    private readonly points: CollectionPointsService,
    private readonly audit: AuditService,
    private readonly time: TimeService,
  ) {}

  /**
   * OPERATOR ONLY, and the absence of an owner branch is the rule rather than a
   * simplification. §10.3 — «Тільки приймальник — і це не помилка»:
   *
   *   «Відкрити чужий робочий день і закрити його за людину нема кому, а підпис
   *    під зведеною касою мусить належати тому, хто цю касу тримав у руках.»
   *
   * So there is no DTO, no body, and no point to resolve: an operator's point
   * comes from their token and an owner has none. The controller's
   * `@Auth(UserRole.PointOperator)` is the real gate; the check below is what
   * happens if `CHK_users_role_point` and the guard both ever fail.
   *
   * THE ROUTE IS PROVISIONAL IN SHAPE, not only in its close path. §07:30 makes
   * opening a shift «сума вводиться фактично порахована», and the 03.09.2026
   * schema note makes that TWO records, one per cash book. Both arrive with
   * `cash_counts`, and that is when this grows a DTO.
   */
  async open(actor: AuthenticatedUser): Promise<ShiftResponse> {
    const pointId = actor.collection_point_id;
    if (!pointId) {
      throw new ForbiddenException({
        message: 'No collection point assigned',
        code: 'NO_COLLECTION_POINT',
      });
    }

    // foundation §5.2 — server-derived, never editable, no backdating path.
    // `toISODate()` on a zone-aware DateTime gives the LOCAL calendar day,
    // which is the whole point: 23:30 on the 8th in Kyiv is the 8th, not the
    // 9th. Under APP_TIMEZONE=UTC this line silently misfiles an evening shift
    // and every document in it.
    const business_date = this.time.now().toISODate()!;

    let shift: Shift;
    try {
      shift = await this.repo.save(
        this.repo.create({
          collection_point_id: pointId,
          opened_by_user_id: actor.sub,
          business_date,
          status: ShiftStatus.Open,
        }),
      );
    } catch (error) {
      throw this.translateUniqueViolation(error);
    }

    await this.audit.record({
      action: 'shift.opened',
      actor_id: actor.sub,
      target_type: 'shift',
      target_id: shift.id,
      after: { collection_point_id: pointId, business_date },
    });

    return toShiftResponse(shift);
  }

  /**
   * Operator only, same as `open` (§10.3). `assertOwnsPoint` still runs: the
   * guard has established the actor is AN operator, not that this is THEIR
   * point.
   *
   * DELIBERATELY DOES NOT READ `business_date`. That is what makes the
   * forgotten-close path work — Friday's shift closed on Saturday morning, no
   * special case, no stuck point. The only visible oddity is that Friday's
   * `closed_at` reads Saturday, which is true and is what happened.
   *
   * A DUMB STAMP, and it will be revisited. §7.7 makes closing WITH a
   * discrepancy the owner's act with a mandatory explanation, but a discrepancy
   * needs `cash_counts` to exist before anything can detect one. Until then
   * `awaiting_explanation` is unreachable and `explanation` stays null.
   */
  async close(actor: AuthenticatedUser, id: string): Promise<ShiftResponse> {
    const shift = await this.loadVisible(actor, id);

    if (shift.closed_at) {
      throw new ConflictException({
        message: 'That shift is already closed',
        code: 'SHIFT_ALREADY_CLOSED',
      });
    }

    shift.closed_at = this.time.now().toJSDate();
    shift.closed_by_user_id = actor.sub;
    shift.status = ShiftStatus.Closed;
    const saved = await this.repo.save(shift);

    await this.audit.record({
      action: 'shift.closed',
      actor_id: actor.sub,
      target_type: 'shift',
      target_id: saved.id,
      after: { business_date: saved.business_date },
    });

    return toShiftResponse(saved);
  }

  /**
   * OWNER ONLY, and this is the one shift verb that inverts §10.3 — because it
   * is a correction, and §10.2 puts corrections with the owner.
   *
   * IT EXISTS BECAUSE OF `UQ_shifts_point_business_date` (spec §8.1). With one
   * shift per point per day, a mistaken close at 11:00 would otherwise end that
   * point's trading day with cars still arriving and no way back. Remove the
   * unique constraint and this route loses its reason; remove this route and
   * keep the constraint and the trap reopens.
   *
   * §2.7's «те, що надруковано на папері, не рухається» does not reach a shift:
   * it has no code, no receipt and no supplier copy, which is exactly why
   * `intakes` and `payouts` carry a `void_*` trio and this does not.
   */
  async reopen(actor: AuthenticatedUser, id: string, dto: ReopenShiftDto): Promise<ShiftResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may reopen a shift',
        code: 'OWNER_ONLY',
      });
    }

    const shift = await this.loadVisible(actor, id);

    if (!shift.closed_at) {
      throw new ConflictException({
        message: 'That shift is not closed',
        code: 'SHIFT_NOT_CLOSED',
      });
    }

    // Both guards below are also enforced by the partial unique index, but a
    // 23505 arriving from a REOPEN reads as a mystery — these produce the two
    // messages that say what to do instead.
    const openElsewhere = await this.findOpenAtPoint(shift.collection_point_id);
    if (openElsewhere) {
      throw new ConflictException({
        message: 'Another shift is already open at that point — close it first',
        code: 'SHIFT_ALREADY_OPEN',
      });
    }

    const newest = await this.repo.findOne({
      where: { collection_point_id: shift.collection_point_id },
      order: { business_date: 'DESC' },
    });
    if (newest && newest.id !== shift.id) {
      throw new ConflictException({
        message: 'Only the point’s most recent shift can be reopened',
        code: 'SHIFT_NOT_NEWEST',
      });
    }

    const before = { closed_at: shift.closed_at, status: shift.status };
    shift.closed_at = null;
    shift.closed_by_user_id = null;
    shift.status = ShiftStatus.Open;
    const saved = await this.repo.save(shift);

    await this.audit.record({
      action: 'shift.reopened',
      actor_id: actor.sub,
      target_type: 'shift',
      target_id: saved.id,
      before,
      after: { closed_at: null, status: ShiftStatus.Open },
      note: dto.reason,
    });

    return toShiftResponse(saved);
  }

  async list(
    actor: AuthenticatedUser,
    query: ListShiftsQueryDto,
  ): Promise<Paginated<ShiftResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const qb = this.repo.createQueryBuilder('s');
    if (pointId) qb.andWhere('s.collection_point_id = :pointId', { pointId });
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });
    if (query.from) qb.andWhere('s.business_date >= :from', { from: query.from });
    if (query.to) qb.andWhere('s.business_date <= :to', { to: query.to });

    const [data, total] = await qb
      .orderBy('s.business_date', 'DESC')
      // Tiebreaker: an owner reading network-wide gets one row per point per
      // day, so business_date alone leaves ties and Postgres promises no order
      // among them — `skip`/`take` could then repeat or drop a row across
      // pages. Same reasoning as SuppliersService.list.
      .addOrderBy('s.id', 'ASC')
      .skip(skipOf(query))
      .take(query.limit)
      .getManyAndCount();

    return { data: data.map(toShiftResponse), total, page: query.page, limit: query.limit };
  }

  async current(actor: AuthenticatedUser, query: CurrentShiftQueryDto): Promise<ShiftResponse> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);
    if (!pointId) {
      throw new NotFoundException('Name a collection point to see its current shift');
    }
    const shift = await this.findOpenAtPoint(pointId);
    if (!shift) throw new NotFoundException('No open shift at that point');
    return toShiftResponse(shift);
  }

  async findOne(actor: AuthenticatedUser, id: string): Promise<ShiftResponse> {
    return toShiftResponse(await this.loadVisible(actor, id));
  }

  /**
   * The open shift at a point, or `null`.
   *
   * Returns null rather than throwing so both document services can turn it
   * into their own 409 — «no open shift at this point» means the same thing to
   * an intake and a payout, but the seam should not decide their wording.
   *
   * Takes an `EntityManager` so a document write reads it INSIDE its own
   * transaction, which is what stops a shift being closed between the check and
   * the insert.
   */
  async findOpenAtPoint(pointId: string, manager?: EntityManager): Promise<Shift | null> {
    const repo = manager ? manager.getRepository(Shift) : this.repo;
    return repo.findOne({ where: { collection_point_id: pointId, closed_at: IsNull() } });
  }

  /** Raw row by id, for the document services. No access check — the caller
   *  already resolved the point it is allowed to write to. */
  async findOneRaw(id: string, manager?: EntityManager): Promise<Shift | null> {
    const repo = manager ? manager.getRepository(Shift) : this.repo;
    return repo.findOne({ where: { id } });
  }

  /** 404 — not 403 — for another point's shift, matching `SuppliersService`. */
  private async loadVisible(actor: AuthenticatedUser, id: string): Promise<Shift> {
    const shift = await this.repo.findOne({ where: { id } });
    if (!shift) throw new NotFoundException('Shift not found');
    if (actor.role !== UserRole.NetworkOwner) {
      if (actor.collection_point_id !== shift.collection_point_id) {
        throw new NotFoundException('Shift not found');
      }
      assertOwnsPoint(actor, shift.collection_point_id);
    }
    return shift;
  }

  /**
   * TWO CONSTRAINTS, TWO REMEDIES, and that is why this exists at all.
   * «Close the open shift first» and «ask the owner to reopen today's shift»
   * are different instructions, and an operator cannot guess which applies from
   * a generic duplicate-key error.
   */
  private translateUniqueViolation(error: unknown): unknown {
    const violation = error as UniqueViolation;
    if (violation?.code !== '23505') return error;
    if (violation.constraint === 'UQ_shifts_open_per_point') {
      return new ConflictException({
        message: 'A shift is already open at this point — close it first',
        code: 'SHIFT_ALREADY_OPEN',
      });
    }
    if (violation.constraint === 'UQ_shifts_point_business_date') {
      return new ConflictException({
        message: 'This point already had a shift today — ask the owner to reopen it',
        code: 'SHIFT_DAY_ALREADY_USED',
      });
    }
    return error;
  }
}
