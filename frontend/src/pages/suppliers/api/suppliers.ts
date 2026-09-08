import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type {
  CreateSupplierInput,
  Paginated,
  Supplier,
  UpdateSupplierInput,
} from '../model/supplier';

/**
 * Scoped server-side from the token: an operator sees only their own point's
 * suppliers, the owner sees all. `search` drives the backend's single `q` box
 * (sniffed into a name lane or a phone lane) — passed only when non-empty, so a
 * cleared search reuses the unfiltered cache entry. `include_inactive` is NOT
 * sent: the browsable list shows active suppliers and grows unbounded.
 */
export function useSuppliersQuery(search: string) {
  const q = search.trim();
  return useQuery({
    queryKey: [...queryKeys.suppliers, search],
    queryFn: async (): Promise<Paginated<Supplier>> => {
      const { data } = await httpClient.get<Paginated<Supplier>>('/suppliers', {
        params: q ? { q } : undefined,
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

export function useCreateSupplierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateSupplierInput): Promise<Supplier> => {
      const { data } = await httpClient.post<Supplier>('/suppliers', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.suppliers }),
  });
}

export function useUpdateSupplierMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateSupplierInput): Promise<Supplier> => {
      const { data } = await httpClient.patch<Supplier>(`/suppliers/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.suppliers }),
  });
}
