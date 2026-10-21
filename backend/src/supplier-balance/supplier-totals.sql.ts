import { debtTermsSql } from './supplier-debt.sql';

/**
 * The supplier-totals fragments. `supplier` is a code literal (`$1` or a
 * correlated `s.id`), never request input — same contract as `debtSql`.
 *
 * NUMERIC, NOT TEXT: `/supplier-totals` ORDERS BY these, and a `::text` here
 * would rank «9.50» above «100.00». The card's breakdown casts at its own
 * projection instead.
 */

/** Σ net kg over live receipts — the card's `kg_total` tile and the list's column, one SQL. */
export const kgTotalSql = (supplier: string): string =>
  `COALESCE((SELECT SUM(ii.net_kg) FROM intake_items ii
               JOIN intakes i ON i.id = ii.intake_id
              WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL), 0.00)`;

/** «Нараховано» — the debt formula's first two terms, reused rather than restated. */
export const accruedSql = (supplier: string): string =>
  `(${debtTermsSql.intakes(supplier)} + ${debtTermsSql.topUps(supplier)})`;

/** The PRODUCT (grades summed) with the most live net kg; tie → name, then id. NULL with no receipts. */
export const mainProductSql = (supplier: string): string =>
  `(SELECT p.name FROM intake_items ii
      JOIN intakes i ON i.id = ii.intake_id
      JOIN product_grades g ON g.id = ii.product_grade_id
      JOIN products p ON p.id = g.product_id
     WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL
     GROUP BY p.id, p.name
     ORDER BY SUM(ii.net_kg) DESC, p.name ASC, p.id ASC
     LIMIT 1)`;
