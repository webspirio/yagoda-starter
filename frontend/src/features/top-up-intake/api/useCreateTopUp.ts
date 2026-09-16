import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { IntakeTopUp } from '@/entities/intake-top-up';

export interface CreateTopUpInput {
  intake_id: string;
  amount: string;
  /** REQUIRED and non-blank — the server enforces `@Length(1,500)` AND a `\S`
   *  test, because `'   '` passes a length check and leaves whitespace standing
   *  as the explanation for a 2 000 ₴ debt. */
  reason: string;
}

/**
 * «Фантомний залишок» (#61) — the owner adds a fixed amount of supplier debt
 * against an ALREADY-RECORDED receipt, when a price was renegotiated after the
 * fact.
 *
 * INVALIDATES `intakeTopUps` AND `supplierBalances`, and nothing else. The
 * balance is the entire reason the row exists — `Σ intakes + Σ top-ups −
 * Σ payouts` — while `intakes` and `payouts` are untouched: a top-up has no
 * shift and joins the world only through its parent receipt.
 */
export function useCreateTopUpMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateTopUpInput): Promise<IntakeTopUp> => {
      const { data } = await httpClient.post<IntakeTopUp>('/intake-top-ups', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.intakeTopUps });
      qc.invalidateQueries({ queryKey: queryKeys.supplierBalances });
    },
  });
}
