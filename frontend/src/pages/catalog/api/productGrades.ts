import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Paginated } from '../model/product';
import type {
  CreateProductGradeInput,
  ProductGrade,
  UpdateProductGradeInput,
} from '../model/productGrade';

/**
 * `productId` undefined means "all products" — the key is parameterised so the
 * filtered and unfiltered lists never share one cache entry. `include_inactive`
 * is always on: the owner reactivates retired grades from this screen, so it
 * must see them.
 */
export function useProductGradesQuery(productId?: string) {
  return useQuery({
    queryKey: queryKeys.productGrades(productId),
    queryFn: async (): Promise<Paginated<ProductGrade>> => {
      const { data } = await httpClient.get<Paginated<ProductGrade>>('/product-grades', {
        params: {
          ...(productId ? { product_id: productId } : {}),
          include_inactive: true,
        },
      });
      return data;
    },
  });
}

/** Invalidates by PREFIX (`queryKeys.productGrades()` → `['product-grades']`),
 *  so every filtered variant is refreshed — a grade created while filtered to
 *  one product must also appear in the unfiltered list. */
export function useCreateProductGradeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateProductGradeInput): Promise<ProductGrade> => {
      const { data } = await httpClient.post<ProductGrade>('/product-grades', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.productGrades() }),
  });
}

/** No `product_id` in the payload: a grade never changes parent after create. */
export function useUpdateProductGradeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: UpdateProductGradeInput & { id: string }): Promise<ProductGrade> => {
      const { data } = await httpClient.patch<ProductGrade>(`/product-grades/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.productGrades() }),
  });
}
