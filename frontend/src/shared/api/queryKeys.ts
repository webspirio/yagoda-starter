export const queryKeys = {
  me: ['me'] as const,
  collectionPoints: ['collection-points'] as const,
  users: ['users'] as const,
  suppliers: ['suppliers'] as const,
  products: ['products'] as const,
  /**
   * Parameterised so the filtered and unfiltered grade lists never share a
   * cache entry. Called with no argument (`['product-grades']`) it is also the
   * invalidation PREFIX that refreshes every filtered variant at once.
   */
  productGrades: (productId?: string) =>
    productId ? (['product-grades', productId] as const) : (['product-grades'] as const),
  tareTypes: ['tare-types'] as const,
  /** Grade prices — the invalidation PREFIX for every `/current?point=…` read;
   *  a per-point read appends the point id (`[...queryKeys.gradePrices, pointId]`). */
  gradePrices: ['grade-prices'] as const,
  /** Shifts — prefix for `/current` and by-date reads; a read appends the point (and date). */
  shifts: ['shifts'] as const,
  /** Document journals — prefix for every filtered list; a read appends its filter object. */
  intakes: ['intakes'] as const,
  payouts: ['payouts'] as const,
  /** `/supplier-balances` and `/suppliers/:id/balance` — invalidated together by any document write. */
  supplierBalances: ['supplier-balances'] as const,
};
