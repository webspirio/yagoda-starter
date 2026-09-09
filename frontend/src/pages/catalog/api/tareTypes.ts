import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated } from '../model/product';
import type {
  CreateTareTypeInput,
  TareType,
  UpdateTareTypeInput,
} from '../model/tareType';

/** `include_inactive` is on: the owner reactivates retired tare types here, and
 *  old receipts still snapshot their weight, so they exist for history. */
export function useTareTypesQuery() {
  return useQuery({
    queryKey: queryKeys.tareTypes,
    queryFn: async (): Promise<Paginated<TareType>> => {
      const { data } = await httpClient.get<Paginated<TareType>>('/tare-types', {
        params: { include_inactive: true },
      });
      return data;
    },
    staleTime: STALE.reference,
  });
}

/** `is_active` is absent from the create payload — the create DTO has no such
 *  field and a new tare type is active. */
export function useCreateTareTypeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTareTypeInput): Promise<TareType> => {
      const { data } = await httpClient.post<TareType>('/tare-types', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tareTypes }),
  });
}

export function useUpdateTareTypeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: UpdateTareTypeInput & { id: string }): Promise<TareType> => {
      const { data } = await httpClient.patch<TareType>(`/tare-types/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tareTypes }),
  });
}
