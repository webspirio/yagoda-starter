import { useMutation, useQueryClient } from '@tanstack/react-query';
import { httpClient } from '@/shared/api';
import { queryKeys } from '@/shared/api/queryKeys';
import type { CrateIssuance, CrateIssuanceMode } from '@/entities/crate';

export interface IssueCratesInput {
  /** Omitted for an operator — their point comes from the token. */
  collection_point_id?: string;
  supplier_id: string;
  units: number;
  mode: CrateIssuanceMode;
}

/**
 * Hands crates to a supplier (§6.4). `deposit` takes money into the crates
 * drawer; `receipt` takes a signature and no money at all.
 *
 * INVALIDATES `pointCash` TOO, and only because of `deposit`: that mode moves
 * cash into the point's crates book, which the cash screen reads. A `receipt`
 * issuance moves none — but branching the invalidation on the mode would make
 * a stale cash figure depend on which radio button was selected, which is a
 * worse failure than one extra refetch.
 */
export function useIssueCratesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: IssueCratesInput): Promise<CrateIssuance> => {
      const { data } = await httpClient.post<CrateIssuance>('/crate-issuances', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.crates });
      qc.invalidateQueries({ queryKey: queryKeys.crateBalances });
      qc.invalidateQueries({ queryKey: queryKeys.pointCash });
    },
  });
}
