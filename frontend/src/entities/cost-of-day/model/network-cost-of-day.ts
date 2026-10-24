/**
 * «Собівартість дня» for EVERY point at once (`GET /reports/cost-of-day`).
 * Same contract as `CostOfDay`: every figure is the server's, and a `null`
 * is a dash — never a zero (§8.6 «Це не нуль»).
 */

/** One point's figures for one product — what that point's own page prints. */
export interface NetworkCostPoint {
  point_id: string;
  point_name: string;
  shift_id: string;
  /** That point's shift is still open. */
  provisional: boolean;
  /** Weighed in full here — the only cells the product's row sums. */
  complete: boolean;
  intake_net_kg: string;
  reweigh_net_kg: string | null;
  shortfall_kg: string;
  accrued: string;
  top_ups: string;
  shortfall: string;
  shortfall_share: string | null;
  expenses_share: string | null;
  full_cost: string | null;
  price_was: string;
  /** The point's own собівартість, identical to its page. */
  price_cost: string | null;
}

/** One product across the network. The row's figures sum over the points
 *  that weighed it in full (or every point when none did, `complete` false),
 *  so `accrued − shortfall + shortfall_share + expenses_share = full_cost`
 *  and `full_cost ÷ reweigh_net_kg = price_cost` both hold on the row. */
export interface NetworkCostProduct {
  product_id: string;
  product_name: string;
  complete: boolean;
  intake_net_kg: string;
  reweigh_net_kg: string | null;
  shortfall_kg: string;
  accrued: string;
  top_ups: string;
  shortfall: string;
  shortfall_share: string | null;
  expenses_share: string | null;
  full_cost: string | null;
  price_was: string;
  /** §8.6 — Σ повна вартість ÷ Σ база кг, never the mean of the points'. */
  price_cost: string | null;
  /** Points that accepted it but did not weigh it in full, when `complete`. */
  unweighed: { intake_kg: string; accrued: string } | null;
  points: NetworkCostPoint[];
}

interface NetworkCostDayPoint {
  point_id: string;
  point_name: string;
  shift_id: string;
  provisional: boolean;
  expenses_amount: string;
  /** Something is weighed there, so its expenses are spread. */
  weighed: boolean;
}

export interface NetworkCostOfDay {
  date: string;
  points: NetworkCostDayPoint[];
  provisional: boolean;
  accrued: string;
  expenses_amount: string;
  /** The expenses the day formula spreads — those of the weighed points. */
  expenses_weighed: string;
  reweighed_kg: string;
  shortfall_amount: string;
  top_ups_total: string;
  /** The total row, sums only. `null` when nothing in the network is weighed. */
  weighed: {
    intake_kg: string;
    shortfall_kg: string;
    accrued: string;
    shortfall: string;
    shortfall_share: string;
    expenses_share: string;
    full_cost: string;
  } | null;
  /** `weighed.full_cost ÷ reweighed_kg`. `null` exactly when `weighed` is. */
  price_cost_avg: string | null;
  unweighed: { intake_kg: string; accrued: string };
  checks: { points_ok: boolean; total_ok: boolean } | null;
  products: NetworkCostProduct[];
}
