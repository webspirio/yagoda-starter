import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ListCrateBalancesQueryDto } from './dto/list-crate-balances.query';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { openTranchesSql } from './crate-balance.service';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import { resolvePointFilter } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CrateBalanceRowResponse {
  supplier_id: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  collection_point_id: string;
  /** A row COUNT, integer — never added to a money value. */
  outstanding_units: number;
  /**
   * The cash cover behind those crates.
   *
   * `'0.00'` IS AMBIGUOUS ON ITS OWN and that is why `has_receipt` exists
   * beside it: a supplier holding only розписка tranches reads `'0.00'` here,
   * and so does one whose deposit was fully refunded. The screen must render
   * «—» for the first and nothing special for the second, so it needs both
   * fields to tell them apart.
   */
  deposit_held: string;
  /** True when at least one OPEN tranche was taken on a paper розписка. */
  has_receipt: boolean;
  /** Of `outstanding_units`, those out on a deposit. */
  deposit_units: number;
  /** Of `outstanding_units`, those out on a paper розписка — no cash cover. */
  receipt_units: number;
}

/**
 * «Ящики» — who at this point is still holding crates, and on what terms.
 *
 * EVERY NUMBER IS COMPUTED BY POSTGRES, not by JavaScript. `numeric`
 * arithmetic in SQL is exact, and the one place this service could have summed
 * `per_unit × remaining` in TypeScript is the one place foundation §5.1
 * forbids it. `CrateBalanceService.balanceFor` does that arithmetic in TS for
 * ONE supplier through `money.ts`; doing it here for a page of them would be a
 * second implementation of the same sum, so the sum stays in the query.
 *
 * THE OPEN-TRANCHE DEFINITION IS THE ONE `tranchesFor` USES — units issued
 * minus units allocated to non-voided returns, filtered to what is left.
 * Here it comes from `openTranchesSql` (`crate-balance.service.ts`), the
 * shared fragment `CrateStandingService`'s point total also reads, so an
 * aggregate over a point and that total cannot silently disagree about what
 * counts as open — the db-spec pins the two against each other regardless.
 */
@Injectable()
export class CrateBalancesService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    actor: AuthenticatedUser,
    query: ListCrateBalancesQueryDto,
  ): Promise<Paginated<CrateBalanceRowResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);

    const params: unknown[] = [CrateIssuanceMode.Receipt];
    // The placeholder is captured when the value is pushed, never looked up
    // afterwards: `params.indexOf(pointId)` would find the WRONG slot the day
    // a point id and some other bound value compare equal.
    let pointPlaceholder = '';
    let pointPredicate = 'TRUE';
    if (pointId) {
      params.push(pointId);
      pointPlaceholder = `$${params.length}`;
      pointPredicate = `s.collection_point_id = ${pointPlaceholder}`;
    }

    // Open tranches (`openTranchesSql`, `crate-balance.service.ts`) first,
    // then aggregate per supplier.
    const base = `
      WITH open AS ${openTranchesSql(pointPredicate)},
      rolled AS (
        SELECT o.supplier_id,
               o.collection_point_id,
               SUM(o.remaining_units)::int AS outstanding_units,
               SUM(o.deposit_per_unit * o.remaining_units)::text AS deposit_held,
               bool_or(o.mode = $1::crate_issuance_mode) AS has_receipt,
               (SUM(o.remaining_units) FILTER (WHERE o.mode <> $1::crate_issuance_mode))::int AS deposit_units,
               (SUM(o.remaining_units) FILTER (WHERE o.mode = $1::crate_issuance_mode))::int AS receipt_units
          FROM open o
         GROUP BY o.supplier_id, o.collection_point_id
      )
      SELECT sup.id AS supplier_id,
             sup.first_name,
             sup.last_name,
             sup.is_active,
             sup.collection_point_id,
             COALESCE(r.outstanding_units, 0) AS outstanding_units,
             COALESCE(r.deposit_held, '0.00') AS deposit_held,
             COALESCE(r.has_receipt, false) AS has_receipt,
             COALESCE(r.deposit_units, 0) AS deposit_units,
             COALESCE(r.receipt_units, 0) AS receipt_units
        FROM suppliers sup
        ${query.include_zero ? 'LEFT JOIN' : 'JOIN'} rolled r ON r.supplier_id = sup.id
       ${pointId ? `WHERE sup.collection_point_id = ${pointPlaceholder}` : ''}`;

    const [countRow] = (await this.dataSource.query(
      `SELECT count(*)::int AS count FROM (${base}) t`,
      params,
    )) as { count: number }[];

    // THE ORDER IS TOTAL — units, then the name, then the id. Postgres
    // promises no order among ties, so without the id tiebreaker `LIMIT`/
    // `OFFSET` can serve one row twice and skip another.
    const rows = (await this.dataSource.query(
      `SELECT * FROM (${base}) t
        ORDER BY t.outstanding_units DESC, t.last_name, t.first_name, t.supplier_id
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.limit, skipOf(query)],
    )) as CrateBalanceRowResponse[];

    return { data: rows, total: countRow.count, page: query.page, limit: query.limit };
  }
}
