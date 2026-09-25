import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { httpClient, apiErrorCode } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';

export type PayoutDecision = 'keep' | 'void' | 'void_returned';

export interface VoidDocumentInput {
  kind: 'intake' | 'payout' | 'transfer' | 'topUp' | 'crateIssuance' | 'crateReturn';
  id: string;
  reason: string;
  /** Intake only (#125): what happens to the payout issued with it. */
  payout?: PayoutDecision;
}

interface VoidDescriptor {
  path: (id: string) => string;
  invalidates: readonly QueryKey[];
}

/** Shared by `intake` and `payout` below — both are journal documents, and
 *  a void of either changes the supplier's running balance the same way. */
const DOCUMENT_KEYS: readonly QueryKey[] = [
  queryKeys.intakes,
  queryKeys.payouts,
  queryKeys.supplierBalances,
];

/** One void per kind; invalidation differs by kind on purpose (§9.3); a
 *  voided payout stays subtracted from cash until its return is recorded. */
const DOCUMENTS: Record<VoidDocumentInput['kind'], VoidDescriptor> = {
  intake: {
    path: (id) => `/intakes/${id}/void`,
    // + pointCash: a void_returned puts the payout back in the drawer.
    invalidates: [...DOCUMENT_KEYS, queryKeys.pointCash],
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
    mutationFn: async ({ kind, id, reason, payout }: VoidDocumentInput): Promise<void> => {
      await httpClient.post(DOCUMENTS[kind].path(id), payout ? { reason, payout } : { reason });
    },
    onSuccess: (_data, { kind }) => {
      for (const queryKey of DOCUMENTS[kind].invalidates) {
        qc.invalidateQueries({ queryKey });
      }
    },
    // These three codes all mean the dialog's own data went stale (a payout
    // voided or reassigned, or the document itself already voided, since it
    // was opened) — refetch so reopening shows what actually changed instead
    // of looping on the same stale banner (intake detail has a 60s staleTime
    // and no refetch-on-focus, so nothing else would refresh it).
    onError: (error, { kind }) => {
      const code = apiErrorCode(error);
      if (code === 'PAYOUT_DECISION_REQUIRED' || code === 'PAYOUT_DECISION_NOT_APPLICABLE' || code === 'ALREADY_VOIDED') {
        for (const queryKey of DOCUMENTS[kind].invalidates) {
          qc.invalidateQueries({ queryKey });
        }
      }
    },
  });
}
