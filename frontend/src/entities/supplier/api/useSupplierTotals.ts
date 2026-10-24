import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type {
  SupplierTotalsRow,
  SupplierTotalsSort,
  SupplierTotalsStatus,
} from '../model/supplier';

/**
 * The suppliers page (#230): `GET /supplier-totals`, every supplier of the
 * chosen `status` in one list — unpaged, because the sort keys move with every document and an
 * offset page would skip a supplier (PR #253 review).
 * UNDER THE `supplierBalances` PREFIX on purpose — every receipt, payout and
 * top-up write (and its void) already invalidates it, so a new receipt moves
 * the weight here with no new invalidation.
 *
 * `pointId` narrows it to one point (ignored server-side for an operator, as
 * on `/suppliers`). Since it is unpaged it is also the journal's NAME source
 * (audit D7): `status: 'all'` names every supplier a historic document can
 * belong to, past the 100 a paged read would stop at.
 */
export function useSupplierTotalsQuery(filter: {
  search: string;
  sort: SupplierTotalsSort;
  order: 'asc' | 'desc';
  status: SupplierTotalsStatus;
  pointId?: string | null;
}) {
  const q = filter.search.trim();
  const { sort, order, status } = filter;
  const pointId = filter.pointId ?? null;
  return useQuery({
    queryKey: [...queryKeys.supplierBalances, 'totals', { q, sort, order, status, pointId }],
    queryFn: async (): Promise<SupplierTotalsRow[]> =>
      (
        await httpClient.get<SupplierTotalsRow[]>('/supplier-totals', {
          params: {
            ...(q ? { q } : {}),
            sort,
            order,
            status,
            ...(pointId ? { collection_point_id: pointId } : {}),
          },
        })
      ).data,
    staleTime: STALE.list,
    // A new sort keeps the old rows on screen (and the header focused) until it lands.
    placeholderData: keepPreviousData,
  });
}
