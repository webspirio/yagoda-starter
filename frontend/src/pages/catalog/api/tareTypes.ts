import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated } from '../model/product';
import type { TareType, TareTypeFormValues } from '../model/tareType';

export function useTareTypesQuery() {
  return useQuery({
    queryKey: queryKeys.tareTypes,
    queryFn: async (): Promise<Paginated<TareType>> => {
      const { data } = await httpClient.get<Paginated<TareType>>('/tare-types', {
        // The owner reactivates retired tare types from this screen, so it
        // must be able to see them.
        params: { include_inactive: true },
      });
      return data;
    },
    staleTime: STALE.reference,
  });
}

/** `is_active` is absent from the create payload: the API has no such field on
 *  the create DTO, and a new tare type is active. */
export function useCreateTareTypeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<TareTypeFormValues, 'is_active'>,
    ): Promise<TareType> => {
      const { data } = await httpClient.post<TareType>('/tare-types', input);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tareTypes }),
  });
}

export function useUpdateTareTypeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TareTypeFormValues & { id: string }): Promise<TareType> => {
      const { id, ...body } = input;
      const { data } = await httpClient.patch<TareType>(`/tare-types/${id}`, body);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.tareTypes }),
  });
}
