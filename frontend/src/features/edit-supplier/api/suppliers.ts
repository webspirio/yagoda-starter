import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Supplier } from '@/entities/supplier';
import type { CreateSupplierInput, UpdateSupplierInput } from '../model/supplier';

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
