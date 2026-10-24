import { MigrationInterface, QueryRunner } from 'typeorm';

/** The as-of rebuild of every intake's `balance_after`. The dev seed reuses it (appending a
 *  `WHERE`) so seeded receipts get the same figure instead of a second hand-written formula. */
export const REBUILD_INTAKE_BALANCE_AFTER_SQL = `
      UPDATE "intakes" i SET "balance_after" =
          COALESCE((SELECT SUM(i2."amount") FROM "intakes" i2
                     WHERE i2."supplier_id" = i."supplier_id"
                       AND (i2."created_at", i2."id") <= (i."created_at", i."id")
                       AND (i2."voided_at" IS NULL OR i2."voided_at" > i."created_at")), 0.00)
        + COALESCE((SELECT SUM(t."amount") FROM "intake_top_ups" t
                      JOIN "intakes" ti ON ti."id" = t."intake_id"
                     WHERE ti."supplier_id" = i."supplier_id" AND t."created_at" <= i."created_at"
                       AND (t."voided_at"  IS NULL OR t."voided_at"  > i."created_at")
                       AND (ti."voided_at" IS NULL OR ti."voided_at" > i."created_at")), 0.00)
        - COALESCE((SELECT SUM(p."amount") FROM "payouts" p
                      LEFT JOIN "intakes" pi ON pi."id" = p."intake_id"
                     WHERE p."supplier_id" = i."supplier_id"
                       AND CASE WHEN p."intake_id" IS NULL THEN p."created_at" <= i."created_at"
                                ELSE (pi."created_at", pi."id") <= (i."created_at", i."id") END
                       AND (p."voided_at" IS NULL OR p."voided_at" > i."created_at")), 0.00)`;

/**
 * Audit 2026-10-24 A1 — `intakes.balance_after`: the supplier's debt right AFTER the receipt,
 * including the cash handed over with it (`payouts.intake_id`, §2.1 ⑥), frozen at write time
 * so a reprint of the receipt prints the «Борг · Разом · Залишок» it printed the first time.
 * Before this column the receipt derived them from the LIVE debt, so any later document of the
 * supplier moved a reprint. The twin of `payouts.balance_after` (#145, `PayoutBalanceAfter`):
 * a record of what was printed, never a source of debt (`supplier-debt` still is).
 *
 * Historic rows are rebuilt AS OF each receipt: the supplier's receipts, top-ups and payouts
 * that existed by then and were not yet voided at that moment. Receipts are ordered by
 * `(created_at, id)`, so two that share a `created_at` count only the earlier one, never each
 * other both ways. A payout made at reception (`intake_id` set) is part of its receipt's
 * transaction, so it counts exactly when its receipt does — this one's own included, even when
 * it was voided later; a standalone payout counts when `created_at <=` this receipt's. The key
 * is `created_at` (the transaction's start), so two transactions that queued on the supplier
 * lock may order differently here than they committed — historic rows only; new rows are exact.
 *
 * A rebuilt figure prints with no «reconstructed» mark — the same call #145 made for payouts.
 * Unlike a payout, a historic receipt WAS printed before this column, from the live debt at the
 * time of printing; the rebuild is the debt at the moment it was recorded, which is what the
 * first print showed whenever nothing else had happened to that supplier in between.
 *
 * The SQL lives in a module-level constant, so `scripts/verify/checks/schema-conformance.mjs`
 * (which scans string literals inside `up()` only) never sees it. It holds no column types and
 * no DDL — the DDL stays inside `up()`.
 *
 * SHIPPED — DO NOT EDIT once merged. `REBUILD_INTAKE_BALANCE_AFTER_SQL` is shared with the dev
 * seed, so a future change to the debt formula needs a NEW constant and a NEW migration.
 */
export class IntakeBalanceAfter1788600000025 implements MigrationInterface {
  name = 'IntakeBalanceAfter1788600000025';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "intakes" ADD "balance_after" numeric(12,2)`);
    await q.query(REBUILD_INTAKE_BALANCE_AFTER_SQL);
    await q.query(`ALTER TABLE "intakes" ALTER COLUMN "balance_after" SET NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "intakes" DROP COLUMN "balance_after"`);
  }
}
