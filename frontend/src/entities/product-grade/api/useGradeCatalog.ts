import { useQueries } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { STALE } from '@/shared/api/queryClient';
import { queryKeys } from '@/shared/api/queryKeys';
import type { GradeCatalogItem } from '../model/product-grade';

/** Only the fields joined here are read; the API envelope carries more. */
interface ProductsEnvelope {
  data: Array<{ id: string; name: string }>;
  total: number;
  page: number;
  limit: number;
}

interface GradesEnvelope {
  data: Array<{ id: string; product_id: string; name: string; is_active: boolean }>;
  total: number;
  page: number;
  limit: number;
}

/**
 * A combined query has one `data`/`isPending`/`isError`, exactly like the
 * single-`useQuery` reads elsewhere, so a page consumes it the same way.
 */
export interface GradeCatalogResult {
  data: GradeCatalogItem[];
  isPending: boolean;
  isError: boolean;
}

/**
 * The grade catalog joined to product names, active grades only — the row source
 * for the price and intake screens.
 *
 * `useQueries` rather than two `useQuery` calls so the join and sort live behind
 * ONE hook with a single loading/error state; the two reads still cache
 * independently under their own keys.
 *
 * KEY CHOICE. Products reuse `queryKeys.products` verbatim — the catalog screen's
 * own products read is identical (`GET /products`, no params), so they dedupe.
 * Grades take a `'active'` LEAF under `queryKeys.productGrades()` rather than the
 * bare key: the catalog screen reads that bare key with `include_inactive: true`,
 * and sharing one cache entry for two different `include_inactive` values would
 * clobber it (same pattern as `usePointOptions`' `'options'` leaf). The leaf
 * still sits under the `['product-grades']` invalidation PREFIX the catalog's
 * create/update mutations fire, so adding a grade there refreshes this list too.
 */
export function useGradeCatalogQuery(): GradeCatalogResult {
  return useQueries({
    queries: [
      {
        queryKey: queryKeys.products,
        queryFn: async (): Promise<ProductsEnvelope> => {
          const { data } = await httpClient.get<ProductsEnvelope>('/products');
          return data;
        },
        staleTime: STALE.reference,
      },
      {
        queryKey: [...queryKeys.productGrades(), 'active'],
        queryFn: async (): Promise<GradesEnvelope> => {
          const { data } = await httpClient.get<GradesEnvelope>('/product-grades', {
            params: { include_inactive: false },
          });
          return data;
        },
        staleTime: STALE.reference,
      },
    ],
    combine: ([productsResult, gradesResult]) => {
      const products = productsResult.data?.data ?? [];
      const grades = gradesResult.data?.data ?? [];
      const productName = new Map(products.map((p) => [p.id, p.name]));
      const data: GradeCatalogItem[] = grades
        .map((g) => ({
          id: g.id,
          name: g.name,
          productId: g.product_id,
          productName: productName.get(g.product_id) ?? '',
        }))
        .sort((a, b) => a.productName.localeCompare(b.productName) || a.name.localeCompare(b.name));
      return {
        data,
        isPending: productsResult.isPending || gradesResult.isPending,
        isError: productsResult.isError || gradesResult.isError,
      };
    },
  });
}
