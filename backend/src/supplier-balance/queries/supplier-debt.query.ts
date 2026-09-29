import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { debtSql } from '../supplier-debt.sql';

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
}
