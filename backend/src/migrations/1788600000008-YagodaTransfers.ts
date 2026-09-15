import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `transfers` — money and empty crates from the base to a point (§7.9). One
 * table, one enum, nothing else altered.
 *
 * FIVE THINGS IN HERE LOOK LIKE OMISSIONS AND ARE NOT. A later reader — or a
 * `migration:generate` run — will try to "fix" each one:
 *
 * 1. `transfer_status` has THREE values and must never gain a fourth. `void`
 *    was removed on 03.09.2026 because §9.3 requires a mandatory reason, which
 *    a status cannot carry.
 * 2. A voided transfer keeps `status = 'accepted'`. Every cash query filters
 *    `voided_at IS NULL` itself. This is not a bug and must not be "tidied".
 * 3. `accepted_*` are filled on DISPUTE as well as on accept (spec §6.2). The
 *    `transfers` Note in 28-db-schema.dbml originally said otherwise; it was
 *    amended on 09.09.2026, because under the old reading the cash formula's
 *    own `disputed` branch was unreachable.
 * 4. There is NO `shift_id` and there must not be one. Transfers are
 *    point-scoped by design — they carry their own point and their own date.
 *
 *    AMENDED 09.09.2026 (cash counts slice §4.1): this item once continued
 *    «and accepting one requires no open shift (spec §6.4)». That is NO LONGER
 *    TRUE. Accepting or disputing now REQUIRES an open shift, because cash is
 *    counted per shift and a transfer accepted outside one enters no shift's
 *    expectation — it would surface as a discrepancy when nothing went wrong.
 *    The absence of `shift_id` is unaffected: the shift supplies the date, the
 *    column would duplicate it. See `TransfersService`'s header.
 * 5. There is NO stored balance, no cash-movement table and no opening-balance
 *    document. §7.3's list of what moves cash is closed and the figure is a
 *    formula (spec §6.5).
 *
 *    AMENDED 09.09.2026 (cash counts slice): this item once continued «A
 *    point's day-one balance is entered as an ordinary transfer (spec §6.6).»
 *    DO NOT DO THIS. The day-one balance is now the point's FIRST OPENING
 *    COUNT, which sets `expected = counted` and anchors the chain. Entering it
 *    as a transfer as well would ADD it a second time and double every point's
 *    starting cash.
 *
 * NO CHECK ENFORCES THE accepted_* / reported_* / resolved_* STATE INVARIANTS,
 * and the DBML says why: «CHECK під це не написаний навмисно, бо стан
 * документа міняється в часі й проміжні комбінації існують». They live in the
 * service's guarded updates.
 */
export class YagodaTransfers1788600000008 implements MigrationInterface {
  name = 'YagodaTransfers1788600000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "transfer_status" AS ENUM ('sent', 'accepted', 'disputed')`,
    );

    await queryRunner.query(`
      CREATE TABLE "transfers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_point_id" uuid NOT NULL,
        "cash" numeric(12,2) NOT NULL,
        "crates" integer NOT NULL,
        "carrier" character varying NOT NULL,
        "sent_by_user_id" uuid NOT NULL,
        "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "status" "transfer_status" NOT NULL DEFAULT 'sent',
        "accepted_by_user_id" uuid,
        "accepted_date" date,
        "accepted_at" TIMESTAMP WITH TIME ZONE,
        "reported_cash" numeric(12,2),
        "reported_crates" integer,
        "dispute_note" text,
        "resolved_cash" numeric(12,2),
        "resolved_crates" integer,
        "resolved_by_user_id" uuid,
        "resolved_at" TIMESTAMP WITH TIME ZONE,
        "correction_of_transfer_id" uuid,
        "voided_at" TIMESTAMP WITH TIME ZONE,
        "voided_by_user_id" uuid,
        "void_reason" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transfers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_transfers_cash_non_negative" CHECK ("cash" >= 0),
        CONSTRAINT "CHK_transfers_crates_non_negative" CHECK ("crates" >= 0),
        CONSTRAINT "CHK_transfers_not_empty" CHECK ("cash" > 0 OR "crates" > 0),
        CONSTRAINT "CHK_transfers_reported_non_negative"
          CHECK (("reported_cash" IS NULL OR "reported_cash" >= 0)
             AND ("reported_crates" IS NULL OR "reported_crates" >= 0)),
        CONSTRAINT "CHK_transfers_resolved_non_negative"
          CHECK (("resolved_cash" IS NULL OR "resolved_cash" >= 0)
             AND ("resolved_crates" IS NULL OR "resolved_crates" >= 0)),
        CONSTRAINT "CHK_transfers_void_trio"
          CHECK (num_nulls("voided_at", "voided_by_user_id", "void_reason") IN (0, 3)),
        CONSTRAINT "CHK_transfers_no_self_correction"
          CHECK ("correction_of_transfer_id" <> "id"),
        CONSTRAINT "FK_transfers_point" FOREIGN KEY ("collection_point_id")
          REFERENCES "collection_points"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_sent_by" FOREIGN KEY ("sent_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_accepted_by" FOREIGN KEY ("accepted_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_resolved_by" FOREIGN KEY ("resolved_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_voided_by" FOREIGN KEY ("voided_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_transfers_correction_of" FOREIGN KEY ("correction_of_transfer_id")
          REFERENCES "transfers"("id") ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_transfers_point_accepted_date"
         ON "transfers" ("collection_point_id", "accepted_date")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_transfers_status" ON "transfers" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "transfers"`);
    await queryRunner.query(`DROP TYPE "transfer_status"`);
  }
}
