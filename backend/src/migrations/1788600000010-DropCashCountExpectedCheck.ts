import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * DROPS `CHK_cash_counts_expected_non_negative`, WHICH COULD STRAND A POINT
 * FOR THE REST OF THE SEASON.
 *
 * `1788600000009` created the two CHECKs as a pair, as if `counted_amount` and
 * `expected_amount` were the same kind of number. They are not. A count is a
 * pile of banknotes and genuinely cannot be negative — so
 * `CHK_cash_counts_counted_non_negative` STAYS, and dropping it too would be a
 * mistake. An expectation is an ARITHMETIC RESULT: the previous count plus
 * this shift's movements (spec §3.3), and movements are signed. `payouts` are
 * subtracted, and there is no rule anywhere that says a shift pays out less
 * than it took in — a database scenario in `point-cash.db-spec.ts` already
 * asserts a movements figure of `-250.00`.
 *
 * THE FAILURE IS REACHED THROUGH A FLOW THE CODE ITSELF DOCUMENTS AS INTENDED,
 * and it is unrecoverable through the API:
 *
 *   1. the operator opens the shift and counts 1 000;
 *   2. a transfer of 10 000 arrives and is accepted — movements +10 000;
 *   3. 9 000 goes out to suppliers — movements +1 000;
 *   4. the owner voids the transfer, which is exactly what `transfers.service`
 *      prescribes as §9.3's way to undo a mistaken «Прийняв» — movements are
 *      now −9 000 and `expectedForClosing` returns −8 000;
 *   5. `POST /shifts/:id/close` inserts that expectation, the CHECK rejects it,
 *      and the operator gets a 500.
 *
 * The shift cannot be closed. `UQ_shifts_open_per_point` then forbids opening
 * tomorrow's, and `close` is operator-only (§10.3), so the owner cannot rescue
 * it either. The point stops trading until someone runs SQL by hand.
 *
 * A NEGATIVE EXPECTATION IS A LEGITIMATE FACT, not a corrupt one: it records
 * that more money left the drawer than entered it, which is precisely the
 * class of event this slice exists to surface. Clamping it to zero — the only
 * other way to satisfy the constraint — would make the stored discrepancy
 * `counted − 0` and the system would report a large surplus where the truth is
 * a large deficit. The constraint does not protect the data; it makes the data
 * lie or makes the request fail.
 *
 * `28-db-schema.dbml` NEVER SPECIFIED THIS CONSTRAINT. It was added in
 * `1788600000009` in error and was an undocumented divergence from the schema
 * of record — so this migration removes a divergence rather than creating one.
 *
 * FIXED FORWARD RATHER THAN BY EDITING `1788600000009`, which has already been
 * applied: a migration that has run is history, and rewriting it would leave
 * every existing database with a constraint no migration file mentions.
 *
 * `down()` restores the constraint so the pair of migrations is reversible in
 * the ordinary way. Reverting it re-opens the trap — and it will FAIL outright
 * on any database that has since recorded a negative expectation, which is the
 * correct outcome: the rows are true and the constraint is what is wrong.
 */
export class DropCashCountExpectedCheck1788600000010 implements MigrationInterface {
  name = 'DropCashCountExpectedCheck1788600000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cash_counts" DROP CONSTRAINT "CHK_cash_counts_expected_non_negative"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cash_counts"
         ADD CONSTRAINT "CHK_cash_counts_expected_non_negative" CHECK ("expected_amount" >= 0)`,
    );
  }
}
