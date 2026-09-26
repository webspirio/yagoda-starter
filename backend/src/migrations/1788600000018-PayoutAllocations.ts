import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillPayoutAllocations } from '../common/payout-allocations-backfill';

/**
 * Stored allocations — spec 2026-09-26. Reverses the 04.09.2026 removal, which was
 * a failed schema simplification, not the owner's decision.
 *
 * A row is a frozen fact: «payout P paid `amount` of this receipt/top-up».
 * Only `voided_at` ever changes (`AllocationsService.release`).
 *
 * The backfill (`../common/payout-allocations-backfill.ts`, kept out of THIS directory —
 * see its header) runs a FROZEN copy of `settle()` in integer kopecks: a migration must
 * not import application code that may change after it ships.
 */
export class PayoutAllocations1788600000018 implements MigrationInterface {
  name = 'PayoutAllocations1788600000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payout_allocations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "payout_id" uuid NOT NULL,
        "intake_id" uuid,
        "intake_top_up_id" uuid,
        "amount" numeric(12,2) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "voided_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_payout_allocations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payout_allocations_payout" FOREIGN KEY ("payout_id")
          REFERENCES "payouts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payout_allocations_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payout_allocations_top_up" FOREIGN KEY ("intake_top_up_id")
          REFERENCES "intake_top_ups"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_payout_allocations_one_target"
          CHECK (num_nonnulls("intake_id", "intake_top_up_id") = 1),
        CONSTRAINT "CHK_payout_allocations_amount" CHECK ("amount" > 0)
      )
    `);
    // Partial: every read and every release filters live rows.
    for (const [name, col] of [
      ['IDX_payout_allocations_payout', 'payout_id'],
      ['IDX_payout_allocations_intake', 'intake_id'],
      ['IDX_payout_allocations_top_up', 'intake_top_up_id'],
    ]) {
      await queryRunner.query(
        `CREATE INDEX "${name}" ON "payout_allocations" ("${col}") WHERE "voided_at" IS NULL`,
      );
    }
    await backfillPayoutAllocations(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payout_allocations"`);
  }
}
