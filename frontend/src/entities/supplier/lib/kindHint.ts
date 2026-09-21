import type { SupplierKind } from '../model/supplier';

/** §2.11: «Це оптовик. Додайте додаткову ціну.» — a hint, never a number (§2.10). */
export const kindHintKey = (kind: SupplierKind): string | null =>
  kind === 'none' ? null : `suppliers.kindHint.${kind}`;
