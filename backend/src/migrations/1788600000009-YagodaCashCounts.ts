import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `cash_counts` — the drawer, counted by a human (§7.6).
 *
 * FOUR THINGS IN HERE LOOK LIKE OMISSIONS AND ARE NOT:
 *
 * 1. The unique index is PARTIAL — `WHERE kind <> 'midday'`. A shift has at
 *    most one opening and one closing count per book, but any number of midday
 *    recounts (§7.6 — «перерахувати можна скільки завгодно разів»). DBML
 *    cannot express a partial index; this is the hand-written half.
 * 2. There is NO `void_*` trio and NO update path. A count is evidence, not a
 *    document. The one mutation that exists — reopening a shift rewrites its
 *    closing count's `kind` to `midday` — is argued in the spec's §6.3.
 * 3. There is NO discrepancy column. It is `counted − expected`, it is never
 *    stored, and no role has an input field for it (§7.7).
 * 4. `cash_book` gets BOTH values although only `berry` is ever written today.
 *    Adding an enum value later is a migration nobody should have to write,
 *    and 28-db-schema.dbml is the schema of record.
 *
 * ONE THING IN HERE WAS AN ERROR: `CHK_cash_counts_expected_non_negative`.
 * `28-db-schema.dbml` never specified it, an expectation is a SIGNED
 * arithmetic result rather than a pile of banknotes, and the constraint made a
 * shift whose payouts exceeded its takings permanently uncloseable. It is
 * dropped by `1788600000010`, which argues it at length. It is left in the
 * `CREATE TABLE` above because this migration has already been applied and
 * this repo fixes forward. `CHK_cash_counts_counted_non_negative` is NOT an
 * error and stays.
 *
 * `shifts.explanation` and `shift_status.awaiting_explanation` were created by
 * `YagodaIntakesAndPayouts` and left unwritten "until cash_counts lands". This
 * IS that slice, and only the first of the two gets used: the client's ruling
 * of 09.09.2026 removed the blocking, so `awaiting_explanation` stays
 * unreachable BY DECISION.
 */
export class YagodaCashCounts1788600000009 implements MigrationInterface {
  name = 'YagodaCashCounts1788600000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "cash_book" AS ENUM ('berry', 'crates')`);
    await queryRunner.query(
      `CREATE TYPE "cash_count_kind" AS ENUM ('opening', 'midday', 'closing')`,
    );

    await queryRunner.query(`
      CREATE TABLE "cash_counts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "shift_id" uuid NOT NULL,
        "book" "cash_book" NOT NULL,
        "kind" "cash_count_kind" NOT NULL,
        "counted_amount" numeric(12,2) NOT NULL,
        "expected_amount" numeric(12,2) NOT NULL,
        "counted_by_user_id" uuid NOT NULL,
        "counted_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cash_counts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_cash_counts_counted_non_negative" CHECK ("counted_amount" >= 0),
        CONSTRAINT "CHK_cash_counts_expected_non_negative" CHECK ("expected_amount" >= 0),
        CONSTRAINT "FK_cash_counts_shift" FOREIGN KEY ("shift_id")
          REFERENCES "shifts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_cash_counts_counted_by" FOREIGN KEY ("counted_by_user_id")
          REFERENCES "users"("id") ON DELETE RESTRICT
      )
    `);

    // PARTIAL, and the `WHERE` is the whole point — see this class's header.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_cash_counts_shift_book_kind"
        ON "cash_counts" ("shift_id", "book", "kind")
        WHERE "kind" <> 'midday'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_cash_counts_shift_counted_at"
        ON "cash_counts" ("shift_id", "counted_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cash_counts"`);
    await queryRunner.query(`DROP TYPE "cash_count_kind"`);
    await queryRunner.query(`DROP TYPE "cash_book"`);
  }
}
