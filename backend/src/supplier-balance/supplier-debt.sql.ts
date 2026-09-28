/**
 * THE DEBT FORMULA, ONCE — `Σ intakes + Σ intake_top_ups − Σ payouts`, four `voided_at IS NULL`
 * filters (the top-ups term carries two: itself and its parent receipt, which is how a voided
 * receipt neutralises its top-ups without a cascading write). `supplier` is a code literal —
 * `$1` or a correlated `s.id` — never request input. `0.00`, not `0`, so an empty supplier
 * reads to two places like every other balance. No point filter: `supplier_id` already is the
 * point (§3.9). A negative result is legal and must not be clamped.
 */
export const debtSql = (supplier: string): string =>
  `(COALESCE((SELECT SUM(i.amount) FROM intakes i
               WHERE i.supplier_id = ${supplier} AND i.voided_at IS NULL), 0.00)
  + COALESCE((SELECT SUM(t.amount) FROM intake_top_ups t
                JOIN intakes ti ON ti.id = t.intake_id
               WHERE ti.supplier_id = ${supplier}
                 AND ti.voided_at IS NULL
                 AND t.voided_at  IS NULL), 0.00)
  - COALESCE((SELECT SUM(p.amount) FROM payouts p
               WHERE p.supplier_id = ${supplier} AND p.voided_at IS NULL), 0.00))`;
