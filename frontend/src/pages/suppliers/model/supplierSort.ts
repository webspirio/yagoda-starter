import type { SupplierTotalsSort } from '@/entities/supplier';

export interface SupplierSort {
  key: SupplierTotalsSort;
  order: 'asc' | 'desc';
}

const KEYS: readonly SupplierTotalsSort[] = ['weight', 'amount', 'name'];
/** Where a column starts when first clicked: the biggest numbers on top, names A→Z. */
const FIRST_ORDER: Record<SupplierTotalsSort, 'asc' | 'desc'> = { weight: 'desc', amount: 'desc', name: 'asc' };

export const DEFAULT_SORT: SupplierSort = { key: 'weight', order: 'desc' };

/** The URL pair → a sort. Anything unrecognised reads as the default, never a 400. */
export function readSort(sort: string | null, order: string | null): SupplierSort {
  const key = KEYS.find((k) => k === sort);
  if (!key) return DEFAULT_SORT; // a junk key discards its order too
  const dir = order === 'asc' || order === 'desc' ? order : FIRST_ORDER[key];
  return { key, order: dir };
}

/** Same column flips; another column opens in its own first direction. */
export function nextSort(current: SupplierSort, clicked: string): SupplierSort {
  const key = KEYS.find((k) => k === clicked) ?? current.key;
  if (key === current.key) return { key, order: current.order === 'asc' ? 'desc' : 'asc' };
  return { key, order: FIRST_ORDER[key] };
}

/** The default writes nulls, so `/suppliers` with no query string IS the default. */
export function toUrl(s: SupplierSort): { sort: string | null; order: string | null } {
  if (s.key === DEFAULT_SORT.key && s.order === DEFAULT_SORT.order) return { sort: null, order: null };
  return { sort: s.key, order: s.order };
}
