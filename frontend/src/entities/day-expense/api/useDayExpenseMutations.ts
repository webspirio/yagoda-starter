import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { DayExpense } from '../model/day-expense';

export interface CreateDayExpenseInput {
  shiftId: string;
  label: string;
  amount: string;
}

export interface UpdateDayExpenseInput {
  id: string;
  label?: string;
  amount?: string;
}

/**
 * EVERY WRITE HERE INVALIDATES TWO KEYS, and that is the point of this file
 * rather than three loose `useMutation`s in the page. A витрата moves
 * `expenses_amount`, `basket`, `per_kg`, `expenses_per_kg` and every
 * product's `basket_share`; refreshing only the list would leave §8.4's
 * arithmetic on screen contradicting the line just typed beneath it.
 */
function useExpenseInvalidation() {
  const qc = useQueryClient();
  return async () => {
    await qc.invalidateQueries({ queryKey: queryKeys.dayExpenses });
    await qc.invalidateQueries({ queryKey: queryKeys.costOfDay });
  };
}

export function useCreateDayExpenseMutation() {
  const invalidate = useExpenseInvalidation();
  return useMutation({
    mutationFn: async ({ shiftId, ...body }: CreateDayExpenseInput): Promise<DayExpense> => {
      const { data } = await httpClient.post<DayExpense>(`/shifts/${shiftId}/expenses`, body);
      return data;
    },
    onSuccess: invalidate,
  });
}

/**
 * Addressed by LINE id and nothing else — the row already knows its shift,
 * and the server refuses a patch that names one. Only the fields actually
 * being changed are sent: the backend records an audit entry only when a
 * value really moved, and a no-op field would make the trail say otherwise.
 */
export function useUpdateDayExpenseMutation() {
  const invalidate = useExpenseInvalidation();
  return useMutation({
    mutationFn: async ({ id, ...body }: UpdateDayExpenseInput): Promise<DayExpense> => {
      const { data } = await httpClient.patch<DayExpense>(`/expenses/${id}`, body);
      return data;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteDayExpenseMutation() {
  const invalidate = useExpenseInvalidation();
  return useMutation({
    mutationFn: async ({ id }: { id: string }): Promise<void> => {
      await httpClient.delete(`/expenses/${id}`);
    },
    onSuccess: invalidate,
  });
}
