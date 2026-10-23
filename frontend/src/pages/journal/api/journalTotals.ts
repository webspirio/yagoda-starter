import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';

/** `GET /journal-totals` — numeric strings, formatted, never summed. */
export interface JournalTotals {
  accrued: string;
  paid: string;
}

/**
 * The journal's two tiles (#257): live receipts and payouts over the range,
 * summed by the server, so they hold for the whole range rather than one page.
 * UNDER THE `intakes` PREFIX on purpose — every receipt and payout write (and
 * void) already invalidates it.
 */
export function useJournalTotalsQuery(filter: {
  from: string;
  to: string;
  pointId: string | null;
  supplierId: string | null;
}) {
  const { from, to, pointId, supplierId } = filter;
  return useQuery({
    queryKey: [...queryKeys.intakes, 'journal-totals', { from, to, pointId, supplierId }],
    queryFn: async (): Promise<JournalTotals> =>
      (
        await httpClient.get<JournalTotals>('/journal-totals', {
          params: {
            from,
            to,
            ...(pointId ? { collection_point_id: pointId } : {}),
            ...(supplierId ? { supplier_id: supplierId } : {}),
          },
        })
      ).data,
    // No `keepPreviousData`: a placeholder would show the previous range's money
    // under the new bounds as if settled (PR #275 review), so a new range reads «—».
    staleTime: STALE.list,
  });
}
