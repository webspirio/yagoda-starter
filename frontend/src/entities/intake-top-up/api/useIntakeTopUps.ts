import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import type { Paginated } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { IntakeTopUp, TopUpFilter } from '../model/intakeTopUp';

/**
 * A supplier's (or a receipt's) top-ups. NEVER bare — like the intake and
 * payout journals, this list is unbounded across the network, so a read
 * without a filter is a mistake rather than a default.
 *
 * `include_voided` is left at the server's default of `true`: §9.3 keeps a
 * voided document in the journal «НАЗАВЖДИ з печаткою "СТОРНОВАНО"», and a
 * voided top-up is no different. The screen strikes it through; it does not
 * drop it.
 */
export function useIntakeTopUpsQuery(filter: TopUpFilter) {
  const enabled = Boolean(filter.supplierId || filter.intakeId || filter.pointId);
  return useQuery({
    queryKey: [...queryKeys.intakeTopUps, filter] as const,
    enabled,
    queryFn: async (): Promise<Paginated<IntakeTopUp>> => {
      const { data } = await httpClient.get<Paginated<IntakeTopUp>>('/intake-top-ups', {
        params: {
          ...(filter.supplierId ? { supplier_id: filter.supplierId } : {}),
          ...(filter.intakeId ? { intake_id: filter.intakeId } : {}),
          ...(filter.pointId ? { collection_point_id: filter.pointId } : {}),
          ...(filter.page ? { page: filter.page } : {}),
          limit: filter.limit ?? 100,
        },
      });
      return data;
    },
    staleTime: STALE.list,
  });
}
