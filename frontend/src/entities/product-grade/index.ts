/** `useGradeCatalogQuery` is deliberately NOT here: since #148 the receipt
 *  names its own lines, and `usePricedGradesQuery` — inside this slice — is
 *  the catalog's only remaining reader. A barrel entry nobody imports is a
 *  public API that invites the very active-only read #148 removed, so the
 *  hook stays slice-internal (same call as `features/edit-supplier`'s). */
export type { GradeCatalogItem, PricedGrade } from './model/product-grade';
export { usePricedGradesQuery } from './api/usePricedGrades';
