import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ListCashCountsQueryDto } from './dto/list-cash-counts.query';
import {
  CashCountRow,
  CashCountRowResponse,
  toCashCountRowResponse,
} from './cash-count.mapper';
import { resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * READ ONLY, AND THAT IS THE WHOLE MODULE. Counts are WRITTEN by `shifts`,
 * inside the open and close transactions (§6.1), because a count that could be
 * written on its own is a count that could be skipped.
 *
 * THIS IS WHAT «NOTIFY THE OWNER» MEANS in this project: there is no email, no
 * push and no notification centre, so a notification is a read the owner's
 * screen performs. `only_discrepancies=true` is the working list.
 */
@Injectable()
export class CashCountsService {
  constructor(private readonly dataSource: DataSource) {}

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
