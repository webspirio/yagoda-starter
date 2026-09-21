import { DataSource } from 'typeorm';
import { gradeTotals, weighedInFull } from '../reweighs/reweigh-reconciliation.service';
import { allocateTopUps, ReceiptForAllocation } from './top-up-allocation';
import { add, div, gt, mul, sub, sum } from '../common/money';

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
   *  '0.00' both when nothing is missing AND when this product is not
   *  `complete`; the latter case is what `reweigh_net_kg === null` exists to
   *  distinguish. */
  shortfall: string;
  /** Σ reweigh net_kg across this product's grades. `null` — not '0.00' —
   *  whenever `complete` is false, which covers both «nothing weighed at
   *  all» and «weighed in one grade but not another» (§8.6: «Це не нуль»,
   *  the same rule `CostOfDayService.buildProducts` already applies to
   *  `price_by_our_weight`). */
  reweigh_net_kg: string | null;
  /** §3.15 — EVERY grade this product had in this shift is on the scale.
   *  Exactly `reweigh_net_kg !== null`, named so callers can read the rule
   *  rather than infer it from a null. */
  complete: boolean;
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
    // §3.15, THE SAME RULE THE RECONCILIATION APPLIES, from the same helper:
    // one unweighed grade makes the whole product «не перезважено». A
    // partially weighed product therefore contributes NOTHING anywhere —
    // no kilograms to `переважено`, no недостача to the basket, no cell to
    // §8.6's network average — rather than contributing the weighed grade's
    // kilograms while the unweighed grade's kilograms silently read as a
    // shortfall that nobody has confirmed. «Contributes nothing — not a
    // zero», and half a weighing is not a weighing.
    const complete = weighedInFull(list);
    rows.push({
      product_id: productId,
      product_name: list[0].product_name,
      accrued: sum(list.map((g) => g.accrued)),
      intake_net_kg: sum(list.map((g) => g.intake_net_kg)),
      shortfall: complete ? sum(list.map((g) => g.shortfall)) : '0.00',
      reweigh_net_kg: complete ? sum(list.map((g) => g.reweigh_net_kg ?? '0.00')) : null,
      complete,
    });
  }
  return rows;
}
