import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { BulkPriceInput, PriceSheet } from '../model/gradePrice';

/**
 * The whole sheet in ONE read — every active grade against every point in
 * scope. Unpaginated by design: `/current` caps at 100 rows, which is what
 * forced the old screen to fetch one point at a time, and a sheet that
 * silently dropped a column would be worse than no sheet.
 *
 * Nested under the `gradePrices` PREFIX behind a `'sheet'` leaf, so the
 * existing `/current` map (cached at `[...gradePrices, pointId]`) and the
 * history (`[...gradePrices, 'history', …]`) cannot collide with it — and so
 * one `invalidateQueries({ queryKey: queryKeys.gradePrices })` still refreshes
 * all three.
 */
export function usePriceSheetQuery() {
  return useQuery({
    queryKey: [...queryKeys.gradePrices, 'sheet'],
    queryFn: async (): Promise<PriceSheet> => {
      const { data } = await httpClient.get<PriceSheet>('/grade-prices/sheet');
      return data;
    },
  });
}

/**
 * «Поставити всім» — one grade, one set of numbers, every NAMED point, written
 * by the server in one transaction. The caller decides which points those are
 * (§4.8: not the warehouse); this hook only carries them.
 *
 * Invalidates the whole `gradePrices` prefix, as the single-point mutation
 * does: a bulk write moves several points at once, so a narrower invalidation
 * would leave the picker's cached maps stale on exactly the write that changed
 * most of them.
 */
export function useBulkSetPriceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkPriceInput): Promise<{ created: number }> => {
      const { data } = await httpClient.post<{ created: number }>('/grade-prices/bulk', input);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.gradePrices }),
  });
}
