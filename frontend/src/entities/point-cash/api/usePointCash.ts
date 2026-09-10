import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { STALE } from '@/shared/api/queryClient';
import type { PointCashRow, PointCashOne, Paginated } from '../model/point-cash';

/** `as_of` only when named — undated means "today", resolved server-side (see the service header). */
function pointCashParams(opts?: { asOf?: string }) {
  return {
    ...(opts?.asOf ? { as_of: opts.asOf } : {}),
    limit: 100,
  };
}

/**
 * §7.10's table — every point in scope with its cash. Widens by role on the
 * server rather than branching here: an operator gets their own point, the
 * owner the whole network, from the same endpoint.
 */
export function usePointCashQuery(opts?: { asOf?: string }): UseQueryResult<Paginated<PointCashRow>> {
  return useQuery({
    queryKey: [...queryKeys.pointCash, opts] as const,
    queryFn: async (): Promise<Paginated<PointCashRow>> => {
      const { data } = await httpClient.get<Paginated<PointCashRow>>('/point-cash', {
        params: pointCashParams(opts),
      });
      return data;
    },
    staleTime: STALE.list,
  });
}

/**
 * One point's cash figure — `enabled` only with a point, same gate as
 * `useCurrentShiftQuery`. Typed `PointCashOne`, not `PointCashOne | null`
 * (review round 2, minor finding, aligned with the opposite ruling on
 * `useTransferQuery`): `GET /point-cash/:pointId` always returns a real
 * object — the backend's own `COALESCE(..., 0.00)` means there is no "not
 * found" shape for a valid point — so `queryFn` never produces `null`, and
 * `data` is simply `undefined` while disabled or loading, same as any other
 * query. A `| null` in the type here would invite a check for a value this
 * hook can never actually hand back.
 */
export function usePointCashForPointQuery(
  pointId: string | null,
  asOf?: string,
): UseQueryResult<PointCashOne> {
  return useQuery({
    queryKey: [...queryKeys.pointCash, 'one', pointId, asOf ?? null] as const,
    enabled: pointId !== null,
    queryFn: async (): Promise<PointCashOne> => {
      const { data } = await httpClient.get<PointCashOne>(`/point-cash/${pointId}`, {
        params: asOf ? { as_of: asOf } : undefined,
      });
      return data;
    },
    staleTime: STALE.list,
  });
}
