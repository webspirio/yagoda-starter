import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The crates slice — spec `docs/superpowers/specs/2026-09-15-yagoda-crates-slice.md`.
 * With these three tables the schema of record is complete: 17 of 17.
 *
 * FOUR THINGS A READER SHOULD NOT "FIX":
 *
 * 1. `crate_issuance_mode` ALREADY EXISTS as a Postgres type only if an earlier
 *    migration made it — it did not. The DBML declares the enum; this migration
 *    creates it.
 * 2. `code` IS NOT NULL ON BOTH MODES. The DBML's `receipt_no` was nullable;
 *    ЗАПИТАННЯ 2 is now closed in favour of generation, and a nullable
 *    identifier would make every query branch on mode.
 * 3. THE `is_crate` DEMOTION BEFORE THE INDEX IS LOAD-BEARING. The seeded
 *    catalogue flags two rows (Чешка and Ящик); creating the unique index
 *    without demoting one would fail on every existing database. The rule is
 *    deterministic — keep the oldest — and the owner re-designates through the
 *    catalogue screen whenever they like.
 * 4. CHECK REGEXES AND `\d`: this SQL lives in a JavaScript template literal
 *    where `\d` collapses to a bare `d`. There is no regex here today; if one
 *    is added, use bracket expressions. Same warning as `…0006` and `…0007`.
 */
export class YagodaCrates1788600000012 implements MigrationInterface {
  name = 'YagodaCrates1788600000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "crate_issuance_mode" AS ENUM ('deposit', 'receipt')`);

    await queryRunner.query(`
      CREATE TABLE "crate_issuances" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying NOT NULL,
        "shift_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "units" integer NOT NULL,
        "mode" "crate_issuance_mode" NOT NULL,
        "deposit_per_unit" numeric(12,2) NOT NULL DEFAULT 0,
        "deposit_taken" numeric(12,2) NOT NULL DEFAULT 0,
        "issued_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crate_issuances" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_crate_issuances_code" UNIQUE ("code"),
        CONSTRAINT "FK_crate_issuances_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_issuances_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_issuances_issued_by" FOREIGN KEY ("issued_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_issuances_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_crate_issuances_units" CHECK ("units" > 0),
        CONSTRAINT "CHK_crate_issuances_deposit_per_unit" CHECK ("deposit_per_unit" >= 0),
        CONSTRAINT "CHK_crate_issuances_deposit_taken" CHECK ("deposit_taken" >= 0),
        -- §6.4: «за розписку грошей немає взагалі». The dash on screen is a
        -- rendering of THIS, not of a zero that happens to be stored.
        CONSTRAINT "CHK_crate_issuances_receipt_no_money"
          CHECK ("mode" <> 'receipt' OR ("deposit_per_unit" = 0 AND "deposit_taken" = 0)),
        CONSTRAINT "CHK_crate_issuances_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crate_issuances_supplier_created"
         ON "crate_issuances" ("supplier_id", "created_at")`,
    );
    // The code counter reads exactly this pair — see `crate-code.ts`.
    await queryRunner.query(
      `CREATE INDEX "IDX_crate_issuances_shift_mode" ON "crate_issuances" ("shift_id", "mode")`,
    );

    await queryRunner.query(`
      CREATE TABLE "crate_returns" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "shift_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "units" integer NOT NULL,
        "deposit_refund" numeric(12,2) NOT NULL DEFAULT 0,
        "accepted_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crate_returns" PRIMARY KEY ("id"),
        CONSTRAINT "FK_crate_returns_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_returns_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_returns_accepted_by" FOREIGN KEY ("accepted_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_crate_returns_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_crate_returns_units" CHECK ("units" > 0),
        CONSTRAINT "CHK_crate_returns_deposit_refund" CHECK ("deposit_refund" >= 0),
        CONSTRAINT "CHK_crate_returns_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crate_returns_supplier_created"
         ON "crate_returns" ("supplier_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE "crate_return_allocations" (
        "return_id" uuid NOT NULL,
        "issuance_id" uuid NOT NULL,
        "units" integer NOT NULL,
        "per_unit" numeric(12,2) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        CONSTRAINT "PK_crate_return_allocations" PRIMARY KEY ("return_id", "issuance_id"),
        -- CASCADE on the return (a composition child, like intake_items),
        -- RESTRICT on the issuance (nothing may vanish under these rows).
        CONSTRAINT "FK_crate_return_allocations_return" FOREIGN KEY ("return_id")
          REFERENCES "crate_returns"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_crate_return_allocations_issuance" FOREIGN KEY ("issuance_id")
          REFERENCES "crate_issuances"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_crate_return_allocations_units" CHECK ("units" > 0),
        CONSTRAINT "CHK_crate_return_allocations_per_unit" CHECK ("per_unit" >= 0),
        CONSTRAINT "CHK_crate_return_allocations_amount" CHECK ("amount" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_crate_return_allocations_issuance"
         ON "crate_return_allocations" ("issuance_id")`,
    );

    // ---- tare_types: exactly one crate -------------------------------------
    // Demote every flagged row but the oldest, THEN build the index. See this
    // file's header, point 3.
    await queryRunner.query(`
      UPDATE "tare_types" SET "is_crate" = false
       WHERE "is_crate"
         AND "id" <> (SELECT "id" FROM "tare_types" WHERE "is_crate"
                       ORDER BY "created_at", "id" LIMIT 1)
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_tare_types_single_crate"
         ON "tare_types" ("is_crate") WHERE "is_crate"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // NOT A ROUND TRIP, DELIBERATELY. `up()` demotes every flagged `tare_types`
    // row but the oldest before building the unique index (see point 3 above);
    // this `down()` drops the index but does not undo that demotion, so
    // up→down→up leaves the catalogue's `is_crate` flags exactly as `up()`
    // last set them rather than restoring whatever they were before this
    // migration first ran. That is fine — the demotion is a deterministic,
    // idempotent normalisation (keep the oldest flagged row), not data this
    // migration owns the previous value of.
    await queryRunner.query(`DROP INDEX "UQ_tare_types_single_crate"`);
    await queryRunner.query(`DROP TABLE "crate_return_allocations"`);
    await queryRunner.query(`DROP TABLE "crate_returns"`);
    await queryRunner.query(`DROP TABLE "crate_issuances"`);
    await queryRunner.query(`DROP TYPE "crate_issuance_mode"`);
  }
}
