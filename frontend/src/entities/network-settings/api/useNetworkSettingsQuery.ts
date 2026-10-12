import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { STALE } from '@/shared/api/queryClient';
import { queryKeys } from '@/shared/api/queryKeys';
import type { NetworkSettings } from '../model/networkSettings';

// The receipt holds Print while this re-reads, so a stalled socket must fail
// fast and let it print the last-known note.
const TIMEOUT_MS = 5_000;

/** Read by every receipt and by the owner's settings page. */
export function useNetworkSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.networkSettings,
    staleTime: STALE.reference,
    queryFn: async (): Promise<NetworkSettings> => {
      const { data } = await httpClient.get<NetworkSettings>('/network-settings', {
        timeout: TIMEOUT_MS,
      });
      return data;
    },
  });
}
