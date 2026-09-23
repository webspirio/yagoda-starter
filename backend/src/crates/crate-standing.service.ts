import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { crateBookSql, crateTareUnitsSql, transferCratesSql } from './crate-balance.service';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CrateStandingQueryDto } from './dto/crate-standing.query';
import { resolvePointFilter } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CrateStandingResponse {
  collection_point_id: string;
  /** `collection_points.target_crates` — `null` is «не задано», never 0. */
  allotment: number | null;
  in_field: number;
  /** Of `in_field`, the units out on a deposit (the rest are on a розписка). */
  deposit_units: number;
  /** The point's crates book — `crateBookSql`, not re-derived. */
  deposit_held: string;
  at_base: number;
  /** `allotment − in_field − at_base`; `null` when `allotment` is; MAY be < 0 (§6.9). */
  on_hand: number | null;
  shortfall: number;
}

/**
 * §6.8's 20:40 block — «800 = 341 порожніх + 195 у людей + 264 на базі» —
 * for ONE point, point-lifetime, every figure computed by Postgres.
 *
 * `in_field` AND `deposit_units` USE THE OPEN-TRANCHE DEFINITION
 * `/crate-balances` uses (units issued minus units allocated to live returns),
 * so this total and the sum of that list cannot disagree; the db-spec pins it.
 *
 * `at_base` = crates on live receipts across ALL the point's shifts, the open
 * one included (§6.8's 20:40 example counts today's 142 before the 20:55
 * close) + recorded breakage − crates brought back by transfer. NOTHING IS
 * SNAPSHOTTED: voiding an old receipt moves it silently — the same
 * `crate_shipments` gap `CrateDispatchService` names. A closed shift whose
 * `broken_crates` is NULL (history older than the column) adds 0.
 */
@Injectable()
export class CrateStandingService {
  constructor(private readonly dataSource: DataSource) {}

  async forPoint(
    actor: AuthenticatedUser,
    query: CrateStandingQueryDto,
  ): Promise<CrateStandingResponse> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);
    if (!pointId) {
      throw new BadRequestException({
        message: 'collection_point_id is required',
        code: 'POINT_REQUIRED',
      });
    }

    const rows: CrateStandingResponse[] = await this.dataSource.query(
      `WITH tranche AS (
         SELECT ci.mode,
                (ci.units - COALESCE((
                    SELECT SUM(a.units)
                      FROM crate_return_allocations a
                      JOIN crate_returns cr ON cr.id = a.return_id
                     WHERE a.issuance_id = ci.id
                       AND cr.voided_at IS NULL), 0))::int AS remaining_units
           FROM crate_issuances ci
           JOIN shifts s ON s.id = ci.shift_id
          WHERE s.collection_point_id = $1
            AND ci.voided_at IS NULL
       ),
       figures AS (
         SELECT cp.id AS collection_point_id,
                cp.target_crates AS allotment,
                (SELECT COALESCE(SUM(remaining_units), 0)::int FROM tranche) AS in_field,
                (SELECT COALESCE(SUM(remaining_units), 0)::int FROM tranche
                  WHERE mode = '${CrateIssuanceMode.Deposit}'::crate_issuance_mode) AS deposit_units,
                ${crateBookSql('$1')}::text AS deposit_held,
                (${crateTareUnitsSql('sh.collection_point_id = $1')}
                 + (SELECT COALESCE(SUM(bs.broken_crates), 0)::int
                      FROM shifts bs WHERE bs.collection_point_id = $1)
                 - ${transferCratesSql('$1')})::int AS at_base
           FROM collection_points cp
          WHERE cp.id = $1
       )
       SELECT f.*,
              CASE WHEN f.allotment IS NULL THEN NULL
                   ELSE f.allotment - f.in_field - f.at_base END AS on_hand,
              (f.in_field + f.at_base) AS shortfall
         FROM figures f`,
      [pointId],
    );

    const row = rows[0];
    if (!row) throw new NotFoundException('Collection point not found');
    return row;
  }
}
