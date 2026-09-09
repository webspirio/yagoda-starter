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

/**
 * A grade catalog row priced for one collection point — `usePricedGradesQuery`'s
 * shape. The three money fields are STRINGS, same discipline as `GradePrice`
 * (`pages/prices/model/gradePrice.ts`): `numeric` end to end, no binary float.
 * Only grades that have a current price at the point become a `PricedGrade` —
 * an unpriced grade cannot be received (§2.4 needs a `base_price`).
 */
export type PricedGrade = GradeCatalogItem & {
  base_price: string;
  max_markup: string;
  max_discount: string;
};
