import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ListSupplierBalancesQueryDto } from './dto/list-supplier-balances.query';
import {
  SupplierBalanceRow,
  SupplierBalanceRowResponse,
  toSupplierBalanceRowResponse,
} from './supplier-balance.mapper';
import { resolvePointFilter } from '../auth/access/point-scope';
import { Paginated } from '../common/dto/paginated';
import { skipOf } from '../common/dto/pagination-query.dto';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

/**
 * THE FORMULA, WRITTEN ONCE. `supplier` is the SQL naming whose debt is
 * wanted — the bind placeholder `$1` for one row, the outer row's own column
 * `s.id` when correlated down a list. Both call sites pass a code literal;
 * nothing from a request is ever spliced here.
 *
 * THE FALLBACK IS `0.00`, NOT `0`. `SUM` over no rows is NULL, and
 * `COALESCE(NULL, 0)` is an integer zero that Postgres renders as `'0'` — so
 * a supplier with no documents at all read `"0"` where every other balance
 * reads to two places. The DBML writes `0`; the wire contract (every numeric a
 * scale-2 string) is why this diverges from it by a literal.
 *
 * THE MIDDLE TERM IS THE ONE THAT REACHES ITS SUPPLIER THROUGH A JOIN.
 * `intake_top_ups` stores no `supplier_id` — it derives one from its parent
 * receipt — so the correlation runs `intake_top_ups → intakes` and filters
 * `ti.voided_at IS NULL` there. That filter is what makes a voided receipt
 * neutralise its own top-ups WITHOUT any cascading write: the money for
 * berries that were never taken stops counting the moment the receipt is
 * stamped СТОРНОВАНО. `t.voided_at IS NULL` is a SEPARATE filter guarding a
 * separate mistake — a top-up voided on its own merits — and deleting either
 * one is invisible to a test that only exercises the other.
 */
const debtSql = (supplier: string): string =>
  `(COALESCE((SELECT SUM(i.amount) FROM intakes i
               WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL), 0.00)
  + COALESCE((SELECT SUM(t.amount) FROM intake_top_ups t
                JOIN intakes ti ON ti.id = t.intake_id
               WHERE ti.supplier_id = ${supplier}
                 AND ti.voided_at IS NULL
                 AND t.voided_at  IS NULL), 0.00)
  - COALESCE((SELECT SUM(p.amount) FROM payouts p
               WHERE p.supplier_id = ${supplier} AND p.voided_at IS NULL), 0.00))`;

/**
 * THE ONLY `SUM` OVER ANY OF THE THREE DEBT TABLES IN THE BACKEND.
 *
 * The formula follows the `suppliers` Note in `28-db-schema.dbml`, including
 * FOUR `voided_at IS NULL` filters across three terms — the middle term
 * alone carries two, one for the top-up and one for its parent intake — and
 * that Note explains at length why they may exist in exactly one place:
 *
 *   «фільтр voided_at IS NULL стоїть на ОБОХ історіях, і забути його на
 *    будь-якій означає або гасити борг грошима, яких не видали, або тримати
 *    борг за ягоду, якої не брали»
 *
 * THE THIRD TERM ARRIVED WITH THE INTAKE TOP-UPS SLICE (#61) and the Note was
 * amended in the same change — «обидві історії» is now three. See
 * `docs/superpowers/specs/2026-09-11-yagoda-intake-top-ups-slice.md`.
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
    const sql = `SELECT ${debtSql('$1')}::text AS debt`;
    const [row] = (await runner.query(sql, [supplierId])) as { debt: string }[];

    return row.debt;
  }

  /**
   * Every supplier in scope with their balance — the «Залишки» screen.
   *
   * THE SAME SQL AS `debtFor`, correlated on each supplier row, so this list
   * cannot carry a formula of its own. Aggregated, filtered, ordered and
   * paginated IN POSTGRES: the `numeric` stays exact up to the projection,
   * where `::text` hands it over, and no balance passes through JavaScript on
   * its way to the page. The count runs over the same filtered set, so
   * `total` and `data` cannot disagree about what is in scope.
   *
   * `include_zero=false` (the default) drops `0.00` rows AND ONLY THOSE. A
   * deactivated supplier who is still owed money stays listed: deactivation is
   * a fact about the card, the debt is a fact about the drawer, and a person
   * must not vanish from the debts list because their card was retired. A
   * negative balance — legal, see the class header — is not zero and stays
   * too, at the bottom.
   *
   * THE ORDER IS TOTAL. `debt DESC` puts the biggest debts first; the name
   * and id tiebreakers are what keep paging stable when two people are owed
   * the same amount — Postgres promises no order among ties, so without them
   * `LIMIT`/`OFFSET` can serve one row twice and another never.
   *
   * THE POINT FILTER HERE IS NOT THE ONE THE CLASS HEADER FORBIDS. That rule
   * is about the FORMULA — a supplier's debt is the same number whichever
   * point asks — and the formula above has none. This filter chooses WHICH
   * suppliers appear, which is `resolvePointFilter`'s ordinary scope question.
   */
  async list(
    actor: AuthenticatedUser,
    query: ListSupplierBalancesQueryDto,
  ): Promise<Paginated<SupplierBalanceRowResponse>> {
    const pointId = resolvePointFilter(actor, query.collection_point_id) ?? null;
    const manager = this.dataSource.manager;

    // Shared by the page and the count, so the two cannot drift apart.
    const scoped = `SELECT s.id, s.first_name, s.last_name, s.is_active, s.collection_point_id,
                           ${debtSql('s.id')} AS debt
                      FROM suppliers s
                     WHERE ($1::uuid IS NULL OR s.collection_point_id = $1::uuid)`;
    const visible = `($2::boolean OR b.debt <> 0)`;

    const rows = (await manager.query(
      `SELECT b.id AS supplier_id, b.first_name, b.last_name, b.is_active,
              b.collection_point_id, b.debt::text AS debt
         FROM (${scoped}) b
        WHERE ${visible}
        ORDER BY b.debt DESC, b.last_name ASC, b.first_name ASC, b.id ASC
        LIMIT $3 OFFSET $4`,
      [pointId, query.include_zero, query.limit, skipOf(query)],
    )) as SupplierBalanceRow[];

    // `::int` so the driver hands back a number: `COUNT` is `bigint`, which
    // `pg` returns as a string, and `Number()` is banned in this module.
    const [{ total }] = (await manager.query(
      `SELECT COUNT(*)::int AS total FROM (${scoped}) b WHERE ${visible}`,
      [pointId, query.include_zero],
    )) as { total: number }[];

    return {
      data: rows.map(toSupplierBalanceRowResponse),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
}
