import { queryOptions, useQuery } from '@tanstack/react-query';
import { httpClient, ApiError } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '../model/shift';

interface ShiftListEnvelope {
  data: Shift[];
  total: number;
  page: number;
  limit: number;
}

/**
 * The OPEN shift at a point, or `null`. The API answers 404 when none is open;
 * that is a state, not a failure, so it is folded into `null` rather than
 * surfacing as `isError`. `enabled` only with a point — an owner who has not
 * picked one has nothing to ask about.
 */
export function useCurrentShiftQuery(pointId: string | null) {
  return useQuery({
    queryKey: [...queryKeys.shifts, 'current', pointId],
    enabled: pointId !== null,
    queryFn: async (): Promise<Shift | null> => {
      try {
        const { data } = await httpClient.get<Shift>('/shifts/current', {
          params: { collection_point_id: pointId },
        });
        return data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

/**
 * The one shift a point had on a date (UQ point+date), or `null`. Built with
 * `queryOptions()` so `useQueries` callers (the owner overview) can share
 * this exact queryKey/queryFn without duplicating the fetcher.
 */
export function shiftOnDateQueryOptions(pointId: string | null, date: string) {
  return queryOptions({
    queryKey: [...queryKeys.shifts, 'on', pointId, date] as const,
    enabled: pointId !== null,
    queryFn: async (): Promise<Shift | null> => {
      const { data } = await httpClient.get<ShiftListEnvelope>('/shifts', {
        params: { collection_point_id: pointId, from: date, to: date, limit: 1 },
      });
      return data.data[0] ?? null;
    },
  });
}

/** The one shift a point had on a date (UQ point+date), or `null`. */
export function useShiftOnDateQuery(pointId: string | null, date: string) {
  return useQuery(shiftOnDateQueryOptions(pointId, date));
}
