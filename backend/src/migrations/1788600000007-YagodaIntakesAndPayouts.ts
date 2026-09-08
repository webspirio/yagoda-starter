import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first two documents in the system, and the shift that contains them.
 *
 * FIVE THINGS IN HERE LOOK LIKE OMISSIONS AND ARE NOT. A later reader — or a
 * `migration:generate` run — will try to "fix" each one:
 *
 * 1. `shifts.explanation` and the `awaiting_explanation` enum value are
 *    UNWRITTEN ON PURPOSE. Both land with `cash_counts`, which is the only
 *    thing that can detect the discrepancy they describe. They stay because
 *    28-db-schema.dbml is the schema of record, and because adding an enum
 *    value later is a migration nobody should have to write.
 * 2. `intake_items` has NO `created_at`/`updated_at` and NO equality CHECK on
 *    `amount`. Foundation §5.4 refuses the latter outright: stored money is
 *    rounded to two decimals, so an exact check rejects legitimate rows and a
 *    tolerant one is the «допустима розбіжність» the schema will not have.
 * 3. `intake_items.bonus` has NO non-negative CHECK. §2.8 — «від'ємний bonus це
 *    м'ята чи цвіла ягода». Adding one makes docking for spoiled fruit
 *    impossible.
 * 4. `shifts` has NO void_* trio and NO `opened_at`. A shift is not a paper
 *    document; it is reopened, not voided (spec §8.2), and `created_at` is the
 *    open instant (spec §8.3).
 * 5. `UQ_shifts_point_business_date` is an ADDITION to the DBML, which writes
 *    that index non-unique. `POST /shifts/:id/reopen` exists BECAUSE of it —
 *    removing one without the other strands a point for a whole day after a
 *    mistaken close. Spec §8.1.
 *
 * THE CHECK REGEX IS WRITTEN WITH `[A-Z0-9]`, NOT `\w` OR `\d`, ON PURPOSE.
 * This SQL lives in a JavaScript template literal where `\d` collapses to a
 * bare `d` before Postgres ever sees it, producing a constraint that matches a
 * literal letter. Bracket expressions need no escaping and cannot be mangled
 * this way. Same warning as `1788600000006-YagodaSuppliersAndPrices`.
 */
