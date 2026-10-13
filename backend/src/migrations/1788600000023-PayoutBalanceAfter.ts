import { MigrationInterface, QueryRunner } from 'typeorm';

/** The as-of rebuild of every payout's `balance_after`. The dev seed reuses it (appending a
 *  `WHERE`) so seeded payouts get the same figure instead of a second hand-written formula. */
export const REBUILD_BALANCE_AFTER_SQL = `
      UPDATE "payouts" p SET "balance_after" =
          COALESCE((SELECT SUM(i."amount") FROM "intakes" i
                     WHERE i."supplier_id" = p."supplier_id" AND i."created_at" <= p."created_at"
                       AND (i."voided_at" IS NULL OR i."voided_at" > p."created_at")), 0.00)
        + COALESCE((SELECT SUM(t."amount") FROM "intake_top_ups" t
                      JOIN "intakes" ti ON ti."id" = t."intake_id"
                     WHERE ti."supplier_id" = p."supplier_id" AND t."created_at" <= p."created_at"
                       AND (t."voided_at"  IS NULL OR t."voided_at"  > p."created_at")
                       AND (ti."voided_at" IS NULL OR ti."voided_at" > p."created_at")), 0.00)
        - COALESCE((SELECT SUM(q2."amount") FROM "payouts" q2
                     WHERE q2."supplier_id" = p."supplier_id" AND q2."created_at" <= p."created_at"
                       AND (q2."voided_at" IS NULL OR q2."voided_at" > p."created_at")), 0.00)`;

/**
 * #145 — `payouts.balance_after`: the supplier's debt right AFTER the payout, frozen at write
 * time so the payout receipt prints the same figure on every reprint. A record of what was
 * printed, never a source of debt (the formula in `supplier-debt.query` still is).
 *
 * Historic rows are rebuilt AS OF each payout: the supplier's intakes, top-ups and payouts
 * created no later than it and not yet voided at that moment. The key is `created_at` (the
 * transaction's start), so two transactions that queued on the supplier lock may order
 * differently here than they committed — historic rows only; new rows are exact.
 */
export class PayoutBalanceAfter1788600000023 implements MigrationInterface {
  name = 'PayoutBalanceAfter1788600000023';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payouts" ADD "balance_after" numeric(12,2)`);
    await q.query(REBUILD_BALANCE_AFTER_SQL);
    await q.query(`ALTER TABLE "payouts" ALTER COLUMN "balance_after" SET NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payouts" DROP COLUMN "balance_after"`);
  }
}
