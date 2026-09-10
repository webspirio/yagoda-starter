import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';

export interface SetPointTargetInput {
  pointId: string;
  /** Рядок — гроші ніколи не `number`. */
  target_cash: string;
  /** §6.1's worked example: "15.07.2026 цільове значення 600 → 800, керівник,
   *  причина: розширили точку". The reason is not stored on the row — a
   *  target keeps no history — it becomes the audit entry's note. */
  reason: string;
}

/**
 * §6.1 (ред. 03.09.2026) — a point's cash target is one plain number, no
 * history: OWNER ONLY (§10.2 — this button does not exist on the operator's
 * screen, not "exists but greyed out"), `PATCH /collection-points/:id` with
 * `{ target_cash, reason }`. A lower target than what is already at the
 * point is allowed — the caller (`SetTargetCashDialog`) warns rather than
 * refusing, because a target is a management decision.
 *
 * Invalidates `pointCash` (its shortfall reads `target_cash` straight off
 * this row) AND `collectionPoints` (the registry's own read of the point).
 */
export function useSetPointTargetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pointId, ...body }: SetPointTargetInput): Promise<unknown> =>
      (await httpClient.patch(`/collection-points/${pointId}`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.pointCash });
      qc.invalidateQueries({ queryKey: queryKeys.collectionPoints });
    },
  });
}
