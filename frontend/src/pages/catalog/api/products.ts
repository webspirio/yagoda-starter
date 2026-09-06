import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated, Product, ProductFormValues } from '../model/product';

/**
 * Copies `useMeQuery`'s shape — queryKey, queryFn through `httpClient`.
 *
 * `STALE.reference` (30 min), not a hand-written duration: a berry catalog
 * changes a few times a season, which is exactly what that constant is for.
 *
 * No `page`/`limit` is sent. The API defaults these bounded catalogs to
 * `limit=100`; the caller checks `total` against `data.length` and warns
 * rather than paginating.
 */
export function useProductsQuery() {
  return useQuery({
    queryKey: queryKeys.products,
    queryFn: async (): Promise<Paginated<Product>> => {
      const { data } = await httpClient.get<Paginated<Product>>('/products');
      return data;
    },
    staleTime: STALE.reference,
  });
}

/**
 * INVALIDATES the list rather than seeding it with `setQueryData`.
 *
 * `useUpdateMeMutation` seeds because its response IS the whole resource.
 * Here the response is one row inside a collection, so seeding would mean
 * splicing by hand — inserting at the right sort position, honouring the
 * active filter, keeping `total` truthful. That is how a cache goes quietly
 * wrong. These lists are at most 100 rows behind a 30-minute stale window.
 */
export function useCreateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductFormValues): Promise<Product> => {
      const { data } = await httpClient.post<Product>('/products', input);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.products }),
  });
}

export function useUpdateProductMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: ProductFormValues & { id: string }): Promise<Product> => {
      const { data } = await httpClient.patch<Product>(`/products/${id}`, input);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.products }),
  });
}
