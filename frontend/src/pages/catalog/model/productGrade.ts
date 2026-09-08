/**
 * Mirrors the backend `ProductGradeResponse`.
 *
 * It carries the product's ID but NOT its name — the API addresses grades
 * flatly (`/product-grades/:id`) and every later table points at a grade
 * without mentioning its product, so the tab loads products too and joins by id
 * on the client. There is NO `display_order`: origin/main's grade slice does
 * not implement one.
 */
export interface ProductGrade {
  id: string;
  product_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

/** POST body. `product_id` is set at CREATE only — a grade never changes parent
 *  (moving it would retroactively move every receipt line into another
 *  product's totals). */
export interface CreateProductGradeInput {
  product_id: string;
  name: string;
}

/** PATCH body. All optional. THERE IS NO `product_id` here on purpose. */
export interface UpdateProductGradeInput {
  name?: string;
  is_active?: boolean;
}

/** RHF values for the grade dialog. `product_id` is picked only when creating;
 *  the edit dialog shows the parent as static text. */
export interface ProductGradeFormValues {
  product_id: string;
  name: string;
  is_active: boolean;
}
