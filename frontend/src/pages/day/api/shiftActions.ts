import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '@/entities/shift';

/**
 * Reopening changes what «today» means for the documents of that point, so
 * it invalidates shifts AND both journals — same shape as
 * `@/features/count-shift`'s own copy for open/close, which this hook does
 * NOT share: reopening is owner-only, takes a reason rather than a count,
 * and has exactly one consumer (`ReopenShiftDialog`), so promoting it
 * alongside open/close would not remove any duplication.
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

/** Owner only — a reason is mandatory (intakes spec §6.1); it lands in the audit log. */
export function useReopenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/reopen`, { reason })).data,
    onSuccess: invalidate,
  });
}
