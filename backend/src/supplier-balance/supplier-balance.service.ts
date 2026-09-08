import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * THE ONLY `SUM` OVER EITHER DOCUMENT TABLE IN THE BACKEND.
 *
 * The formula is copied verbatim from the `suppliers` Note in
 * `28-db-schema.dbml`, including BOTH `voided_at IS NULL` filters, and that
 * Note explains at length why it may exist in exactly one place:
 *
 *   «фільтр voided_at IS NULL стоїть на ОБОХ історіях, і забути його на
 *    будь-якій означає або гасити борг грошима, яких не видали, або тримати
 *    борг за ягоду, якої не брали»
 *
 * NOTE THE ASYMMETRY WITH CASH, which lands with `cash_counts`: the debt
 * formula filters voided payouts OUT, the cash formula counts them IN, because
 * the money physically left the drawer and returns only when someone puts it
 * back (`payouts.return_settled_at`). The same column reads two opposite ways
 * in two queries, and §9.3 says why — «інакше сторно стає способом красти».
 *
 * NO POINT FILTER, and one must not be added: `supplier_id` already means the
 * point (§3.9 — a person delivering to two points is two rows), and the Note
 * says filtering by point as well is «не треба й не можна».
 *
 * NOTHING IS CACHED AND NO BALANCE IS STORED. §3.2 forbids a «Залишок» input
 * field «для жодної ролі», and the DBML supplies the field evidence for why a
 * stored one is worse: in the client's own workbook the hand-copied balance
 * chain is broken in 124 переходах із 1 473.
 *
 * A NEGATIVE RESULT IS LEGAL. Voiding a receipt that was already paid for is
 * «ЄДИНИЙ шлях у мінус, і воно ДОЗВОЛЕНЕ», and «інваріанта борг >= 0 в цій
 * схемі немає». Callers must not clamp it.
 */
@Injectable()
export class SupplierBalanceService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * `Σ intakes − Σ payouts` for one supplier, as a decimal STRING.
   *
   * Takes an `EntityManager` so the payout ceiling reads it inside the same
   * transaction that holds the supplier row lock — otherwise the value it
   * checks against is stale by the time the insert lands.
   */
  async debtFor(supplierId: string, manager?: EntityManager): Promise<string> {
    const runner = manager ?? this.dataSource.manager;
    // `::text` on the numeric expression so the value never passes through a
    // JS number on its way out of the driver (foundation §5.1).
    const [row] = (await runner.query(
      `SELECT (COALESCE((SELECT SUM(i.amount) FROM intakes i
                          WHERE i.supplier_id = $1 AND i.voided_at IS NULL), 0)
             - COALESCE((SELECT SUM(p.amount) FROM payouts p
                          WHERE p.supplier_id = $1 AND p.voided_at IS NULL), 0))::text AS debt`,
      [supplierId],
    )) as { debt: string }[];

    return row.debt;
  }
}
