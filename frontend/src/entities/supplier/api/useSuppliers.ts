import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Paginated, Supplier } from '../model/supplier';

/**
 * Scoped server-side from the token: an operator sees only their own point's
 * suppliers, the owner sees all (unless `pointId` narrows it further — e.g. a
 * money screen where the owner has picked a point). `search` drives the
 * backend's single `q` box (sniffed into a name lane or a phone lane) —
 * passed only when non-empty, so a cleared search reuses the unfiltered cache
 * entry. `include_inactive` is NOT sent: the browsable list shows active
 * suppliers and grows unbounded.
 */
export function useSuppliersQuery(search: string, pointId?: string | null) {
  const q = search.trim();
  return useQuery({
    queryKey: [...queryKeys.suppliers, { search, pointId }],
    queryFn: async (): Promise<Paginated<Supplier>> => {
      const { data } = await httpClient.get<Paginated<Supplier>>('/suppliers', {
        params: {
          ...(q ? { q } : {}),
          ...(pointId ? { collection_point_id: pointId } : {}),
          limit: 100,
        },
      });
      return data;
    },
  });
}

/** One supplier by id — the card a money screen resolves a document against. */
export function useSupplierQuery(id: string | null) {
  return useQuery({
    queryKey: [...queryKeys.suppliers, 'one', id],
    enabled: id !== null,
    queryFn: async (): Promise<Supplier> =>
      (await httpClient.get<Supplier>(`/suppliers/${id}`)).data,
  });
}
