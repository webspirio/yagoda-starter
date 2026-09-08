import { useQueries, type UseQueryResult } from '@tanstack/react-query';
import { shiftOnDateQueryOptions, type Shift } from '@/entities/shift';
import { intakesQueryOptions, type Intake, type Paginated } from '@/entities/intake';
import { payoutsQueryOptions, type Payout } from '@/entities/payout';
import { sum } from '@/shared/lib/money';
import { todayIso } from '@/shared/lib/date';

/** Today's read for one point: its shift (or `null`) plus the day's live totals. */
export interface PointToday {
  pointId: string;
  shift: Shift | null;
  receipts: number;
  accrued: string;
  paid: string;
}

export interface NetworkTodayResult {
  rows: PointToday[];
  isPending: boolean;
  isError: boolean;
}

/**
 * Today's shift, receipts and payouts for every point in `pointIds` — the
 * owner overview's «Точки сьогодні» and its network-wide tiles.
 *
 * THREE queries per point (shift/intakes/payouts), all flattened into ONE
 * `useQueries` call rather than one call per document type, so a network of
 * N points fires 3N requests in parallel instead of point-by-point
 * waterfalls. Each query is built with the day screen's own `queryOptions`
 * factories (`shiftOnDateQueryOptions`, `intakesQueryOptions`,
 * `payoutsQueryOptions`) — same queryKey/queryFn/staleTime — so a point
 * opened from here and then on `/day` hits a warm cache instead of
 * refetching.
 *
 * `combine` (rather than a plain `useMemo` over the raw results) gives the
 * returned object TanStack Query's structural-sharing stability: the page
 * only re-renders when a summed value actually changes, not on every
 * background refetch tick.
 *
 * The array TanStack infers here is a plain (non-tuple) array of a UNION of
 * the three option shapes, so every result in `combine` carries that same
 * union type regardless of which query produced it — the `as` casts below
 * just restore the type each position is known (by construction) to have;
 * they have no runtime effect.
 */
export function useNetworkToday(pointIds: string[]): NetworkTodayResult {
  const today = todayIso();

  return useQueries({
    queries: pointIds.flatMap((pointId) => [
      shiftOnDateQueryOptions(pointId, today),
      intakesQueryOptions({ pointId, from: today, to: today, limit: 100 }),
      payoutsQueryOptions({ pointId, from: today, to: today, limit: 100 }),
    ]),
    combine: (results): NetworkTodayResult => {
      const rows = pointIds.map((pointId, i): PointToday => {
        const shiftResult = results[i * 3] as UseQueryResult<Shift | null>;
        const intakesResult = results[i * 3 + 1] as UseQueryResult<Paginated<Intake>>;
        const payoutsResult = results[i * 3 + 2] as UseQueryResult<Paginated<Payout>>;

        const liveIntakes = (intakesResult.data?.data ?? []).filter((x) => x.voided_at === null);
        const livePayouts = (payoutsResult.data?.data ?? []).filter((x) => x.voided_at === null);

        return {
          pointId,
          shift: shiftResult.data ?? null,
          receipts: liveIntakes.length,
          accrued: sum(liveIntakes.map((x) => x.amount)),
          paid: sum(livePayouts.map((x) => x.amount)),
        };
      });

      return {
        rows,
        isPending: results.some((r) => r.isPending),
        isError: results.some((r) => r.isError),
      };
    },
  });
}
