import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { Payout } from '@/entities/payout';

export interface CreatePayoutInput {
  code: string;
  supplier_id: string;
  amount: string;
  /** Owner only — an operator's point is resolved server-side from their token. */
  collection_point_id?: string;
}

/**
 * Records a payout — a standalone document (never a patch on an intake; see
 * `entities/payout`). Invalidates both the payout journal AND
 * `supplierBalances`: a payout is one of the two flows (with intakes) that
 * move a supplier's Σ intakes − Σ payouts number, so both caches go stale
 * together.
 */
export function useCreatePayoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePayoutInput): Promise<Payout> => {
      const { data } = await httpClient.post<Payout>('/payouts', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payouts });
      qc.invalidateQueries({ queryKey: queryKeys.supplierBalances });
    },
  });
}
