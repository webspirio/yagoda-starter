import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Me } from '@/entities/user';

export function useUploadAvatarMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (file: File): Promise<Me> => {
      const body = new FormData();
      body.append('file', file);
      // No explicit Content-Type: the browser must set it, because only the
      // browser knows the multipart boundary it generated.
      const { data } = await httpClient.post<Me>('/me/avatar', body);
      return data;
    },
    onSuccess: (me) => queryClient.setQueryData(queryKeys.me, me),
  });
}
