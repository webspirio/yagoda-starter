import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CrateIssuanceMode } from './crate-issuance-mode.enum';
import { CrateTranche } from './crate-allocation';
import { mul, sum } from '../common/money';

export interface CrateTrancheView extends CrateTranche {
  code: string;
  issued_at: string;
}

export interface CrateBalanceResponse {
  supplier_id: string;
  outstanding_units: number;
  deposit_held: string;
  tranches: CrateTrancheView[];
}

/**
 * THE CRATES BOOK, IN SQL, IN ONE PLACE. Both the balance below and
 * `point-cash`'s crates figure read this file rather than re-deriving the
 * `voided_at IS NULL` filters that make it correct — the same discipline
 * `supplier-balance` holds for the berry debt.
 *
 * POINT-LIFETIME, NO DATE FLOOR. §7.5: «завдаток, узятий у липні, лежить у
 * шухляді в серпні», «від першої видачі». This is a DIFFERENT SHAPE from the
 * berry book, which is anchored on the last physical count and bounded by
 * `as_of`, and the two must not be made to share SQL.
 */
export const CRATE_BOOK_SQL = (point: string): string => `(
    COALESCE((SELECT SUM(ci.deposit_taken)
         FROM crate_issuances ci
         JOIN shifts cs ON cs.id = ci.shift_id
        WHERE cs.collection_point_id = ${point}
          AND ci.voided_at IS NULL), 0.00)
  - COALESCE((SELECT SUM(cr.deposit_refund)
         FROM crate_returns cr
         JOIN shifts rs ON rs.id = cr.shift_id
        WHERE rs.collection_point_id = ${point}
          AND cr.voided_at IS NULL), 0.00)
)`;

@Injectable()
export class CrateBalanceService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Open tranches, OLDEST FIRST, with `created_at` then `id` as the order —
   * the `intakes` tiebreaker, because two documents in one millisecond are
   * ordinary rather than exceptional.
   *
   * `remaining` is DERIVED, never stored (§3.2). A voided return releases its
   * allocations here, by the `cr.voided_at IS NULL` filter on the join, and no
   * allocation row is ever deleted.
   */
  async tranchesFor(supplierId: string, manager?: EntityManager): Promise<CrateTrancheView[]> {
    const runner = manager ?? this.dataSource.manager;
    const rows: Array<{
      issuance_id: string;
      code: string;
      per_unit: string;
      mode: CrateIssuanceMode;
      issued_at: Date;
      remaining_units: string | number;
    }> = await runner.query(
      `SELECT ci.id            AS issuance_id,
              ci.code          AS code,
              ci.deposit_per_unit AS per_unit,
              ci.mode          AS mode,
              ci.created_at    AS issued_at,
              (ci.units - COALESCE((
                  SELECT SUM(a.units)
                    FROM crate_return_allocations a
                    JOIN crate_returns cr ON cr.id = a.return_id
                   WHERE a.issuance_id = ci.id
                     AND cr.voided_at IS NULL), 0))::int AS remaining_units
         FROM crate_issuances ci
        WHERE ci.supplier_id = $1
          AND ci.voided_at IS NULL
        ORDER BY ci.created_at ASC, ci.id ASC`,
      [supplierId],
    );

    return rows
      .map((row) => ({
        issuance_id: row.issuance_id,
        code: row.code,
        per_unit: row.per_unit,
        mode: row.mode,
        issued_at: new Date(row.issued_at).toISOString(),
        // A row COUNT, not money — see this file's eslint guard note below.
        remaining_units: Number.parseInt(String(row.remaining_units), 10),
      }))
      .filter((tranche) => tranche.remaining_units > 0);
  }

  /** §6.3's header — «у цієї людини вже на руках 20 ящ., завдатку за них 2 400 ₴». */
  async balanceFor(supplierId: string, manager?: EntityManager): Promise<CrateBalanceResponse> {
    const tranches = await this.tranchesFor(supplierId, manager);
    const held = tranches.map((t) => mul(t.per_unit, String(t.remaining_units)));

    return {
      supplier_id: supplierId,
      outstanding_units: tranches.reduce((total, t) => total + t.remaining_units, 0),
      deposit_held: held.length ? sum(held) : '0.00',
      tranches,
    };
  }

  /** The point's crates drawer (spec §4.3). One number, no `as_of`. */
  async pointDepositBook(pointId: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    const rows: Array<{ book: string }> = await runner.query(
      `SELECT ${CRATE_BOOK_SQL('$1')} AS book`,
      [pointId],
    );
    return rows[0]?.book ?? '0.00';
  }
}
