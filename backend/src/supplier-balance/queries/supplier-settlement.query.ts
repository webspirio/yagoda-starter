import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { fromAllocations, AllocationRow, DebtLine, PayoutLine, Settlement } from '../settlement';
import { SupplierDebtQuery } from './supplier-debt.query';

/** Queue key (business_date, created_at, id); ISO dates and timestamp::text sort lexicographically. */
const byQueueKey = (a: DebtLine, b: DebtLine): number =>
  a.business_date < b.business_date
    ? -1
    : a.business_date > b.business_date
      ? 1
      : a.created_at < b.created_at
        ? -1
        : a.created_at > b.created_at
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0;

@Injectable()
export class SupplierSettlementQuery {
  constructor(
    private readonly dataSource: DataSource,
    private readonly debt: SupplierDebtQuery,
  ) {}

  /** «За що саме винні» for one supplier. Live documents (the four `voided_at` filters of `debtSql`) plus live allocation rows, in one REPEATABLE READ snapshot so `debt` and `Σ open − unallocated` agree. */
  async settlementFor(supplierId: string): Promise<Settlement & { debt: string }> {
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      type IntakeRow = {
        id: string;
        code: string;
        business_date: string;
        created_at: string;
        amount: string;
      };
      type TopUpRow = IntakeRow & { intake_id: string };
      type PayoutRow = IntakeRow & { intake_id: string | null };

      const intakes = (await manager.query(
        `SELECT i.id, i.code, s.business_date::text AS business_date,
                i.created_at::text AS created_at, i.amount::text AS amount
           FROM intakes i
           JOIN shifts s ON s.id = i.shift_id
          WHERE i.supplier_id = $1 AND i.voided_at IS NULL
          ORDER BY s.business_date, i.created_at, i.id`,
        [supplierId],
      )) as IntakeRow[];

      const topUps = (await manager.query(
        `SELECT t.id, ti.code, t.intake_id, s.business_date::text AS business_date,
                t.created_at::text AS created_at, t.amount::text AS amount
           FROM intake_top_ups t
           JOIN intakes ti ON ti.id = t.intake_id
           JOIN shifts s ON s.id = ti.shift_id
          WHERE ti.supplier_id = $1
            AND ti.voided_at IS NULL
            AND t.voided_at IS NULL
          ORDER BY s.business_date, t.created_at, t.id`,
        [supplierId],
      )) as TopUpRow[];

      const payouts = (await manager.query(
        `SELECT p.id, p.code, p.intake_id, s.business_date::text AS business_date,
                p.created_at::text AS created_at, p.amount::text AS amount
           FROM payouts p
           JOIN shifts s ON s.id = p.shift_id
          WHERE p.supplier_id = $1 AND p.voided_at IS NULL
          ORDER BY s.business_date, p.created_at, p.id`,
        [supplierId],
      )) as PayoutRow[];

      const lines: DebtLine[] = [
        ...intakes.map((r): DebtLine => ({ ...r, kind: 'intake', intake_id: r.id })),
        ...topUps.map((r): DebtLine => ({ ...r, kind: 'top_up' })),
      ].sort(byQueueKey);
      const payoutLines: PayoutLine[] = payouts;

      const allocations = (await manager.query(
        `SELECT a.payout_id, a.intake_id, a.intake_top_up_id, a.amount::text AS amount
           FROM payout_allocations a
           JOIN payouts p ON p.id = a.payout_id
          WHERE p.supplier_id = $1 AND a.voided_at IS NULL
          ORDER BY a.created_at, a.id`,
        [supplierId],
      )) as AllocationRow[];

      const debt = await this.debt.debtFor(supplierId, manager);
      return { debt, ...fromAllocations(lines, payoutLines, allocations) };
    });
  }
}
