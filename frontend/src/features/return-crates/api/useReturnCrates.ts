import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { CrateReturn, CrateReturnPreview } from '@/entities/crate';

export interface ReturnCratesInput {
  collection_point_id?: string;
  supplier_id: string;
  units: number;
}

/**
 * THE SPLIT THE SERVER WOULD MAKE, before anything is written.
 *
 * §6.5 says the operator is never asked which tranche a return comes from —
 * returns consume the oldest issuances first and refund each at the price IT
 * was taken at. That is the right rule and a completely opaque one: someone
 * who took 20 crates at 120 ₴ and 20 at 130 ₴ and brings back 25 gets a refund
 * neither number explains. So the screen must SHOW the split, and it must be
 * the SERVER'S split — recomputing FIFO on the client would be a second
 * implementation of the rule that decides real money.
 *
 * A POST that writes nothing, so it is modelled as a query: `enabled` only
 * once both inputs are real, keyed by them, and never cached (`queryKeys.crates`
 * is off `shared/api/cachePolicy.ts`'s allowlist) because a stale preview is a
 * wrong number about money.
 */
export function useReturnPreviewQuery(input: {
  supplierId: string | null;
  units: number;
  pointId?: string;
}) {
  return useQuery({
    queryKey: [...queryKeys.crates, 'return-preview', input] as const,
    enabled: input.supplierId !== null && Number.isInteger(input.units) && input.units > 0,
    retry: false,
    queryFn: async (): Promise<CrateReturnPreview> => {
      const { data } = await httpClient.post<CrateReturnPreview>('/crate-returns/preview', {
        supplier_id: input.supplierId,
        units: input.units,
        ...(input.pointId ? { collection_point_id: input.pointId } : {}),
      });
      return data;
    },
  });
}

/** Accepts crates back and refunds the deposit the server allocated. */
export function useReturnCratesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReturnCratesInput): Promise<CrateReturn> => {
      const { data } = await httpClient.post<CrateReturn>('/crate-returns', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.crates });
      qc.invalidateQueries({ queryKey: queryKeys.crateBalances });
      qc.invalidateQueries({ queryKey: queryKeys.pointCash });
    },
  });
}
