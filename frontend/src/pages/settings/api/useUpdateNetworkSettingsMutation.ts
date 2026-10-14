import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { NetworkSettings } from '@/entities/network-settings';

export interface UpdateNetworkSettingsInput {
  receipt_note: string | null;
}

export function useUpdateNetworkSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateNetworkSettingsInput): Promise<NetworkSettings> => {
      const { data } = await httpClient.patch<NetworkSettings>('/network-settings', input);
      return data;
    },
    // The response IS the new row — every receipt reads it from this cache entry.
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.networkSettings, settings),
  });
}
