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

/** Operator only — the point is the actor's own, derived from the token; no body. */
export function useOpenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async (): Promise<Shift> => (await httpClient.post<Shift>('/shifts')).data,
    onSuccess: invalidate,
  });
}

/** Operator only — closing is the signature of whoever held the cash (§10.3). */
export function useCloseShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async (id: string): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/close`)).data,
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
