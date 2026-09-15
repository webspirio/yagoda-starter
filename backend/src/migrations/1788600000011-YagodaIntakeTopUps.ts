import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `intake_top_ups` — «фантомний залишок» (#61), the third source of supplier
 * debt.
 *
 * THIS TABLE IS NOT IN `28-db-schema.dbml`'s original seventeen. It is added by
 * the intake top-ups slice, and that slice also AMENDS the `suppliers` Note,
 * whose canonical debt SQL had two terms and now has three. If you are reading
 * this migration because the DBML and the code disagree, the DBML is the one
 * that was meant to change — see
 * `docs/superpowers/specs/2026-09-11-yagoda-intake-top-ups-slice.md` §12.
 *
 * FOUR ABSENCES THAT ARE DECISIONS, argued in the entity's header: no
 * `supplier_id`, no `shift_id`, no date column, no `code`.
 *
 * `amount > 0` is STRICTLY greater, unlike `CHK_intakes_amount`'s `>= 0`: a
 * zero top-up is a debt document that changes no debt.
 *
 * NO UNIQUE INDEX ON `intake_id`. Several top-ups on one receipt are legal and
 * necessary — §9.3 makes a correction a void plus a NEW row, so uniqueness
 * would make this the only uncorrectable record in the system.
 */
export class YagodaIntakeTopUps1788600000011 implements MigrationInterface {
  name = 'YagodaIntakeTopUps1788600000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "intake_top_ups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "intake_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "reason" text NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_intake_top_ups" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_intake_top_ups_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_intake_top_ups_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)),
        CONSTRAINT "FK_intake_top_ups_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intake_top_ups_created_by" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intake_top_ups_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    // Every read of this table arrives through its parent, including the
    // balance subquery correlated over a page of suppliers.
    await queryRunner.query(`
      CREATE INDEX "IDX_intake_top_ups_intake" ON "intake_top_ups" ("intake_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "intake_top_ups"`);
  }
}
