import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The network's settings — one row, one typed column per setting. A new
 * setting is a new column, so the DBML keeps saying what is configurable.
 *
 * `id boolean … CHECK (id)`: the only key value allowed is `true`, so a second
 * row cannot exist. The row is inserted here, so nothing ever has to create it.
 *
 * `receipt_note` is stored ALREADY WRAPPED onto the receipt's ruled lines; the
 * command checks it fits (≤ 7 lines × ≤ 40 characters).
 */
export class NetworkSettings1788600000021 implements MigrationInterface {
  name = 'NetworkSettings1788600000021';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "network_settings" (
        "id" boolean NOT NULL DEFAULT true,
        "receipt_note" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_network_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_network_settings_single_row" CHECK ("id")
      )
    `);
    await queryRunner.query(`INSERT INTO "network_settings" DEFAULT VALUES`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "network_settings"`);
  }
}
