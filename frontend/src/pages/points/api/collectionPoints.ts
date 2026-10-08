import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
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
        params: { include_inactive: true },
      });
      return data;
    },
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
