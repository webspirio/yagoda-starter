import { queryOptions, useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { DocumentFilter, Intake, Paginated } from '../model/intake';

export function documentParams(f: DocumentFilter) {
  return {
    ...(f.shiftId ? { shift_id: f.shiftId } : {}),
    ...(f.supplierId ? { supplier_id: f.supplierId } : {}),
    ...(f.pointId ? { collection_point_id: f.pointId } : {}),
    ...(f.from ? { from: f.from } : {}),
    ...(f.to ? { to: f.to } : {}),
    ...(f.page ? { page: f.page } : {}),
    ...(f.expandItems ? { expand: 'items' } : {}),
    include_voided: f.includeVoided ?? true,
    limit: f.limit ?? 100,
  };
}

/**
 * Receipt headers for a shift, a supplier, a point, or a `from`/`to` date
 * range — never bare. Built with `queryOptions()` so `useQueries` callers
 * (the owner overview) can share this exact queryKey/queryFn/staleTime
 * without duplicating the fetcher.
 */
export function intakesQueryOptions(filter: DocumentFilter) {
  const enabled = Boolean(
    filter.shiftId || filter.supplierId || filter.pointId || (filter.from && filter.to),
  );
  return queryOptions({
    queryKey: [...queryKeys.intakes, filter] as const,
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

/** Receipt headers for a shift, a supplier, a point, or a date range — never all of them. */
export function useIntakesQuery(filter: DocumentFilter) {
  return useQuery(intakesQueryOptions(filter));
}
