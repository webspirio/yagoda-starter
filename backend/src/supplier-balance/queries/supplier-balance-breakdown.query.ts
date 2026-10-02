import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { debtSql } from '../supplier-debt.sql';
import type { SupplierBalanceBreakdown } from '../supplier-balance.mapper';

/**
 * The balance AND the season counters, in one read. `GET /suppliers/:id/balance`
 * used to answer one number, so the card rebuilt its tiles from three
 * paginated reads and they were wrong past 100 documents (#103).
 *
 * THE THREE TERMS OF `debt` ARE NOT HERE — they ride on `/settlement`
 * (`SupplierDebtQuery.termsFor`), which is the snapshot the card's balance tile
 * reads; a breakdown line fed from this separate request could land on the
 * other side of a write and fail to add up to the tile above it (#153). That
 * also keeps this read cheap for the reception screen's payout ceiling, which
 * wants only `debt`.
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
      ${debtSql('$1')}::text AS debt,
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
