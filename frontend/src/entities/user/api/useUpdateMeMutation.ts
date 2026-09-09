import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Me } from '../model/user';

/**
 * `display_name` is gone: it is derived server-side and the owner, not the
 * user, sets the underlying names. `language_code` is all that is left, and
 * nothing writes it yet — the language preference lives in localStorage
 * (`shared/lib/i18n/language-preference`).
 *
 * Kept anyway, the same way `shared/lib/form-draft` and `shared/lib/url-state`
 * are kept: it is this project's reference TanStack mutation, seeding the
 * cache from the response instead of invalidating. Do not delete it as dead
 * code, and do not invent a caller to justify it.
 */
export interface UpdateMeInput {
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
