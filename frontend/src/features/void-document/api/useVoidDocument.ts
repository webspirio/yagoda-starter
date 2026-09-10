import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';

export interface VoidDocumentInput {
  kind: 'intake' | 'payout' | 'transfer';
  id: string;
  reason: string;
}

const PATHS = {
  intake: (id: string) => `/intakes/${id}/void`,
  payout: (id: string) => `/payouts/${id}/void`,
  transfer: (id: string) => `/transfers/${id}/void`,
} as const;

/**
 * Voids an intake, payout or transfer — `POST /<kind>s/:id/void` with
 * `{ reason }`. A document is never edited (§2.7 freezes `amount`, §9.3 makes
 * a correction a void plus a new document): this call freezes the row and the
 * reason is what survives in the journal, so the operator writes a fresh
 * document afterwards rather than patching this one.
 *
 * INVALIDATION SPLITS BY KIND, deliberately not harmonised (§9.3). An intake
 * or payout invalidates `intakes`, `payouts` AND `supplierBalances` together —
 * a void changes the supplier's running balance too. A transfer invalidates
 * `transfers` AND `pointCash` instead: voiding a transfer stops it from being
 * added to a point's cash, and it never touched a supplier's balance in the
 * first place — invalidating `supplierBalances` for it would be needless
 * network noise and a hint at a relationship that doesn't exist. This is the
 * flip side of a voided PAYOUT, which stays subtracted because that money
 * physically left the drawer.
 */
export function useVoidDocumentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id, reason }: VoidDocumentInput): Promise<void> => {
      await httpClient.post(PATHS[kind](id), { reason });
    },
    onSuccess: (_data, { kind }) => {
      if (kind === 'transfer') {
        qc.invalidateQueries({ queryKey: queryKeys.transfers });
        qc.invalidateQueries({ queryKey: queryKeys.pointCash });
        return;
      }
      qc.invalidateQueries({ queryKey: queryKeys.intakes });
      qc.invalidateQueries({ queryKey: queryKeys.payouts });
      qc.invalidateQueries({ queryKey: queryKeys.supplierBalances });
    },
  });
}
