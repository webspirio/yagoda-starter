import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { debtSql, debtTermsSql } from '../supplier-debt.sql';

/** `debt` and the three sums it is made of — every field a decimal string. */
export interface DebtTerms {
  debt: string;
  intakes_total: string;
  top_ups_total: string;
  payouts_total: string;
}

/** A supplier's debt as a decimal string. The payout ceiling passes its manager so the read
 *  sits under the supplier lock it checks against. Nothing is cached, nothing stored (§3.2). */
@Injectable()
export class SupplierDebtQuery {
  constructor(private readonly dataSource: DataSource) {}

  async debtFor(supplierId: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    // `::text` so the numeric never passes through a JS number (foundation §5.1).
    const [row] = (await runner.query(`SELECT ${debtSql('$1')}::text AS debt`, [supplierId])) as {
      debt: string;
    }[];
    return row.debt;
  }

  /**
   * The debt WITH its three terms (#153) — what `/settlement` returns so the
   * card's breakdown line reads the same snapshot as the balance tile. Each
   * term is evaluated ONCE in the inner select and `debt` is derived from
   * them, which is `debtSql`'s own composition, not a restatement of it.
   */
  async termsFor(supplierId: string, manager?: EntityManager): Promise<DebtTerms> {
    const runner = manager ?? this.dataSource.manager;
    const [row] = (await runner.query(
      `SELECT (t.intakes_total + t.top_ups_total - t.payouts_total)::text AS debt,
              t.intakes_total::text AS intakes_total,
              t.top_ups_total::text AS top_ups_total,
              t.payouts_total::text AS payouts_total
         FROM (SELECT ${debtTermsSql.intakes('$1')} AS intakes_total,
                      ${debtTermsSql.topUps('$1')}  AS top_ups_total,
                      ${debtTermsSql.payouts('$1')} AS payouts_total) t`,
      [supplierId],
    )) as DebtTerms[];
    return row;
  }
}
