import type { SupplierKind } from '../model/supplier';

/**
 * §2.11: «Це оптовик. Додайте додаткову ціну.» — a hint, never a number (§2.10).
 * Wholesale only (#118): a farmer's price may vary within the bounds like
 * anyone's, but the red reminder is the wholesaler's alone.
 */
export const kindHintKey = (kind: SupplierKind): string | null =>
  kind === 'wholesale' ? 'suppliers.kindHint.wholesale' : null;
