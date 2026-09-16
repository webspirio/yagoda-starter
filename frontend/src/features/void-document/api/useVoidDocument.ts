import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';

export interface VoidDocumentInput {
  kind: 'intake' | 'payout' | 'transfer' | 'topUp' | 'crateIssuance' | 'crateReturn';
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
/** Shared by `intake` and `payout` below — both are journal documents, and
 *  a void of either changes the supplier's running balance the same way. */
const DOCUMENT_KEYS: readonly QueryKey[] = [
  queryKeys.intakes,
  queryKeys.payouts,
  queryKeys.supplierBalances,
];

const DOCUMENTS: Record<VoidDocumentInput['kind'], VoidDescriptor> = {
  intake: {
    path: (id) => `/intakes/${id}/void`,
    invalidates: DOCUMENT_KEYS,
  },
  payout: {
    path: (id) => `/payouts/${id}/void`,
    invalidates: DOCUMENT_KEYS,
  },
  transfer: {
    path: (id) => `/transfers/${id}/void`,
    invalidates: [queryKeys.transfers, queryKeys.pointCash],
  },
  // A TOP-UP HAS NO SHIFT, so `intakes` and `payouts` are untouched by voiding
  // one — the third kind of key set, not a copy of either. What moves is the
  // supplier's debt, and voiding a top-up that was ALREADY PAID OUT drives that
  // debt negative. That is legal: the money left the drawer, so the balance
  // must show it, exactly as a voided receipt does.
  topUp: {
    path: (id) => `/intake-top-ups/${id}/void`,
    invalidates: [queryKeys.intakeTopUps, queryKeys.supplierBalances],
  },
  // CRATES ARE NOT MONEY OWED FOR BERRIES, so neither of these touches
  // `supplierBalances` — a person can owe twenty crates and be owed nothing for
  // berries, or the reverse. They DO touch `pointCash`: a deposit issuance
  // moves cash into the point's crates book, and voiding it moves that cash
  // back out.
  crateIssuance: {
    path: (id) => `/crate-issuances/${id}/void`,
    invalidates: [queryKeys.crates, queryKeys.crateBalances, queryKeys.pointCash],
  },
  crateReturn: {
    path: (id) => `/crate-returns/${id}/void`,
    invalidates: [queryKeys.crates, queryKeys.crateBalances, queryKeys.pointCash],
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
