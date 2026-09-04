import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Me } from '@/entities/user';

/**
 * Not built on `shared/lib/upload/useImageUpload` — that hook is typed for
 * endpoints returning `{ id?, url }`, but `POST /me/avatar` returns the whole
 * updated `Me`, which is what needs to land in the `/me` query cache. The
 * response shapes don't match, so this mutation talks to `httpClient`
 * directly instead of forcing a cast through `useImageUpload`.
 */
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
