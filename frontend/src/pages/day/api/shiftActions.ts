import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '@/entities/shift';

/**
 * Opening, closing and reopening all change what «today» means for the
 * documents of that point, so every one invalidates shifts AND both journals.
 */
function useInvalidateDay() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.shifts }),
      qc.invalidateQueries({ queryKey: queryKeys.intakes }),
      qc.invalidateQueries({ queryKey: queryKeys.payouts }),
    ]);
}

/**
 * Оператор, і лише він (§10.3). Точка береться з токена — тіло несе САМЕ
 * підрахунок шухляди, і він обов'язковий: перший підрахунок точки ЦЕ і є її
 * початковий залишок (§7.3), тому «пропустити цього разу» немає чого.
 */
export function useOpenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({ counted_amount }: { counted_amount: string }): Promise<Shift> =>
      (await httpClient.post<Shift>('/shifts', { counted_amount })).data,
    onSuccess: invalidate,
  });
}

/** Оператор, і лише він — закриття це підпис того, хто тримав гроші (§10.3). */
export function useCloseShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({
      id,
      counted_amount,
    }: {
      id: string;
      counted_amount: string;
    }): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/close`, { counted_amount })).data,
    onSuccess: invalidate,
  });
}

/** Owner only — a reason is mandatory (intakes spec §6.1); it lands in the audit log. */
export function useReopenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/reopen`, { reason })).data,
    onSuccess: invalidate,
  });
}
