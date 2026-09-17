import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The reweigh slice — spec `docs/superpowers/specs/2026-09-17-yagoda-reweigh-slice.md`.
 * The first tables in this schema that describe the BASE rather than a point.
 *
 * FOUR THINGS A READER SHOULD NOT "FIX":
 *
 * 1. `reweighs` HAS NO COLUMNS OF ITS OWN, and that is the design (spec §3.2).
 *    It is one row per shift whose only job is to be the parent of lines that
 *    accumulate across deliveries. The columns it is waiting for are §8.5's
 *    `expense_allocation` + `allocation_product_id`, which strategy ③ «усе на
 *    один товар» will need — see the follow-ups file.
 * 2. THERE IS NO `posted_at` AND NO STATUS (spec §3.3). Собівартість is computed
 *    live from whatever lines exist. §8.2's «звірка видна ДО проведення» is
 *    implemented as the open-shift rule in the reconciliation read, not as a
 *    posting gate, because §8.1 puts the weighing a day after the shift and
 *    §8.7 puts it in different hands than §10.3 puts the closing.
 * 3. VOID IS ON THE LINE, AND THE HEADER HAS NO `void_*` (spec §3.4). §8.7's own
 *    storno reason is «переважили не ту партію» — a batch. A header-level void
 *    would throw away a day to fix one pallet.
 * 4. NO `code` (spec §3.11). `code` exists where a human walks away holding the
 *    paper (§6.2). Nothing is printed at the base. `transfers` and
 *    `intake_top_ups` decided the same way for the same reason.
 *
 * `reweigh_items` CARRIES TIMESTAMPS although `intake_items` does not: an intake
 * line is frozen with its parent, while a reweigh line is written and voided on
 * its own, days after its header.
 */
export class YagodaReweigh1788600000013 implements MigrationInterface {
  name = 'YagodaReweigh1788600000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "reweighs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "shift_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reweighs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reweighs_shift" UNIQUE ("shift_id"),
        CONSTRAINT "FK_reweighs_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "reweigh_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "reweigh_id" uuid NOT NULL,
        "item_order" integer NOT NULL,
        "product_grade_id" uuid NOT NULL,
        "gross_kg" numeric(10,2) NOT NULL,
        "pallet_kg" numeric(10,2) NOT NULL DEFAULT 0,
        "tare_weight_kg" numeric(10,2) NOT NULL,
        "net_kg" numeric(10,2) NOT NULL,
        "weighed_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_reweigh_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_reweigh_items_order" UNIQUE ("reweigh_id", "item_order"),
        CONSTRAINT "FK_reweigh_items_reweigh" FOREIGN KEY ("reweigh_id")
          REFERENCES "reweighs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reweigh_items_product_grade" FOREIGN KEY ("product_grade_id")
          REFERENCES "product_grades"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reweigh_items_weighed_by" FOREIGN KEY ("weighed_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_reweigh_items_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_reweigh_items_gross_kg" CHECK ("gross_kg" > 0),
        CONSTRAINT "CHK_reweigh_items_pallet_kg" CHECK ("pallet_kg" >= 0),
        CONSTRAINT "CHK_reweigh_items_tare_weight_kg" CHECK ("tare_weight_kg" >= 0),
        -- §8.1's net is what remains after the pallet and then the tare. A line
        -- that nets to zero or less is a measurement error, not a document.
        CONSTRAINT "CHK_reweigh_items_net_kg" CHECK ("net_kg" > 0),
        CONSTRAINT "CHK_reweigh_items_order" CHECK ("item_order" > 0),
        CONSTRAINT "CHK_reweigh_items_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_reweigh_items_reweigh" ON "reweigh_items" ("reweigh_id")`,
    );
    // The reconciliation groups by grade over a whole header.
    await queryRunner.query(
      `CREATE INDEX "IDX_reweigh_items_grade" ON "reweigh_items" ("product_grade_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "reweigh_item_tare_types" (
        "item_id" uuid NOT NULL,
        "tare_type_id" uuid NOT NULL,
        "units" integer NOT NULL,
        CONSTRAINT "PK_reweigh_item_tare_types" PRIMARY KEY ("item_id", "tare_type_id"),
        CONSTRAINT "FK_reweigh_item_tare_types_item" FOREIGN KEY ("item_id")
          REFERENCES "reweigh_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_reweigh_item_tare_types_tare_type" FOREIGN KEY ("tare_type_id")
          REFERENCES "tare_types"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_reweigh_item_tare_types_units" CHECK ("units" > 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "reweigh_item_tare_types"`);
    await queryRunner.query(`DROP TABLE "reweigh_items"`);
    await queryRunner.query(`DROP TABLE "reweighs"`);
  }
}
