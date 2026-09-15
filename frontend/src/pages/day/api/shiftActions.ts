import { useMutation } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { useInvalidateDay } from '@/features/count-shift';
import type { Shift } from '@/entities/shift';

/**
 * Owner only — a reason is mandatory (intakes spec §6.1); it lands in the
 * audit log. Reopening's invalidation set is identical to open/close's (see
 * `useInvalidateDay` in `@/features/count-shift`), so it shares that hook
 * rather than carrying its own copy.
 */
export function useReopenShiftMutation() {
  const invalidate = useInvalidateDay();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }): Promise<Shift> =>
      (await httpClient.post<Shift>(`/shifts/${id}/reopen`, { reason })).data,
    onSuccess: invalidate,
  });
}
