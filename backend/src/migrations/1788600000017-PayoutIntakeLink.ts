import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * §2.1 step ⑥ and §3.1 — the cash handed over IN THE SAME VISIT as the receipt.
 * Spec 2026-09-21 §2.2.
 *
 * NOT AN ALLOCATION. The correction to §3.3 cancelled «яку саме дату закриває
 * виплата»: a supplier's debt is one number, and this column does not say
 * which receipt a payout settles. It says with which visit the cash left the
 * drawer, so the printed receipt can carry «Видано готівкою» (#116) and the
 * day's list can show «залишок» beside the receipt it was created on.
 *
 * NULLABLE because §3.7's «Видати без ягоди» is a payout with no visit:
 * a person who came for money and brought nothing.
 *
 * RESTRICT, not CASCADE: nothing deletes a document (§9.3), and a payout must
 * never lose its signature because someone tried.
 */
export class PayoutIntakeLink1788600000017 implements MigrationInterface {
  name = 'PayoutIntakeLink1788600000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "payouts" ADD COLUMN "intake_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "payouts"
        ADD CONSTRAINT "FK_payouts_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE RESTRICT
    `);
    // Partial: the receipt read looks up payouts BY intake, and a standalone
    // payout has nothing to be looked up by.
    await queryRunner.query(
      `CREATE INDEX "IDX_payouts_intake" ON "payouts" ("intake_id") WHERE "intake_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_payouts_intake"`);
    await queryRunner.query(`ALTER TABLE "payouts" DROP CONSTRAINT "FK_payouts_intake"`);
    await queryRunner.query(`ALTER TABLE "payouts" DROP COLUMN "intake_id"`);
  }
}
