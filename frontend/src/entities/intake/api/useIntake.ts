import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { IntakeDetail } from '../model/intake';

/**
 * One receipt with its lines — `GET /intakes/:id`, the read a printed/reopened
 * receipt and the reception screen's "just recorded" confirmation both need.
 * Unlike `useIntakesQuery`'s `[...queryKeys.intakes, filter]`, the detail read
 * takes an `'one'` LEAF so a single-document cache entry never collides with a
 * list read that happens to share the same id as a filter value.
 *
 * Not cached (`shared/api/cachePolicy.ts`): a receipt is immutable once written
 * (§2.7: `amount` never changes after posting), but a fresh void could land
 * seconds later.
 */
export function useIntakeQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.intakes, 'one', id],
    enabled: id !== null,
    queryFn: async (): Promise<IntakeDetail> => {
      const { data } = await httpClient.get<IntakeDetail>(`/intakes/${id}`);
      return data;
    },
  });
}
