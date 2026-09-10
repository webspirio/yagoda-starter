import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { CashCount, CashCountFilter, Paginated } from '../model/cash-count';

function cashCountParams(f: CashCountFilter) {
  return {
    ...(f.pointId ? { collection_point_id: f.pointId } : {}),
    ...(f.shiftId ? { shift_id: f.shiftId } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.page ? { page: f.page } : {}),
    only_discrepancies: f.onlyDiscrepancies ?? false,
    limit: f.limit ?? 100,
  };
}

/**
 * §7.6's journal, and the owner's incident list — read-only by design, not
 * by omission: there is no `POST /cash-counts`, a count is born only from
 * opening or closing a shift.
 */
export function useCashCountsQuery(filter: CashCountFilter) {
  return useQuery({
    queryKey: [...queryKeys.cashCounts, filter] as const,
    queryFn: async (): Promise<Paginated<CashCount>> => {
      const { data } = await httpClient.get<Paginated<CashCount>>('/cash-counts', {
        params: cashCountParams(filter),
      });
      return data;
    },
    staleTime: STALE.list,
  });
}
