import type { SupplierTotalsStatus } from '@/entities/supplier';

const STATUSES: readonly SupplierTotalsStatus[] = ['active', 'inactive', 'all'];

/** The URL param → a status. Anything unrecognised reads as active, never a 400. */
export function readStatus(param: string | null): SupplierTotalsStatus {
  return STATUSES.find((s) => s === param) ?? 'active';
}

/** The default writes null, so `/suppliers` with no query string IS the default. */
export function statusToUrl(s: SupplierTotalsStatus): string | null {
  return s === 'active' ? null : s;
}
