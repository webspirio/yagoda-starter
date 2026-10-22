import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { JournalTotalsQueryDto } from '../dto/journal-totals.query';
import { resolvePointFilter } from '../../auth/access/point-scope';
import type { AuthenticatedUser } from '../../auth/jwt.strategy';

export interface JournalTotalsResponse {
  accrued: string;
  paid: string;
}

/** `$1`/`$2` the range, `$3` the point, `$4` the supplier — `NULL` meaning «any». */
const scope = (doc: string) => `
  JOIN shifts s ON s.id = ${doc}.shift_id
 WHERE ${doc}.voided_at IS NULL
   AND s.business_date BETWEEN $1 AND $2
   AND ($3::uuid IS NULL OR s.collection_point_id = $3)
   AND ($4::uuid IS NULL OR ${doc}.supplier_id = $4)`;

/**
 * The journal's two tiles (#257): what was accrued for berries and what was
 * paid out over a range, LIVE documents only — the «показувати анульовані»
 * switch shapes the tables, never these sums. One statement, so the two
 * numbers are one snapshot. No top-ups: they reprice a receipt, they are not
 * an intake (#102 is where they reach the journal).
 */
@Injectable()
export class JournalTotalsQuery {
  constructor(private readonly dataSource: DataSource) {}

  async totals(actor: AuthenticatedUser, query: JournalTotalsQueryDto): Promise<JournalTotalsResponse> {
    const pointId = resolvePointFilter(actor, query.collection_point_id);
    // Two scalar subqueries and no FROM: always exactly one row.
    const [row] = (await this.dataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(i.amount), 0.00) FROM intakes i ${scope('i')})::text AS accrued,
         (SELECT COALESCE(SUM(p.amount), 0.00) FROM payouts p ${scope('p')})::text AS paid`,
      [query.from, query.to, pointId ?? null, query.supplier_id ?? null],
    )) as JournalTotalsResponse[];
    return { accrued: row.accrued, paid: row.paid };
  }
}
