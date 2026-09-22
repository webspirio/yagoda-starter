import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ListCashCountsQueryDto } from './dto/list-cash-counts.query';
import { CreateCashCountDto } from './dto/create-cash-count.dto';
import {
  CashCountRow,
  CashCountRowResponse,
  toCashCountRowResponse,
} from './cash-count.mapper';
import { CashCount } from './cash-count.entity';
import { CashBook } from './cash-book.enum';
import { CashCountKind } from './cash-count-kind.enum';
import { ShiftsService } from '../shifts/shifts.service';
import { PointCashService } from '../point-cash/point-cash.service';
import { AuditService } from '../audit/audit.service';
import { resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * `opening` AND `closing` COUNTS ARE STILL WRITTEN BY `shifts`, inside the
 * open and close transactions (§6.1), because a count that could be written on
 * its own is a count that could be skipped. THIS MODULE NOW OWNS ONE WRITE OF
 * ITS OWN — `recount`, a `midday` count (R2, spec
 * `2026-09-22-yagoda-point-cash-parity.md`) — and that is the one `kind` that
 * was always meant to live outside a shift verb: §7.6 puts no endpoint on it
 * and no limit on how many times it may happen, unlike `opening`/`closing`,
 * which are each exactly one per shift by construction.
 *
 * THIS IS WHAT «NOTIFY THE OWNER» MEANS in this project: there is no email, no
 * push and no notification centre, so a notification is a read the owner's
 * screen performs. `only_discrepancies=true` is the working list.
 *
 * THE WORKING LIST EXCLUDES `midday`, and that is the same filter — and the
 * same reason — as `point-cash`'s `unexplained_difference`. A reopen demotes
 * the first closing count to `midday` (§6.3) and the re-close writes a second
 * one, so ONE physical drift becomes TWO stored rows. Counting both would tell
 * the owner a −90 shortage is −180 on one screen while the headline figure
 * says −90 on the other. The demoted row is evidence and keeps its place in
 * the UNFILTERED list; what it loses is a seat on the list of things still to
 * be worked. A RECOUNT'S `midday` ROW IS EXCLUDED FOR A DIFFERENT REASON — not
 * because it is superseded (nothing supersedes it — see `recount`'s own doc
 * comment), but because §7.6 makes a recount a witness, never an incident: it
 * never opens anything for the owner to work.
 *
 * THE LIMIT NAMED BELOW BY THE OLD COMMENT IS NOW RESOLVED, not discovered:
 * this module now has a midday-recount route, and the filter above, plus
 * `point-cash.service.ts`'s `unexplained_difference` and `is_open` in
 * `cash-count.mapper.ts`, were re-checked against it — all three already
 * excluded every `kind = 'midday'` row unconditionally, with no branch that
 * distinguished "demoted" from "recounted", so none of the three needed to
 * change.
 */
@Injectable()
export class CashCountsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
    private readonly cash: PointCashService,
    private readonly audit: AuditService,
  ) {}

  /**
   * `POST /cash-counts` — operator only (`@Auth(UserRole.PointOperator)` on
   * the controller decides that; this method does not re-check the role). A
   * MIDDAY RECOUNT, and §7.6's own words are the spec: «перерахунок — це
   * свідчення, а не коригування». It writes exactly one `cash_counts` row and
   * touches nothing else — no shift, no document, no balance — and it can
   * happen any number of times on one open shift, which is exactly why `kind
   * = 'midday'` sits outside `UQ_cash_counts_shift_book_kind`.
   *
   * THE POINT IS THE ACTOR'S, NEVER THE REQUEST'S — same rule as every other
   * write in this backend (`auth/access/point-scope.ts`'s header): the DTO
   * carries no point field to forge, and an operator with no point assigned is
   * refused before the transaction even opens, the same `NO_COLLECTION_POINT`
   * `ForbiddenException` `ShiftsService.open` throws for the identical
   * situation.
   *
   * `expected_amount` IS `PointCashService.cashFor` READ INSIDE THE SAME
   * TRANSACTION AS THE INSERT — the drawer at this instant, exactly as
   * `ShiftsService.open`/`close` snapshot it for their own counts. A midday
   * count NEVER ANCHORS the formula (`cashFor`'s `anchorSql` filters `kind <>
   * 'midday'`), so recording one changes nothing about what a LATER count —
   * midday or closing — expects to find.
   *
   * `is_open` STAYS FALSE. `toCashCountRowResponse` already treats every
   * `midday` row that way, and `CashCountsService.list`'s
   * `only_discrepancies` filter already excludes `kind = 'midday'`
   * unconditionally — a recount finding a shortage is recorded evidence, not
   * an incident the owner's list surfaces. THE CLOSING COUNT IS STILL WHAT
   * CARRIES THE DAY: the 10.09 note's «midday = перекрито» reading — that a
   * midday count could settle the drawer the way a close does — is FALSE, and
   * this is where that correction is recorded (see also the controller's own
   * comment).
   */
  async recount(actor: AuthenticatedUser, dto: CreateCashCountDto): Promise<CashCountRowResponse> {
    const pointId = actor.collection_point_id;
    if (!pointId) {
      throw new ForbiddenException({
        message: 'No collection point assigned',
        code: 'NO_COLLECTION_POINT',
      });
    }

    return this.dataSource.transaction(async (m) => {
      const shift = await this.shifts.findOpenAtPoint(pointId, m);
      if (!shift) {
        throw new BadRequestException({
          message: 'Перерахунок чіпляється лише до відкритої зміни',
          code: 'SHIFT_NOT_OPEN',
        });
      }

      // The drawer at THIS instant, under no lock of its own — a recount is a
      // read of a moving figure, not a claim that nothing else may write
      // between the read and the insert (§7.6 names no such guarantee).
      const expected = await this.cash.cashFor(pointId, undefined, m);
      const countedAt = new Date();

      const saved = await m.save(CashCount, {
        shift_id: shift.id,
        book: CashBook.Berry,
        kind: CashCountKind.Midday,
        counted_amount: dto.counted_amount,
        expected_amount: expected,
        // §10.6 — whoever pressed the button, not whoever opened the shift.
        counted_by_user_id: actor.sub,
        counted_at: countedAt,
      });

      await this.audit.record(
        {
          action: 'cash-count.recorded',
          actor_id: actor.sub,
          target_type: 'cash_count',
          target_id: saved.id,
          after: {
            shift_id: shift.id,
            kind: CashCountKind.Midday,
            book: CashBook.Berry,
            counted_amount: dto.counted_amount,
            expected_amount: expected,
          },
        },
        m,
      );

      return toCashCountRowResponse({
        id: saved.id,
        shift_id: saved.shift_id,
        collection_point_id: shift.collection_point_id,
        business_date: shift.business_date,
        book: saved.book,
        kind: saved.kind,
        counted_amount: saved.counted_amount,
        expected_amount: saved.expected_amount,
        counted_by_user_id: saved.counted_by_user_id,
        counted_at: saved.counted_at,
        // A fresh count carries whatever explanation is already on the
        // shift — the same column `list`'s SQL joins in — never a value of
        // its own; a count has no `explanation` column (see the entity).
        explanation: shift.explanation ?? null,
      });
    });
  }

  async list(
    actor: AuthenticatedUser,
    query: ListCashCountsQueryDto,
  ): Promise<Paginated<CashCountRowResponse>> {
    // `?? null`: node-postgres itself already binds `undefined` the same as
    // `null` (both become SQL NULL — see pg/lib/utils.js's `prepareValue`), so
    // this normalization changes no runtime behaviour. It exists to keep the
    // `$1::uuid IS NULL` guard below self-documenting: `resolvePointFilter`
    // returns `undefined` to mean "an owner asked for every point", and
    // writing that as an explicit `null` says "this is deliberately SQL NULL"
    // rather than leaving a reader to trust the driver's implicit coercion.
    // Same pattern as `point-cash.service.ts` and `supplier-balance.service.ts`.
    const pointId = resolvePointFilter(actor, query.collection_point_id) ?? null;
    const m = this.dataSource.manager;

    // Shared by the page and the count so the two cannot disagree about scope.
    // `only_discrepancies` filters in SQL on the two stored columns, so the
    // page size means what it says.
    const scope = `
        FROM cash_counts c
        JOIN shifts s ON s.id = c.shift_id
       WHERE ($1::uuid IS NULL OR s.collection_point_id = $1::uuid)
         AND ($2::uuid IS NULL OR c.shift_id = $2::uuid)
         AND ($3::date IS NULL OR s.business_date >= $3::date)
         AND ($4::date IS NULL OR s.business_date <= $4::date)
         AND (NOT $5::boolean
              OR (c.counted_amount <> c.expected_amount
                  AND c.kind <> 'midday'
                  AND (s.explanation IS NULL OR s.explanation = '')))`;

    const params = [
      pointId,
      query.shift_id ?? null,
      query.from ?? null,
      query.to ?? null,
      query.only_discrepancies,
    ];

    const rows = (await m.query(
      `SELECT c.id, c.shift_id, s.collection_point_id, s.business_date::text AS business_date,
              c.book, c.kind,
              c.counted_amount::text  AS counted_amount,
              c.expected_amount::text AS expected_amount,
              c.counted_by_user_id, c.counted_at, s.explanation
       ${scope}
        ORDER BY s.business_date DESC, c.counted_at DESC, c.id ASC
        LIMIT $6 OFFSET $7`,
      [...params, query.limit, skipOf(query)],
    )) as CashCountRow[];

    const [{ total }] = (await m.query(
      `SELECT COUNT(*)::int AS total ${scope}`,
      params,
    )) as { total: number }[];

    return {
      data: rows.map(toCashCountRowResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
