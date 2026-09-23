import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ShiftsService } from '../shifts/shifts.service';
import { crateTareUnitsSql } from './crate-balance.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/** §6.8's three numbers. Only `broken` is stored. */
export interface CrateDispatchResponse {
  /** Σ crates on the shift's live intakes. `0` on an empty shift — the query
   *  knows there were none, which is not the same as not knowing. */
  with_berry: number;
  /** `shifts.broken_crates`. `null` while the shift is open. */
  broken: number | null;
  /** `with_berry + broken`, or `null` while `broken` is. Never stored. */
  dispatched: number | null;
}

/**
 * WHY THIS LIVES IN `crates/` AND NOT IN `shifts/`. `crates/` owns crate
 * counting, exactly as `point-cash/` reads `CRATE_BOOK_SQL` out of
 * `crate-balance.service.ts` rather than re-deriving the filter. Putting this
 * query in `shifts/` would make `shifts/` the second module that knows how
 * `is_crate` selects a tare type. The selector itself is `crateTareUnitsSql`
 * in `crate-balance.service.ts`, shared with the point standing. (An earlier
 * draft of the spec claimed the
 * money-arithmetic eslint rule FORCED the move; it does not — `Number.parseInt`
 * is a MemberExpression and passes that rule. The module boundary is the real
 * reason and stands on its own.)
 *
 * NOTHING HERE IS STORED. §6.8's «кількість "з ягодою" запамʼятовується на
 * момент відправлення» is a DISPATCH-DOCUMENT rule, and `crate_shipments` is
 * deferred — so voiding an intake on a closed day silently moves that day's
 * «відвантажено», and §6.8's «було 142, стало 145» warning cannot be built
 * until the snapshot exists. Named in the spec's §4.3, not an oversight.
 */
@Injectable()
export class CrateDispatchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly shifts: ShiftsService,
  ) {}

  async forShift(actor: AuthenticatedUser, shiftId: string): Promise<CrateDispatchResponse> {
    // Point scope and existence are the shifts service's to enforce — a shift
    // at another point 404s there, so this never leaks a foreign point's count.
    const shift = await this.shifts.findOne(actor, shiftId);

    // `::int` IS LOAD-BEARING: an uncast SUM() is int8, which node-postgres
    // yields as a STRING, and `runner.query` returns `any` so TypeScript would
    // not catch it landing in `with_berry: number`.
    const rows: Array<{ with_berry: number }> = await this.dataSource.manager.query(
      `SELECT ${crateTareUnitsSql('i.shift_id = $1')} AS with_berry`,
      [shiftId],
    );

    const with_berry = rows[0]?.with_berry ?? 0;
    const broken = shift.broken_crates;

    return {
      with_berry,
      broken,
      // `null` propagates deliberately. `broken === null` is «не записано», and
      // a dispatched total built on an unknown breakage would be a guess.
      // `broken === 0` is a real value and must still add — hence the explicit
      // null test rather than a falsy one.
      dispatched: broken === null ? null : with_berry + broken,
    };
  }
}
