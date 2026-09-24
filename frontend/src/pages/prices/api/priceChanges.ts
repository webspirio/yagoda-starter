import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { PriceChanges } from '../model/gradePrice';

/**
 * #151 — today's price moves, newest first. The server picks the day (its own
 * today in `APP_TIMEZONE`) and the scope (the operator's point, or the whole
 * network for the owner), so the hook takes nothing.
 *
 * Nested under the `gradePrices` PREFIX behind a `'changes'` leaf, so the
 * prefix invalidation every price write already performs refreshes this list
 * too — a price set from the sheet shows up here without a reload.
 */
export function usePriceChangesQuery() {
  return useQuery({
    queryKey: [...queryKeys.gradePrices, 'changes'],
    queryFn: async (): Promise<PriceChanges> => {
      const { data } = await httpClient.get<PriceChanges>('/grade-prices/changes');
      return data;
    },
  });
}
