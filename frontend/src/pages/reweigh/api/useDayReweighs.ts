import { useQueries } from '@tanstack/react-query';
import { shiftOnDateQueryOptions } from '@/entities/shift';
import { reweighQueryOptions, type ReweighItem } from '@/entities/reweigh';
import type { PointOption } from '@/entities/collection-point';

/** One reweigh line, labelled with the point it came from — the day
 *  table's first column («З пункту») needs the point, not just the shift. */
export interface DayLine {
  item: ReweighItem;
  pointId: string;
  pointName: string;
}

export interface DayReweighsResult {
  lines: DayLine[];
  isPending: boolean;
}

interface PointWithShift {
  point: PointOption;
  shiftId: string;
}

/**
 * Every weighing recorded for a DAY, across every point — the mock's «по всіх
 * пунктах» table.
 *
 * Assembled client-side from the two per-shift reads this API has, in the
 * pattern `pages/dashboard`'s `useNetworkToday` set: one wave of queries for
 * the shifts, a second for their reconciliations. That is ~2×P requests for P
 * points, which is fine at the five working points this network has and is
 * NOT fine at thirty — a day-wide `GET /reweigh-items?date=` is the
 * follow-up, and this is the code it replaces.
 *
 * `includeVoided` is on: §8.7's storno leaves the row, and this table is the
 * only place it stays readable.
 *
 * Both waves use `useQueries`' `combine` option rather than a raw result
 * array plus `useMemo` — exactly how `useNetworkToday` avoids the same
 * hazard. `useQueries` hands back a NEW array identity every render, so a
 * `useMemo` keyed on it either recomputes every render (if it's an honest
 * dependency) or lint-errors / lies (if it isn't). `combine`'s output gets
 * TanStack's own structural sharing instead: the SECOND wave's query list is
 * built from the first wave's `combine` output, which only changes identity
 * when the shifts it names actually change, not on every background tick —
 * no `useMemo`, no `eslint-disable`, anywhere in this file.
 */
export function useDayReweighs(points: PointOption[], date: string): DayReweighsResult {
  const { withShift, isPending: shiftsPending } = useQueries({
    queries: points.map((point) => shiftOnDateQueryOptions(point.id, date)),
    combine: (results) => ({
      // Points WITH a resolved shift, paired with that shift's id. A point
      // that never opened that day has nothing to reconcile — firing a
      // reconciliation query for it would be a request for
      // `/shifts/undefined/reweigh`.
      withShift: points.flatMap((point, i): PointWithShift[] => {
        const shiftId = results[i]?.data?.id;
        return shiftId !== undefined ? [{ point, shiftId }] : [];
      }),
      isPending: results.some((r) => r.isPending),
    }),
  });

  return useQueries({
    queries: withShift.map((x) => reweighQueryOptions(x.shiftId, { includeVoided: true })),
    combine: (results): DayReweighsResult => {
      const lines: DayLine[] = [];
      withShift.forEach((x, i) => {
        for (const item of results[i]?.data?.items ?? []) {
          lines.push({ item, pointId: x.point.id, pointName: x.point.name });
        }
      });
      // Newest first ACROSS points: each shift's `items` already arrives
      // newest-first on its own, and concatenating them one shift after
      // another would order the table by point while claiming to be a day.
      lines.sort((a, b) => b.item.created_at.localeCompare(a.item.created_at));
      return {
        lines,
        isPending: shiftsPending || results.some((r) => r.isPending),
      };
    },
  });
}
