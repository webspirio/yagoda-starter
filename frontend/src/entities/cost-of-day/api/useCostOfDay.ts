import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { CostOfDay } from '../model/cost-of-day';

/**
 * §8.4's собівартість for ONE shift — computed live, with no posting moment
 * and no snapshot (reweigh slice §3.3), so a read is always the current
 * answer and a write anywhere in the day invalidates it.
 *
 * `enabled` on the shift id: «зміну не відкривали» is a state the page
 * renders, never a request it sends.
 */
export function useCostOfDayQuery(shiftId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.costOfDay, shiftId] as const,
    enabled: shiftId !== undefined,
    queryFn: async (): Promise<CostOfDay> => {
      const { data } = await httpClient.get<CostOfDay>(`/shifts/${shiftId}/cost-of-day`);
      return data;
    },
  });
}
