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
  /** «із пулу» — this product's allocated share of the basket. `null` when it
   *  contributed no kilograms to the day. */
  basket_share: string | null;
  /** «було» — нараховано ÷ вага пункту. */
  price_was: string;
  /** «собівартість» — було + на кілограм. `null` when there is no на кілограм. */
  price_cost: string | null;
  /** «нараховане ÷ наша вага» — the third of §8.4's three prices. */
  price_by_our_weight: string | null;
  /** §3.15 — every grade this product had this shift is on the scale. */
  complete: boolean;
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
  shortfall_per_kg: string | null;
  expenses_per_kg: string | null;
  /** §8.4's own звірка: нараховано + витрати. */
  total_check: string;
  top_ups_included: true;
  /** §3.12's marker — a late доплата moved an already-closed day. */
  top_ups_latest_at: string | null;
  products: CostOfDayProduct[];
}
