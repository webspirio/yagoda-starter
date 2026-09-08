import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { DocumentFilter, Intake, Paginated } from '../model/intake';

export function documentParams(f: DocumentFilter) {
  return {
    ...(f.shiftId ? { shift_id: f.shiftId } : {}),
    ...(f.supplierId ? { supplier_id: f.supplierId } : {}),
    ...(f.pointId ? { collection_point_id: f.pointId } : {}),
    include_voided: f.includeVoided ?? true,
    limit: f.limit ?? 100,
  };
}

/** Receipt headers for a shift, a supplier or a point — never all of them. */
export function useIntakesQuery(filter: DocumentFilter) {
  const enabled = Boolean(filter.shiftId || filter.supplierId || filter.pointId);
  return useQuery({
    queryKey: [...queryKeys.intakes, filter],
    enabled,
    queryFn: async (): Promise<Paginated<Intake>> => {
      const { data } = await httpClient.get<Paginated<Intake>>('/intakes', {
        params: documentParams(filter),
      });
      return data;
    },
    staleTime: STALE.list,
  });
}
