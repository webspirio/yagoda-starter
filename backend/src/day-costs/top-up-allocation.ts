import type { DataSource, EntityManager } from 'typeorm';
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
      byGrade.set(
        line.product_grade_id,
        add(byGrade.get(line.product_grade_id) ?? '0.00', parts[i]),
      );
    });
  }
  return byGrade;
}

/**
 * One shift's доплати per GRADE — the shift's live receipts and live top-ups
 * read from the database, then spread by `allocateTopUps`. The ONE reader of
 * that pair: «Собівартість дня» (`productCostRows`) and «Переважування»
 * (`ReweighReconciliationService`) both price a product at its accrued
 * average INCLUDING доплати, and two copies of this query are how the two
 * screens printed 229,99 and 265,19 ₴ for the same 1,40 кг (2026-10-23).
 */
export async function topUpsByGradeForShift(
  dataSource: DataSource | EntityManager,
  shiftId: string,
): Promise<Map<string, string>> {
  const receipts = (await dataSource.query(
    `SELECT i.id AS intake_id,
            COALESCE(tu.total, '0.00') AS top_up_total,
            COALESCE(
              -- ORDERED: allocate() settles a tie in remainders by position,
              -- so an unordered json_agg would let the leftover kopiyka land
              -- on a different grade between two reads of the same day. No
              -- money is lost either way, but a собівартість that flickers by
              -- a kopiyka on refresh is a bug report.
              (SELECT json_agg(json_build_object('product_grade_id', ii.product_grade_id, 'amount', ii.amount::text) ORDER BY ii.item_order)
                 FROM intake_items ii WHERE ii.intake_id = i.id),
              '[]'::json
            ) AS lines
       FROM intakes i
       LEFT JOIN (
            SELECT intake_id, SUM(amount)::text AS total
              FROM intake_top_ups
             WHERE voided_at IS NULL
             GROUP BY intake_id
       ) tu ON tu.intake_id = i.id
      WHERE i.shift_id = $1 AND i.voided_at IS NULL`,
    [shiftId],
  )) as ReceiptForAllocation[];

  return allocateTopUps(receipts);
}
