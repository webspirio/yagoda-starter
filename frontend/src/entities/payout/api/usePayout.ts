import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { PayoutDetail } from '../model/payout';

/**
 * One payout — `GET /payouts/:id`, the only read that carries the receipt
 * header's numbers (`paid_by_number`, `point_number`). Single-document `'one'` leaf, so it never collides with a
 * list read keyed by a filter (same shape as `useIntakeQuery`).
 */
export function usePayoutQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.payouts, 'one', id],
    enabled: id !== null,
    queryFn: async (): Promise<PayoutDetail> => {
      const { data } = await httpClient.get<PayoutDetail>(`/payouts/${id}`);
      return data;
    },
    staleTime: STALE.detail,
  });
}
