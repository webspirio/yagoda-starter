import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spec 2026-10-08 — a discrepancy belongs to a COUNT, so both texts live there:
 * `explanation` (owner, closes the incident) and `operator_note` (whoever counted).
 * One shift text is copied onto EVERY disagreeing opening/closing count so no
 * incident reopens; a text on a shift with none disagreeing goes to its closing
 * count (else opening) so it is not lost, and with no such count `up()` refuses.
 * `''` was «undecided» and is not copied.
 *
 * Numbered 022: PR #222 claims 021. Whichever merges second re-checks.
 */
export class CashCountExplanations1788600000022 implements MigrationInterface {
  name = 'CashCountExplanations1788600000022';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "cash_counts" ADD "explanation" text`);
    await q.query(`ALTER TABLE "cash_counts" ADD "operator_note" text`);
    await q.query(`ALTER TABLE "cash_counts" ADD CONSTRAINT "CHK_cash_counts_explanation_not_blank"
      CHECK ("explanation" IS NULL OR btrim("explanation") <> '')`);
    await q.query(`ALTER TABLE "cash_counts" ADD CONSTRAINT "CHK_cash_counts_operator_note_not_blank"
      CHECK ("operator_note" IS NULL OR btrim("operator_note") <> '')`);
    await q.query(`
      UPDATE "cash_counts" c SET "explanation" = btrim(s."explanation")
        FROM "shifts" s
       WHERE c."shift_id" = s."id" AND btrim(coalesce(s."explanation", '')) <> ''
         AND c."book" = 'berry' AND c."kind" IN ('opening', 'closing')
         AND c."counted_amount" <> c."expected_amount"`);
    await q.query(`
      UPDATE "cash_counts" c SET "explanation" = btrim(s."explanation")
        FROM "shifts" s
       WHERE c."shift_id" = s."id" AND btrim(coalesce(s."explanation", '')) <> ''
         AND NOT EXISTS (SELECT 1 FROM "cash_counts" x
                          WHERE x."shift_id" = s."id" AND x."explanation" IS NOT NULL)
         AND c."id" = (SELECT y."id" FROM "cash_counts" y
                        WHERE y."shift_id" = s."id" AND y."book" = 'berry'
                          AND y."kind" IN ('opening', 'closing')
                        ORDER BY (y."kind" = 'closing') DESC LIMIT 1)`);
    // A text with no berry opening/closing count has nowhere to go; refuse rather than drop it.
    const orphans: { id: string }[] = await q.query(`
      SELECT s."id" FROM "shifts" s
       WHERE btrim(coalesce(s."explanation", '')) <> ''
         AND NOT EXISTS (SELECT 1 FROM "cash_counts" c
                          WHERE c."shift_id" = s."id" AND c."explanation" IS NOT NULL)`);
    if (orphans.length > 0) {
      throw new Error(
        `CashCountExplanations: shifts ${orphans.map((o) => o.id).join(', ')} have an explanation ` +
          `but no opening or closing count to carry it; move the text by hand first.`,
      );
    }
    await q.query(`ALTER TABLE "shifts" DROP COLUMN "explanation"`);
  }

  /** LOSSY: two counts with different texts come back as ONE — the closing count's. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "shifts" ADD "explanation" text`);
    await q.query(`
      UPDATE "shifts" s SET "explanation" = (
        SELECT c."explanation" FROM "cash_counts" c
         WHERE c."shift_id" = s."id" AND c."explanation" IS NOT NULL
         ORDER BY (c."kind" = 'closing') DESC, (c."kind" = 'opening') DESC LIMIT 1)`);
    await q.query(`ALTER TABLE "cash_counts" DROP CONSTRAINT "CHK_cash_counts_operator_note_not_blank"`);
    await q.query(`ALTER TABLE "cash_counts" DROP CONSTRAINT "CHK_cash_counts_explanation_not_blank"`);
    await q.query(`ALTER TABLE "cash_counts" DROP COLUMN "operator_note"`);
    await q.query(`ALTER TABLE "cash_counts" DROP COLUMN "explanation"`);
  }
}
