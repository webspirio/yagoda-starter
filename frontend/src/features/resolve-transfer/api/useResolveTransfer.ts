import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Transfer } from '@/entities/transfer';

export interface ResolveTransferInput {
  id: string;
  /** Чим керівник закриває спір. Рядок — гроші ніколи не `number`. */
  resolved_cash: string;
  resolved_crates: number;
}

/**
 * §7.9 step 4б — the owner's final word on a dispute. OWNER ONLY (§10.2).
 * `status` never changes — see `ResolveTransferDto`'s own header — this is
 * an accounting act, not a cash movement.
 *
 * Invalidates `transfers` (the document's `resolved_*` fields just changed)
 * AND `pointCash`: `PointCashService`'s formula switches from
 * `reported_cash` to `resolved_cash` the moment `resolved_at` is set, so the
 * point's cash figure itself moves the instant a dispute is resolved.
 */
export function useResolveTransferMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: ResolveTransferInput): Promise<Transfer> =>
      (await httpClient.post<Transfer>(`/transfers/${id}/resolve`, body)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.transfers });
      qc.invalidateQueries({ queryKey: queryKeys.pointCash });
    },
  });
}
