import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Transfer } from '@/entities/transfer';

/**
 * Both point actions — «Прийняв» and «Не сходиться» — invalidate the same
 * two keys. `transfers` because the document itself just changed;
 * `pointCash` because an accepted transfer moves the point's cash figure
 * immediately, and — under the 09.09.2026 ruling — so does a disputed one:
 * `reported_cash` already counts while the dispute sits open.
 *
 * NOT `shifts`, though §4.1 makes an open shift a precondition.
 * `TransfersService.transition` READS that shift to learn its business date
 * and then writes `accepted_date`/`accepted_at` ON THE TRANSFER ROW — the
 * shift row is never touched (`m.save(Transfer, transfer)` is the only save
 * in the transaction). Invalidating a key nothing changed just refetches
 * every shift query on screen.
 */
function useInvalidateTransferAnswer() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.transfers });
    qc.invalidateQueries({ queryKey: queryKeys.pointCash });
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
