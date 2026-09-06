import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { Paginated } from '../model/product';
import type { ProductGrade, ProductGradeFormValues } from '../model/productGrade';

/** `productId` undefined means "all products" — the key is parameterised so
 *  the filtered and unfiltered lists never share one cache entry. */
export function useProductGradesQuery(productId?: string) {
  return useQuery({
    queryKey: queryKeys.productGrades(productId),
    queryFn: async (): Promise<Paginated<ProductGrade>> => {
      const { data } = await httpClient.get<Paginated<ProductGrade>>('/product-grades', {
        params: {
          ...(productId ? { product_id: productId } : {}),
          // Deactivated grades still matter to the owner: this screen is where
          // they are reactivated, so it must be able to see them.
          include_inactive: true,
        },
      });
      return data;
    },
    staleTime: STALE.reference,
  });
}

/** Invalidates by PREFIX (`['product-grades']`), so every filtered variant is
 *  refreshed — a grade created while filtered to Малина must also appear in
 *  the unfiltered list. */
export function useCreateProductGradeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Pick<ProductGradeFormValues, 'product_id' | 'name'>,
    ): Promise<ProductGrade> => {
      const { data } = await httpClient.post<ProductGrade>('/product-grades', input);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product-grades'] }),
  });
}

/** No `product_id` in the payload: it is immutable after create. */
export function useUpdateProductGradeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name: string;
      is_active: boolean;
    }): Promise<ProductGrade> => {
      const { id, ...body } = input;
      const { data } = await httpClient.patch<ProductGrade>(`/product-grades/${id}`, body);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['product-grades'] }),
  });
}
