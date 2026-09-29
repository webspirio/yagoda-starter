import { GradePrice } from './grade-price.entity';
import { displayNameOf } from '../users/display-name';

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

/**
 * ONE LINE OF #151's «Зміни протягом дня» — §4.2's journal row, named for a
 * reader rather than for a join.
 *
 * `previous_base_price` is the price this row REPLACED at the same (point,
 * grade), whatever day that was set on — `null` only for a pair's first-ever
 * price. It is read from the journal at query time, never stored: storing it
 * would be a second copy of the row before it.
 */
export interface PriceChangeResponse {
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

export interface PriceChangesResponse {
  /** The period the list covers, both ends inclusive local dates in the app
   *  zone, `YYYY-MM-DD` — `from === to` for a single day. */
  from: string;
  to: string;
  changes: PriceChangeResponse[];
}

/** The raw row `GradePricesService.changes()` selects — the journal row joined
 *  to the names a reader needs, with the author still in two columns. */
export interface PriceChangeRow {
  id: string;
  created_at: Date;
  collection_point_id: string;
  point_name: string;
  product_grade_id: string;
  product_name: string;
  grade_name: string;
  previous_base_price: string | null;
  base_price: string;
  reason: string | null;
  first_name: string;
  last_name: string;
}

export function toPriceChangeResponse(row: PriceChangeRow): PriceChangeResponse {
  return {
    id: row.id,
    created_at: row.created_at.toISOString(),
    collection_point_id: row.collection_point_id,
    point_name: row.point_name,
    product_grade_id: row.product_grade_id,
    product_name: row.product_name,
    grade_name: row.grade_name,
    // Strings straight through — `numeric` never becomes a float here.
    previous_base_price: row.previous_base_price,
    base_price: row.base_price,
    reason: row.reason,
    author_name: displayNameOf(row),
  };
}
