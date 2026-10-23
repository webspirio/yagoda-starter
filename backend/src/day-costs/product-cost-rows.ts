import { DataSource } from 'typeorm';
import {
  gradeTotals,
  productShortfall,
  weighedInFull,
} from '../reweighs/reweigh-reconciliation.service';
import { topUpsByGradeForShift } from './top-up-allocation';
import { add, div, gt, sum } from '../common/money';

export interface ProductCostRow {
  product_id: string;
  product_name: string;
  /** «нараховано» — Σ intake_items.amount + allocated top-ups, non-voided,
   *  over every grade this product had in this shift. */
  accrued: string;
  /** The доплати inside `accrued` — Σ this product's grades' `top_ups`.
   *  '0.00' when there are none. Carried so a screen can say how much of
   *  «нараховано» no receipt shows (2026-10-23 three-screens review, C3). */
  top_ups: string;
  intake_net_kg: string;
  /** «недостача» — the PRODUCT's shortfall at its average accrued rate
   *  (`productShortfall`), clamped at zero (§8.2's clamp); a surplus on one
   *  grade offsets a shortfall on another.
   *  '0.00' both when nothing is missing AND when this product is not
   *  `complete`; the latter case is what `reweigh_net_kg === null` exists to
   *  distinguish. */
  shortfall: string;
  /** The same недостача in kilograms — Σ point minus Σ base for the product,
   *  clamped the same way, so it never disagrees with `shortfall`. */
  shortfall_kg: string;
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
  /** The product's grades, for a breakdown under its row — information, not a
   *  second недостача: the shortfall is the product's (`productShortfall`). */
  grades: ProductCostGrade[];
}

export interface ProductCostGrade {
  product_grade_id: string;
  product_grade_name: string;
  /** This grade's Σ intake_items.amount + its allocated top-ups. */
  accrued: string;
  /** The доплати inside `accrued` — this grade's part of `topUpsByGradeForShift`.
   *  '0.00' when there are none. */
  top_ups: string;
  intake_net_kg: string;
  /** `null` when nothing was weighed for this grade. */
  reweigh_net_kg: string | null;
  /** accrued ÷ intake_net_kg. */
  price_was: string;
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

  const topUpsByGrade = await topUpsByGradeForShift(dataSource, shiftId);

  const gradeCosts = grades.map((g) => {
    const topUps = topUpsByGrade.get(g.product_grade_id) ?? '0.00';
    return {
      product_id: g.product_id,
      product_name: g.product_name,
      product_grade_id: g.product_grade_id,
      product_grade_name: g.product_grade_name,
      accrued: add(g.intake_amount, topUps),
      top_ups: topUps,
      intake_net_kg: g.intake_net_kg,
      reweigh_net_kg: g.reweigh_net_kg,
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
    const accrued = sum(list.map((g) => g.accrued));
    const intakeNet = sum(list.map((g) => g.intake_net_kg));
    const reweighNet = complete ? sum(list.map((g) => g.reweigh_net_kg ?? '0.00')) : null;
    let shortfall = '0.00';
    let shortfall_kg = '0.00';
    if (reweighNet !== null) {
      // Per PRODUCT, at its average accrued rate — `productShortfall`, the reweigh screen's
      // own arithmetic. THE CLAMP — the one place a surplus (missing < 0) is discarded rather
      // than shown — now applies to the product, so one grade's surplus does offset another's.
      const missing = productShortfall(intakeNet, reweighNet, accrued);
      if (gt(missing.kg, '0.00')) {
        shortfall_kg = missing.kg;
        shortfall = missing.amount;
      }
    }
    rows.push({
      product_id: productId,
      product_name: list[0].product_name,
      accrued,
      top_ups: sum(list.map((g) => g.top_ups)),
      intake_net_kg: intakeNet,
      shortfall,
      shortfall_kg,
      reweigh_net_kg: reweighNet,
      complete,
      grades: list.map((g) => ({
        product_grade_id: g.product_grade_id,
        product_grade_name: g.product_grade_name,
        accrued: g.accrued,
        top_ups: g.top_ups,
        intake_net_kg: g.intake_net_kg,
        reweigh_net_kg: g.reweigh_net_kg,
        price_was: div(g.accrued, g.intake_net_kg),
      })),
    });
  }
  return rows;
}
