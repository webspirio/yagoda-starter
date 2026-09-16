import { useQuery } from '@tanstack/react-query';
import { httpClient, type Paginated } from '@/shared/api';
import { STALE } from '@/shared/api/queryClient';
import { queryKeys } from '@/shared/api/queryKeys';
import type { PointOption } from '../model/collection-point';

/**
 * Active-only lookup of collection points for select controls (Users, and
 * later Suppliers). A shared `entities/` hook so a page never reaches into
 * another page for its option list. `include_inactive: false` — a form should
 * never offer a retired point as a new assignment.
 */
export function usePointOptionsQuery() {
  return useQuery({
    // Distinct from the admin registry query (which fetches include_inactive:true
    // under queryKeys.collectionPoints) — same base, own leaf, so the two never
    // clobber each other's cache despite different params.
    queryKey: [...queryKeys.collectionPoints, 'options'],
    queryFn: async (): Promise<PointOption[]> => {
      const { data } = await httpClient.get<
        Paginated<{
          id: string;
          name: string;
          kind: 'reception' | 'base';
          target_crates: number | null;
        }>
      >('/collection-points', { params: { include_inactive: false } });
      // `kind` and `target_crates` ride along because `GET /collection-points`
      // already returns both: `features/point-scope` needs to know which point
      // is the склад, and «Ящики» needs the allotment beside the name. Nothing
      // else reads them, and a `null` target stays `null` rather than being
      // defaulted to 0 here — see `PointOption`'s doc for why that distinction
      // is load-bearing.
      return data.data.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        target_crates: p.target_crates ?? null,
      }));
    },
    staleTime: STALE.reference,
  });
}
