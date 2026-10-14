import { useInfiniteQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated, SupplierTotalsRow, SupplierTotalsSort } from '../model/supplier';

const PAGE_SIZE = 100;

/** The next page number while the server still has rows beyond the last page fetched. */
export function nextTotalsPage(last: Paginated<unknown>): number | undefined {
  return last.page * last.limit < last.total ? last.page + 1 : undefined;
}

/**
 * The suppliers page (#230): `GET /supplier-totals`, 100 at a time, «показати ще».
 * UNDER THE `supplierBalances` PREFIX on purpose — every receipt, payout and
 * top-up write (and its void) already invalidates it, so a new receipt moves
 * the weight here with no new invalidation. Sort and search are in the key, so
 * changing either starts a fresh list at page 1.
 */
export function useSupplierTotalsInfiniteQuery(filter: {
  search: string;
  sort: SupplierTotalsSort;
  order: 'asc' | 'desc';
}) {
  const q = filter.search.trim();
  const { sort, order } = filter;
  return useInfiniteQuery({
    queryKey: [...queryKeys.supplierBalances, 'totals', { q, sort, order }],
    initialPageParam: 1,
    queryFn: async ({ pageParam }): Promise<Paginated<SupplierTotalsRow>> =>
      (
        await httpClient.get<Paginated<SupplierTotalsRow>>('/supplier-totals', {
          params: { ...(q ? { q } : {}), sort, order, page: pageParam, limit: PAGE_SIZE },
        })
      ).data,
    getNextPageParam: nextTotalsPage,
    staleTime: STALE.list,
  });
}
