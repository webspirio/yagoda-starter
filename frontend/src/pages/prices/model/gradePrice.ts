/**
 * Mirrors the backend `GradePriceResponse`. All three money values are STRINGS
 * on the wire — `numeric` is carried end to end so no value ever passes through
 * a binary float. `reason` is `string | null` (nullable column), never absent.
 */
export interface GradePrice {
  id: string;
  collection_point_id: string;
  product_grade_id: string;
  base_price: string;
  max_markup: string;
  max_discount: string;
  created_by_user_id: string;
  reason: string | null;
  created_at: string;
}

/**
 * The `/current` read reduced to a lookup keyed by `product_grade_id`, so a row
 * renderer can ask "what is the price of this grade?" in O(1). Only priced
 * grades appear as keys; an unpriced grade is a missing key, rendered "—".
 */
export type CurrentPriceMap = Record<
  string,
  { base_price: string; max_markup: string; max_discount: string }
>;

/**
 * POST body for `/grade-prices`. `collection_point_id` is carried in the body
 * (the documented owner-only exception — an owner has no point to derive it
 * from). `reason` is optional. Setting a price APPENDS a new row; there is no
 * PATCH, the latest row wins.
 */
export interface SetPriceInput {
  collection_point_id: string;
  product_grade_id: string;
  base_price: string;
  max_markup: string;
  max_discount: string;
  reason?: string;
}

/** RHF values for the set-price dialog — all strings, `reason` always present
 *  (empty when untouched; trimmed to `undefined` before it hits the wire). */
export interface PriceFormValues {
  base_price: string;
  max_markup: string;
  max_discount: string;
  reason: string;
}

/* ------------------------------------------------------------------------- *
 * THE SHEET — #89's «аркуш»: rows are grades, columns are points.
 * ------------------------------------------------------------------------- */

/** Mirrors the backend `SheetPointColumn`. */
export interface SheetPoint {
  id: string;
  name: string;
  /**
   * `'reception'` or `'base'`. THE ENUM SPELLS THE WAREHOUSE `base`, because
   * §8.1 also re-weighs there — reading it as `'warehouse'` finds nothing and
   * silently treats the warehouse as an ordinary point, which would put it
   * inside «встановити всім» against §4.8.
   */
  kind: 'reception' | 'base';
}

/** One point's price for one grade. All three numbers, because the cell's
 *  dialog edits all three. */
export interface SheetCell {
  base_price: string;
  max_markup: string;
  max_discount: string;
}

/** One grade's row. A point with NO price is ABSENT from `prices` — never
 *  present holding `null`, which a renderer would show as «0». */
export interface SheetRow {
  product_grade_id: string;
  grade_name: string;
  product_name: string;
  prices: Record<string, SheetCell>;
}

export interface PriceSheet {
  points: SheetPoint[];
  rows: SheetRow[];
}

/**
 * POST body for `/grade-prices/bulk` — «поставити всім». The points are NAMED
 * by this client rather than computed by the server, so §4.8's warehouse
 * exclusion is visible on the screen that performs the gesture.
 */
export interface BulkPriceInput {
  product_grade_id: string;
  collection_point_ids: string[];
  base_price: string;
  max_markup: string;
  max_discount: string;
  reason?: string;
}

/* ------------------------------------------------------------------------- *
 * #151 — «Зміни протягом дня».
 * ------------------------------------------------------------------------- */

/** Mirrors the backend `PriceChangeResponse`: one journal row, named for a
 *  reader. `previous_base_price` is the price this row REPLACED at the same
 *  point and grade — possibly set on an earlier day — and `null` only for the
 *  pair's first-ever price. */
export interface PriceChange {
  id: string;
  created_at: string;
  collection_point_id: string;
  point_name: string;
  product_grade_id: string;
  product_name: string;
  grade_name: string;
  previous_base_price: string | null;
  base_price: string;
  reason: string | null;
  author_name: string;
}

export interface PriceChanges {
  /** The server's today in the app zone, `YYYY-MM-DD`. */
  date: string;
  changes: PriceChange[];
}
