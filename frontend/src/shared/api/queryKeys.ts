export const queryKeys = {
  me: ['me'] as const,
  products: ['products'] as const,
  /** Parameterised: the grades tab filters by product, and two filters must
   *  never share one cache entry. */
  productGrades: (productId?: string) => ['product-grades', productId ?? 'all'] as const,
  tareTypes: ['tare-types'] as const,
};
