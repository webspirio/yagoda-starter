/**
 * Mirrors the backend's `ProductResponse`. There is deliberately NO
 * `is_active`: a product's visibility is DERIVED from whether it has any
 * active grade (§4.1 of the domain rules), so the column does not exist and no
 * form may invent one.
 */
export interface Product {
  id: string;
  name: string;
  created_at: string;
}

/** The API's list envelope, shared by all three catalogs. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ProductFormValues {
  name: string;
}
