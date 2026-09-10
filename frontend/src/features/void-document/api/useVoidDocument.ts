import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';

export interface VoidDocumentInput {
  kind: 'intake' | 'payout' | 'transfer';
  id: string;
  reason: string;
}

interface VoidDescriptor {
  path: (id: string) => string;
  invalidates: readonly QueryKey[];
}

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
const DOCUMENTS: Record<VoidDocumentInput['kind'], VoidDescriptor> = {
  intake: {
    path: (id) => `/intakes/${id}/void`,
    invalidates: [queryKeys.intakes, queryKeys.payouts, queryKeys.supplierBalances],
  },
  payout: {
    path: (id) => `/payouts/${id}/void`,
    invalidates: [queryKeys.intakes, queryKeys.payouts, queryKeys.supplierBalances],
  },
  transfer: {
    path: (id) => `/transfers/${id}/void`,
    invalidates: [queryKeys.transfers, queryKeys.pointCash],
  },
};

export function useVoidDocumentMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, id, reason }: VoidDocumentInput): Promise<void> => {
      await httpClient.post(DOCUMENTS[kind].path(id), { reason });
    },
    onSuccess: (_data, { kind }) => {
      for (const queryKey of DOCUMENTS[kind].invalidates) {
        qc.invalidateQueries({ queryKey });
      }
    },
  });
}
