import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '@/entities/shift';

export interface SetCashExplanationInput {
  shiftId: string;
  explanation: string;
}

/**
 * §7.7 (ред. 09.09.2026) — a drawer discrepancy NEVER blocks closing a shift;
 * the operator closes, and the owner explains it afterwards. `PUT
 * /shifts/:id/explanation`, NOT `POST` — this replaces the shift's one
 * `explanation` field (there is no per-count history), it never moves a
 * number, and it is OWNER ONLY (§10.2).
 *
 * Invalidates `shifts` (the field being written lives on the shift) AND
 * `cashCounts` — the owner's incident list (`GET
 * /cash-counts?only_discrepancies=true`) reads the same explanation off the
 * count it belongs to, and both would otherwise show a stale "unexplained"
 * state right after this call succeeds.
 */
export function useSetCashExplanationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ shiftId, explanation }: SetCashExplanationInput): Promise<Shift> =>
      (await httpClient.put<Shift>(`/shifts/${shiftId}/explanation`, { explanation })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.shifts });
      qc.invalidateQueries({ queryKey: queryKeys.cashCounts });
    },
  });
}
