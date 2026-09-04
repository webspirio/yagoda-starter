import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Me } from '../model/types';

export interface UpdateMeInput {
  display_name?: string;
  language_code?: string;
}

export function useUpdateMeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMeInput): Promise<Me> => {
      const { data } = await httpClient.patch<Me>('/me', input);
      return data;
    },
    // The response IS the new profile, so seed the cache from it instead of
    // invalidating and paying for a second round trip.
    onSuccess: (me) => queryClient.setQueryData(queryKeys.me, me),
  });
}
