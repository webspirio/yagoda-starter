import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { PriceChanges } from '../model/gradePrice';
import type { ChangesPeriod } from '../model/changesPeriod';

/**
 * #151 — price moves over a period, newest first. A `null` bound is left off
 * the request so the server picks it (its own today in `APP_TIMEZONE`); the
 * scope (the operator's point, or the whole network for the owner) is always
 * the server's.
 *
 * Nested under the `gradePrices` PREFIX behind a `'changes'` leaf, so the
 * prefix invalidation every price write already performs refreshes this list
 * too — a price set from the sheet shows up here without a reload.
 */
export function usePriceChangesQuery(period: ChangesPeriod) {
  return useQuery({
    queryKey: [...queryKeys.gradePrices, 'changes', period.from, period.to],
    queryFn: async (): Promise<PriceChanges> => {
      const params: Record<string, string> = {};
      if (period.from) params.from = period.from;
      if (period.to) params.to = period.to;
      const { data } = await httpClient.get<PriceChanges>('/grade-prices/changes', { params });
      return data;
    },
    staleTime: STALE.list,
  });
}
