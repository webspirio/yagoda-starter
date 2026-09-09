/**
 * A product grade flattened together with its parent product's name — the shape
 * every screen that prices or receives a grade needs, but neither the grades API
 * (`/product-grades`, which carries `product_id` but not the product's name) nor
 * the products API returns on its own. `useGradeCatalogQuery` joins the two.
 *
 * Field names are camelCase here because this is a client-side view model, not a
 * wire type: nothing serialises it back to the API.
 */
export interface GradeCatalogItem {
  /** The grade id — this is what `product_grade_id` on a price or receipt points at. */
  id: string;
  /** The grade's own name, e.g. "Grade 1". */
  name: string;
  productId: string;
  productName: string;
}
