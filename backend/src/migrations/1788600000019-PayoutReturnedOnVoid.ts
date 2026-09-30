import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-09-28 team decision: a payout voided while its shift is open puts the cash back into
 * THAT shift's drawer at once. `return_settled_at` alone would book it by calendar date, which
 * misfiles a void after midnight or in a reopened shift. Spec 2026-09-28 §3 decisions 3–4.
 * No backfill: earlier voids keep their pending or date-attributed return (decision 7).
 */
export class PayoutReturnedOnVoid1788600000019 implements MigrationInterface {
  name = 'PayoutReturnedOnVoid1788600000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payouts" ADD COLUMN "returned_on_void" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      ALTER TABLE "payouts" ADD CONSTRAINT "CHK_payouts_returned_on_void"
        CHECK (NOT "returned_on_void" OR "return_settled_at" IS NOT NULL)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payouts" DROP CONSTRAINT "CHK_payouts_returned_on_void"`);
    await queryRunner.query(`ALTER TABLE "payouts" DROP COLUMN "returned_on_void"`);
  }
}
