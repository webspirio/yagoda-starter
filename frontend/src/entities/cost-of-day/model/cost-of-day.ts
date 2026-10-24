/**
 * §8.5 — how the day's basket is split between the products weighed in full
 * (spec 2026-10-24 §2): by «наша вага», by «нараховано», or each product's own
 * недостача plus витрати by «нараховано». A view of the day, never its state.
 */
export const COST_SPLITS = ['weight', 'value', 'own'] as const;
export type CostSplit = (typeof COST_SPLITS)[number];

export function isCostSplit(value: unknown): value is CostSplit {
  return typeof value === 'string' && (COST_SPLITS as readonly string[]).includes(value);
}

/**
 * One product on §8.4's screen. EVERY figure here is the server's — this
 * screen never re-derives one, same contract as `entities/point-cash`.
 *
 * The three `null`s are three different silences and none of them is a zero
 * (§8.6 «Це не нуль»): `reweigh_net_kg` is «не перезважено», `price_cost` and
 * `basket_share` are «this product was left out of the day's denominator, so
 * it collects nothing from it» (§3.15).
 */
export interface CostOfDayProduct {
  product_id: string;
  product_name: string;
  /** «нараховано» — the accrued purchase, top-ups included. NOT cash paid out. */
  accrued: string;
  /** The доплати inside `accrued`; '0.00' when there are none. */
  top_ups: string;
  /** What the POINT weighed in. */
  intake_net_kg: string;
  /** «наша вага» — what the base's scale said. `null` when `complete` is false. */
  reweigh_net_kg: string | null;
  /** «недостача», clamped: never negative, §8.2's надлишок is impossible. */
  shortfall: string;
  /** The same недостача in kilograms, clamped per product like `shortfall`. */
  shortfall_kg: string;
  /** This product's part of the day's недостача — largest-remainder split over
   *  the weighed kilograms, so the parts add up to `shortfall_amount` exactly.
   *  `null` exactly when `basket_share` is. */
  shortfall_share: string | null;
  /** This product's part of the day's витрати, split the same way. `null`
   *  exactly when `basket_share` is. */
  expenses_share: string | null;
  /** «із пулу» — `shortfall_share + expenses_share`, allocated rather than
   *  multiplied so the shares add up to `basket` exactly. `null` when nothing
   *  was weighed or this product is not `complete` (§3.15). */
  basket_share: string | null;
  /** «повна вартість» — `accrued − shortfall + basket_share`, a money figure,
   *  never divided into a per-kg one. `null` exactly when `basket_share` is. */
  full_cost: string | null;
  /** This row's «недостача дня, ₴/кг»: the day's half under `weight`, the
   *  row's own `shortfall_share ÷ reweigh_net_kg` under `value`/`own`, so
   *  ціна закупки + недостача + витрати = собівартість on every row. `null`
   *  exactly when `price_cost` is. */
  shortfall_per_kg: string | null;
  /** This row's «витрати, ₴/кг», the same rule as `shortfall_per_kg`. */
  expenses_per_kg: string | null;
  /** «ціна закупки» — нараховано ÷ вага пункту, доплати included. */
  price_was: string;
  /** «собівартість» — було + на кілограм. `null` when there is no на кілограм. */
  price_cost: string | null;
  // `price_by_our_weight` (§8.4's «нараховане ÷ наша вага») still rides on
  // the wire but no screen prints it since the single-table redesign — left
  // off this type so nothing starts reading it by accident (audit E11).
  /** §3.15 — every grade this product had this shift is on the scale. */
  complete: boolean;
  /** The product's grades — a breakdown, not a second недостача: the
   *  shortfall is the product's. */
  grades: CostOfDayGrade[];
}

/** One grade under a product on §8.4's screen. */
interface CostOfDayGrade {
  product_grade_id: string;
  product_grade_name: string;
  /** This grade's нараховано, top-ups included. */
  accrued: string;
  /** The доплати inside `accrued`; '0.00' when there are none. */
  top_ups: string;
  intake_net_kg: string;
  /** `null` when nothing was weighed for this grade. */
  reweigh_net_kg: string | null;
  /** accrued ÷ intake_net_kg. */
  price_was: string;
}

/** §8.4 for one shift. `GET /shifts/:shiftId/cost-of-day`, owner-only. */
export interface CostOfDay {
  shift_id: string;
  /** The split asked for. */
  split: CostSplit;
  /** The split the figures were built with — `weight` when a split by money
   *  had no money to split by (weighed нараховано 0,00 ₴). */
  split_applied: CostSplit;
  /** витрати as ≈ % of the weighed нараховано — a caption, never an operand.
   *  `null` under `weight` and when nothing is weighed. */
  expenses_pct: string | null;
  /** недостача as ≈ % of the weighed нараховано, under `value` only. */
  shortfall_pct: string | null;
  closed_at: string | null;
  /** The shift is still open, so every figure below is still moving (§3.9). */
  provisional: boolean;
  accrued: string;
  reweighed_kg: string;
  shortfall_amount: string;
  expenses_amount: string;
  /** СПІЛЬНИЙ КОШИК — недостача + витрати. */
  basket: string;
  /** «на кілограм» — `shortfall_per_kg + expenses_per_kg`. `null` when
   *  nothing was weighed, and then so are the two halves below and every
   *  product's `basket_share`. */
  per_kg: string | null;
  /** `shortfall_amount ÷ reweighed_kg`, its own quotient. `null` as `per_kg`. */
  shortfall_per_kg: string | null;
  /** `expenses_amount ÷ reweighed_kg`, its own quotient. `null` as `per_kg`. */
  expenses_per_kg: string | null;
  /** §8.4's own звірка: нараховано + витрати. */
  total_check: string;
  /** The total row, over the `complete` products only — sums, never a per-kg
   *  figure. `null` when `per_kg` is. */
  weighed: {
    intake_kg: string;
    shortfall_kg: string;
    accrued: string;
    shortfall: string;
  } | null;
  /** Σ product `full_cost` = `weighed.accrued + expenses_amount` exactly. `null` as `per_kg`. */
  full_cost: string | null;
  /** `full_cost ÷ reweighed_kg` — the day's average, printed under the table
   *  as «(weighed.accrued + expenses_amount) ÷ reweighed_kg». `null` as `per_kg`. */
  price_cost_avg: string | null;
  /** The products not weighed in full, kept out of `weighed`. A real zero, never `null`. */
  unweighed: { intake_kg: string; accrued: string };
  /** The two звірка facts, computed server-side. `null` as `per_kg`. */
  checks: { shares_ok: boolean; total_ok: boolean } | null;
  top_ups_included: true;
  /** §3.12's marker — a late доплата moved an already-closed day. */
  top_ups_latest_at: string | null;
  /** Σ product `top_ups` — every доплата on the day; '0.00' when none. */
  top_ups_total: string;
  products: CostOfDayProduct[];
}
