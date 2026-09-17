import { DataSource } from 'typeorm';
import { gradeTotals } from '../reweighs/reweigh-reconciliation.service';
import { allocateTopUps, ReceiptForAllocation } from './top-up-allocation';
import { add, div, gt, isZero, mul, sub, sum } from '../common/money';

interface ReceiptRow {
  intake_id: string;
  top_up_total: string;
  lines: { product_grade_id: string; amount: string }[];
}

export interface ProductCostRow {
  product_id: string;
  product_name: string;
  /** «нараховано» — Σ intake_items.amount + allocated top-ups, non-voided,
   *  over every grade this product had in this shift. */
  accrued: string;
  intake_net_kg: string;
  /** «недостача» — Σ per-grade shortfall, already clamped so a surplus on one
   *  grade never lowers it (§8.2's clamp — see `cost-of-day.service.ts`).
   *  '0.00' both when nothing is missing AND when nothing was weighed; the
   *  latter case is what `reweigh_net_kg === null` exists to distinguish. */
  shortfall: string;
  /** Σ reweigh net_kg across this product's grades. `null` — not '0.00' —
   *  when NOTHING was weighed for this product this shift (§8.6: «Це не
   *  нуль», the same rule `CostOfDayService.buildProducts` already applies
   *  to `price_by_our_weight`). */
  reweigh_net_kg: string | null;
}

/**
 * Per-shift, per-PRODUCT costing — the arithmetic §8.4 (cost-of-day) and §8.6
 * (network average) both need: нараховано (top-ups included), недостача
 * (clamped) and the weighed kilograms, aggregated from grade to product
 * level. Extracted out of `CostOfDayService` (which used to compute this
 * inline) so the network-average endpoint reuses it rather than recomputing
 * the same top-up allocation and shortfall clamp a second time — see the
 * task-10 brief's reuse note.
 */
export async function productCostRows(
  dataSource: DataSource,
  shiftId: string,
): Promise<ProductCostRow[]> {
  const grades = await gradeTotals(dataSource, shiftId);
  if (grades.length === 0) return [];

  const receiptRows = (await dataSource.query(
    `SELECT i.id AS intake_id,
            COALESCE(tu.total, '0.00') AS top_up_total,
            COALESCE(
              (SELECT json_agg(json_build_object('product_grade_id', ii.product_grade_id, 'amount', ii.amount::text))
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
  )) as ReceiptRow[];

  const receipts: ReceiptForAllocation[] = receiptRows.map((r) => ({
    intake_id: r.intake_id,
    top_up_total: r.top_up_total,
    lines: r.lines,
  }));
  const topUpsByGrade = allocateTopUps(receipts);

  const gradeCosts = grades.map((g) => {
    const accrued = add(g.intake_amount, topUpsByGrade.get(g.product_grade_id) ?? '0.00');
    // §3.6 — per GRADE, never a product-level average of summed amounts.
    const price = div(accrued, g.intake_net_kg);
    const reweighNet = g.reweigh_net_kg;
    let shortfall = '0.00';
    if (reweighNet !== null) {
      const missing = sub(g.intake_net_kg, reweighNet);
      // THE CLAMP — the one place a surplus (missing < 0) is discarded
      // rather than shown, matching `CostOfDayService`.
      shortfall = gt(missing, '0.00') ? mul(missing, price) : '0.00';
    }
    return {
      product_id: g.product_id,
      product_name: g.product_name,
      accrued,
      intake_net_kg: g.intake_net_kg,
      reweigh_net_kg: reweighNet,
      shortfall,
    };
  });

  const byProduct = new Map<string, typeof gradeCosts>();
  for (const g of gradeCosts) {
    const list = byProduct.get(g.product_id) ?? [];
    list.push(g);
    byProduct.set(g.product_id, list);
  }

  const rows: ProductCostRow[] = [];
  for (const [productId, list] of byProduct) {
    const reweighNetRaw = sum(list.map((g) => g.reweigh_net_kg ?? '0.00'));
    rows.push({
      product_id: productId,
      product_name: list[0].product_name,
      accrued: sum(list.map((g) => g.accrued)),
      intake_net_kg: sum(list.map((g) => g.intake_net_kg)),
      shortfall: sum(list.map((g) => g.shortfall)),
      reweigh_net_kg: isZero(reweighNetRaw) ? null : reweighNetRaw,
    });
  }
  return rows;
}
