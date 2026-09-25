import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec §8.3 — a return written BY the receipt in the same «Прийняти»: a
 * person who brought berries in our rented crates hands them back in the
 * same visit that punches the intake.
 *
 * NULLABLE because most returns are still a standalone «Прийняти ящики»
 * with no receipt attached.
 *
 * UNIQUE (partial, `WHERE intake_id IS NOT NULL`): one receipt writes AT
 * MOST ONE return.
 *
 * RESTRICT, not CASCADE: nothing deletes a document (§9.3).
 */
export class CrateReturnIntakeLink1788600000018 implements MigrationInterface {
  name = 'CrateReturnIntakeLink1788600000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "crate_returns" ADD COLUMN "intake_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "crate_returns"
        ADD CONSTRAINT "FK_crate_returns_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_crate_returns_intake" ON "crate_returns" ("intake_id") WHERE "intake_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_crate_returns_intake"`);
    await queryRunner.query(`ALTER TABLE "crate_returns" DROP CONSTRAINT "FK_crate_returns_intake"`);
    await queryRunner.query(`ALTER TABLE "crate_returns" DROP COLUMN "intake_id"`);
  }
}
