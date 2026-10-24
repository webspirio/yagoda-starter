import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { CostOfDay, CostSplit } from '../model/cost-of-day';

/**
 * §8.4's собівартість for ONE shift — computed live, with no posting moment
 * and no snapshot (reweigh slice §3.3), so a read is always the current
 * answer and a write anywhere in the day invalidates it.
 *
 * `enabled` on the shift id: «зміну не відкривали» is a state the page
 * renders, never a request it sends.
 *
 * `split` is in the key (spec 2026-10-24 §4), so switching back to a split
 * already seen is a cache hit, and a write still invalidates every split.
 */
export function useCostOfDayQuery(shiftId: string | undefined, split: CostSplit) {
  return useQuery({
    queryKey: [...queryKeys.costOfDay, shiftId, split] as const,
    enabled: shiftId !== undefined,
    queryFn: async (): Promise<CostOfDay> => {
      const { data } = await httpClient.get<CostOfDay>(`/shifts/${shiftId}/cost-of-day`, {
        params: { split },
      });
      return data;
    },
    staleTime: STALE.detail,
  });
}
