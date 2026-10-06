import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 2026-10-06 — the closing operator's own account of a cash discrepancy.
 * Informs the owner; only `explanation` closes the incident.
 *
 * NULLABLE, and a note is never blanked: the CHECK forbids '' and whitespace,
 * so NULL keeps one meaning — «nothing written» (reopen writes it back).
 */
export class ShiftOperatorNote1788600000021 implements MigrationInterface {
  name = 'ShiftOperatorNote1788600000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shifts" ADD COLUMN "operator_note" text`);
    await queryRunner.query(`
      ALTER TABLE "shifts"
        ADD CONSTRAINT "CHK_shifts_operator_note_not_blank"
          CHECK ("operator_note" IS NULL OR btrim("operator_note") <> '')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shifts" DROP CONSTRAINT "CHK_shifts_operator_note_not_blank"`,
    );
    await queryRunner.query(`ALTER TABLE "shifts" DROP COLUMN "operator_note"`);
  }
}
