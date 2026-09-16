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
 * THE LAST READER OF `GET /grade-prices/current`. It used to share a cache
 * entry with the prices screen, which made the same call under the same key;
 * since #89 that screen reads `GET /grade-prices/sheet` instead, and its
 * `useCurrentPricesQuery` twin was removed rather than left behind as an
 * exported hook nothing calls. The key (`[...queryKeys.gradePrices, pointId]`)
 * still sits under the `gradePrices` PREFIX, so a price write on the sheet —
 * which invalidates that whole prefix — still refreshes this reception read.
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
