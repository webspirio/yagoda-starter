import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Payout } from '../model/payout';

/**
 * One payout — `GET /payouts/:id`, the only read that carries the payer's
 * name (`paid_by`). Single-document `'one'` leaf, so it never collides with a
 * list read keyed by a filter (same shape as `useIntakeQuery`).
 */
export function usePayoutQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.payouts, 'one', id],
    enabled: id !== null,
    queryFn: async (): Promise<Payout> => {
      const { data } = await httpClient.get<Payout>(`/payouts/${id}`);
      return data;
    },
    staleTime: STALE.detail,
  });
}
