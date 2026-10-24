import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { NetworkCostOfDay } from '../model/network-cost-of-day';

/**
 * «Усі точки» on «Собівартість дня» — every point's day, summed by the
 * server. Keyed under `queryKeys.costOfDay`, so every write that invalidates
 * one point's cost-of-day invalidates the network's too.
 *
 * `date` is `null` while the page is not in all-points mode: nothing is sent.
 */
export function useNetworkCostOfDayQuery(date: string | null) {
  return useQuery({
    queryKey: [...queryKeys.costOfDay, 'network', date] as const,
    enabled: date !== null,
    queryFn: async (): Promise<NetworkCostOfDay> => {
      const { data } = await httpClient.get<NetworkCostOfDay>('/reports/cost-of-day', {
        params: { date },
      });
      return data;
    },
    staleTime: STALE.detail,
  });
}
