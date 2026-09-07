import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suppliers and the price journal.
 *
 * TWO THINGS IN HERE ARE DELIBERATE ABSENCES, and both are the kind a later
 * reader "fixes":
 *
 * 1. `grade_prices` has NO `updated_at` and NO UNIQUE on
 *    (collection_point_id, product_grade_id). §4.2 requires history —
 *    «записи не перетираються, а додаються» — and that UNIQUE is precisely
 *    what forbade it in the old `shift_grade_prices`. A row is never updated;
 *    a correction is a new row. `suppliers-prices-schema.db-spec.ts` asserts
 *    both absences.
 * 2. `grade_prices` has NO `business_date`. Prices carry over until changed
 *    and the current one is the newest row for the pair. See spec §8.1, which
 *    also records what that costs.
 *
 * THE REGEX IS WRITTEN WITH `[+]` AND `[0-9]`, NOT `\+` AND `\d`, ON PURPOSE.
 * This SQL lives in a JavaScript template literal, where `\+` collapses to a
 * bare `+` and `\d` collapses to a bare `d` before Postgres ever sees the
 * string — producing `^+[1-9]...` (an invalid POSIX regex) and `^[1-9]d{7,14}`
 * (a constraint that matches a literal letter d). Both are silent: the first
 * throws at migration time, the second creates a constraint that rejects every
 * real phone number. Bracket expressions need no escaping and cannot be
 * mangled this way.
 */
export class YagodaSuppliersAndPrices1788600000006 implements MigrationInterface {
  name = 'YagodaSuppliersAndPrices1788600000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "supplier_kind" AS ENUM ('none', 'wholesale', 'farmer')`,
    );

    await queryRunner.query(`
      CREATE TABLE "suppliers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_point_id" uuid NOT NULL,
        "first_name" character varying NOT NULL,
        "last_name" character varying NOT NULL,
        "phone" character varying,
        "note" text,
        "kind" "supplier_kind" NOT NULL DEFAULT 'none',
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_suppliers" PRIMARY KEY ("id"),
        CONSTRAINT "FK_suppliers_point" FOREIGN KEY ("collection_point_id")
          REFERENCES "collection_points"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_suppliers_phone_e164"
          CHECK ("phone" IS NULL OR "phone" ~ '^[+][1-9][0-9]{7,14}$'),
        CONSTRAINT "UQ_suppliers_point_phone" UNIQUE ("collection_point_id", "phone")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_suppliers_point_last_name"
         ON "suppliers" ("collection_point_id", "last_name")`,
    );

    await queryRunner.query(`
      CREATE TABLE "grade_prices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_point_id" uuid NOT NULL,
        "product_grade_id" uuid NOT NULL,
        "base_price" numeric(10,2) NOT NULL,
        "max_markup" numeric(10,2) NOT NULL,
        "max_discount" numeric(10,2) NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_grade_prices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_grade_prices_point" FOREIGN KEY ("collection_point_id")
          REFERENCES "collection_points"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_grade_prices_grade" FOREIGN KEY ("product_grade_id")
          REFERENCES "product_grades"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_grade_prices_author" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_grade_prices_base_price" CHECK ("base_price" >= 0),
        CONSTRAINT "CHK_grade_prices_max_markup" CHECK ("max_markup" >= 0),
        CONSTRAINT "CHK_grade_prices_max_discount" CHECK ("max_discount" >= 0)
      )
    `);
    // Serves the only hot read: "the current price at this point for this
    // grade" is the first row of this index, descending.
    await queryRunner.query(
      `CREATE INDEX "IDX_grade_prices_lookup"
         ON "grade_prices" ("collection_point_id", "product_grade_id", "created_at" DESC)`,
    );
  }

  /**
   * Drops both tables and the enum. This WILL fail once any `intakes` row
   * references a supplier — the safe direction, and the same posture
   * `BootstrapOwner.down()` already takes.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "grade_prices"`);
    await queryRunner.query(`DROP TABLE "suppliers"`);
    await queryRunner.query(`DROP TYPE "supplier_kind"`);
  }
}
