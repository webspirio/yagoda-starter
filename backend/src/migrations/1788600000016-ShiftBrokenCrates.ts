import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ADDS `shifts.broken_crates` — §6.8's «бій», the one fact in issue #110 that
 * no table could hold.
 *
 * NULLABLE WITH NO DEFAULT, AND THAT IS THE WHOLE DESIGN. A `DEFAULT 0` would
 * backfill «нічого не побилось» onto every shift ever closed, including the
 * 150 the dev seed generates, and make «не записано» indistinguishable from a
 * real zero on every one of them. `collection_points.target_crates` is
 * nullable for the identical reason, stated in its own DBML Note.
 *
 * `CHK_shifts_broken_crates_closed` is therefore ONE-SIDED: it forbids a count
 * on an OPEN shift, which is true forever, rather than requiring one on a
 * closed shift, which no pre-existing row can satisfy.
 */
export class ShiftBrokenCrates1788600000016 implements MigrationInterface {
  name = 'ShiftBrokenCrates1788600000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shifts" ADD "broken_crates" integer`);
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD CONSTRAINT "CHK_shifts_broken_crates_non_negative"
         CHECK ("broken_crates" >= 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "shifts" ADD CONSTRAINT "CHK_shifts_broken_crates_closed"
         CHECK ("closed_at" IS NOT NULL OR "broken_crates" IS NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shifts" DROP CONSTRAINT "CHK_shifts_broken_crates_closed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shifts" DROP CONSTRAINT "CHK_shifts_broken_crates_non_negative"`,
    );
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "broken_crates"`);
  }
}
