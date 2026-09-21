import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { IntakeDetail } from '@/entities/intake';
import type { CreateIntakeBody, IntakePreview, PreviewIntakeBody } from '../model/intakeForm';

/**
 * Records the receipt — `POST /intakes` writes the whole document in one
 * transaction (§2.3), now with an OPTIONAL payout in the same write (§2.1 ⑥,
 * §3.1, §3.6). Invalidates the intake journal, `supplierBalances` (an intake
 * is one of the two flows, with payouts, that move a supplier's Σ intakes −
 * Σ payouts number), and — since a payout may have ridden along — `payouts`
 * and `pointCash` too: the SAME write can move the point's drawer, exactly
 * as `features/settle-payout`'s `useCreatePayoutMutation` already invalidates
 * for a payout recorded on its own.
 */
export function useCreateIntakeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateIntakeBody): Promise<IntakeDetail> => {
      const { data } = await httpClient.post<IntakeDetail>('/intakes', body);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.intakes });
      qc.invalidateQueries({ queryKey: queryKeys.payouts });
      qc.invalidateQueries({ queryKey: queryKeys.pointCash });
      qc.invalidateQueries({ queryKey: queryKeys.supplierBalances });
    },
  });
}

/**
 * Computes the numbers §2.4/§2.8/§2.9 reserve to the server — net weight,
 * price, bonus, and the line/document amounts — WITHOUT writing anything.
 * Nothing here invalidates a cache: a preview is not an event. Consumed by
 * `useIntakePreview`, which debounces and gates when this fires.
 */
export function usePreviewIntakeMutation() {
  return useMutation({
    mutationFn: async (body: PreviewIntakeBody): Promise<IntakePreview> => {
      const { data } = await httpClient.post<IntakePreview>('/intakes/preview', body);
      return data;
    },
  });
}
