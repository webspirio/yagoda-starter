import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  crateBookSql,
  crateTareUnitsSql,
  inTransitCratesSql,
  onHandSql,
  openTranchesSql,
  transferCratesSql,
} from './crate-balance.service';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CrateStandingQueryDto } from './dto/crate-standing.query';
import { resolvePointFilter } from '../auth/access/point-scope';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

export interface CrateStandingResponse {
  collection_point_id: string;
  /** `collection_points.target_crates` — `null` is «не задано», never 0. */
  allotment: number | null;
  /** Σ empty crates brought to the point by transfer — `transferCratesSql`. */
  received: number;
  /**
   * Empties at the point — `onHandSql`, the one formula the stock guard shares.
   * Never null; MAY be < 0 when the documents disagree (§6.9 — shown red).
   */
  on_hand: number;
  /** Σ crates of `sent` transfers — on their way, not yet empties. */
  in_transit: number;
  /** Open units of live tranches — out with people. */
  in_field: number;
  /** Of `in_field`, the units out on a deposit (the rest are on a розписка). */
  deposit_units: number;
  /** The point's crates book — `crateBookSql`, not re-derived. */
  deposit_held: string;
  /** Crate tare on live receipts of the point's OPEN shift; 0 when none is open. */
  with_berry: number;
  /** `on_hand + in_field + with_berry`. */
  total: number;
  /** `allotment − total`; `null` when `allotment` is; negative is «понад наділ». */
  shortfall: number | null;
}

/**
 * One point's crate standing, point-lifetime, every figure computed by
 * Postgres — spec §8.1–§8.2, the crate flow as the client runs it:
 *
 *   | Step                         | Empty (on_hand) | With people (in_field) | With berries |
 *   | Transfer 500 empty           | 500             | 0                      | 0            |
 *   | Issue 100                    | 400             | 100                    | 0            |
 *   | 50 full, not in our crates   | 350             | 100                    | 50           |
 *   | 50 full in OUR crates        | 350             | 50                     | 100          |
 *   | Shift closed → next shift    | 350             | 50                     | 0            |
 *
 * A TRANSFER IS HOW EMPTY CRATES ARRIVE at the point (`received`, the
 * three-way `transferCratesSql` reading). Issuing moves empties to people;
 * a return moves them back. FULL CRATES ARE ALWAYS OURS (client, 2026-09-23):
 * berries brought in anything end up in our crates, so every crate-tare unit
 * on a live receipt leaves the empties — and a supplier returning our crates
 * with berries in them is the receipt PLUS a return, which net to 0 on
 * `on_hand`. Breakage (`shifts.broken_crates`, NULL adds 0) comes out of the
 * empties too.
 *
 * `with_berry` is the OPEN shift's crate tare only, because berries go to the
 * base when the shift closes: nothing on this screen tracks crates at the
 * base, so after the close those crates simply leave the point's total, and
 * `shortfall` shows what the base still owes back.
 *
 * `in_field` AND `deposit_units` sum `openTranchesSql`, the SAME shared
 * fragment `/crate-balances`'s aggregate reads, so this total and the sum of
 * that list cannot disagree; the db-spec pins it regardless. NOTHING IS
 * SNAPSHOTTED: voiding an old receipt or transfer moves the figures silently.
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
      `WITH tranche AS ${openTranchesSql('s.collection_point_id = $1')},
       figures AS (
         SELECT cp.id AS collection_point_id,
                cp.target_crates AS allotment,
                ${transferCratesSql('$1')} AS received,
                ${onHandSql('$1')} AS on_hand,
                ${inTransitCratesSql('$1')} AS in_transit,
                ${crateTareUnitsSql('sh.collection_point_id = $1 AND sh.closed_at IS NULL')} AS with_berry,
                (SELECT COALESCE(SUM(remaining_units), 0)::int FROM tranche) AS in_field,
                (SELECT COALESCE(SUM(remaining_units), 0)::int FROM tranche
                  WHERE mode = '${CrateIssuanceMode.Deposit}'::crate_issuance_mode) AS deposit_units,
                ${crateBookSql('$1')}::text AS deposit_held
           FROM collection_points cp
          WHERE cp.id = $1
       )
       SELECT f.collection_point_id,
              f.allotment,
              f.received,
              f.on_hand,
              f.in_transit,
              f.in_field,
              f.deposit_units,
              f.deposit_held,
              f.with_berry,
              (f.on_hand + f.in_field + f.with_berry)::int AS total,
              CASE WHEN f.allotment IS NULL THEN NULL
                   ELSE (f.allotment - (f.on_hand + f.in_field + f.with_berry))::int END AS shortfall
         FROM figures f`,
      [pointId],
    );

    const row = rows[0];
    if (!row) throw new NotFoundException('Collection point not found');
    return row;
  }
}
