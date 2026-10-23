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
  /** «було» — нараховано ÷ вага пункту. */
  price_was: string;
  /** «собівартість» — було + на кілограм. `null` when there is no на кілограм. */
  price_cost: string | null;
  /** «нараховане ÷ наша вага» — the third of §8.4's three prices. */
  price_by_our_weight: string | null;
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
  intake_net_kg: string;
  /** `null` when nothing was weighed for this grade. */
  reweigh_net_kg: string | null;
  /** accrued ÷ intake_net_kg. */
  price_was: string;
}

/** §8.4 for one shift. `GET /shifts/:shiftId/cost-of-day`, owner-only. */
export interface CostOfDay {
  shift_id: string;
  closed_at: string | null;
  /** The shift is still open, so every figure below is still moving (§3.9). */
  provisional: boolean;
  accrued: string;
  reweighed_kg: string;
  shortfall_amount: string;
  expenses_amount: string;
  /** СПІЛЬНИЙ КОШИК — недостача + витрати. */
  basket: string;
  /** «на кілограм» — `null` when nothing was weighed, and then so are the two
   *  halves below and every product's `basket_share`. */
  per_kg: string | null;
  /** The недостача half of `per_kg`; with `expenses_per_kg` it adds up to
   *  `per_kg` exactly (a split of `per_kg`, not two quotients). `null` as `per_kg`. */
  shortfall_per_kg: string | null;
  /** The витрати half of `per_kg`. `null` as `per_kg`. */
  expenses_per_kg: string | null;
  /** §8.4's own звірка: нараховано + витрати. */
  total_check: string;
  /** The total row, over the `complete` products only. `null` when `per_kg` is. */
  weighed: {
    intake_kg: string;
    shortfall_kg: string;
    accrued: string;
    shortfall: string;
    price_was: string;
  } | null;
  /** Σ product `full_cost` = `weighed.accrued + expenses_amount`. `null` as `per_kg`. */
  full_cost: string | null;
  /** `full_cost ÷ reweighed_kg` — an average, not any product's `price_cost`. `null` as `per_kg`. */
  price_cost_avg: string | null;
  /** The products not weighed in full, kept out of `weighed`. A real zero, never `null`. */
  unweighed: { intake_kg: string; accrued: string };
  /** The two звірка facts, computed server-side. `null` as `per_kg`. */
  checks: { shares_ok: boolean; total_ok: boolean } | null;
  top_ups_included: true;
  /** §3.12's marker — a late доплата moved an already-closed day. */
  top_ups_latest_at: string | null;
  products: CostOfDayProduct[];
}
