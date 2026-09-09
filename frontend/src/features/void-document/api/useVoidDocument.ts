import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';

export interface VoidDocumentInput {
  kind: 'intake' | 'payout';
  id: string;
  reason: string;
}

/**
 * Voids an intake or payout — `POST /intakes/:id/void` or `/payouts/:id/void`
 * with `{ reason }`. A document is never edited (§2.7 freezes `amount`, §9.3
 * makes a correction a void plus a new document): this call freezes the row
 * and the reason is what survives in the journal, so the operator writes a
 * fresh document afterwards rather than patching this one.
 *
 * Invalidates `intakes`, `payouts` AND `supplierBalances` together — a void
 * changes the supplier's running balance too (the voided amount drops out of
 * it), regardless of whether the voided document was an intake or a payout.
 */
export function useVoidDocumentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id, reason }: VoidDocumentInput): Promise<void> => {
      const path = kind === 'intake' ? `/intakes/${id}/void` : `/payouts/${id}/void`;
      await httpClient.post(path, { reason });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.intakes });
      qc.invalidateQueries({ queryKey: queryKeys.payouts });
      qc.invalidateQueries({ queryKey: queryKeys.supplierBalances });
    },
  });
}