export class YagodaIntakesAndPayouts1788600000007 implements MigrationInterface {
  name = 'YagodaIntakesAndPayouts1788600000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- collection_points.code -------------------------------------------
    // Required by the receipt-code scheme (spec §6.2): without a point
    // identifier in the code, the DBML's own global UNIQUE (code) is
    // unsatisfiable for two points using identical paper receipt books.
    await queryRunner.query(`ALTER TABLE "collection_points" ADD COLUMN "code" character varying`);
    // Deterministic backfill so the column can be NOT NULL immediately. The
    // owner renames these to something meaningful via PATCH whenever they like.
    //
    // THE `CASE` IS NOT DECORATION. Postgres `lpad` TRUNCATES when the input is
    // longer than the target width — `lpad('100', 2, '0')` is `'10'`, not
    // `'100'` — so a bare `lpad(rn::text, 2, '0')` silently maps row 100 onto
    // row 10's code and the UNIQUE below fails to build. Caught by
    // `intakes-payouts-schema.db-spec.ts` against a test database that had
    // accumulated 274 points; a fresh database with three points would have
    // shipped this happily and broken on the hundredth point years later.
    await queryRunner.query(`
      UPDATE "collection_points" AS cp
         SET "code" = t.generated
        FROM (SELECT id,
                     'P' || CASE
                              WHEN row_number() OVER (ORDER BY created_at, id) < 100
                                THEN lpad(row_number() OVER (ORDER BY created_at, id)::text, 2, '0')
                              ELSE row_number() OVER (ORDER BY created_at, id)::text
                            END AS generated
                FROM "collection_points") AS t
       WHERE cp.id = t.id
    `);
    await queryRunner.query(`ALTER TABLE "collection_points" ALTER COLUMN "code" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "collection_points"
         ADD CONSTRAINT "UQ_collection_points_code" UNIQUE ("code")`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_points"
         ADD CONSTRAINT "CHK_collection_points_code" CHECK ("code" ~ '^[A-Z0-9]{2,8}$')`,
    );

    // ---- shifts ------------------------------------------------------------
    await queryRunner.query(
      `CREATE TYPE "shift_status" AS ENUM ('open', 'awaiting_explanation', 'closed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "shifts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_point_id" uuid NOT NULL,
        "opened_by_user_id" uuid NOT NULL,
        "closed_by_user_id" uuid,
        "business_date" date NOT NULL,
        "closed_at" TIMESTAMP WITH TIME ZONE,
        "status" "shift_status" NOT NULL DEFAULT 'open',
        "explanation" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shifts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_shifts_point" FOREIGN KEY ("collection_point_id")
          REFERENCES "collection_points"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_shifts_opened_by" FOREIGN KEY ("opened_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_shifts_closed_by" FOREIGN KEY ("closed_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "UQ_shifts_point_business_date"
          UNIQUE ("collection_point_id", "business_date"),
        CONSTRAINT "CHK_shifts_closed_pair"
          CHECK (("closed_at" IS NULL) = ("closed_by_user_id" IS NULL)),
        -- Written as open <=> no closed_at, NOT as closed <=> closed_at, so
        -- that 'awaiting_explanation' stays storable alongside a closed_at when
        -- cash_counts lands. The stricter form would need a migration then.
        CONSTRAINT "CHK_shifts_open_status"
          CHECK (("status" = 'open') = ("closed_at" IS NULL))
      )
    `);

    // §7.8 — «дві відкриті зміни це дві книги на одну шухляду». The DBML writes
    // `(collection_point_id) [unique]`, which would forbid a point from ever
    // having a SECOND shift; the partial form is what the rule actually says.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shifts_open_per_point"
         ON "shifts" ("collection_point_id") WHERE "closed_at" IS NULL`,
    );

    // ---- intakes -----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "intakes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying NOT NULL,
        "shift_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "received_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_intakes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_intakes_code" UNIQUE ("code"),
        CONSTRAINT "FK_intakes_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intakes_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intakes_received_by" FOREIGN KEY ("received_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_intakes_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        -- §9.3 makes the REASON mandatory, which is why voiding is a trio of
        -- columns and not a status value.
        CONSTRAINT "CHK_intakes_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)),
        CONSTRAINT "CHK_intakes_amount" CHECK ("amount" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_intakes_supplier_created" ON "intakes" ("supplier_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_intakes_shift" ON "intakes" ("shift_id")`);

    // ---- intake_items ------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "intake_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "intake_id" uuid NOT NULL,
        "item_order" integer NOT NULL,
        "product_grade_id" uuid NOT NULL,
        "gross_kg" numeric(10,2) NOT NULL,
        "pallet_kg" numeric(10,2) NOT NULL DEFAULT 0,
        "tare_weight_kg" numeric(10,2) NOT NULL,
        "net_kg" numeric(10,2) NOT NULL,
        "price" numeric(10,2) NOT NULL,
        "bonus" numeric(10,2) NOT NULL DEFAULT 0,
        "amount" numeric(12,2) NOT NULL,
        CONSTRAINT "PK_intake_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_intake_items_order" UNIQUE ("intake_id", "item_order"),
        CONSTRAINT "FK_intake_items_intake" FOREIGN KEY ("intake_id")
          REFERENCES "intakes"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_intake_items_grade" FOREIGN KEY ("product_grade_id")
          REFERENCES "product_grades"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_intake_items_gross_kg" CHECK ("gross_kg" > 0),
        CONSTRAINT "CHK_intake_items_pallet_kg" CHECK ("pallet_kg" >= 0),
        CONSTRAINT "CHK_intake_items_tare_weight_kg" CHECK ("tare_weight_kg" >= 0),
        CONSTRAINT "CHK_intake_items_net_kg" CHECK ("net_kg" > 0),
        CONSTRAINT "CHK_intake_items_price" CHECK ("price" >= 0),
        CONSTRAINT "CHK_intake_items_amount" CHECK ("amount" >= 0),
        CONSTRAINT "CHK_intake_items_order" CHECK ("item_order" > 0)
        -- NO CHECK ON "bonus". §2.8 — a negative bonus is «м'ята чи цвіла ягода».
      )
    `);

    // ---- intake_item_tare_types -------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "intake_item_tare_types" (
        "item_id" uuid NOT NULL,
        "tare_type_id" uuid NOT NULL,
        "units" integer NOT NULL,
        CONSTRAINT "PK_intake_item_tare_types" PRIMARY KEY ("item_id", "tare_type_id"),
        CONSTRAINT "FK_intake_item_tare_types_item" FOREIGN KEY ("item_id")
          REFERENCES "intake_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_intake_item_tare_types_tare" FOREIGN KEY ("tare_type_id")
          REFERENCES "tare_types"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_intake_item_tare_types_units" CHECK ("units" > 0)
      )
    `);

