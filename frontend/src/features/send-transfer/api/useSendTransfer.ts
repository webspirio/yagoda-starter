import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Transfer } from '@/entities/transfer';

export interface SendTransferInput {
  collection_point_id: string;
  /** Скільки грошей їде на точку. Рядок — гроші ніколи не `number`. */
  cash: string;
  crates: number;
  carrier: string;
  /** §9.3 — виправлення називає переказ, який воно виправляє. */
  correction_of_transfer_id?: string;
}

/**
 * §7.9 step 1 — OWNER ONLY. `POST /transfers`.
 *
 * Invalidates `transfers` AND `pointCash` together even though a freshly
 * SENT transfer moves no cash yet (`accepted_date` is null until the point
 * answers, and `PointCashService`'s formula only sees accepted/disputed
 * rows). `PointCashRowResponse` carries `latest_transfer` — the field the
 * owner's «Перекази» table reads for its status badge — so sending a new
 * transfer must flip that badge to `sent` right away, or the row keeps
 * showing whatever the PREVIOUS transfer to that point last did.
 */
export function useSendTransferMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendTransferInput): Promise<Transfer> =>
      (await httpClient.post<Transfer>('/transfers', input)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.transfers });
      qc.invalidateQueries({ queryKey: queryKeys.pointCash });
    },
  });
}
