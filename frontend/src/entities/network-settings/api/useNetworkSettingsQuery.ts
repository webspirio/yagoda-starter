import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { STALE } from '@/shared/api/queryClient';
import { queryKeys } from '@/shared/api/queryKeys';
import type { NetworkSettings } from '../model/networkSettings';

/** Read by every receipt and by the owner's settings page. */
export function useNetworkSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.networkSettings,
    staleTime: STALE.reference,
    queryFn: async (): Promise<NetworkSettings> => {
      const { data } = await httpClient.get<NetworkSettings>('/network-settings');
      return data;
    },
  });
}
