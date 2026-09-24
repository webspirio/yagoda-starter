import { useQuery } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { DayExpense } from '../model/day-expense';

/**
 * §8.3 — one shift's expense lines, oldest first (the server orders by
 * `created_at`, so the list reads in the order the owner typed it).
 *
 * Unpaginated on purpose: this is a handful of lines about one day, and the
 * screen totals them from the собівартість response rather than from here.
 */
export function useDayExpensesQuery(shiftId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.dayExpenses, shiftId] as const,
    enabled: shiftId !== undefined,
    queryFn: async (): Promise<DayExpense[]> => {
      const { data } = await httpClient.get<DayExpense[]>(`/shifts/${shiftId}/expenses`);
      return data;
    },
  });
}
