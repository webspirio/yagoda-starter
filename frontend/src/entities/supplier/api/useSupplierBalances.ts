import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Paginated, SupplierBalanceRow } from '../model/supplier';

/** One supplier's outstanding debt — §3.1's «Разом», read before a payout. */
export function useSupplierBalanceQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.supplierBalances, 'one', id],
    enabled: id !== null,
    queryFn: async (): Promise<{ supplier_id: string; debt: string }> =>
      (await httpClient.get<{ supplier_id: string; debt: string }>(`/suppliers/${id}/balance`))
        .data,
    // A balance moves with every receipt and payout; those writes invalidate the prefix.
  });
}

/**
 * The «Залишки» list — every supplier's debt at a point. `enabled` defaults to
 * `true`; the caller decides when to hold off (e.g. an owner with no point
 * chosen yet) by passing `enabled: false`.
 */
export function useSupplierBalancesQuery(filter: {
  pointId?: string | null;
  includeZero?: boolean;
  enabled?: boolean;
}) {
  const { pointId, includeZero = false, enabled = true } = filter;
  return useQuery({
    queryKey: [...queryKeys.supplierBalances, 'list', { pointId: pointId ?? null, includeZero }],
    enabled,
    queryFn: async (): Promise<Paginated<SupplierBalanceRow>> =>
      (
        await httpClient.get<Paginated<SupplierBalanceRow>>('/supplier-balances', {
          params: {
            ...(pointId ? { collection_point_id: pointId } : {}),
            include_zero: includeZero,
            limit: 100,
          },
        })
      ).data,
  });
}
