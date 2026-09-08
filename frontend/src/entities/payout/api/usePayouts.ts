import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { DocumentFilter, Payout, Paginated } from '../model/payout';

/**
 * Duplicated from `entities/intake/api/useIntakes.ts` rather than imported —
 * FSD forbids a same-layer cross-import (`entities/payout` -> `entities/intake`).
 * A three-line duplicate is the recorded FSD-correct price; keep it in sync
 * by hand if the param mapping ever changes.
 */
export function documentParams(f: DocumentFilter) {
  return {
    ...(f.shiftId ? { shift_id: f.shiftId } : {}),
    ...(f.supplierId ? { supplier_id: f.supplierId } : {}),
    ...(f.pointId ? { collection_point_id: f.pointId } : {}),
    include_voided: f.includeVoided ?? true,
    limit: f.limit ?? 100,
  };
}

/** Payout headers for a shift, a supplier or a point — never all of them. */
export function usePayoutsQuery(filter: DocumentFilter) {
  const enabled = Boolean(filter.shiftId || filter.supplierId || filter.pointId);
  return useQuery({
    queryKey: [...queryKeys.payouts, filter],
    enabled,
    queryFn: async (): Promise<Paginated<Payout>> => {
      const { data } = await httpClient.get<Paginated<Payout>>('/payouts', {
        params: documentParams(filter),
      });
      return data;
    },
    staleTime: STALE.list,
  });
}
