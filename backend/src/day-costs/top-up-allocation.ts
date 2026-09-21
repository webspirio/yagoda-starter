import { allocate, add, isZero } from '../common/money';

export interface ReceiptLineForAllocation {
  product_grade_id: string;
  amount: string;
}

export interface ReceiptForAllocation {
  intake_id: string;
  /** Non-voided lines of one non-voided receipt, in any order. */
  lines: ReceiptLineForAllocation[];
  /** Σ of that receipt's non-voided доплати. '0.00' when there are none. */
  top_up_total: string;
}

/**
 * Spread each receipt's доплати across that receipt's own lines, PRO-RATA BY
 * LINE AMOUNT (spec §3.13).
 *
 * By amount rather than by `net_kg` because the trigger is «ціну перерахували
 * ПІСЛЯ того, як людина здала» — a price revision scales with money. Splitting
 * by weight would charge a cheap heavy berry the same доплата per kilogram as
 * an expensive light one. On a single-line receipt — the common case — every
 * split agrees, which is why this is cheap to get wrong and cheap to fix.
 *
 * `allocate` rather than a ratio multiplied per line: §8.4's звірка is «жодна
 * гривня не загубилася», and a per-line rounding drifts by a kopiyka each.
 *
 * VOIDED RECEIPTS AND VOIDED TOP-UPS NEVER REACH HERE — the caller's SQL
 * filters both, matching the debt formula's `ti.voided_at IS NULL` on the
 * parent: «ягоди не брали, значить і доплати за ті ягоди немає».
 */
export function allocateTopUps(receipts: ReceiptForAllocation[]): Map<string, string> {
  const byGrade = new Map<string, string>();
  for (const receipt of receipts) {
    if (isZero(receipt.top_up_total) || receipt.lines.length === 0) continue;
    const parts = allocate(
      receipt.top_up_total,
      receipt.lines.map((l) => l.amount),
    );
    receipt.lines.forEach((line, i) => {
      byGrade.set(line.product_grade_id, add(byGrade.get(line.product_grade_id) ?? '0.00', parts[i]));
    });
  }
  return byGrade;
}
