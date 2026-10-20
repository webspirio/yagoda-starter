/**
 * THE DEBT FORMULA, ONCE — `Σ intakes + Σ intake_top_ups − Σ payouts`, four `voided_at IS NULL`
 * filters (the top-ups term carries two: itself and its parent receipt, which is how a voided
 * receipt neutralises its top-ups without a cascading write). `supplier` is a code literal —
 * `$1` or a correlated `s.id` — never request input. `0.00`, not `0`, so an empty supplier
 * reads to two places like every other balance. No point filter: `supplier_id` already is the
 * point (§3.9). A negative result is legal and must not be clamped.
 */
const intakesTermSql = (supplier: string): string =>
  `COALESCE((SELECT SUM(i.amount) FROM intakes i
              WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL), 0.00)`;

const topUpsTermSql = (supplier: string): string =>
  `COALESCE((SELECT SUM(t.amount) FROM intake_top_ups t
               JOIN intakes ti ON ti.id = t.intake_id
              WHERE ti.supplier_id = ${supplier}
                AND ti.voided_at IS NULL
                AND t.voided_at  IS NULL), 0.00)`;

const payoutsTermSql = (supplier: string): string =>
  `COALESCE((SELECT SUM(p.amount) FROM payouts p
              WHERE p.supplier_id = ${supplier} AND p.voided_at IS NULL), 0.00)`;

/** The three terms on their own — what `SupplierDebtQuery.termsFor` projects for `/settlement` (#103, #153). */
export const debtTermsSql = {
  intakes: intakesTermSql,
  topUps: topUpsTermSql,
  payouts: payoutsTermSql,
};

/**
 * THE TOTAL, COMPOSED FROM THE THREE TERMS ABOVE rather than written again — a
 * breakdown that restated the formula could drift from the number it is
 * supposed to explain; this one cannot, because it IS the same SQL. The terms
 * were split out (#103) so the breakdown can project each one on its own
 * alongside the total it already was.
 */
export const debtSql = (supplier: string): string =>
  `(${intakesTermSql(supplier)} + ${topUpsTermSql(supplier)} - ${payoutsTermSql(supplier)})`;

/**
 * The business date of the supplier's OLDEST OPEN LINE (#101) — `NULL` when nothing is open.
 * «Open» is exactly `AllocationsService`'s residual: a live line whose live `payout_allocations`
 * fall short of its amount, a partly paid receipt included. A top-up queues under its PARENT
 * receipt's shift, as everywhere in the settlement (spec 2026-09-26 §3.5). The same expression
 * lives in `services/allocations.ts` `RESIDUAL_LINES_SQL` and `intake-row-extras.ts`
 * `open_amount` — change all three together. `os`, not `s`: the caller's suppliers row is `s`.
 */
export const oldestOpenDateSql = (supplier: string): string =>
  `(SELECT MIN(o.business_date) FROM (
      SELECT os.business_date FROM intakes i
        JOIN shifts os ON os.id = i.shift_id
       WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL
         AND i.amount > COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_id = i.id AND a.voided_at IS NULL), 0)
      UNION ALL
      SELECT os.business_date FROM intake_top_ups t
        JOIN intakes ti ON ti.id = t.intake_id
        JOIN shifts os ON os.id = ti.shift_id
       WHERE ti.supplier_id = ${supplier} AND ti.voided_at IS NULL AND t.voided_at IS NULL
         AND t.amount > COALESCE((SELECT SUM(a.amount) FROM payout_allocations a
                                   WHERE a.intake_top_up_id = t.id AND a.voided_at IS NULL), 0)
    ) o)`;
