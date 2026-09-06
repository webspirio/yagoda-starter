/**
 * Mirrors the backend's `ProductGradeResponse`.
 *
 * It carries the product's ID AND NOT ITS NAME — deliberately, because the API
 * addresses grades flatly (`/product-grades/:id`) and every later table
 * (`grade_prices`, `intake_items`) points at a grade without mentioning its
 * product. The tab therefore loads products too and joins by id on the client.
 */
export interface ProductGrade {
  id: string;
  product_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

/** `product_id` is set at CREATE only. A grade never changes parent: moving it
 *  would retroactively move every receipt line ever written against it into a
 *  different product's totals. The edit dialog shows the product as text. */
export interface ProductGradeFormValues {
  product_id: string;
  name: string;
  is_active: boolean;
}
