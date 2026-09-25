import { queryOptions, useQuery } from '@tanstack/react-query';
import { httpClient, ApiError, type Paginated } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import { todayIso, addDaysIso } from '@/shared/lib/date';
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
    // A shift changes by the operator's own action, which invalidates; 30s covers a second tab.
    staleTime: 30_000,
  });
}

/**
 * The one shift a point had on a date (UQ point+date), or `null`. Built with
 * `queryOptions()` so `useQueries` callers (the owner overview) can share
 * this exact queryKey/queryFn/staleTime without duplicating the fetcher.
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
    staleTime: 30_000,
  });
}

/** The one shift a point had on a date (UQ point+date), or `null`. */
export function useShiftOnDateQuery(pointId: string | null, date: string) {
  return useQuery(shiftOnDateQueryOptions(pointId, date));
}

/**
 * Зміни, що ЛИШИЛИСЬ ВІДКРИТИМИ з попередніх днів — по всій мережі (#114).
 *
 * ОДИН запит на всю мережу, а не по запиту на точку: `ShiftsService.list`
 * фільтрує за `collection_point_id` лише тоді, коли його передали, а
 * керівникові `resolvePointFilter` віддає `undefined` як є. Тому без точки
 * сервер повертає зміни всіх точок, а `to` відсікає їх по `business_date <=`.
 * Оператор цього читання не робить узагалі (`enabled`) — не «прочитати й
 * викинути», а не питати: його власну незакриту зміну ловить `OpenShiftAlert`
 * просто там, де він працює, ще й з кнопкою «Закрити».
 *
 * «Застаріла» означає РАНІШЕ ЗА СЬОГОДНІ — та сама межа, що й в
 * `OpenShiftAlert`: сьогоднішня відкрита зміна відкрита саме там, де має
 * бути. Межу рахує сам хук, бо саме він знає, що питає сервер, і рахує її
 * НА РЕНДЕРІ, а не на рівні модуля: вкладка, відкрита через північ, інакше
 * назавжди лишилась би з учорашнім «вчора». Дата входить у `queryKey`, тож
 * після півночі це вже інше читання, а не протухла відповідь на старе.
 */
export function useStaleOpenShiftsQuery({ enabled = true }: { enabled?: boolean } = {}) {
  const before = addDaysIso(todayIso(), -1);
  return useQuery({
    queryKey: [...queryKeys.shifts, 'open-before', before],
    enabled,
    queryFn: async (): Promise<Paginated<Shift>> =>
      (
        await httpClient.get<Paginated<Shift>>('/shifts', {
          params: { status: 'open', to: before, limit: 100 },
        })
      ).data,
    staleTime: 30_000,
  });
}
