import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';

export interface SetPointTargetInput {
  pointId: string;
  /** Рядок — гроші ніколи не `number`. */
  target_cash: string;
  /**
   * §6.1's worked example: "15.07.2026 цільове значення 600 → 800, керівник,
   * причина: розширили точку". The reason is not stored on the row — a
   * target keeps no history — it becomes the audit entry's note.
   *
   * `''` MEANS "no reason" — §6.1: "для першого цільового значення точки
   * причина не потрібна, попереднього рівня не існувало". The empty string
   * is dropped from the request body below rather than sent as-is (see the
   * mutation's own comment for why).
   */
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
 * `reason` IS OMITTED FROM THE REQUEST when the caller sends `''` — the
 * point's first-ever target needs no reason (§6.1). The backend DTO's
 * `reason` is `@IsOptional()`, but that only skips validation when the field
 * is ABSENT; a PRESENT empty string still hits `@Length(1, 500)` and 400s.
 * So "no reason" has to mean "no key", not `reason: ''`.
 *
 * Invalidates `pointCash` (its shortfall reads `target_cash` straight off
 * this row) AND `collectionPoints` (the registry's own read of the point).
 */
export function useSetPointTargetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ pointId, target_cash, reason }: SetPointTargetInput): Promise<unknown> =>
      (
        await httpClient.patch(`/collection-points/${pointId}`, {
          target_cash,
          ...(reason ? { reason } : {}),
        })
      ).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.pointCash });
      qc.invalidateQueries({ queryKey: queryKeys.collectionPoints });
    },
  });
}
