import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Shift } from '@/entities/shift';

export interface SetOperatorNoteInput {
  shiftId: string;
  operatorNote: string;
}

/**
 * Spec 2026-10-06 — пояснення приймальника. `PUT`, бо замінює одне поле зміни.
 * Оновлює `shifts` і `cashCounts`: обидва несуть `operator_note` і прапорець.
 */
export function useSetOperatorNoteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ shiftId, operatorNote }: SetOperatorNoteInput): Promise<Shift> =>
      (await httpClient.put<Shift>(`/shifts/${shiftId}/operator-note`, { operator_note: operatorNote }))
        .data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.shifts });
      qc.invalidateQueries({ queryKey: queryKeys.cashCounts });
    },
  });
}
