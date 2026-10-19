import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { SupplierTotalsRow, SupplierTotalsSort } from '../model/supplier';

/**
 * The suppliers page (#230): `GET /supplier-totals`, every active supplier in
 * one list — unpaged, because the sort keys move with every document and an
 * offset page would skip a supplier (PR #253 review).
 * UNDER THE `supplierBalances` PREFIX on purpose — every receipt, payout and
 * top-up write (and its void) already invalidates it, so a new receipt moves
 * the weight here with no new invalidation.
 */
export function useSupplierTotalsQuery(filter: {
  search: string;
  sort: SupplierTotalsSort;
  order: 'asc' | 'desc';
}) {
  const q = filter.search.trim();
  const { sort, order } = filter;
  return useQuery({
    queryKey: [...queryKeys.supplierBalances, 'totals', { q, sort, order }],
    queryFn: async (): Promise<SupplierTotalsRow[]> =>
      (
        await httpClient.get<SupplierTotalsRow[]>('/supplier-totals', {
          params: { ...(q ? { q } : {}), sort, order },
        })
      ).data,
    staleTime: STALE.list,
    // A new sort keeps the old rows on screen (and the header focused) until it lands.
    placeholderData: keepPreviousData,
  });
}
