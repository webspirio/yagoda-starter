import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type {
  CreateProductInput,
  Paginated,
  Product,
  UpdateProductInput,
} from '../model/product';

/**
 * `products` has no `is_active` column (visibility is derived from grades), so
 * unlike the other catalogs this read sends no `include_inactive` — there is
 * nothing to include. `STALE.reference`: a berry catalog changes a few times a
 * season.
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

export function useCreateProductMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductInput): Promise<Product> => {
      const { data } = await httpClient.post<Product>('/products', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.products }),
  });
}

export function useUpdateProductMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: UpdateProductInput & { id: string }): Promise<Product> => {
      const { data } = await httpClient.patch<Product>(`/products/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.products }),
  });
}
