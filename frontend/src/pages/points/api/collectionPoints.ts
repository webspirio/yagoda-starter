import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type {
  CollectionPoint,
  CreateCollectionPointInput,
  Paginated,
  UpdateCollectionPointInput,
} from '../model/collectionPoint';

/** Owner-facing registry, so inactive points are asked for too. */
export function useCollectionPointsQuery() {
  return useQuery({
    queryKey: queryKeys.collectionPoints,
    queryFn: async (): Promise<Paginated<CollectionPoint>> => {
      const { data } = await httpClient.get<Paginated<CollectionPoint>>('/collection-points', {
        // As much of the registry as one read allows (100), not the default 20: the
        // table sorts client-side (#250). Past 100 the page says it is partial.
        params: { limit: 100, include_inactive: true },
      });
      return data;
    },
    staleTime: STALE.reference,
  });
}

export function useCreateCollectionPointMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateCollectionPointInput): Promise<CollectionPoint> => {
      const { data } = await httpClient.post<CollectionPoint>('/collection-points', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.collectionPoints }),
  });
}

export function useUpdateCollectionPointMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: UpdateCollectionPointInput & { id: string }): Promise<CollectionPoint> => {
      const { data } = await httpClient.patch<CollectionPoint>(`/collection-points/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.collectionPoints }),
  });
}
