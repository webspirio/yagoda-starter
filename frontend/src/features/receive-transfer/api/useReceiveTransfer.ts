import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Transfer } from '@/entities/transfer';

/**
 * Both point actions — «Прийняв» and «Не сходиться» — invalidate the same
 * three keys. `transfers` because the document itself just changed;
 * `pointCash` because an accepted transfer moves the point's cash figure
 * immediately, and — under the 09.09.2026 ruling — so does a disputed one:
 * `reported_cash` already counts while the dispute sits open. `shifts`
 * because accepting/disputing requires an OPEN SHIFT and stamps that
 * shift's `accepted_date` (§4.1) — the shift the point is working is part of
 * what a fresh accept/dispute can change.
 */
function useInvalidateTransferAnswer() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.transfers });
    qc.invalidateQueries({ queryKey: queryKeys.pointCash });
    qc.invalidateQueries({ queryKey: queryKeys.shifts });
  };
}

/**
 * §7.9 step 4а — «Прийняв». POINT OPERATOR ONLY, refused to the owner
 * (§10.3). No body — see `TransfersService.accept`'s own comment: a point
 * that could type a number here would never press the other button, and the
 * dispute record would never be written.
 */
export function useAcceptTransferMutation() {
  const invalidate = useInvalidateTransferAnswer();
  return useMutation({
    mutationFn: async (id: string): Promise<Transfer> =>
      (await httpClient.post<Transfer>(`/transfers/${id}/accept`)).data,
    onSuccess: invalidate,
  });
}

export interface DisputeTransferInput {
  id: string;
  /** Скільки нарахувала точка. Рядок — гроші ніколи не `number`. */
  reported_cash: string;
  reported_crates: number;
  dispute_note: string;
}

/** §7.9 step 4б — «Не сходиться». POINT OPERATOR ONLY, refused to the owner (§10.3). */
export function useDisputeTransferMutation() {
  const invalidate = useInvalidateTransferAnswer();
  return useMutation({
    mutationFn: async ({ id, ...body }: DisputeTransferInput): Promise<Transfer> =>
      (await httpClient.post<Transfer>(`/transfers/${id}/dispute`, body)).data,
    onSuccess: invalidate,
  });
}
