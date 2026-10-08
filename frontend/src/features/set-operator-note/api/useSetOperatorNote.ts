import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { CashCount } from '@/entities/cash-count';

export interface SetOperatorNoteInput {
  countId: string;
  operatorNote: string;
}

/** Spec 2026-10-08 — the counter's account of THIS count. Invalidates `cashCounts`
 *  alone: the row carries the text and the flag, and the panel reads its counts. */
export function useSetOperatorNoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ countId, operatorNote }: SetOperatorNoteInput): Promise<CashCount> =>
      (await httpClient.put<CashCount>(`/cash-counts/${countId}/operator-note`, { operator_note: operatorNote })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.cashCounts });
    },
  });
}
