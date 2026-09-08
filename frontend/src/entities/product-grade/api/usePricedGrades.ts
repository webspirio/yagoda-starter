import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { STALE } from '@/shared/api/queryClient';
import { queryKeys } from '@/shared/api/queryKeys';
import { useGradeCatalogQuery } from './useGradeCatalog';
import type { GradeCatalogItem, PricedGrade } from '../model/product-grade';

/** Wire shape of one row from `GET /grade-prices/current` — see
 *  `pages/prices/model/gradePrice.ts`'s `GradePrice`; only the fields this
 *  reduce reads are declared here. */
interface CurrentPriceRow {
  product_grade_id: string;
  base_price: string;
  max_markup: string;
  max_discount: string;
}

interface CurrentPricesEnvelope {
  data: CurrentPriceRow[];
  total: number;
  page: number;
  limit: number;
}

type CurrentPriceMap = Record<
  string,
  { base_price: string; max_markup: string; max_discount: string }
>;

/**
 * The grade catalog priced for one point — the row source for the reception
 * form's grade picker and the receipt. Joins `useGradeCatalogQuery()` (grades
 * × product names) with the point's current prices; only grades that HAVE a
 * price appear, since an unpriced grade cannot be received (§2.4 needs a
 * base_price to compute a line).
 *
 * SAME QUERY KEY AND PARAMS as `pages/prices/api/gradePrices.ts`'s
 * `useCurrentPricesQuery` (`[...queryKeys.gradePrices, pointId]`,
 * `GET /grade-prices/current?collection_point_id=`) so the prices screen and
 * this reception read share one cache entry — deliberately copied rather than
 * imported, since an entity may not import from `pages`.
 */
export function usePricedGradesQuery(pointId: string | null): {
  data: PricedGrade[];
  isPending: boolean;
  isError: boolean;
} {
  const catalog = useGradeCatalogQuery();
  const prices = useQuery({
    queryKey: [...queryKeys.gradePrices, pointId],
    enabled: pointId !== null,
    queryFn: async (): Promise<CurrentPriceMap> => {
      const { data } = await httpClient.get<CurrentPricesEnvelope>('/grade-prices/current', {
        params: { collection_point_id: pointId },
      });
      return data.data.reduce<CurrentPriceMap>((map, price) => {
        map[price.product_grade_id] = {
          base_price: price.base_price,
          max_markup: price.max_markup,
          max_discount: price.max_discount,
        };
        return map;
      }, {});
    },
    staleTime: STALE.list,
  });

  const priceMap = prices.data ?? {};
  const data: PricedGrade[] = catalog.data.reduce<PricedGrade[]>(
    (rows, grade: GradeCatalogItem) => {
      const price = priceMap[grade.id];
      if (price) rows.push({ ...grade, ...price });
      return rows;
    },
    [],
  );

  return {
    data,
    isPending: catalog.isPending || prices.isPending,
    isError: catalog.isError || prices.isError,
  };
}
