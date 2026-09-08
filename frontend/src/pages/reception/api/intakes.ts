import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { IntakeDetail } from '@/entities/intake';
import type { Shift } from '@/entities/shift';
import type { CreateIntakeBody, IntakePreview, PreviewIntakeBody } from '../model/intakeForm';

/**
 * Operator only — the point is the actor's own, derived from the token; no body.
 *
 * A DELIBERATE DUPLICATE of `pages/day/api/shiftActions.ts`'s
 * `useOpenShiftMutation`, invalidations included: a page may not import from
 * another page, and the eight lines here are not worth promoting a shift WRITE
 * into `entities/shift` (which owns reads). If a third screen ever opens a
 * shift, move both to a `features/` slice rather than adding a third copy.
 */
export function useOpenShiftMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<Shift> => (await httpClient.post<Shift>('/shifts')).data,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.shifts }),
        qc.invalidateQueries({ queryKey: queryKeys.intakes }),
        qc.invalidateQueries({ queryKey: queryKeys.payouts }),
      ]),
  });
}

/**
 * Records the receipt — `POST /intakes` writes the whole document in one
 * transaction (§2.3). Invalidates both the intake journal AND
 * `supplierBalances`: an intake is one of the two flows (with payouts) that
 * move a supplier's Σ intakes − Σ payouts number, so both caches go stale
 * together — same shape as `features/settle-payout`'s `useCreatePayoutMutation`.
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
