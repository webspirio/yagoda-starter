import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
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
 * At least one of point, shift or a `from`/`to` range — mirrors
 * `intakesQueryOptions`/`payoutsQueryOptions` (review round 2, minor
 * finding). Without this, a caller with no point picked yet
 * (`PointCashPage` before an owner chooses one) fired `GET /cash-counts`
 * for the WHOLE network on a screen showing nothing but an empty-state
 * placeholder. A future network-wide incident list
 * (`only_discrepancies=true` alone, per this function's own doc comment)
 * would need to opt in explicitly rather than rely on the absence of a
 * scope — there is no such caller today.
 */
function isScoped(f: CashCountFilter): boolean {
  return Boolean(f.pointId || f.shiftId || (f.from && f.to));
}

/**
 * §7.6's journal, and the owner's incident list — read-only by design, not
 * by omission: there is no `POST /cash-counts`, a count is born only from
 * opening or closing a shift.
 */
export function useCashCountsQuery(filter: CashCountFilter) {
  return useQuery({
    queryKey: [...queryKeys.cashCounts, filter] as const,
    enabled: isScoped(filter),
    queryFn: async (): Promise<Paginated<CashCount>> => {
      const { data } = await httpClient.get<Paginated<CashCount>>('/cash-counts', {
        params: cashCountParams(filter),
      });
      return data;
    },
  });
}
