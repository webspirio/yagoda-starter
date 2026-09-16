import { GradePrice } from './grade-price.entity';

/** All three money values are STRINGS on the wire — `numeric` is carried end
 *  to end so no value ever passes through a binary float. */
export interface GradePriceResponse {
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
 * Accepts an entity OR a raw row from the `DISTINCT ON` query in
 * `GradePricesService.current()`. `SELECT gp.*` returns the same column names
 * as the entity's properties and the `pg` driver returns `timestamptz` as a
 * `Date` and `numeric` as a `string`, so the two shapes coincide — which is
 * why one mapper serves both reads.
 */
export function toGradePriceResponse(price: GradePrice): GradePriceResponse {
  return {
    id: price.id,
    collection_point_id: price.collection_point_id,
    product_grade_id: price.product_grade_id,
    base_price: price.base_price,
    max_markup: price.max_markup,
    max_discount: price.max_discount,
    created_by_user_id: price.created_by_user_id,
    reason: price.reason,
    created_at: price.created_at.toISOString(),
  };
}

/**
 * THE SHEET — #89's «аркуш»: rows are grades, columns are points.
 *
 * Shaped as `points` plus `rows` rather than a flat list, because the SCREEN is
 * a grid and a flat list would make every client rebuild the same pivot. The
 * column order is the server's and is total, so two reads cannot reshuffle it.
 */
export interface SheetPointColumn {
  id: string;
  name: string;
  /** `'reception'` or `'warehouse'` — §4.8's «поставити всім» skips the
   *  warehouse, and the client cannot apply that rule without knowing which is
   *  which. */
  kind: string;
}

/** All three numbers, because a cell's dialog edits all three. */
export interface SheetCell {
  base_price: string;
  max_markup: string;
  max_discount: string;
}

export interface SheetRow {
  product_grade_id: string;
  grade_name: string;
  product_name: string;
  /** Keyed by `collection_point_id`. A point with NO price is ABSENT from this
   *  map — never present with a `null`, which would read as «0». */
  prices: Record<string, SheetCell>;
}

export interface GradePriceSheetResponse {
  points: SheetPointColumn[];
  rows: SheetRow[];
}
