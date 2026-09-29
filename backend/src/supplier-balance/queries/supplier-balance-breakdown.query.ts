import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { debtSql, debtTermsSql } from '../supplier-debt.sql';
import type { SupplierBalanceBreakdown } from '../supplier-balance.mapper';

/**
 * The balance AND what it is made of, in one read. `GET /suppliers/:id/balance`
 * used to answer one number, so the card rebuilt the explanation from three
 * paginated reads and its tiles were wrong past 100 documents (#103).
 *
 * The three season counters (`intakes_count`, `kg_total`, `last_intake_date`)
 * ride here rather than in a separate summary endpoint because the
 * «Залишки» row and the owner's top-suppliers table want the same numbers,
 * and the programme's register forbids a second query for numbers that
 * already have one.
 *
 * NO `manager` PARAMETER, UNLIKE `SupplierDebtQuery.debtFor`. Nothing inside a
 * locked transaction needs the breakdown — only the bare total, for the payout
 * ceiling — so this always reads through `this.dataSource.manager`.
 */
@Injectable()
export class SupplierBalanceBreakdownQuery {
  constructor(private readonly dataSource: DataSource) {}

  async breakdownFor(supplierId: string): Promise<SupplierBalanceBreakdown> {
    const sql = `SELECT
      ${debtSql('$1')}::text                  AS debt,
      ${debtTermsSql.intakes('$1')}::text     AS intakes_total,
      ${debtTermsSql.topUps('$1')}::text      AS top_ups_total,
      ${debtTermsSql.payouts('$1')}::text     AS payouts_total,
      (SELECT COUNT(i.id)::int FROM intakes i
        WHERE i.supplier_id = $1 AND i.voided_at IS NULL) AS intakes_count,
      (SELECT COALESCE(SUM(ii.net_kg)::text, '0.00') FROM intake_items ii
         JOIN intakes i ON i.id = ii.intake_id
        WHERE i.supplier_id = $1 AND i.voided_at IS NULL) AS kg_total,
      -- ::text, like every other raw-query date in this codebase
      -- (cash-counts.service.ts, seed/dev-seed.ts): the pg driver hands a
      -- bare date column back as a JS Date, and JSON.stringify would then
      -- widen 'YYYY-MM-DD' to a full UTC-midnight timestamp on the wire.
      (SELECT MAX(s.business_date)::text FROM intakes i
         JOIN shifts s ON s.id = i.shift_id
        WHERE i.supplier_id = $1 AND i.voided_at IS NULL) AS last_intake_date`;

    const [row] = (await this.dataSource.manager.query(sql, [
      supplierId,
    ])) as SupplierBalanceBreakdown[];

    return row;
  }
}
