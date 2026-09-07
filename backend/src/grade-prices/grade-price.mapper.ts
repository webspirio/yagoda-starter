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
