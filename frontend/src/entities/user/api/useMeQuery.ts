import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { useSession } from '../model/store';
import type { Me } from '../model/types';

export function useMeQuery() {
  const token = useSession((s) => s.token);
  return useQuery({
    queryKey: queryKeys.me,
    // Without a token the request is guaranteed to 401 — which would clear the
    // session and count as a failed query for no reason.
    enabled: token !== null,
    queryFn: async (): Promise<Me> => {
      const { data } = await httpClient.get<Me>('/me');
      return data;
    },
  });
}
