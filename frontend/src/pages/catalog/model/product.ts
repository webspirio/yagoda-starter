/**
 * Mirrors the backend `ProductResponse`. There is deliberately NO `is_active`
 * and NO `display_order`:
 *  - a product's visibility is DERIVED from whether it has any active grade, so
 *    there is no `is_active` column to edit here;
 *  - origin/main's product slice does not implement an ordering column either
 *    (`ProductResponse` and both DTOs carry only `name`), so no form invents one.
 */
export interface Product {
  id: string;
  name: string;
  created_at: string;
}

/** The API's list envelope, shared by all three catalog resources. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/** POST body — `name` is the only field the create DTO accepts. */
export interface CreateProductInput {
  name: string;
}

/** PATCH body — all optional; `name` is the only field the update DTO accepts. */
export interface UpdateProductInput {
  name?: string;
}

/** RHF values for the product dialog. */
export interface ProductFormValues {
  name: string;
}
