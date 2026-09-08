import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { STALE } from '@/shared/api/queryClient';
import { queryKeys } from '@/shared/api/queryKeys';
import type { TareTypeOption } from '../model/tare-type';

/**
 * The paginated envelope the backend returns for the tare-type registry —
 * only the `data` array (and, from each item, `id`/`name`/`weight_kg`/
 * `is_crate`) is read here.
 */
interface TareTypeListEnvelope {
  data: Array<{ id: string; name: string; weight_kg: string; is_crate: boolean }>;
  total: number;
  page: number;
  limit: number;
}

/**
 * Active-only tare types for the reception form's tare picker. Mirrors
 * `entities/collection-point/api/usePointOptions.ts`'s options-hook pattern:
 * a shared `entities/` hook so a page never reaches into another page for its
 * option list, `include_inactive: false` since a form should never offer a
 * retired tare type on a new receipt.
 *
 * Distinct from the admin registry read (`pages/catalog/api/tareTypes.ts`'s
 * `useTareTypesQuery`, which fetches `include_inactive: true` under the bare
 * `queryKeys.tareTypes`) — same base key, own `'options'` leaf, so the two
 * never clobber each other's cache despite different params.
 */
export function useTareTypeOptionsQuery() {
  return useQuery({
    queryKey: [...queryKeys.tareTypes, 'options'],
    queryFn: async (): Promise<TareTypeOption[]> => {
      const { data } = await httpClient.get<TareTypeListEnvelope>('/tare-types', {
        params: { include_inactive: false },
      });
      return data.data.map((t) => ({
        id: t.id,
        name: t.name,
        weight_kg: t.weight_kg,
        is_crate: t.is_crate,
      }));
    },
    staleTime: STALE.reference,
  });
}
