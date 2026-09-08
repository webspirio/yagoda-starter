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
};
