import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { CashCount } from '@/entities/cash-count';

export interface SetCashExplanationInput {
  countId: string;
  explanation: string;
}

/**
 * §7.7 — the owner's decision on ONE count (spec 2026-10-08). OWNER ONLY, replaces
 * the text, never moves a number. Invalidates `cashCounts` (the incident list reads
 * the same row) and `shifts` (the panel reads its counts).
 */
export function useSetCashExplanationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ countId, explanation }: SetCashExplanationInput): Promise<CashCount> =>
      (await httpClient.put<CashCount>(`/cash-counts/${countId}/explanation`, { explanation })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cashCounts });
      qc.invalidateQueries({ queryKey: queryKeys.shifts });
    },
  });
}
