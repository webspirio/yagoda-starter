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
