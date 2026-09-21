import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { Shift } from './shift.entity';
import { ShiftStatus } from './shift-status.enum';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { ReopenShiftDto } from './dto/reopen-shift.dto';
import { SetExplanationDto } from './dto/set-explanation.dto';
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
import { CashCount } from '../cash-counts/cash-count.entity';
import { CashBook } from '../cash-counts/cash-book.enum';
import { CashCountKind } from '../cash-counts/cash-count-kind.enum';
import { PointCashService } from '../point-cash/point-cash.service';

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
    private readonly dataSource: DataSource,
    private readonly cash: PointCashService,
  ) {}

  /**
   * OPERATOR ONLY (§10.3) — unchanged. What is new is that opening a shift
   * COUNTS THE DRAWER, in the same transaction (spec §6.1).
   *
   * THE FIRST COUNT AT A POINT SETS `expected = counted`, and that is not a
   * fudge: the client's ruling is that the counted figure BECOMES the starting
   * balance, so at that instant the expectation genuinely is whatever is in
   * the drawer. It keeps `Σ (counted − expected)` — the point's accumulated
   * unexplained difference — correct with no special case, because the first
   * count contributes zero to it.
   *
   * A DISCREPANCY DOES NOT REFUSE. Client ruling of 09.09.2026, overruling
   * §7.7: «якщо каса не сходиться, це не блокує процес».
   */
  async open(actor: AuthenticatedUser, dto: OpenShiftDto): Promise<ShiftResponse> {
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
    const countedAt = this.time.now().toJSDate();

    return this.dataSource.transaction(async (m) => {
      let shift: Shift;
      try {
        shift = await m.save(
          Shift,
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

      // `null` means this point has never been counted — see the header.
      const previous = await this.cash.expectedForOpening(pointId, m);
      const expected = previous ?? dto.counted_amount;

      const countRow = await m.save(CashCount, {
        shift_id: shift.id,
        book: CashBook.Berry,
        kind: CashCountKind.Opening,
        counted_amount: dto.counted_amount,
        expected_amount: expected,
        // §10.6 — whoever pressed the button, not whoever opened the shift.
        counted_by_user_id: actor.sub,
        counted_at: countedAt,
      });

      await this.audit.record(
        {
          action: 'shift.opened',
          actor_id: actor.sub,
          target_type: 'shift',
          target_id: shift.id,
          after: { collection_point_id: pointId, business_date },
        },
        m,
      );
      await this.audit.record(
        {
          action: 'cash-count.recorded',
          actor_id: actor.sub,
          target_type: 'cash_count',
          target_id: countRow.id,
          after: {
            shift_id: shift.id,
            kind: CashCountKind.Opening,
            counted_amount: dto.counted_amount,
            expected_amount: expected,
          },
        },
        m,
      );

      return toShiftResponse(shift);
    });
  }

  /**
   * OPERATOR ONLY (§10.3), and it STAYS operator-only. §7.7 once made a
   * discrepancy the owner's business; the client's ruling of 09.09.2026
   * removed the blocking, and with it the only reason the owner was involved.
   *
   * A DISCREPANCY NEVER REFUSES. There is no branch here that compares counted
   * against expected and behaves differently — the comparison is the reader's,
   * not the writer's. `shift_status.awaiting_explanation` is unreachable BY
   * DECISION; see the enum's comment.
   *
   * STILL DOES NOT READ `business_date`, which is what makes the forgotten-close
   * path work: Friday's shift closed on Saturday morning, no special case. The
   * cost is named in the spec's §9.1 — a transfer accepted into that shift on
   * Saturday takes Friday's date.
   */
  async close(
    actor: AuthenticatedUser,
    id: string,
    dto: CloseShiftDto,
  ): Promise<ShiftResponse> {
    return this.dataSource.transaction(async (m) => {
      // UNDER THE ROW LOCK, and the check with it — see `loadVisible`. Read
      // outside, `closed_at` is a check-then-write: a double-tapped button
      // sends two closes, both see `null`, and the loser's count INSERT hits
      // `UQ_cash_counts_shift_book_kind` as a bare 23505 that
      // `translateUniqueViolation` does not know — a 500 on the flagship money
      // path. `shift-close-race.db-spec.ts` is that scenario.
      const shift = await this.loadVisible(actor, id, m);
      if (shift.closed_at) {
        throw new ConflictException({
          message: 'That shift is already closed',
          code: 'SHIFT_ALREADY_CLOSED',
        });
      }

      // AFTER the lock, not before: a request that waited on the winner should
      // stamp the moment it actually closed the shift, not the moment it
      // started queuing for the right to.
      const closedAt = this.time.now().toJSDate();

      // `null` only if something wrote a shift without going through `open`.
      const expected = (await this.cash.expectedForClosing(shift.id, m)) ?? dto.counted_amount;

      const countRow = await m.save(CashCount, {
        shift_id: shift.id,
        book: CashBook.Berry,
        kind: CashCountKind.Closing,
        counted_amount: dto.counted_amount,
        expected_amount: expected,
        counted_by_user_id: actor.sub,
        counted_at: closedAt,
      });

      shift.closed_at = closedAt;
      shift.closed_by_user_id = actor.sub;
      shift.status = ShiftStatus.Closed;
      // §6.8 — «бій вписує приймальник». The ONLY write of this column.
      shift.broken_crates = dto.broken_crates;
      const saved = await m.save(Shift, shift);

      await this.audit.record(
        {
          action: 'shift.closed',
          actor_id: actor.sub,
          target_type: 'shift',
          target_id: saved.id,
          after: { business_date: saved.business_date, broken_crates: saved.broken_crates },
        },
        m,
      );
      await this.audit.record(
        {
          action: 'cash-count.recorded',
          actor_id: actor.sub,
          target_type: 'cash_count',
          target_id: countRow.id,
          after: {
            shift_id: saved.id,
            kind: CashCountKind.Closing,
            counted_amount: dto.counted_amount,
            expected_amount: expected,
          },
        },
        m,
      );

      return toShiftResponse(saved);
    });
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

    return this.dataSource.transaction(async (m) => {
      // EVERY GUARD BELOW IS INSIDE THE TRANSACTION, under the row lock, for
      // the reason `close` states. Two concurrent reopens both read
      // `closed_at` set, and — unlike `close` — nothing downstream stops the
      // second: it re-demotes an already-demoted count and writes a SECOND
      // `shift.reopened` entry, leaving the audit log claiming the shift was
      // reopened twice by one press. Silent, and therefore worse.
      const shift = await this.loadVisible(actor, id, m);

      if (!shift.closed_at) {
        throw new ConflictException({
          message: 'That shift is not closed',
          code: 'SHIFT_NOT_CLOSED',
        });
      }

      // Both guards below are also enforced by the partial unique index, but a
      // 23505 arriving from a REOPEN reads as a mystery — these produce the two
      // messages that say what to do instead.
      const openElsewhere = await this.findOpenAtPoint(shift.collection_point_id, m);
      if (openElsewhere) {
        throw new ConflictException({
          message: 'Another shift is already open at that point — close it first',
          code: 'SHIFT_ALREADY_OPEN',
        });
      }

      const newest = await m.findOne(Shift, {
        where: { collection_point_id: shift.collection_point_id },
        order: { business_date: 'DESC' },
      });
      if (newest && newest.id !== shift.id) {
        throw new ConflictException({
          message: 'Only the point’s most recent shift can be reopened',
          code: 'SHIFT_NOT_NEWEST',
        });
      }

      const before = {
        closed_at: shift.closed_at,
        status: shift.status,
        broken_crates: shift.broken_crates,
      };

      // §6.3 — THE CLOSING COUNT BECOMES A MIDDAY COUNT. Reopening needs a free
      // `closing` slot (UQ_cash_counts_shift_book_kind), and the 11:00 count
      // was never a close: it was a count, taken at 11:00, which is exactly
      // what `midday` means and why `midday` sits outside that index.
      //
      // This MUTATES a posted row's `kind`, which this codebase otherwise
      // refuses to do. The defence is the one that lets a shift be reopened
      // while an intake may only be voided: a count carries no code, no paper
      // twin and no supplier copy. The alternatives are destroying evidence
      // (§7.6 forbids it) or making every closing-count lookup an ordering
      // problem, where a bug returns a wrong cash figure instead of an error.
      // Everything except `kind` is preserved.
      await m.update(
        CashCount,
        { shift_id: shift.id, kind: CashCountKind.Closing },
        { kind: CashCountKind.Midday },
      );

      shift.closed_at = null;
      shift.closed_by_user_id = null;
      shift.status = ShiftStatus.Open;
      // Back to «не записано»: CHK_shifts_broken_crates_closed forbids a count
      // on an open shift, and the re-close will ask the operator again.
      shift.broken_crates = null;
      const saved = await m.save(Shift, shift);

      await this.audit.record(
        {
          action: 'shift.reopened',
          actor_id: actor.sub,
          target_type: 'shift',
          target_id: saved.id,
          before,
          after: { closed_at: null, status: ShiftStatus.Open, broken_crates: null },
          note: dto.reason,
        },
        m,
      );

      return toShiftResponse(saved);
    });
  }

  /**
   * OWNER ONLY (§10.2 — corrections and judgements belong to the owner).
   * Idempotent: re-sending replaces the text.
   */
  async setExplanation(
    actor: AuthenticatedUser,
    id: string,
    dto: SetExplanationDto,
  ): Promise<ShiftResponse> {
    if (actor.role !== UserRole.NetworkOwner) {
      throw new ForbiddenException({
        message: 'Only the network owner may explain a discrepancy',
        code: 'OWNER_ONLY',
      });
    }
    const shift = await this.loadVisible(actor, id);
    const before = { explanation: shift.explanation };
    shift.explanation = dto.explanation.trim();
    const saved = await this.repo.save(shift);

    await this.audit.record({
      action: 'shift.explained',
      actor_id: actor.sub,
      target_type: 'shift',
      target_id: saved.id,
      before,
      after: { explanation: saved.explanation },
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

  /**
   * 404 — not 403 — for another point's shift, matching `SuppliersService`.
   *
   * PASSING A MANAGER TAKES `pessimistic_write` ON THE ROW, and every verb
   * that writes passes one. The lock is not a precaution: `close` and `reopen`
   * both decide what to do from `closed_at`, and a decision taken on a row
   * nobody holds is a check-then-write no matter how soon the write follows.
   * `TransfersService.transition` states the same rule at length — «§6.11's
   * 409 has to be enforced where the write happens or it is not enforced at
   * all» — and this is that rule applied to shifts.
   *
   * The two READ callers (`findOne`, `setExplanation`'s sibling paths) pass
   * nothing and take no lock, because a read that locks a row blocks the
   * operator who is trying to close it.
   */
  private async loadVisible(
    actor: AuthenticatedUser,
    id: string,
    m?: EntityManager,
  ): Promise<Shift> {
    const shift = m
      ? await m.findOne(Shift, { where: { id }, lock: { mode: 'pessimistic_write' } })
      : await this.repo.findOne({ where: { id } });
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