    // ---- payouts -----------------------------------------------------------
    await queryRunner.query(`
      CREATE TABLE "payouts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "code" character varying NOT NULL,
        "shift_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "paid_by_user_id" uuid NOT NULL,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "return_settled_at" TIMESTAMP WITH TIME ZONE,
        "return_settled_by_user_id" uuid,
        "return_note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payouts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_payouts_code" UNIQUE ("code"),
        CONSTRAINT "FK_payouts_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_supplier" FOREIGN KEY ("supplier_id")
          REFERENCES "suppliers"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_paid_by" FOREIGN KEY ("paid_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_payouts_return_settled_by" FOREIGN KEY ("return_settled_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_payouts_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)),
        -- The return NOTE is optional, unlike void_reason. Two similar trios,
        -- two different rules: §9.3 demands a reason for a void and says
        -- nothing about annotating the cash coming back.
        CONSTRAINT "CHK_payouts_return_pair"
          CHECK (("return_settled_at" IS NULL) = ("return_settled_by_user_id" IS NULL)),
        -- §9.3 — «каса НЕ виросла на 8 000… інакше сторно стає способом красти».
        -- Money can only come BACK if it went out and the payout was voided.
        CONSTRAINT "CHK_payouts_return_requires_void"
          CHECK ("return_settled_at" IS NULL OR "voided_at" IS NOT NULL),
        -- Spec §8.6, stricter than §3.7: a zero payout is a receipt for handing
        -- over nothing.
        CONSTRAINT "CHK_payouts_amount" CHECK ("amount" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_payouts_supplier_created" ON "payouts" ("supplier_id", "created_at")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_payouts_shift" ON "payouts" ("shift_id")`);
  }

  /**
   * Drops in dependency order. This WILL fail once `crate_issuances` or
   * `cash_counts` reference a shift — the safe direction, and the same posture
   * every earlier migration in this project takes.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "payouts"`);
    await queryRunner.query(`DROP TABLE "intake_item_tare_types"`);
    await queryRunner.query(`DROP TABLE "intake_items"`);
    await queryRunner.query(`DROP TABLE "intakes"`);
    await queryRunner.query(`DROP TABLE "shifts"`);
    await queryRunner.query(`DROP TYPE "shift_status"`);
    await queryRunner.query(
      `ALTER TABLE "collection_points" DROP CONSTRAINT "CHK_collection_points_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "collection_points" DROP CONSTRAINT "UQ_collection_points_code"`,
    );
    await queryRunner.query(`ALTER TABLE "collection_points" DROP COLUMN "code"`);
  }
}
