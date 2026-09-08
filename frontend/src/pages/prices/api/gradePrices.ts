import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { CurrentPriceMap, GradePrice, SetPriceInput } from '../model/gradePrice';

/** The `/current` picker envelope — one row per priced grade for the point. */
interface CurrentPricesEnvelope {
  data: GradePrice[];
  total: number;
  page: number;
  limit: number;
}

/**
 * The CURRENT (latest) price per grade at one point, reduced to a
 * `product_grade_id → money` map. `enabled: pointId !== null` so it never fires
 * before the owner has picked a point; the point id is part of the key, so each
 * point caches independently.
 */
export function useCurrentPricesQuery(pointId: string | null) {
  return useQuery({
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
    // Prices are day-level data (they change more often than the reference
    // catalog), and our own POST invalidates on success, so a list window is
    // the right freshness floor.
    staleTime: STALE.list,
  });
}

/** `GET /grade-prices` envelope — the full journal, newest first (unlike
 *  `/current`, rows are not reduced: a price NEVER overwrites, so the history
 *  for one grade at one point is every row it has ever had). */
interface PriceHistoryEnvelope {
  data: GradePrice[];
  total: number;
  page: number;
  limit: number;
}

/**
 * One grade's price history at one point — the last 20 rows, newest first as
 * the API already orders them (no client-side re-sort). `enabled` only once
 * both ids are known, so the dialog never fires before its row has resolved a
 * point and a grade. The key nests under the `gradePrices` PREFIX behind a
 * `'history'` leaf so it never collides with the `/current` map cached at
 * `[...queryKeys.gradePrices, pointId]`.
 */
export function usePriceHistoryQuery(pointId: string | null, gradeId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.gradePrices, 'history', pointId, gradeId],
    enabled: pointId !== null && gradeId !== null,
    queryFn: async (): Promise<GradePrice[]> => {
      const { data } = await httpClient.get<PriceHistoryEnvelope>('/grade-prices', {
        params: { collection_point_id: pointId, product_grade_id: gradeId, limit: 20 },
      });
      return data.data;
    },
    staleTime: STALE.list,
  });
}

/**
 * Sets a grade's price — a POST that APPENDS a new row (there is no PATCH; the
 * latest row wins). Invalidates the `['grade-prices']` PREFIX so every point's
 * cached map refetches — cheap here, and it keeps the screen honest if the owner
 * priced two points in one session.
 */
export function useSetPriceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetPriceInput): Promise<GradePrice> => {
      const { data } = await httpClient.post<GradePrice>('/grade-prices', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.gradePrices }),
  });
}
