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
  /**
   * Доплати до квитанції (#61) — префікс; читання дописує свій фільтр.
   * A top-up moves a supplier's debt without touching a shift, so a write here
   * invalidates `supplierBalances` but NOT `intakes`/`payouts`.
   */
  intakeTopUps: ['intake-top-ups'] as const,
  /** `/supplier-balances` and `/suppliers/:id/balance` — invalidated together by any document write. */
  supplierBalances: ['supplier-balances'] as const,
  /** Перекази — префікс для кожного фільтрованого списку; читання дописує свій фільтр. */
  transfers: ['transfers'] as const,
  /** Каса точок — префікс і для списку мережі, і для однієї точки. */
  pointCash: ['point-cash'] as const,
  /** Ящики — префікс для видач і повернень; читання дописує свій фільтр. */
  crates: ['crates'] as const,
  /** Переважування — префікс; читання дописує зміну і прапорець сторнованих. */
  reweighs: ['reweighs'] as const,
  /**
   * Залишки ящиків — і список точки (`/crate-balances`), і баланс однієї
   * людини (`/suppliers/:id/crate-balance`). Спільний префікс навмисно: будь-яка
   * видача чи повернення рухає обидва читання.
   */
  crateBalances: ['crate-balances'] as const,
  /** Підрахунки каси — префікс; читання дописує точку/зміну. */
  cashCounts: ['cash-counts'] as const,
  /** §8.4's собівартість — prefix; a read appends the shift. Invalidated by
   *  every expense write, since a витрата moves the basket and на кілограм. */
  costOfDay: ['cost-of-day'] as const,
  /** §8.3's витрати дня — prefix; a read appends the shift. */
  dayExpenses: ['day-expenses'] as const,
};
